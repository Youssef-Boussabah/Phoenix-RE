import { copyFile, mkdir, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { HostInfo, TargetDescription } from '@phoenix/contracts';
import {
  classifyFile,
  classifyFileSource,
  describeTarget,
  hostCompatibility,
  inspectBytes,
  inspectFormat,
  targetIdentityUrl,
} from '../src/index.js';
import { elf, elfTables, fat, asar, zip } from '../../../tests/support/synth.js';
import { tempDir } from './support.js';

const fixtures = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));
const host = HostInfo.parse({
  os: 'linux',
  arch: 'x64',
  osRelease: 'test',
  nodeVersion: 'test',
  isWsl: false,
  phoenixVersion: 'test',
});
const native = (name: string) => path.join(fixtures, 'native', name);
const classify = (b: Buffer, name = 'input') =>
  classifyFileSource(
    {
      sizeBytes: b.length,
      readRange: (offset, length) => Promise.resolve(b.subarray(offset, offset + length)),
    },
    name,
  );

it.each(['hello-linux-x64.elf', 'hello-linux-x86.elf'])(
  'classifies real compiled PIE %s without executing it',
  async (name) => {
    const file = native(name),
      before = await lstat(file, { bigint: true });
    const result = await classifyFile(file);
    expect(result.details).toMatchObject({ type: 3 });
    expect(result.details?.format === 'elf' && result.details.interpreter).toMatch(/^\/.+/);
    expect(result.platform?.binaryType).toBe('executable');
    expect(result.structuralStatus).toBe('validated');
    expect((await lstat(file, { bigint: true })).mtimeNs).toBe(before.mtimeNs);
  },
);
it.each([32, 64] as const)(
  'does not invent executable identity for ELF%s ET_DYN without PT_INTERP',
  async (bits) => {
    const b = elf(bits, true);
    b.writeUInt16LE(3, 16);
    const result = await inspectBytes(b);
    expect(result.platform?.binaryType).toBe('unknown');
    expect(result.structuralStatus).toBe('validated');
    expect(
      hostCompatibility(result.platform, host, result.kind, result.structuralStatus).nativeExecution,
    ).toBe('unknown');
    b.writeUInt16LE(2, 16);
    expect((await inspectBytes(b)).platform?.binaryType).toBe('executable');
  },
);
it.each(['empty', 'relative', 'embedded-nul', 'unterminated', 'invalid-utf8', 'outside'] as const)(
  'rejects malformed PIE interpreter: %s',
  async (damage) => {
    const b = elfTables(64, true),
      location = Number(b.readBigUInt64LE(72));
    b.writeUInt16LE(3, 16);
    if (damage === 'empty') b.writeBigUInt64LE(1n, 96);
    if (damage === 'relative') b[location] = 120;
    if (damage === 'embedded-nul') b[location + 2] = 0;
    if (damage === 'unterminated') b[b.length - 1] = 120;
    if (damage === 'invalid-utf8') b[location + 1] = 0xff;
    if (damage === 'outside') b.writeBigUInt64LE(BigInt(b.length + 1), 72);
    const result = await classify(b);
    expect(result.structuralStatus).toBe('invalid');
    expect(result.warnings.map((w) => w.code)).toContain('MALFORMED_FORMAT');
    expect(result.classification.signals.some((s) => s.description.includes('metadata parsed'))).toBe(false);
    expect(
      hostCompatibility(result.platform, host, result.kind, result.structuralStatus).nativeExecution,
    ).toBe('unknown');
  },
);
it('ignores undefined ELF program offsets when the associated count is zero', async () => {
  for (const bits of [32, 64] as const) {
    const b = elf(bits, true);
    if (bits === 64) b.writeBigUInt64LE(0xffffffffffffffffn, 32);
    else b.writeUInt32LE(0xffffffff, 28);
    const result = await inspectBytes(b);
    expect(result.warnings).toEqual([]);
    expect(result.header['programOffset']).toBe(0);
  }
});
it('retains conservative compatibility against real parser outputs for OSABI-0 and fat Mach-O', async () => {
  const real = await classifyFile(native('hello-linux-x64.elf'));
  expect(real.platform).toMatchObject({ osBasis: 'assumed', binaryType: 'executable' });
  for (const os of ['linux', 'windows', 'macos'] as const)
    expect(
      hostCompatibility(real.platform, { ...host, os }, real.kind, real.structuralStatus).nativeExecution,
    ).toBe('unknown');
  const universal = await inspectBytes(fat());
  expect(universal.structuralStatus).toBe('incomplete');
  expect(
    hostCompatibility(
      universal.platform,
      { ...host, os: 'macos' },
      universal.kind,
      universal.structuralStatus,
    ).nativeExecution,
  ).toBe('unknown');
  const explicit = await readFile(native('hello-linux-x64.elf'));
  explicit[7] = 3;
  const parsed = await inspectBytes(explicit);
  expect(hostCompatibility(parsed.platform, host, parsed.kind, parsed.structuralStatus).nativeExecution).toBe(
    'compatible',
  );
  expect(hostCompatibility(parsed.platform, host, parsed.kind).nativeExecution).toBe('unknown');
});
it('does not turn matching unknown CPU labels into native compatibility', async () => {
  const bytes = elf(64, true);
  bytes.writeUInt16LE(0xffff, 18);
  const parsed = await inspectBytes(bytes);
  expect(parsed.platform?.arches).toEqual(['other']);
  for (const arch of ['other', 'unknown'] as const)
    expect(
      hostCompatibility(parsed.platform, { ...host, arch }, parsed.kind, parsed.structuralStatus)
        .nativeExecution,
    ).toBe('unknown');
});
it('keeps PIE identity and invalid-main compatibility conservative in an actual Electron layout', async () => {
  const root = await tempDir();
  await mkdir(path.join(root, 'resources'));
  await writeFile(path.join(root, 'resources', 'app.asar'), asar());
  const file = path.join(root, 'app');
  await copyFile(native('hello-linux-x64.elf'), file);
  const original = await describeTarget({ type: 'path', path: root }, {}, host);
  expect(original.kind).toBe('electron');
  expect(original.platform?.binaryType).toBe('executable');
  expect(original.compatibility.nativeExecution).toBe('unknown');
  const bytes = await readFile(file);
  bytes[7] = 3;
  const section = Number(bytes.readBigUInt64LE(40)) + bytes.readUInt16LE(58);
  bytes.writeBigUInt64LE(BigInt(bytes.length + 99), section + 24);
  await writeFile(file, bytes);
  const invalid = await describeTarget({ type: 'path', path: root }, {}, host);
  expect(invalid.compatibility.nativeExecution).toBe('unknown');
  expect(invalid.warnings.map((w) => w.code)).toContain('MALFORMED_FORMAT');
});

