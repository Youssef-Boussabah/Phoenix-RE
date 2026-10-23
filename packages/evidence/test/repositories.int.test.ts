import { it, expect } from 'vitest';
import { createEvidenceStore } from '@phoenix/evidence';
import {
  Observation,
  Finding,
  EvidenceRef,
  JobStep,
  RelationId,
  ToolResponseEnvelope,
  AnalysisRequest,
  JobId,
} from '@phoenix/contracts';
import { fixture, cleanup, target, job, event, id, time } from './helpers.js';
async function withFixture(
  fn: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void> | void,
): Promise<void> {
  const f = await fixture();
  try {
    await fn(f);
  } finally {
    await cleanup(f.directory, f.store);
  }
}
const producer = { type: 'user', id: 'test', version: '1' };
it('validates incoming records, uniqueness, foreign keys and bounded deterministic lists', async () =>
  withFixture((f) => {
    expect(() => f.store.repos.projects.create({ name: '' })).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    expect(() => f.store.repos.projects.create({ name: 'test' })).toThrow(
      expect.objectContaining({ code: 'STORAGE_ERROR' }),
    );
    for (const name of ['second', 'third']) f.store.repos.projects.create({ name });
    const first = f.store.repos.projects.list({ limit: 1 })[0];
    if (!first) throw new Error();
    expect(f.store.repos.projects.get(first.id)).toEqual(first);
    expect(f.store.repos.projects.list({ limit: 1, cursor: first.id })[0]?.id.localeCompare(first.id)).toBe(
      1,
    );
    expect(() => f.store.repos.projects.list({ limit: 5001 })).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    expect(() => f.store.repos.projects.get(id('prj'))).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    const unknown = target(f.project.id, { projectId: id('prj') });
    expect(() => f.store.repos.targets.add(unknown)).toThrow(
      expect.objectContaining({ code: 'STORAGE_ERROR' }),
    );
    expect(() =>
      f.store.repos.targets.add(
        target(f.project.id, { artifactId: id('art'), localPath: '/different-source' }),
      ),
    ).toThrow(expect.objectContaining({ code: 'STORAGE_ERROR' }));
  }));
it('local targets deduplicate by complete source digest and preserve supersession/staleness', async () =>
  withFixture((f) => {
    expect(f.store.repos.targets.add(target(f.project.id))).toEqual(f.t);
    const next = target(f.project.id, {
      sha256: 'b'.repeat(64),
      digest: { algorithm: 'sha256', value: 'b'.repeat(64) },
    });
    const saved = f.store.repos.targets.add(next);
    expect(saved.supersedes).toBe(f.t.id);
    expect(f.store.repos.targets.stale(f.t.id)).toBe(true);
    expect(f.store.repos.targets.stale(saved.id, 'a'.repeat(64))).toBe(true);
    expect(f.store.repos.relations.list()[0]).toMatchObject({
      fromId: saved.id,
      toId: f.t.id,
      relation: 'supersedes',
    });
    expect(f.store.repos.targets.list()).toHaveLength(2);
    expect(f.store.repos.targets.get(saved.id)).toEqual(saved);
    expect(() => f.store.repos.targets.get(id('tgt'))).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(() => f.store.repos.targets.add({ ...f.t, metadata: { changed: true } })).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    expect(() => f.store.repos.targets.add(target(f.project.id, { localPath: undefined }))).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
  }));
