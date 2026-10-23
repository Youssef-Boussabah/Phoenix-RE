import { it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ListEvidenceInput, Finding, Observation } from '@phoenix/contracts';
import { EVIDENCE_LIST_SQL } from '../src/repos/evidence.js';
import { LEGACY_EVIDENCE_SQL } from './support/legacy-evidence-query.js';
import { seedQueryRows } from './support/query-fixtures.js';
import { fixture, cleanup, target, job, id, time } from './helpers.js';
function parameters(value: unknown) {
  const p = ListEvidenceInput.parse(value);
  return [
    p.cursor ?? '',
    p.targetId ?? null,
    p.targetId ?? null,
    p.jobId ?? null,
    p.jobId ?? null,
    p.projectId ?? null,
    p.projectId ?? null,
    p.artifactsOnly ? 1 : 0,
    p.limit + 1,
  ];
}
it('uses indexed UNION arms and scales without nested full scans', async () => {
  const f = await fixture();
  const samples = [];
  try {
    for (const count of [1000, 5000]) {
      seedQueryRows(f, count);
      const params = parameters({ artifactsOnly: true, limit: 10 });
      const plan = f.store.db.all('EXPLAIN QUERY PLAN ' + EVIDENCE_LIST_SQL, ...params);
      const details = plan.map((row) => String(row['detail'])).join('\n');
      expect(details).not.toContain('LEFT-JOIN');
      for (const index of [
        'targets_artifact',
        'targets_inventory_artifact',
        'jobs_target',
        'jobs_candidate_target',
        'observations_data_artifact',
      ])
        expect(details).toContain(index);
      // Each right side of a target/job association must be searched by an index.
      expect(details).not.toMatch(/SCAN j\b/);
      const times = [];
      for (let attempt = 0; attempt < 5; attempt++) {
        const start = performance.now();
        const page = f.store.evidence.list({ artifactsOnly: true, limit: 10 });
        times.push(performance.now() - start);
        expect(page.items).toHaveLength(10);
        expect(page.nextCursor).toBeTypeOf('string');
      }
      samples.push({
        artifacts: count,
        targets: Number(f.store.db.get('SELECT count(*) n FROM targets')?.['n']),
        ms: times,
        plan,
      });
    }
    const small = [...(samples[0]?.ms ?? [])].sort((a, b) => a - b)[2] ?? Infinity;
    const large = [...(samples[1]?.ms ?? [])].sort((a, b) => a - b)[2] ?? Infinity;
    // Generous timing bounds tolerate instrumentation and shared CI hosts. Query
    // plans are the structural gate; these bounds detect the old multi-second cliff.
    expect(large).toBeLessThan(1500);
    expect(large).toBeLessThan(small * 15 + 200);
    await appendFile(
      join(tmpdir(), 'phoenix-wp4-query-after.jsonl'),
      JSON.stringify({ node: process.version, samples }) + '\n',
    );
  } finally {
    await cleanup(f.directory, f.store);
  }
}, 30000);
it('preserves inclusion, filtering, candidate links, deduplication and page ordering', async () => {
  const f = await fixture();
  try {
    const a = await f.store.artifacts.putBytes(Buffer.from('shared target bytes'), 'text/plain');
    const make = (name: string) =>
      f.store.repos.targets.add(
        target(f.project.id, {
          localPath: join(f.directory, name),
          artifactId: a.id,
          sha256: a.sha256,
          digest: { algorithm: 'sha256', value: a.sha256 },
          sizeBytes: a.sizeBytes,
        }),
      );
    const primary = make('primary'),
      candidate = make('candidate');
    const verify = f.store.repos.jobs.create(
      job(primary, { mode: 'verify', candidateTargetId: candidate.id }),
    );
    const inventory = await f.store.artifacts.putBytes(
      Buffer.from('{"schemaVersion":1,"entries":[]}'),
      'application/vnd.phoenix.inventory+json',
    );
    const directory = f.store.repos.targets.add(
      target(f.project.id, {
        localPath: join(f.directory, 'directory'),
        source: { type: 'directory', displayName: 'directory' },
        classification: { ...f.t.classification, format: 'directory' },
        sha256: undefined,
        digest: undefined,
        inventoryArtifactId: inventory.id,
      }),
    );
    const directoryJob = f.store.repos.jobs.create(job(directory));
    const producer = { type: 'user', id: 'query-test', version: '1' },
      output = await f.store.artifacts.putBytes(Buffer.from('observed'), 'text/plain');
    const o = f.store.repos.observations.insert(
      Observation.parse({
        schemaVersion: 1,
        id: id('obs'),
        targetId: candidate.id,
        jobId: verify.id,
        producer,
        kind: 'user',
        type: 'observed',
        dataArtifactId: output.id,
        createdAt: time,
      }),
    );
    const ref = f.store.repos.evidenceRefs.insert({
      id: id('evr'),
      kind: 'user',
      artifactId: output.id,
      observationId: o.id,
    });
    f.store.repos.findings.append(
      Finding.parse({
        schemaVersion: 1,
        id: id('fnd'),
        targetId: candidate.id,
        statement: 'Observed bytes',
        status: 'observed',
        evidence: [ref],
        limitations: [],
        revision: 1,
        author: producer,
        createdAt: time,
      }),
      { jobId: verify.id },
    );
    const orphan = await f.store.artifacts.putBytes(Buffer.from('orphan'), 'text/plain');
    const cases = [
      {},
      { artifactsOnly: true },
      { projectId: f.project.id },
      { targetId: primary.id },
      { targetId: candidate.id },
      { jobId: verify.id },
      { jobId: directoryJob.id },
      { jobId: verify.id, targetId: candidate.id, artifactsOnly: true },
      { targetId: f.t.id },
      { projectId: id('prj') },
      { limit: 1 },
    ];
    for (const selection of cases) {
      const expected = f.store.db.all(LEGACY_EVIDENCE_SQL, ...parameters(selection));
      const actual = f.store.db.all(EVIDENCE_LIST_SQL, ...parameters(selection));
      expect(actual).toEqual(expected);
    }
    const page = f.store.evidence.list({ limit: 1 });
    const ids = page.items.map((i) =>
      i.type === 'artifact' ? i.artifact.id : i.type === 'finding' ? i.finding.id : i.observation.id,
    );
    let cursor = page.nextCursor;
    while (cursor) {
      const next = f.store.evidence.list({ cursor, limit: 1 });
      ids.push(
        ...next.items.map((i) =>
          i.type === 'artifact' ? i.artifact.id : i.type === 'finding' ? i.finding.id : i.observation.id,
        ),
      );
      cursor = next.nextCursor;
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(orphan.id);
    expect(ids).toEqual([...ids].sort());
    expect(
      f.store.evidence
        .list({ jobId: verify.id, artifactsOnly: true })
        .items.map((i) => (i.type === 'artifact' ? i.artifact.id : '')),
    ).toEqual([a.id, output.id].sort());
    expect(f.store.evidence.list({ jobId: directoryJob.id, artifactsOnly: true }).items).toMatchObject([
      { type: 'artifact', artifact: inventory },
    ]);
    expect(
      f.store.evidence
        .list({ projectId: f.project.id })
        .items.some((i) => i.type === 'artifact' && i.artifact.id === orphan.id),
    ).toBe(false);
    expect(f.store.evidence.list({ targetId: candidate.id }).items.every((i) => !i.stale)).toBe(true);
  } finally {
    await cleanup(f.directory, f.store);
  }
});
