import { it, expect } from 'vitest';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArtifactId, Observation, EvidenceRef, Finding } from '@phoenix/contracts';
import { fixture, cleanup, target, id, time } from './helpers.js';
const producer = { type: 'user', id: 'provenance-test', version: '1' };
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function snapshot(f: Fixture, text: string) {
  const a = await f.store.artifacts.putBytes(Buffer.from(text), 'application/octet-stream');
  const t = f.store.repos.targets.add(
    target(f.project.id, {
      localPath: join(f.directory, text),
      intakeMode: 'snapshot',
      artifactId: a.id,
      sha256: a.sha256,
      digest: { algorithm: 'sha256', value: a.sha256 },
      sizeBytes: a.sizeBytes,
    }),
  );
  return { a, t };
}
function observation(f: Fixture, targetId: string, artifactId?: string) {
  return f.store.repos.observations.insert(
    Observation.parse({
      schemaVersion: 1,
      id: id('obs'),
      targetId,
      producer,
      kind: 'static',
      type: 'actual-read',
      data: null,
      ...(artifactId ? { dataArtifactId: artifactId } : {}),
      createdAt: time,
    }),
  );
}
function finding(targetId: string, evidence: unknown[] = []) {
  return Finding.parse({
    schemaVersion: 1,
    id: id('fnd'),
    targetId,
    statement: 'A testable claim',
    status: evidence.length ? 'corroborated' : 'hypothesis',
    evidence,
    limitations: [],
    revision: 1,
    author: producer,
    createdAt: time,
  });
}
it.each([
  'hash',
  'size',
  'missing',
  'directory-artifact',
  'missing-inventory',
  'wrong-inventory',
  'file-inventory',
  'snapshot-without-artifact',
])('rejects target artifact mismatch: %s', async (mode) => {
  const f = await fixture();
  try {
    const a = await f.store.artifacts.putBytes(Buffer.from('real snapshot'), 'application/octet-stream');
    const base = target(f.project.id, {
      localPath: join(f.directory, 'snapshot'),
      intakeMode: 'snapshot',
      artifactId: a.id,
      sha256: a.sha256,
      digest: { algorithm: 'sha256', value: a.sha256 },
      sizeBytes: a.sizeBytes,
    });
    const directory = {
      source: { type: 'directory', displayName: 'directory' },
      classification: { ...base.classification, format: 'directory' },
      sha256: undefined,
      digest: { algorithm: 'phoenix-tree-sha256-v1', value: 'd'.repeat(64) },
      artifactId: undefined,
    };
    const variants: Record<string, unknown> = {
      hash: { ...base, sha256: 'a'.repeat(64), digest: { algorithm: 'sha256', value: 'a'.repeat(64) } },
      size: { ...base, sizeBytes: a.sizeBytes + 1 },
      missing: { ...base, artifactId: id('art') },
      'directory-artifact': { ...base, ...directory, artifactId: a.id },
      'missing-inventory': { ...base, ...directory, inventoryArtifactId: id('art') },
      'wrong-inventory': { ...base, ...directory, inventoryArtifactId: a.id },
      'file-inventory': { ...base, inventoryArtifactId: a.id },
      'snapshot-without-artifact': { ...base, artifactId: undefined },
    };
    const expected = mode === 'missing' || mode === 'missing-inventory' ? 'STORAGE_ERROR' : 'INVALID_REQUEST';
    const before = f.store.repos.targets.list();
    expect(() => {
      f.store.db.transaction(() => {
        f.store.repos.projects.create({ name: 'must roll back' });
        f.store.repos.targets.add(variants[mode]);
      });
    }).toThrow(expect.objectContaining({ code: expected }));
    expect(f.store.repos.projects.list()).toHaveLength(1);
    expect(f.store.repos.targets.list()).toEqual(before);
    expect(f.store.repos.relations.list()).toEqual([]);
  } finally {
    await cleanup(f.directory, f.store);
  }
});
it('validates before local idempotence and accepts correctly matched real CAS snapshots', async () => {
  const f = await fixture();
  try {
    const { a, t } = await snapshot(f, 'matching');
    expect(f.store.repos.targets.get(t.id).sha256).toBe(a.sha256);
    const other = await f.store.artifacts.putBytes(Buffer.from('different'), 'application/octet-stream');
    expect(() =>
      f.store.repos.targets.add(
        target(f.project.id, {
          ...t,
          id: target(f.project.id).id,
          uri: `phoenix:artifact/${other.id}`,
          artifactId: other.id,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    const inventory = await f.store.artifacts.putBytes(
      Buffer.from('{"schemaVersion":1,"entries":[]}'),
      'application/vnd.phoenix.inventory+json',
    );
    const dir = f.store.repos.targets.add(
      target(f.project.id, {
        localPath: join(f.directory, 'directory'),
        source: { type: 'directory', displayName: 'directory' },
        classification: { ...t.classification, format: 'directory' },
        sha256: undefined,
        digest: undefined,
        inventoryArtifactId: inventory.id,
      }),
    );
    expect(dir.inventoryArtifactId).toBe(inventory.id);
    const incomplete = f.store.repos.targets.add(
      target(f.project.id, {
        localPath: join(f.directory, 'incomplete'),
        digest: undefined,
        sha256: undefined,
      }),
    );
    expect(incomplete.artifactId).toBeUndefined();
    expect(incomplete.digest).toBeUndefined();
  } finally {
    await cleanup(f.directory, f.store);
  }
});
it.each([
  'cross-target-no-observation',
  'cross-target-observation',
  'unrelated-no-observation',
  'unrelated-with-observation',
  'missing-bytes',
])('rolls back a finding revision with invalid provenance: %s', async (mode) => {
  const f = await fixture();
  try {
    const own = await snapshot(f, 'target-A'),
      other = await snapshot(f, 'target-B');
    const output = await f.store.artifacts.putBytes(Buffer.from('observation output'), 'text/plain');
    const ownObs = observation(f, own.t.id, output.id),
      otherObs = observation(f, other.t.id, other.a.id);
    const base = f.store.repos.findings.append(finding(own.t.id));
    let artifactId: ArtifactId = other.a.id,
      observationId;
    if (mode === 'cross-target-observation') observationId = otherObs.id;
    if (mode === 'unrelated-no-observation')
      artifactId = (await f.store.artifacts.putBytes(Buffer.from('unrelated'), 'text/plain')).id;
    if (mode === 'unrelated-with-observation') {
      artifactId = other.a.id;
      observationId = ownObs.id;
    }
    if (mode === 'missing-bytes') {
      artifactId = f.store.repos.artifacts.register({
        id: id('art'),
        sha256: 'f'.repeat(64),
        sizeBytes: 10,
        mediaType: 'text/plain',
      }).id;
      observationId = observation(f, own.t.id, artifactId).id;
    }
    const ref = EvidenceRef.parse({
      id: id('evr'),
      kind: 'static',
      artifactId,
      ...(observationId ? { observationId } : {}),
    });
    expect(() =>
      f.store.repos.findings.append({ ...base, revision: 2, status: 'corroborated', evidence: [ref] }),
    ).toThrow(
      expect.objectContaining({ code: mode === 'missing-bytes' ? 'STORAGE_ERROR' : 'INVALID_REQUEST' }),
    );
    expect(f.store.repos.findings.get(base.id)).toEqual(base);
    expect(f.store.repos.findings.history(base.id)).toEqual([base]);
    expect(f.store.repos.evidenceRefs.list()).toEqual([]);
    expect(f.store.db.all('SELECT * FROM finding_evidence')).toEqual([]);
  } finally {
    await cleanup(f.directory, f.store);
  }
});
it('accepts actual target snapshot and observation output evidence with and without observation IDs', async () => {
  const f = await fixture();
  try {
    const { a, t } = await snapshot(f, 'target');
    const output = await f.store.artifacts.putBytes(Buffer.alloc(131073, 80), 'text/plain');
    const o = observation(f, t.id, output.id),
      inline = observation(f, t.id);
    for (const e of [
      { artifactId: a.id },
      { artifactId: a.id, observationId: inline.id },
      { artifactId: output.id },
      { artifactId: output.id, observationId: o.id },
    ]) {
      const ref = EvidenceRef.parse({ id: id('evr'), kind: 'static', ...e });
      const claim = f.store.repos.findings.append(finding(t.id, [ref]));
      expect(claim.status).toBe('corroborated');
      expect(f.store.repos.findings.get(claim.id).evidence).toEqual([ref]);
    }
  } finally {
    await cleanup(f.directory, f.store);
  }
});
it('accepts actual target inventory evidence and rejects corrupted associated bytes', async () => {
  const f = await fixture();
  try {
    const a = await f.store.artifacts.putBytes(
      Buffer.from('{"schemaVersion":1,"entries":[]}'),
      'application/vnd.phoenix.inventory+json',
    );
    const t = f.store.repos.targets.add(
      target(f.project.id, {
        localPath: join(f.directory, 'inventory'),
        source: { type: 'directory', displayName: 'directory' },
        classification: { kind: 'unknown', format: 'directory', signals: [], classifierVersion: 'test' },
        digest: undefined,
        sha256: undefined,
        inventoryArtifactId: a.id,
      }),
    );
    const ref = EvidenceRef.parse({ id: id('evr'), kind: 'static', artifactId: a.id });
    expect(f.store.repos.findings.append(finding(t.id, [ref])).status).toBe('corroborated');
    const path = join(f.directory, 'artifacts', 'sha256', a.sha256.slice(0, 2), a.sha256);
    await chmod(path, 0o600);
    await writeFile(path, Buffer.alloc(a.sizeBytes, 120));
    expect(() => f.store.repos.findings.append(finding(t.id, [{ ...ref, id: id('evr') }]))).toThrow(
      expect.objectContaining({ code: 'STORAGE_ERROR' }),
    );
  } finally {
    await cleanup(f.directory, f.store);
  }
});