it('sanitizes real credential-bearing target fields and never merges query-dependent URL intakes', async () => {
  const f = await fixture();
  let reopened;
  try {
    const raw =
      'https://alice:private-password@example.com/a/../app?token=private-token&signature=private-signature#private-fragment';
    const make = (url: string) =>
      target(f.project.id, {
        source: { type: 'url', displayName: url },
        localPath: undefined,
        digest: undefined,
        sha256: undefined,
        url,
        uri: url,
        metadata: { original: url, nested: { ['source ' + url]: url } },
        warnings: [{ code: 'INPUT', message: 'Input ' + url }],
      });
    const one = f.store.repos.targets.add(make(raw));
    const two = f.store.repos.targets.add(make(raw.replace('private-token', 'different-token')));
    expect(one.url).toBe('https://example.com/app');
    expect(one.uri).toBe(one.url);
    expect(two.id).not.toBe(one.id);
    expect(two.supersedes).toBeUndefined();
    expect(f.store.repos.targets.stale(one.id)).toBe(false);
    expect(f.store.repos.targets.add(one)).toEqual(one);
    expect(() => f.store.repos.targets.add({ ...one, supersedes: two.id })).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    await f.store.close();
    reopened = await createEvidenceStore({ dataDir: f.directory });
    const serialized = JSON.stringify({
      records: reopened.repos.targets.list(),
      rows: reopened.db.all('SELECT * FROM targets'),
      relations: reopened.db.all('SELECT * FROM relations'),
    });
    for (const secret of [
      'alice',
      'private-password',
      'private-token',
      'private-signature',
      'private-fragment',
      'different-token',
    ])
      expect(serialized).not.toContain(secret);
    expect(
      reopened.db
        .all("SELECT source_key FROM targets WHERE source_type='url'")
        .every((r) => String(r['source_key']).startsWith('intake:tgt_')),
    ).toBe(true);
  } finally {
    await cleanup(f.directory, f.store, ...(reopened ? [reopened] : []));
  }
});
it.each(['json', 'schema', 'columns', 'unsafe-url'])('fails closed on corrupted target %s', async (mode) =>
  withFixture((f) => {
    f.store.db.exec('DROP TRIGGER targets_no_update');
    if (mode === 'columns') f.store.db.run("UPDATE targets SET kind='elf' WHERE id=?", f.t.id);
    else {
      const corrupt =
        mode === 'json'
          ? '{broken'
          : mode === 'schema'
            ? JSON.stringify({ schemaVersion: 1 })
            : JSON.stringify({ ...f.t, metadata: { url: 'https://user:secret@example.com/app?key=secret' } });
      f.store.db.run('UPDATE targets SET manifest_json=? WHERE id=?', corrupt, f.t.id);
    }
    expect(() => f.store.repos.targets.get(f.t.id)).toThrow(
      expect.objectContaining({ code: 'STORAGE_ERROR' }),
    );
  }),
);
it('persists explicit JSON null separately from absent artifact-backed observation data', async () =>
  withFixture(async (f) => {
    const a = await f.store.artifacts.putBytes(Buffer.from('large output'), 'text');
    const make = (extra: Record<string, unknown>) =>
      Observation.parse({
        schemaVersion: 1,
        id: id('obs'),
        targetId: f.t.id,
        producer,
        kind: 'user',
        type: 'test',
        createdAt: time,
        ...extra,
      });
    const inline = f.store.repos.observations.insert(make({ data: null })),
      backed = f.store.repos.observations.insert(make({ dataArtifactId: a.id }));
    expect(f.store.db.get('SELECT data_json FROM observations WHERE id=?', inline.id)?.['data_json']).toBe(
      'null',
    );
    expect(
      f.store.db.get('SELECT data_json FROM observations WHERE id=?', backed.id)?.['data_json'],
    ).toBeNull();
    expect(f.store.repos.observations.get(inline.id).data).toBeNull();
    expect(f.store.repos.observations.get(backed.id).data).toBeUndefined();
    expect(f.store.repos.observations.list()).toHaveLength(2);
    expect(() =>
      f.store.repos.observations.insert({ ...backed, id: id('obs'), dataArtifactId: id('art') }),
    ).toThrow(expect.objectContaining({ code: 'STORAGE_ERROR' }));
    expect(() =>
      f.store.repos.observations.insert({ ...inline, id: id('obs'), jobId: JobId.parse(id('job')) }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    const page = f.store.evidence.list({ targetId: f.t.id, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTypeOf('string');
    expect(f.store.evidence.list({ targetId: f.t.id, cursor: page.nextCursor }).items).toHaveLength(2);
    expect(f.store.evidence.list({ artifactsOnly: true, targetId: f.t.id }).items).toMatchObject([
      { type: 'artifact', artifact: a },
    ]);
    f.store.db.exec('DROP TRIGGER observations_no_update');
    f.store.db.run("UPDATE observations SET producer_json='{}' WHERE id=?", inline.id);
    expect(() => f.store.repos.observations.get(inline.id)).toThrow(
      expect.objectContaining({ code: 'STORAGE_ERROR' }),
    );
  }));
it('keeps finding revisions and evidence provenance in one transaction', async () =>
  withFixture(async (f) => {
    const a = await f.store.artifacts.putBytes(Buffer.from('bytes'), 'text');
    const o = f.store.repos.observations.insert(
      Observation.parse({
        schemaVersion: 1,
        id: id('obs'),
        targetId: f.t.id,
        jobId: f.j.id,
        producer,
        kind: 'static',
        type: 'test',
        data: { actual: true },
        dataArtifactId: a.id,
        createdAt: time,
      }),
    );
    const e = EvidenceRef.parse({
      id: id('evr'),
      kind: 'static',
      artifactId: a.id,
      observationId: o.id,
      locator: { type: 'byte-range', offset: 0, length: 5 },
    });
    const base = Finding.parse({
      schemaVersion: 1,
      id: id('fnd'),
      targetId: f.t.id,
      statement: 'Possibly text',
      status: 'hypothesis',
      evidence: [],
      limitations: [],
      revision: 1,
      author: producer,
      createdAt: time,
    });
    f.store.repos.findings.append(base, { jobId: f.j.id });
    const next = Finding.parse({
      ...base,
      status: 'observed',
      statement: 'Read actual bytes',
      revision: 2,
      evidence: [e],
    });
    f.store.repos.findings.append(next, { reason: 'Read bytes' });
    expect(f.store.repos.findings.get(base.id)).toEqual(next);
    expect(f.store.repos.findings.get(base.id, 1)).toEqual(base);
    expect(f.store.repos.findings.history(base.id)).toEqual([base, next]);
    expect(f.store.repos.findings.list()).toEqual([next]);
    expect(f.store.repos.evidenceRefs.list()).toEqual([e]);
    expect(f.store.repos.evidenceRefs.get(e.id)).toEqual(e);
    expect(() =>
      f.store.repos.findings.append({ ...next, revision: 3, evidence: [{ ...e, location: 'changed' }] }),
    ).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() =>
      f.store.repos.findings.append({
        ...next,
        revision: 3,
        evidence: [{ ...e, id: id('evr'), artifactId: id('art') }],
      }),
    ).toThrow(expect.objectContaining({ code: 'STORAGE_ERROR' }));
    expect(f.store.repos.findings.get(base.id).revision).toBe(2);
    expect(f.store.repos.findings.history(base.id)).toHaveLength(2);
    expect(() => f.store.repos.findings.append({ ...next, revision: 3, evidence: [] })).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    expect(() => f.store.repos.findings.append({ ...base, id: id('fnd'), revision: 2 })).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    expect(
      f.store.evidence
        .list({ jobId: f.j.id })
        .items.map((v) => v.type)
        .sort(),
    ).toEqual(['artifact', 'finding', 'observation']);
  }));
it.each([
  'job_events',
  'finding_revisions',
  'observations',
  'targets',
  'artifacts',
  'evidence_refs',
  'finding_evidence',
  'relations',
])('enforces append-only %s UPDATE and DELETE triggers', async (table) =>
  withFixture(async (f) => {
    const a = await f.store.artifacts.putBytes(Buffer.from('test'), 'text');
    const o = f.store.repos.observations.insert(
      Observation.parse({
        schemaVersion: 1,
        id: id('obs'),
        targetId: f.t.id,
        producer,
        kind: 'user',
        type: 'test',
        data: null,
        dataArtifactId: a.id,
        createdAt: time,
      }),
    );
    f.store.repos.findings.append(
      Finding.parse({
        schemaVersion: 1,
        id: id('fnd'),
        targetId: f.t.id,
        statement: 'Actual',
        status: 'observed',
        evidence: [{ id: id('evr'), kind: 'user', artifactId: a.id, observationId: o.id }],
        limitations: [],
        revision: 1,
        author: producer,
        createdAt: time,
      }),
    );
    f.store.repos.events.append(event(f.j));
    f.store.repos.relations.append({
      id: RelationId.parse(id('rel')),
      fromType: 'target',
      fromId: f.t.id,
      relation: 'supports',
      toType: 'artifact',
      toId: a.id,
      createdAt: time,
    });
    const column =
      table === 'job_events'
        ? 'id'
        : table === 'finding_revisions' || table === 'finding_evidence'
          ? 'finding_id'
          : 'id';
    expect(() => {
      f.store.db.exec(`UPDATE ${table} SET ${column}=${column}`);
    }).toThrow(expect.objectContaining({ code: 'STORAGE_ERROR' }));
    expect(() => {
      f.store.db.exec(`DELETE FROM ${table}`);
    }).toThrow(expect.objectContaining({ code: 'STORAGE_ERROR' }));
  }),
);
it('validates polymorphic relation endpoints and deterministic pagination', async () =>
  withFixture((f) => {
    const r = {
      id: RelationId.parse(id('rel')),
      fromType: 'project' as const,
      fromId: f.project.id,
      relation: 'supports' as const,
      toType: 'target' as const,
      toId: f.t.id,
      createdAt: time,
    };
    expect(f.store.repos.relations.append(r)).toEqual(r);
    expect(f.store.repos.relations.get(r.id)).toEqual(r);
    expect(() =>
      f.store.repos.relations.append({ ...r, id: RelationId.parse(id('rel')), toId: id('tgt') }),
    ).toThrow(expect.objectContaining({ code: 'STORAGE_ERROR' }));
    expect(() => f.store.repos.relations.append({ ...r, fromType: 'unknown' as 'target' })).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    expect(() => f.store.repos.relations.get(id('rel'))).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  }));
it('stores invocation envelopes, validates provenance and reads serialized JSON', async () =>
  withFixture((f) => {
    const req = AnalysisRequest.parse({
      requestId: id('req'),
      targetId: f.t.id,
      operation: 'inspect_target',
      params: {},
      limits: {},
    });
    const env = ToolResponseEnvelope.parse({
      schemaVersion: 1,
      requestId: req.requestId,
      targetId: f.t.id,
      operation: req.operation,
      providerId: 'phoenix.fileinfo',
      providerVersion: '1',
      timestamp: time,
      status: 'ok',
      durationMs: 1,
      data: { real: true },
      evidenceRefs: [],
      artifacts: [],
      warnings: [],
      error: null,
    });
    const invocation = { request: req, envelope: env, jobId: f.j.id, cacheKey: 'c'.repeat(64) };
    expect(f.store.repos.invocations.append(invocation)).toEqual(invocation);
    expect(f.store.repos.invocations.list()).toEqual([invocation]);
    const observation = Observation.parse({
      schemaVersion: 1,
      id: id('obs'),
      targetId: f.t.id,
      jobId: f.j.id,
      requestId: req.requestId,
      producer,
      kind: 'static',
      type: 'tool',
      data: null,
      createdAt: time,
    });
    expect(f.store.repos.observations.insert(observation)).toEqual(observation);
    expect(() =>
      f.store.repos.invocations.append({
        ...invocation,
        envelope: { ...env, requestId: AnalysisRequest.parse({ ...req, requestId: id('req') }).requestId },
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() => f.store.repos.invocations.get(id('req'))).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    f.store.db.run("UPDATE tool_invocations SET envelope_json='broken' WHERE request_id=?", req.requestId);
    expect(() => f.store.repos.invocations.get(req.requestId)).toThrow(
      expect.objectContaining({ code: 'STORAGE_ERROR' }),
    );
  }));
it('commits job state, version, step and events atomically and rejects stale or illegal updates', async () =>
  withFixture((f) => {
    const step = JobStep.parse({
      schemaVersion: 1,
      id: id('stp'),
      jobId: f.j.id,
      stepKey: 'intake',
      status: 'pending',
      attempt: 0,
      maxAttempts: 2,
      createdAt: time,
    });
    const next = { ...f.j, state: 'fingerprinting', version: 1 };
    const changed = event(f.j, {
      type: 'job_state_changed',
      payload: { from: 'created', to: 'fingerprinting' },
    });
    f.store.repos.jobs.save(next, 0, [changed], [{ record: step }]);
    expect(f.store.repos.jobs.get(f.j.id)).toMatchObject(next);
    expect(f.store.repos.steps.list()).toEqual([step]);
    const saved = f.store.repos.events.list(f.j.id)[1];
    expect(saved?.seq).toBeGreaterThan(0);
    expect(f.store.repos.events.append(changed)).toEqual(saved);
    expect(f.store.repos.events.list(f.j.id)).toHaveLength(2);
    expect(() => f.store.repos.events.append({ ...changed, createdAt: '2026-10-22T13:00:00.000Z' })).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    expect(() => f.store.repos.jobs.save({ ...next, state: 'ready', version: 2 }, 0)).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    const bad = event(f.j, { id: id('evt'), jobId: JobId.parse(id('job')) });
    expect(() =>
      f.store.repos.jobs.save({ ...next, state: 'ready', version: 2 }, 1, [event(f.j), bad]),
    ).toThrow();
    expect(f.store.repos.jobs.get(f.j.id).state).toBe('fingerprinting');
    expect(f.store.repos.events.list(f.j.id)).toHaveLength(2);
    f.store.repos.jobs.save({ ...next, state: 'ready', version: 2 }, 1);
    expect(() =>
      f.store.repos.jobs.save({ ...next, state: 'failed', version: 3, finishedAt: time }, 2),
    ).toThrow(expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }));
    const running = { ...step, status: 'running', attempt: 1 };
    expect(f.store.repos.steps.save(running, 0)).toMatchObject(running);
    expect(() => f.store.repos.steps.save(running, 0)).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() => f.store.repos.steps.save({ ...running, attempt: 3 }, 1)).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    expect(() => f.store.repos.events.list(f.j.id, -1)).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
  }));
it('orders event sequences globally across jobs and never retains rolled-back events', async () =>
  withFixture((f) => {
    const second = f.store.repos.jobs.create(job(f.t));
    const first = f.store.repos.events.append(event(f.j)),
      middle = f.store.repos.events.append(event(second)),
      last = f.store.repos.events.append(event(f.j));
    expect(first.seq).toBeLessThan(middle.seq);
    expect(middle.seq).toBeLessThan(last.seq);
    expect(f.store.repos.events.list(f.j.id, first.seq)).toEqual([last]);
    expect(() =>
      f.store.db.transaction(() => {
        f.store.repos.events.append(event(f.j));
        throw new Error();
      }),
    ).toThrow();
    expect(f.store.repos.events.list(f.j.id).slice(1)).toEqual([first, last]);
  }));
it('creates lifecycle events automatically and preserves terminal immutability', async () =>
  withFixture((f) => {
    const created = f.store.repos.events.list(f.j.id);
    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe('job_created');
    const failed = { ...f.j, state: 'failed', version: 1, finishedAt: time };
    f.store.repos.jobs.save(failed, 0);
    expect(f.store.repos.events.list(f.j.id).map((e) => e.type)).toEqual([
      'job_created',
      'job_state_changed',
      'job_finished',
    ]);
    expect(() => f.store.repos.jobs.save({ ...failed, version: 2 }, 1)).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }),
    );
  }));