// 103 realistic input mutations: intact signatures/headers, corrupt only a file-backed section offset.
it.each(Array.from({ length: 103 }, (_, i) => i))(
  'rejects native section-offset mutation %i without compatible/parsed claims',
  async (index) => {
    const pe = index % 2 !== 0;
    const bytes = await readFile(native(pe ? 'hello-windows-x64.exe' : 'hello-linux-x64.elf'));
    if (pe) {
      const header = bytes.readUInt32LE(60),
        section = header + 24 + bytes.readUInt16LE(header + 20);
      bytes.writeUInt32LE(bytes.length + index + 1, section + 20);
    } else {
      bytes[7] = 3;
      const section = Number(bytes.readBigUInt64LE(40)) + bytes.readUInt16LE(58);
      bytes.writeBigUInt64LE(BigInt(bytes.length + index + 1), section + 24);
    }
    const parsed = await classify(bytes);
    expect(parsed.structuralStatus).toBe('invalid');
    expect(parsed.warnings.map((w) => w.code)).toContain('MALFORMED_FORMAT');
    expect(parsed.classification.signals.some((s) => s.description.includes('metadata parsed'))).toBe(false);
    const root = await tempDir(),
      file = path.join(root, 'mutated');
    await writeFile(file, bytes);
    const report = await describeTarget(
      { type: 'path', path: file },
      {},
      { ...host, os: pe ? 'windows' : 'linux' },
    );
    expect(report.compatibility.nativeExecution).toBe('unknown');
    expect(report.platform?.arches).toEqual(['x64']); // Partial observations survive.
    expect(TargetDescription.safeParse(report).success).toBe(true);
  },
);
it.each([
  ['https://alice:secret@example.com/app', ['alice', 'secret']],
  ['https://example.com/app?token=abc&api_key=PRIVATE_KEY', ['token', 'abc', 'PRIVATE_KEY']],
  [
    'https://example.com/app?X-Amz-Signature=SIGNED_SECRET&Expires=604800',
    ['SIGNED_SECRET', 'X-Amz', '604800'],
  ],
  ['https://example.com/app#access_token=FRAGMENT_SECRET', ['FRAGMENT_SECRET', 'access_token']],
] as const)('persists only a safe identity for %s without fetching', async (url, secrets) => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw Error('NETWORK FORBIDDEN');
  });
  try {
    const report = await describeTarget({ type: 'url', url }, {}, host);
    expect(report.url).toBe('https://example.com/app');
    expect(report.source.displayName).toBe(report.url);
    expect(report.warnings.find((w) => w.code === 'URL_ACCESS_CONTEXT_REMOVED')?.message).toContain(
      'not an equivalent retrievable source',
    );
    const serialized = JSON.stringify(report);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});
