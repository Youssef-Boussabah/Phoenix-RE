import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, it } from 'vitest';
import { FileFormat, FormatDetails, HostInfo, TargetDescription } from '@phoenix/contracts';
import { describeTarget, inspectBytes } from '../src/index.js';
import { syntheticInputs } from '../../../tests/support/synth.js';
import lock from '../../../tests/fixtures/fixtures.lock.json' with { type: 'json' };

const root = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));
const host = HostInfo.parse({
  os: 'linux',
  arch: 'x64',
  osRelease: 'fixture',
  nodeVersion: 'fixture',
  isWsl: false,
  phoenixVersion: 'fixture',
});
it.each(lock.files)('inspects locked original fixture $path', async (fixture) => {
  const native = path.join(root, fixture.path),
    before = await lstat(native, { bigint: true }),
    bytes = await readFile(native);
  expect(bytes.length).toBe(fixture.size);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);
  const result = await describeTarget({ type: 'path', path: native }, {}, host);
  expect(result.kind).toBe(fixture.expected.kind);
  expect(result.classification.format).toBe(fixture.expected.format);
  expect(result.platform?.arches ?? []).toEqual(fixture.expected.arches);
  if ('binaryType' in fixture.expected) expect(result.platform?.binaryType).toBe(fixture.expected.binaryType);
  expect(result.sha256).toBe(fixture.sha256);
  expect(TargetDescription.safeParse(result).success).toBe(true);
  if (result.formatDetails !== undefined)
    expect(FormatDetails.safeParse(result.formatDetails).success).toBe(true);
  expect((await lstat(native, { bigint: true })).mtimeNs).toBe(before.mtimeNs);
  expect(await readFile(native)).toEqual(bytes);
});
it.each(lock.directories)('matches committed cross-host directory digest for $path', async (fixture) => {
  const result = await describeTarget({ type: 'path', path: path.join(root, fixture.path) }, {}, host);
  expect(result.kind).toBe(fixture.expected.kind);
  expect(result.classification.format).toBe('directory');
  expect(result.digest).toEqual({ algorithm: fixture.algorithm, value: fixture.digest });
  expect(result.inventory?.truncated).toBe(false);
});
it('matches golden file, directory and URL descriptions with only local/time fields normalized', async () => {
  const reports: Record<string, unknown>[] = [];
  for (const source of [
    { type: 'path', path: path.join(root, 'native/hello-windows-x64.exe') },
    { type: 'path', path: path.join(root, 'dirs/source-node') },
    { type: 'url', url: 'https://example.com/app' },
    { type: 'url', url: 'https://alice:GOLDEN_PASSWORD@example.com/app?token=GOLDEN_TOKEN#GOLDEN_FRAGMENT' },
  ] as const) {
    const result: Record<string, unknown> = {
      ...(await describeTarget(source, {}, host)),
      inspectedAt: '2026-10-22T00:00:00.000Z',
    };
    if (result['localPath'] !== undefined) result['localPath'] = '<fixture>';
    reports.push(result);
  }
  expect(reports).toMatchSnapshot();
  for (const secret of ['alice', 'GOLDEN_PASSWORD', 'GOLDEN_TOKEN', 'GOLDEN_FRAGMENT'])
    expect(JSON.stringify(reports)).not.toContain(secret);
});
it('classifies every fixture/synthetic prefix and 2000 seeded adversarial inputs without a raw parser crash', async () => {
  const inputs = [
    ...(await Promise.all(lock.files.map((f) => readFile(path.join(root, f.path))))),
    ...syntheticInputs(),
  ];
  let prefixes = 0;
  for (const bytes of inputs)
    for (let length = 0; length <= Math.min(4096, bytes.length); length++) {
      const result = await inspectBytes(bytes.subarray(0, length), 'untrusted.exe');
      expect(FileFormat.safeParse(result.format).success).toBe(true);
      if (result.details !== undefined) expect(FormatDetails.safeParse(result.details).success).toBe(true);
      expect(result.warnings.length).toBeLessThanOrEqual(32);
      prefixes++;
    }
  expect(prefixes).toBeGreaterThan(18_000);
  let state = 0x50485833;
  for (let i = 0; i < 2000; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const bytes = Buffer.alloc(state % 1025);
    for (let j = 0; j < bytes.length; j++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      bytes[j] = state >>> 24;
    }
    // Half the adversarial buffers preserve a real magic to reach structural parsers.
    if (i % 2 === 0) {
      const seed = inputs[i % inputs.length];
      seed?.subarray(0, Math.min(16, bytes.length)).copy(bytes);
    }
    const result = await inspectBytes(bytes);
    expect(FileFormat.safeParse(result.format).success).toBe(true);
    if (result.details !== undefined) expect(FormatDetails.safeParse(result.details).success).toBe(true);
  }
}, 60_000);
