import { describe, expect, it } from 'vitest';
import * as c from '../src/index.js';
import {
  fixtures,
  id,
  timestamp,
  digest,
  description,
  manifest,
  job,
  envelope,
  observation,
  finding,
  evidence,
  doctor,
} from './fixtures.js';

it('covers every exported runtime schema with an explicit fixture', () => {
  expect(Object.keys(fixtures).sort()).toEqual(Object.keys(c.contractSchemas).sort());
});
describe.each(Object.entries(c.contractSchemas))('%s', (name, schema) => {
  it('checks a valid example and generic missing/wrong-type inputs', () => {
    expect(schema.safeParse(fixtures[name]).success).toBe(true);
    expect(schema.safeParse(name === 'BoundedJsonValue' ? () => 0 : null).success).toBe(false);
    expect(schema.safeParse(undefined).success).toBe(false);
  });
});
it('every enum accepts each declared value and rejects unknown strings and numbers', () => {
  for (const schema of Object.values(c.contractSchemas)) {
    if (
      'options' in schema &&
      Array.isArray(schema.options) &&
      schema.options.every((x: unknown) => typeof x === 'string')
    ) {
      for (const option of schema.options) expect(schema.safeParse(option).success).toBe(true);
      expect(schema.safeParse('not-a-value').success).toBe(false);
      expect(schema.safeParse(1).success).toBe(false);
    }
  }
});
it('validates ID prefix, lowercase, width, timestamp precision and UTC', () => {
  expect(() => c.idSchema('a.*', 'Bad')).toThrow(TypeError);
  for (const bad of [id('job'), 'tgt_abc', `tgt_${'A'.repeat(32)}`, `tgt_${'0'.repeat(33)}`])
    expect(c.TargetId.safeParse(bad).success).toBe(false);
  for (const bad of ['2026-10-22T12:34:56Z', '2026-10-22T12:34:56.789+00:00', '2026-02-30T00:00:00.000Z'])
    expect(c.IsoTimestamp.safeParse(bad).success).toBe(false);
  expect(c.Sha256Hex.safeParse(digest.toUpperCase()).success).toBe(false);
  expect(c.CONTRACTS_VERSION).toBe('1.0.0-m0');
  expect(c.SCHEMA_VERSION).toBe(1);
});
it('applies nested defaults rather than returning unparsed empty objects', () => {
  expect(c.AnalysisRequest.parse(fixtures['AnalysisRequest']).limits).toEqual({
    timeoutMs: 30_000,
    maxInlineBytes: 1024 ** 2,
  });
  expect(c.InspectInput.parse(fixtures['InspectInput']).options.maxEntries).toBe(50_000);
  expect(c.CreateJobInput.parse(fixtures['CreateJobInput']).budget.maxToolCalls).toBe(200);
  expect(c.CreateJobInput.parse(fixtures['CreateJobInput']).policy).toEqual({
    allowExecution: false,
    allowNetwork: false,
    allowCloudInference: false,
  });
});
it('rejects inconsistent target identities and digests', () => {
  expect(c.TargetDescription.safeParse({ ...description, kind: 'web' }).success).toBe(false);
  expect(c.TargetManifest.safeParse({ ...manifest, hostOs: 'windows' }).success).toBe(false);
  for (const uri of ['/home/test/a', 'file:///tmp/a', 'C:\\sample', 'https://'])
    expect(c.TargetManifest.safeParse({ ...manifest, uri }).success).toBe(false);
  expect(c.TargetDescription.safeParse({ ...description, sha256: digest }).success).toBe(false);
  expect(
    c.TargetDescription.safeParse({ ...description, digest: { algorithm: 'sha256', value: digest } }).success,
  ).toBe(false);
  expect(
    c.TargetDescription.safeParse({
      ...description,
      digest: { algorithm: 'sha256', value: digest },
      sha256: digest,
    }).success,
  ).toBe(true);
  expect(
    c.TargetDescription.safeParse({
      ...description,
      digest: { algorithm: 'sha256', value: digest },
      sha256: 'b'.repeat(64),
    }).success,
  ).toBe(false);
  const inventory = fixtures['InventorySummary'] as Record<string, unknown>;
  expect(
    c.TargetDescription.safeParse({
      ...description,
      digest: { algorithm: 'phoenix-tree-sha256-v1', value: digest },
      inventory: { ...inventory, truncated: true },
    }).success,
  ).toBe(false);
  expect(
    c.TargetDescription.safeParse({
      ...description,
      digest: { algorithm: 'phoenix-tree-sha256-v1', value: digest },
      sha256: digest,
    }).success,
  ).toBe(false);
});
it('requires reference and candidate for verify, and forbids candidate in other modes', () => {
  for (const schema of [c.Job, c.CreateJobInput]) {
    const valid = schema === c.Job ? job : (fixtures['CreateJobInput'] as Record<string, unknown>);
    expect(schema.safeParse({ ...valid, mode: 'verify' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, mode: 'verify', candidateTargetId: id('tgt') }).success).toBe(true);
    expect(
      schema.safeParse({ ...valid, mode: 'verify', targetId: undefined, candidateTargetId: id('tgt') })
        .success,
    ).toBe(false);
    for (const mode of ['investigate', 'reconstruct'])
      expect(schema.safeParse({ ...valid, mode, candidateTargetId: id('tgt') }).success).toBe(false);
  }
});
it('enforces observation content and finding evidence', () => {
  expect(c.Observation.safeParse({ ...observation, data: undefined }).success).toBe(false);
  expect(
    c.Observation.safeParse({ ...observation, data: undefined, dataArtifactId: id('art') }).success,
  ).toBe(true);
  expect(c.Observation.safeParse({ ...observation, data: null }).success).toBe(true);
  for (const status of ['observed', 'corroborated', 'contradicted']) {
    expect(c.Finding.safeParse({ ...finding, status }).success).toBe(false);
    expect(c.Finding.safeParse({ ...finding, status, evidence: [evidence] }).success).toBe(true);
  }
});
it.each(['ok', 'partial', 'error'] as const)('enforces envelope invariants for %s', (status) => {
  for (const error of [null, { code: 'INTERNAL', message: 'failure', retryable: false }]) {
    expect(c.ToolResponseEnvelope.safeParse({ ...envelope, status, data: null, error }).success).toBe(
      (status === 'error') === (error !== null),
    );
  }
  expect(
    c.ToolResponseEnvelope.safeParse({ ...envelope, status, error: null, data: undefined }).success,
  ).toBe(false);
});
it('requires null error data, paired provider versions, and nonnegative duration', () => {
  expect(
    c.ToolResponseEnvelope.safeParse({
      ...envelope,
      status: 'error',
      error: { code: 'INTERNAL', message: 'x', retryable: false },
    }).success,
  ).toBe(false);
  for (const change of [
    { providerId: null },
    { providerVersion: null },
    { durationMs: -1 },
    { data: 1n },
    { data: NaN },
    { data: () => 1 },
  ])
    expect(c.ToolResponseEnvelope.safeParse({ ...envelope, ...change }).success).toBe(false);
});
it('rejects unsafe sizes, offsets and limits', () => {
  for (const n of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    expect(c.ArtifactRef.safeParse({ ...(fixtures['ArtifactRef'] as object), sizeBytes: n }).success).toBe(
      false,
    );
    expect(
      c.AnalysisRequest.safeParse({
        ...(fixtures['AnalysisRequest'] as object),
        limits: { maxInlineBytes: n },
      }).success,
    ).toBe(false);
  }
  expect(
    c.AnalysisRequest.safeParse({ ...(fixtures['AnalysisRequest'] as object), limits: { timeoutMs: 99 } })
      .success,
  ).toBe(false);
  expect(
    c.AnalysisRequest.safeParse({
      ...(fixtures['AnalysisRequest'] as object),
      limits: { maxInlineBytes: 8 * 1024 ** 2 + 1 },
    }).success,
  ).toBe(false);
});
it('doctor ok reflects required checks, and optional warnings do not fail it', () => {
  expect(c.DoctorReport.safeParse({ ...doctor, ok: false }).success).toBe(false);
  expect(
    c.DoctorReport.safeParse({ ...doctor, checks: [{ ...doctor.checks[0], status: 'warn' }], ok: false })
      .success,
  ).toBe(true);
  expect(
    c.DoctorReport.safeParse({
      ...doctor,
      checks: [{ ...doctor.checks[0], category: 'optional', status: 'warn' }],
    }).success,
  ).toBe(true);
});
it('rejects unknown fields and non-v1 documents', () => {
  for (const [name, value] of Object.entries(fixtures)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && 'schemaVersion' in value) {
      expect(c.contractSchemas[name]?.safeParse({ ...value, schemaVersion: 2 }).success).toBe(false);
      expect(c.contractSchemas[name]?.safeParse({ ...value, misspelledField: true }).success).toBe(false);
    }
  }
});
it('defines operation schemas only for supported M0 contract shapes', () => {
  expect(Object.keys(c.operationSchemas).sort()).toEqual(['inspect_assets', 'inspect_target']);
  expect(c.operationSchemas.decompile_function).toBeUndefined();
  expect(c.InspectAssetsParams.parse({}).limit).toBe(500);
  expect(c.InspectTargetParams.parse({}).maxSections).toBe(256);
  expect(c.InspectAssetsParams.safeParse({ limit: 5001 }).success).toBe(false);
  expect(c.InspectTargetParams.safeParse({ maxSections: 0 }).success).toBe(false);
});
it('round-trips every locator form', () => {
  for (const locator of [
    { type: 'byte-range', offset: 0, length: 1 },
    { type: 'path', path: 'a', line: 1, column: 1 },
    { type: 'address', address: '0x00' },
    { type: 'event', sequence: 0 },
    { type: 'region', x: 0, y: 0, width: 10, height: 10 },
  ])
    expect(c.Locator.parse(locator)).toEqual(locator);
});
it('accepts all format detail variants and rejects missing discriminants', () => {
  const formats = [
    { format: 'elf', class: 'elf64', data: 'lsb', osabi: 0, type: 2, machine: 62, entry: '0x0' },
    {
      format: 'pe',
      machine: 34404,
      magic: 'pe32+',
      characteristics: 2,
      isDll: false,
      subsystem: 3,
      sectionCount: 1,
      timeDateStamp: 0,
      hasClrHeader: false,
    },
    { format: 'macho', cpuType: 1, cpuSubtype: 0, fileType: 2, loadCommandCount: 0, flags: 0, bits: 64 },
    { format: 'macho-fat', arches: [{ cpuType: 1, cpuSubtype: 0, offset: 0, size: 0 }] },
    { format: 'wasm', version: 1 },
    { format: 'dex', version: '035' },
    ...['zip', 'jar', 'apk'].map((format) => ({
      format,
      entryCount: 0,
      sampledEntries: [],
      truncated: false,
      zip64: false,
    })),
    { format: 'asar', headerSize: 0, fileCount: 0, truncated: false },
    { format: 'java-class', majorVersion: 65, minorVersion: 0 },
    { format: 'text', encoding: 'utf-8' },
  ];
  for (const value of formats) {
    expect(c.FormatDetails.safeParse(value).success).toBe(true);
    expect(c.FormatDetails.safeParse({ ...value, format: 'invalid' }).success).toBe(false);
    expect(c.FormatDetails.safeParse({ format: value.format }).success).toBe(false);
  }
  expect(c.IsoTimestamp.parse(timestamp)).toBe(timestamp);
});
