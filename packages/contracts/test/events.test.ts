import { expect, it } from 'vitest';
import { JobEvent, EvidenceItem, jsonSchemaFor, contractSchemas, CONTRACTS_VERSION } from '../src/index.js';
import { event, id, finding, artifact } from './fixtures.js';

const payloads: Record<string, unknown> = {
  job_created: { mode: 'investigate', targetId: id('tgt') },
  job_started: { runner: 'test' },
  job_state_changed: { from: 'created', to: 'fingerprinting' },
  target_identified: { targetId: id('tgt'), kind: 'unknown', format: 'unknown' },
  capabilities_probed: { available: [], unavailable: [] },
  provider_selected: { providerId: 'phoenix.fileinfo', operation: 'inspect_target' },
  tool_executed: {
    requestId: id('req'),
    operation: 'inspect_target',
    providerId: null,
    status: 'ok',
    durationMs: 0,
  },
  evidence_saved: { observationIds: [id('obs')] },
  step_failed: {
    stepKey: 'fingerprint',
    attempt: 1,
    error: { code: 'INTERNAL', message: 'failed', retryable: false },
    willRetry: false,
  },
  step_recovered: { stepKey: 'fingerprint', previousOwner: 'test:0:0' },
  budget_exhausted: { budget: 'maxToolCalls', limit: 0, used: 0 },
  job_finished: { state: 'failed' },
  hypothesis_updated: { findingId: id('fnd'), revision: 1 },
  build_completed: { artifactIds: [], succeeded: false },
  comparison_completed: { reportArtifactId: id('art'), passed: 0, failed: 1 },
};
it('validates every event discriminator and rejects incorrect or absent payloads', () => {
  expect(JobEvent.options.map((o) => o.shape.type.value).sort()).toEqual(Object.keys(payloads).sort());
  for (const [type, payload] of Object.entries(payloads)) {
    expect(JobEvent.safeParse({ ...event, type, payload }).success).toBe(true);
    expect(JobEvent.safeParse({ ...event, type, payload: null }).success).toBe(false);
    expect(JobEvent.safeParse({ ...event, type, payload: { unknown: 1 } }).success).toBe(false);
  }
});
it('validates all evidence item variants', () => {
  for (const item of [
    { type: 'finding', finding },
    { type: 'artifact', artifact },
  ])
    expect(EvidenceItem.safeParse({ schemaVersion: 1, ...item, stale: true }).success).toBe(true);
});
it('generates deterministic JSON Schema with explicit runtime refinement limitations', () => {
  for (const [name, schema] of Object.entries(contractSchemas)) {
    const first = jsonSchemaFor(name, schema);
    expect(first).toEqual(jsonSchemaFor(name, schema));
    expect(first['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(first['$id']).toBe(`https://phoenix.invalid/contracts/${CONTRACTS_VERSION}/${name}.schema.json`);
    expect(first['$comment']).toContain('runtime Zod validation');
  }
  expect(jsonSchemaFor('Job', JobEvent)['x-phoenix-runtime-constraints']).toContain('candidateTargetId');
});
