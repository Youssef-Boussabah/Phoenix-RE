import { expect, it } from 'vitest';
import * as c from '../src/index.js';
import {
  job,
  event,
  timestamp,
  errorShape,
  envelope,
  providerStatus,
  description,
  manifest,
  digest,
  id,
  observation,
  fixtures,
} from './fixtures.js';

it('requires finishedAt exactly for terminal jobs and coherent lifecycle errors', () => {
  for (const state of [
    'created',
    'fingerprinting',
    'ready',
    'planning',
    'investigating',
    'reconstructing',
    'verifying',
  ]) {
    expect(
      c.Job.safeParse({
        ...job,
        state,
        mode: state === 'reconstructing' || state === 'verifying' ? 'reconstruct' : 'investigate',
      }).success,
    ).toBe(true);
    expect(c.Job.safeParse({ ...job, state, finishedAt: timestamp }).success).toBe(false);
    expect(c.Job.safeParse({ ...job, state, error: errorShape }).success).toBe(false);
  }
  for (const state of ['completed', 'partial', 'failed', 'cancelled']) {
    expect(c.Job.safeParse({ ...job, state }).success).toBe(false);
    expect(c.Job.safeParse({ ...job, state, finishedAt: timestamp }).success).toBe(true);
    expect(c.JobEvent.safeParse({ ...event, type: 'job_finished', payload: { state } }).success).toBe(true);
  }
  for (const state of ['planning', 'ready', 'created'])
    expect(c.JobEvent.safeParse({ ...event, type: 'job_finished', payload: { state } }).success).toBe(false);
  for (const state of ['completed', 'partial', 'failed', 'cancelled'])
    for (const code of ['INTERNAL', 'CANCELLED']) {
      const error = { code, message: 'reason', retryable: false };
      const expected =
        state === 'cancelled' ? code === 'CANCELLED' : state !== 'completed' && code !== 'CANCELLED';
      expect(c.Job.safeParse({ ...job, state, error, finishedAt: timestamp }).success).toBe(expected);
      expect(
        c.JobEvent.safeParse({ ...event, type: 'job_finished', payload: { state, error } }).success,
      ).toBe(expected);
    }
});
it('budget exhaustion events use recognized budgets and safe counters at or beyond the limit', () => {
  const input = (payload: unknown) => ({ ...event, type: 'budget_exhausted', payload });
  for (const budget of ['maxWallClockMs', 'maxToolCalls']) {
    for (const [limit, used] of [
      [0, 0],
      [1, 1],
      [10, 11],
    ])
      expect(c.JobEvent.safeParse(input({ budget, limit, used })).success).toBe(true);
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(c.JobEvent.safeParse(input({ budget, limit: value, used: 20 })).success).toBe(false);
      expect(c.JobEvent.safeParse(input({ budget, limit: 1, used: value })).success).toBe(false);
    }
    expect(c.JobEvent.safeParse(input({ budget, limit: 2, used: 1 })).success).toBe(false);
  }
  expect(c.JobEvent.safeParse(input({ budget: 'bogus', limit: 0, used: 0 })).success).toBe(false);
});
it('transition and budget helpers validate unparsed boundary input predictably', () => {
  for (const invalid of ['bogus', 'constructor', '__proto__', null, undefined, {}, 0, Symbol('state')]) {
    for (const args of [
      [invalid, 'created', 'fingerprinting'],
      ['investigate', invalid, 'cancelled'],
      ['investigate', 'created', invalid],
    ] as const) {
      expect(c.canTransition(args[0], args[1], args[2])).toBe(false);
      expect(() => {
        c.assertTransition(args[0], args[1], args[2]);
      }).toThrow(c.PhoenixError);
    }
  }
  for (const value of [null, [], { maxToolCalls: -1 }, { maxWallClockMs: 0 }])
    expect(() => c.exhaustedBudget(value, { elapsedMs: 0, toolCalls: 0 })).toThrow(c.PhoenixError);
  expect(c.exhaustedBudget({}, { elapsedMs: 0, toolCalls: 0 })).toBeUndefined();
  // Pending ADR: ready -> failed remains forbidden under ADR-0002.
  expect(c.canTransition('investigate', 'ready', 'failed')).toBe(false);
});
it('all target URL contracts reject unsupported schemes, malformed URLs and local URI leaks', () => {
  for (const url of [
    'file:///home/alice/a',
    'javascript:alert(1)',
    'ftp://example.com/a',
    'ssh://example.com/a',
    'data:text/plain,a',
    'https://?',
    'https://',
  ]) {
    expect(
      c.TargetDescription.safeParse({ ...description, source: { type: 'url', displayName: 'app' }, url })
        .success,
    ).toBe(false);
    expect(
      c.TargetManifest.safeParse({ ...manifest, source: { type: 'url', displayName: 'app' }, url, uri: url })
        .success,
    ).toBe(false);
  }
  for (const url of ['https://example.com/app', 'http://localhost:4141/app']) {
    const source = { type: 'url', displayName: 'app' };
    expect(c.TargetDescription.safeParse({ ...description, source, url }).success).toBe(true);
    expect(c.TargetManifest.safeParse({ ...manifest, source, url, uri: url }).success).toBe(true);
  }
});
it('target source, digest and internal URI identities agree', () => {
  const fileDigest = { algorithm: 'sha256', value: digest };
  const treeDigest = { algorithm: 'phoenix-tree-sha256-v1', value: digest };
  expect(c.TargetDescription.safeParse({ ...description, digest: fileDigest, sha256: digest }).success).toBe(
    true,
  );
  expect(c.TargetDescription.safeParse({ ...description, digest: treeDigest }).success).toBe(false);
  const directory = { ...description, source: { type: 'directory', displayName: 'dir' } };
  expect(c.TargetDescription.safeParse({ ...directory, digest: treeDigest }).success).toBe(true);
  expect(c.TargetDescription.safeParse({ ...directory, digest: fileDigest, sha256: digest }).success).toBe(
    false,
  );
  expect(
    c.TargetDescription.safeParse({ ...description, source: { type: 'url', displayName: 'url' } }).success,
  ).toBe(false);
  expect(c.TargetDescription.safeParse({ ...description, url: 'https://example.com' }).success).toBe(false);
  expect(
    c.TargetManifest.safeParse({ ...manifest, uri: `phoenix:target/tgt_${'1'.repeat(32)}/source` }).success,
  ).toBe(false);
  expect(c.TargetManifest.safeParse({ ...manifest, uri: `phoenix:artifact/${id('art')}` }).success).toBe(
    false,
  );
  expect(
    c.TargetManifest.safeParse({ ...manifest, uri: `phoenix:artifact/${id('art')}`, artifactId: id('art') })
      .success,
  ).toBe(true);
  expect(
    c.TargetManifest.safeParse({
      ...manifest,
      uri: `phoenix:artifact/art_${'1'.repeat(32)}`,
      artifactId: id('art'),
    }).success,
  ).toBe(false);
  expect(c.TargetManifest.safeParse({ ...manifest, uri: 'https://example.com' }).success).toBe(false);
});
it('relative path and literal exclusion contracts reject traversal and ambiguous normalization', () => {
  for (const path of ['a', 'src/app.ts', '.git', 'café/😀', 'line\nname', 'tab\tname', 'quote"name']) {
    expect(c.RelativePath.safeParse(path).success).toBe(true);
    expect(c.InventoryEntry.safeParse({ path, type: 'file' }).success).toBe(true);
    expect(c.IntakeOptions.safeParse({ exclude: [path] }).success).toBe(true);
    expect(c.InspectAssetsParams.safeParse({ pathPrefix: path }).success).toBe(true);
  }
  for (const path of [
    '',
    '.',
    '..',
    '../a',
    'a/../b',
    './a',
    '/a',
    'a//b',
    'a/',
    'C:/a',
    'C:a',
    '\\\\server\\share',
    'a\\b',
    'a\0b',
    'cafe\u0301',
    'bad\ud800',
    'bad\udc00',
  ]) {
    expect(c.RelativePath.safeParse(path).success).toBe(false);
    expect(c.InventoryEntry.safeParse({ path, type: 'file' }).success).toBe(false);
    expect(c.IntakeOptions.safeParse({ exclude: [path] }).success).toBe(false);
    expect(c.InspectAssetsParams.safeParse({ pathPrefix: path }).success).toBe(false);
    expect(c.Locator.safeParse({ type: 'path', path }).success).toBe(false);
  }
  for (const exclude of ['**/node_modules', '*.js', '!src', 'a?', '[ab]', '{a,b}'])
    expect(c.ExcludePattern.safeParse(exclude).success).toBe(false);
});
it('successful envelopes and provider status require coherent nonempty provider identities', () => {
  for (const status of ['ok', 'partial']) {
    expect(c.ToolResponseEnvelope.safeParse({ ...envelope, status }).success).toBe(true);
    for (const change of [
      { providerId: null, providerVersion: null },
      { providerId: '' },
      { providerVersion: '' },
      { providerId: 'undotted' },
    ])
      expect(c.ToolResponseEnvelope.safeParse({ ...envelope, status, ...change }).success).toBe(false);
  }
  expect(
    c.ToolResponseEnvelope.safeParse({
      ...envelope,
      status: 'error',
      data: null,
      error: errorShape,
      providerId: null,
      providerVersion: null,
    }).success,
  ).toBe(true);
  expect(c.ProviderStatus.safeParse(providerStatus).success).toBe(true);
  expect(
    c.ProviderStatus.safeParse({
      ...providerStatus,
      availability: { ...providerStatus.availability, providerId: 'different.provider' },
    }).success,
  ).toBe(false);
  for (const schema of [c.AnalysisRequest, c.ToolInvokeInput, c.CapabilityReport, c.ProviderAvailability]) {
    const input = fixtures[Object.entries(c.contractSchemas).find(([, s]) => s === schema)?.[0] ?? ''];
    expect(schema.safeParse({ ...(input as object), providerId: '' }).success).toBe(false);
  }
});
it('explicit observation JSON null differs from absent inline data at the persistence boundary', () => {
  expect(c.Observation.safeParse({ ...observation, data: undefined }).success).toBe(false);
  for (const data of [null, false, 0, '', {}, []]) {
    const parsed = c.Observation.parse({ ...observation, data });
    const sqlText = parsed.data === undefined ? null : JSON.stringify(parsed.data);
    expect(typeof sqlText).toBe('string');
    if (data === null) expect(sqlText).toBe('null'); // TEXT "null", never SQL NULL.
  }
  const artifactOnly = c.Observation.parse({ ...observation, data: undefined, dataArtifactId: id('art') });
  expect(artifactOnly.data).toBeUndefined();
});
it('thin and fat Mach-O CPU fields cover exactly unsigned 32-bit values', () => {
  const thin = {
    format: 'macho',
    cpuType: 1,
    cpuSubtype: 0,
    fileType: 2,
    loadCommandCount: 0,
    flags: 0,
    bits: 64,
  };
  const fat = { format: 'macho-fat', arches: [{ cpuType: 1, cpuSubtype: 0, offset: 0, size: 0 }] };
  for (const value of [0, 0x80000002, 0x80000003, 0xffffffff]) {
    expect(c.FormatDetails.safeParse({ ...thin, cpuType: value, cpuSubtype: value }).success).toBe(true);
    expect(
      c.FormatDetails.safeParse({ ...fat, arches: [{ ...fat.arches[0], cpuType: value, cpuSubtype: value }] })
        .success,
    ).toBe(true);
  }
  for (const value of [-1, 0x100000000, 1.5])
    for (const key of ['cpuType', 'cpuSubtype']) {
      expect(c.FormatDetails.safeParse({ ...thin, [key]: value }).success).toBe(false);
      expect(
        c.FormatDetails.safeParse({ ...fat, arches: [{ ...fat.arches[0], [key]: value }] }).success,
      ).toBe(false);
    }
});