it.each(['transition', 'finished', 'created', 'step', 'identity'])(
  'rolls back contradictory job %s and all accompanying writes',
  async (mode) =>
    withFixture((f) => {
      const next = { ...f.j, state: 'fingerprinting', version: 1 };
      const events =
        mode === 'transition'
          ? [event(f.j, { type: 'job_state_changed', payload: { from: 'ready', to: 'planning' } })]
          : mode === 'finished'
            ? [event(f.j, { type: 'job_finished', payload: { state: 'failed' } })]
            : mode === 'created'
              ? [event(f.j)]
              : [];
      const step = JobStep.parse({
        schemaVersion: 1,
        id: id('stp'),
        jobId: mode === 'step' ? id('job') : f.j.id,
        stepKey: 'test',
        status: 'pending',
        attempt: 0,
        maxAttempts: 1,
        createdAt: time,
      });
      expect(() =>
        f.store.repos.jobs.save(mode === 'identity' ? { ...next, objective: 'changed' } : next, 0, events, [
          { record: step },
        ]),
      ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(f.store.repos.jobs.get(f.j.id)).toEqual(f.j);
      expect(f.store.repos.events.list(f.j.id)).toHaveLength(1);
      expect(f.store.repos.steps.list()).toHaveLength(0);
    }),
);
it('rolls back creation events and rejects noninitial job inserts', async () =>
  withFixture((f) => {
    const j = job(f.t);
    expect(() =>
      f.store.repos.jobs.create(j, [event(j, { payload: { mode: 'reconstruct', targetId: f.t.id } })]),
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() => f.store.repos.jobs.get(j.id)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => f.store.repos.jobs.insert({ ...j, state: 'ready' })).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
  }));
it('rejects cross-project jobs, findings, invocations and observation provenance', async () =>
  withFixture(async (f) => {
    const p = f.store.repos.projects.create({ name: 'other' }),
      t = f.store.repos.targets.add(target(p.id, { localPath: '/other' })),
      j = f.store.repos.jobs.create(job(t));
    expect(() => f.store.repos.jobs.create(job(f.t, { basedOnJobId: j.id }))).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    expect(() => f.store.repos.jobs.create(job(f.t, { projectId: p.id }))).toThrow(
      expect.objectContaining({ code: 'STORAGE_ERROR' }),
    );
    const a = await f.store.artifacts.putBytes(Buffer.from('fact'), 'text');
    const o = f.store.repos.observations.insert(
      Observation.parse({
        schemaVersion: 1,
        id: id('obs'),
        targetId: t.id,
        producer,
        kind: 'user',
        type: 'test',
        data: null,
        createdAt: time,
      }),
    );
    const finding = {
      schemaVersion: 1,
      id: id('fnd'),
      targetId: f.t.id,
      statement: 'Cross target',
      status: 'observed',
      evidence: [{ id: id('evr'), kind: 'user', artifactId: a.id, observationId: o.id }],
      limitations: [],
      revision: 1,
      author: producer,
      createdAt: time,
    };
    expect(() => f.store.repos.findings.append(finding)).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    expect(f.store.repos.findings.list()).toEqual([]);
    expect(f.store.repos.evidenceRefs.list()).toEqual([]);
    expect(() =>
      f.store.repos.findings.append({ ...finding, status: 'hypothesis', evidence: [] }, { jobId: j.id }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  }));
it.each(['budget_json', 'policy_json', 'host_json', 'error_json'])(
  'fails closed on corrupted jobs.%s',
  async (column) =>
    withFixture((f) => {
      f.store.db.run(`UPDATE jobs SET ${column}=? WHERE id=?`, '{"unknown":true}', f.j.id);
      expect(() => f.store.repos.jobs.get(f.j.id)).toThrow(
        expect.objectContaining({ code: 'STORAGE_ERROR' }),
      );
    }),
);
it('retrieves current evidence with superseded observations and findings marked stale', async () =>
  withFixture((f) => {
    const observation = Observation.parse({
      schemaVersion: 1,
      id: id('obs'),
      targetId: f.t.id,
      producer,
      kind: 'user',
      type: 'test',
      data: null,
      createdAt: time,
    });
    f.store.repos.observations.insert(observation);
    f.store.repos.findings.append({
      schemaVersion: 1,
      id: id('fnd'),
      targetId: f.t.id,
      statement: 'Maybe',
      status: 'hypothesis',
      evidence: [],
      limitations: [],
      revision: 1,
      author: producer,
      createdAt: time,
    });
    f.store.repos.targets.add(
      target(f.project.id, {
        sha256: 'd'.repeat(64),
        digest: { algorithm: 'sha256', value: 'd'.repeat(64) },
      }),
    );
    expect(f.store.evidence.list({ projectId: f.project.id }).items.every((e) => e.stale)).toBe(true);
  }));
it('rejects URL control-character ambiguity without returning secrets in errors', async () =>
  withFixture((f) => {
    const raw = 'https://user:private-password@example.com/app?token=private-prefix\tprivate-suffix';
    const manifest = target(f.project.id, {
      source: { type: 'url', displayName: raw },
      localPath: undefined,
      digest: undefined,
      sha256: undefined,
      url: raw,
      uri: raw,
    });
    try {
      f.store.repos.targets.add({ ...manifest, url: raw, uri: raw });
      throw new Error('Expected privacy rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_REQUEST' });
      expect(JSON.stringify(error)).not.toContain('private-');
    }
    expect(f.store.db.all("SELECT * FROM targets WHERE source_type='url'")).toEqual([]);
  }));
it('sanitizes noncanonical URL strings in ordinary metadata', async () =>
  withFixture((f) => {
    const raw = 'https:example.com/app?access=private-value#private-fragment';
    const t = f.store.repos.targets.add(
      target(f.project.id, { localPath: '/metadata-url', metadata: { source: raw } }),
    );
    expect(t.metadata['source']).toBe('https://example.com/app');
    expect(JSON.stringify(t)).not.toContain('private-');
  }));
it('normalizes policy rejection while reading corrupted rows to STORAGE_ERROR', async () =>
  withFixture((f) => {
    f.store.db.exec('DROP TRIGGER targets_no_update');
    f.store.db.run(
      'UPDATE targets SET manifest_json=? WHERE id=?',
      JSON.stringify({ ...f.t, metadata: { url: 'https://example.com/a?token=private\tsuffix' } }),
      f.t.id,
    );
    expect(() => f.store.repos.targets.get(f.t.id)).toThrow(
      expect.objectContaining({ code: 'STORAGE_ERROR' }),
    );
    const relation = {
      id: RelationId.parse(id('rel')),
      fromType: 'project' as const,
      fromId: f.project.id,
      relation: 'supports' as const,
      toType: 'job' as const,
      toId: f.j.id,
      createdAt: time,
    };
    f.store.repos.relations.append(relation);
    f.store.db.exec('DROP TRIGGER relations_no_update');
    f.store.db.run("UPDATE relations SET from_type='unknown' WHERE id=?", relation.id);
    expect(() => f.store.repos.relations.get(relation.id)).toThrow(
      expect.objectContaining({ code: 'STORAGE_ERROR' }),
    );
  }));
it('fails closed when the current finding revision is missing', async () =>
  withFixture((f) => {
    const finding = f.store.repos.findings.append({
      schemaVersion: 1,
      id: id('fnd'),
      targetId: f.t.id,
      statement: 'Maybe',
      status: 'hypothesis',
      evidence: [],
      limitations: [],
      revision: 1,
      author: producer,
      createdAt: time,
    });
    f.store.db.run('UPDATE findings SET current_revision=99 WHERE id=?', finding.id);
    expect(() => f.store.repos.findings.get(finding.id)).toThrow(
      expect.objectContaining({ code: 'STORAGE_ERROR' }),
    );
    expect(() => f.store.repos.findings.get(finding.id, 2)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  }));
it('preserves incomplete directory manifests without equating missing digests', async () =>
  withFixture((f) => {
    const incomplete = target(f.project.id, {
      source: { type: 'directory', displayName: 'partial directory' },
      digest: undefined,
      sha256: undefined,
      classification: { kind: 'unknown', format: 'directory', signals: [], classifierVersion: 'test-1' },
      inventory: {
        fileCount: 0,
        directoryCount: 0,
        symlinkCount: 0,
        otherCount: 0,
        totalBytes: 0,
        truncated: true,
        excluded: [],
        formats: {},
      },
      warnings: [{ code: 'INVENTORY_TRUNCATED', message: 'Bounded traversal is incomplete' }],
    });
    const nextId = target(f.project.id).id;
    const first = f.store.repos.targets.add(incomplete);
    const second = f.store.repos.targets.add({
      ...incomplete,
      id: nextId,
      uri: `phoenix:target/${nextId}/source`,
    });
    expect(first.digest).toBeUndefined();
    expect(second.id).not.toBe(first.id);
    expect(second.supersedes).toBe(first.id);
  }));
it('preserves both reference and candidate provenance for verify jobs', async () =>
  withFixture(async (f) => {
    const artifact = await f.store.artifacts.putBytes(Buffer.from('candidate bytes'), 'text');
    const candidate = f.store.repos.targets.add(
      target(f.project.id, {
        localPath: (f.t.localPath ?? '') + '/candidate',
        artifactId: artifact.id,
        sha256: artifact.sha256,
        digest: { algorithm: 'sha256', value: artifact.sha256 },
        sizeBytes: artifact.sizeBytes,
      }),
    );
    const verify = f.store.repos.jobs.create(job(f.t, { mode: 'verify', candidateTargetId: candidate.id }));
    const o = Observation.parse({
      schemaVersion: 1,
      id: id('obs'),
      targetId: candidate.id,
      jobId: verify.id,
      producer,
      kind: 'user',
      type: 'candidate',
      data: null,
      createdAt: time,
    });
    expect(f.store.repos.observations.insert(o)).toEqual(o);
    const req = AnalysisRequest.parse({
      requestId: id('req'),
      targetId: candidate.id,
      operation: 'inspect_target',
      params: {},
    });
    const envelope = ToolResponseEnvelope.parse({
      schemaVersion: 1,
      requestId: req.requestId,
      targetId: candidate.id,
      operation: req.operation,
      providerId: 'phoenix.fileinfo',
      providerVersion: '1',
      timestamp: time,
      status: 'ok',
      durationMs: 0,
      data: null,
      evidenceRefs: [],
      artifacts: [],
      warnings: [],
      error: null,
    });
    expect(f.store.repos.invocations.append({ request: req, envelope, jobId: verify.id }).envelope).toEqual(
      envelope,
    );
    f.store.repos.findings.append(
      {
        schemaVersion: 1,
        id: id('fnd'),
        targetId: candidate.id,
        statement: 'Candidate hypothesis',
        status: 'hypothesis',
        evidence: [],
        limitations: [],
        revision: 1,
        author: producer,
        createdAt: time,
      },
      { jobId: verify.id },
    );
    expect(
      f.store.evidence
        .list({ jobId: verify.id })
        .items.map((e) => e.type)
        .sort(),
    ).toEqual(['artifact', 'finding', 'observation']);
  }));
