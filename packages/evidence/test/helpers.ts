import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEvidenceStore, type EvidenceStore } from '@phoenix/evidence';
import { TargetManifest, Job, JobEvent, ProjectId } from '@phoenix/contracts';
export const id = (prefix: string): string => `${prefix}_${randomUUID().replaceAll('-', '')}`;
export const time = '2026-10-22T12:00:00.000Z';
export function target(projectId: ProjectId, override: Record<string, unknown> = {}): TargetManifest {
  const targetId = id('tgt');
  return TargetManifest.parse({
    schemaVersion: 1,
    id: targetId,
    projectId,
    uri: `phoenix:target/${targetId}/source`,
    hostOs: 'linux',
    intakeMode: 'reference',
    createdAt: time,
    metadata: {},
    source: { type: 'file', displayName: 'hello' },
    localPath: join(tmpdir(), 'hello'),
    classification: { kind: 'unknown', format: 'text', signals: [], classifierVersion: 'test-1' },
    kind: 'unknown',
    digest: { algorithm: 'sha256', value: 'a'.repeat(64) },
    sha256: 'a'.repeat(64),
    compatibility: { staticAnalysis: 'supported', nativeExecution: 'unknown', reason: 'Test metadata' },
    warnings: [],
    inspectedAt: time,
    inspectedOn: {
      os: 'linux',
      arch: 'x64',
      osRelease: 'test',
      nodeVersion: '26.8.1',
      isWsl: false,
      phoenixVersion: 'test',
    },
    ...override,
  });
}
export function job(t: TargetManifest, override: Record<string, unknown> = {}): Job {
  return Job.parse({
    schemaVersion: 1,
    id: id('job'),
    projectId: t.projectId,
    targetId: t.id,
    mode: 'investigate',
    objective: 'Inspect',
    state: 'created',
    version: 0,
    budget: {},
    policy: {},
    createdAt: time,
    updatedAt: time,
    ...override,
  });
}
export function event(j: Job, override: Record<string, unknown> = {}) {
  const { seq: _seq, ...draft } = JobEvent.parse({
    schemaVersion: 1,
    id: id('evt'),
    jobId: j.id,
    seq: 0,
    type: 'job_created',
    payload: { mode: j.mode, targetId: j.targetId },
    createdAt: time,
    ...override,
  });
  if (_seq !== 0) throw new Error('Unexpected fixture sequence');
  return draft;
}
export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'Phoenix WP4 tést '));
  const store = await createEvidenceStore({ dataDir: directory });
  const project = store.repos.projects.create({ name: 'test' });
  const t = store.repos.targets.add(target(project.id));
  const j = store.repos.jobs.create(job(t));
  return { directory, store, project, t, j };
}
export async function cleanup(directory: string, ...stores: EvidenceStore[]): Promise<void> {
  await Promise.all(stores.map((s) => s.close()));
  async function writable(path: string): Promise<void> {
    for (const e of await readdir(path, { withFileTypes: true })) {
      const next = join(path, e.name);
      if (e.isDirectory()) await writable(next);
      else await chmod(next, 0o600);
    }
  }
  await writable(directory);
  await rm(directory, { recursive: true, force: true, maxRetries: 10 });
}