it('retains ordinary HTTP(S) identity paths and rejects unsafe URL schemes', () => {
  expect(targetIdentityUrl('https://example.com/app')).toEqual({
    url: 'https://example.com/app',
    removedAccessContext: false,
  });
  expect(targetIdentityUrl('http://example.com/app?view=all')).toEqual({
    url: 'http://example.com/app',
    removedAccessContext: true,
  });
  for (const url of ['file:///x', 'javascript:alert(1)', 'ftp://example.com'])
    expect(() => targetIdentityUrl(url)).toThrow('HTTP(S)');
});
it('caps all file warnings at 32 while preserving mismatch and structural failure', async () => {
  const data = asar({
    files: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [String(i), { link: 'outside' }])),
  });
  const result = await classify(data, 'spoof.exe');
  expect(result.warnings).toHaveLength(32);
  expect(result.warnings[0]?.code).toBe('EXTENSION_MISMATCH');
  expect((await classify(data, 'spoof.exe')).warnings).toEqual(result.warnings);
  const failed = asar({
    files: {
      ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [String(i), { link: 'outside' }])),
      invalid: { size: -1 },
    },
  });
  const invalid = await classify(failed, 'spoof.exe');
  expect(invalid.warnings).toHaveLength(32);
  expect(invalid.warnings.slice(0, 2).map((w) => w.code)).toEqual(['MALFORMED_FORMAT', 'EXTENSION_MISMATCH']);
});
it('rejects the non-ZIP64 local-offset sentinel bypass', async () => {
  const b = zip(['AndroidManifest.xml', 'classes.dex']),
    central = b.indexOf(Buffer.from('504b0102', 'hex'));
  b.writeUInt32LE(0xffffffff, central + 42);
  const result = await inspectBytes(b);
  expect(result.kind).toBe('unknown');
  expect(result.format).toBe('zip');
  expect(result.structuralStatus).toBe('invalid');
  expect(result.warnings.map((w) => w.code)).toContain('MALFORMED_FORMAT');
});
it.each([
  ['AndroidManifest.xml', 'classes.dex', 'classes.dex'],
  ['META-INF/MANIFEST.MF', 'META-INF/MANIFEST.MF'],
  ['AndroidManifest.xml', 'classes.dex', 'café', 'cafe\u0301'],
  ['AndroidManifest.xml', 'classes.dex', 'A', 'a'],
  ['META-INF/MANIFEST.MF', 'folder/a', 'folder\\a'],
] as const)('withholds package identity for duplicate/normalized names %s', async (...names) => {
  const result = await inspectBytes(zip(names));
  expect(result.format).toBe('zip');
  expect(result.kind).toBe('unknown');
  expect(result.warnings.map((w) => w.code)).toContain('ARCHIVE_NAME_AMBIGUOUS');
});
it.each([
  '../evil',
  '/absolute',
  'a:stream',
  'CON',
  'COM0.txt',
  'LPT0',
  'CONIN$',
  'folder/CONOUT$',
  'a\nb',
  'a\u001bb',
  'a\u202eb',
  'a\u200bb',
  'trailing.',
])('rejects unsafe portable ZIP identity %s', async (name) => {
  const result = await inspectBytes(zip(['AndroidManifest.xml', 'classes.dex', name]));
  expect(result.format).toBe('zip');
  expect(result.warnings.map((w) => w.code)).toContain('UNSAFE_ARCHIVE_PATH');
  expect(result.warnings.length).toBeLessThanOrEqual(32);
});
it.each(['<!-- comment --><html>', ' \n<!--a--><!--b--><head>', '<head><title>Original</title>'])(
  'recognizes HTML after comments or head: %s',
  async (text) => {
    expect((await inspectBytes(Buffer.from(text))).format).toBe('html');
  },
);
it('bounds comment sniffing and does not execute or write a script during inspection', async () => {
  expect((await inspectBytes(Buffer.from('<!-- unclosed'))).format).toBe('text');
  expect((await inspectBytes(Buffer.from('<!--x-->'.repeat(1000)))).format).toBe('text');
  const root = await tempDir(),
    file = path.join(root, 'do-not-run.js');
  await writeFile(file, 'require("node:fs").writeFileSync("SHOULD_NOT_EXIST","executed")');
  const before = await readFile(file);
  await describeTarget({ type: 'path', path: file }, {}, host);
  expect(await readdir(root)).toEqual(['do-not-run.js']);
  expect(await readFile(file)).toEqual(before);
});
it.each([
  new TypeError('programming bug'),
  new SyntaxError('programming bug'),
  new RangeError('programming bug'),
])('propagates programming faults rather than claiming malformed input: %s', async (fault) => {
  const b = elfTables(64, true);
  // Force a parser read beyond the 64 KiB head cache, after retaining a valid native header.
  const large = Buffer.alloc(70_000);
  b.copy(large);
  large.writeBigUInt64LE(66_000n, 32);
  const source = {
    sizeBytes: large.length,
    readRange: (offset: number, length: number) =>
      offset === 0 ? Promise.resolve(large.subarray(0, length)) : Promise.reject(fault),
  };
  await expect(inspectFormat(source)).rejects.toBe(fault);
});
it.each(['valid-unsupported', 'truncated-header', 'outside-field', 'wrong-id'] as const)(
  'handles per-entry ZIP64 extra metadata: %s',
  async (variant) => {
    const original = zip(['AndroidManifest.xml', 'classes.dex']);
    const central = original.indexOf(Buffer.from('504b0102', 'hex')),
      insert = central + 46 + original.readUInt16LE(central + 28);
    const extra = Buffer.alloc(variant === 'truncated-header' ? 2 : 12);
    extra.writeUInt16LE(variant === 'wrong-id' ? 2 : 1);
    if (extra.length >= 4) extra.writeUInt16LE(variant === 'outside-field' ? 100 : 8, 2);
    const bytes = Buffer.concat([original.subarray(0, insert), extra, original.subarray(insert)]);
    bytes.writeUInt16LE(extra.length, central + 30);
    bytes.writeUInt32LE(0xffffffff, central + 42);
    const end = bytes.length - 22;
    bytes.writeUInt32LE(bytes.readUInt32LE(end + 12) + extra.length, end + 12);
    const parsed = await inspectBytes(bytes);
    expect(parsed.kind).toBe('unknown');
    expect(parsed.format).toBe('zip');
    expect(parsed.warnings.map((w) => w.code)).toContain(
      variant === 'valid-unsupported' ? 'UNSUPPORTED_VARIANT' : 'MALFORMED_FORMAT',
    );
    expect(parsed.structuralStatus).toBe(variant === 'valid-unsupported' ? 'incomplete' : 'invalid');
  },
);
