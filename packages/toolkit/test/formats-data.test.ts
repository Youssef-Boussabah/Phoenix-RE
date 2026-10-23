import { expect, it } from 'vitest';
import { FormatDetails } from '@phoenix/contracts';
import { inspectBytes, inspectFormat, FORMAT_LIMITS } from '../src/index.js';
import { asar, dex, javaClass, zip } from '../../../tests/support/synth.js';
import { FormatReader } from '../src/formats/reader.js';

it('distinguishes Java and fat magic using actual header fields', async () => {
  const result = await inspectBytes(javaClass());
  expect(result).toMatchObject({
    format: 'java-class',
    kind: 'unknown',
    details: { majorVersion: 65, minorVersion: 0 },
    header: { constantPoolCount: 1 },
  });
  expect(result.warnings).toEqual([]);
  for (const offset of [0, 6, 8]) {
    const b = javaClass();
    b.writeUInt16BE(0, offset);
    expect((await inspectBytes(b)).details).toBeUndefined();
  }
});
it('validates DEX header endian, version, sizes and table bounds', async () => {
  expect(await inspectBytes(dex())).toMatchObject({
    kind: 'android',
    format: 'dex',
    details: { version: '039' },
    header: { fileSize: 112 },
  });
  const big = dex();
  for (const offset of [32, 36, 40]) big.writeUInt32BE(offset === 40 ? 0x12345678 : 112, offset);
  expect((await inspectBytes(big)).warnings).toEqual([]);
  for (const [offset, value] of [
    [32, 113],
    [36, 0],
    [40, 0],
    [56, 1],
    [60, 112],
    [104, 2],
    [108, 111],
  ] as const) {
    const b = dex();
    b.writeUInt32LE(value, offset);
    expect((await inspectBytes(b)).warnings.map((w) => w.code)).toContain('MALFORMED_FORMAT');
  }
  const future = dex();
  future.write('041', 4);
  expect((await inspectBytes(future)).warnings.map((w) => w.code)).toContain('UNSUPPORTED_VARIANT');
});
it('walks WASM section sizes without interpreting code', async () => {
  const b = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0, 2, 1, 120]);
  expect(await inspectBytes(b)).toMatchObject({
    kind: 'wasm',
    details: { version: 1 },
    sections: [{ type: 0, offset: 10, size: 2 }],
  });
  for (const tail of [[1], [1, 128], [1, 3], [1, 255, 255, 255, 255, 16]]) {
    expect(
      (await inspectBytes(Buffer.concat([b.subarray(0, 8), Buffer.from(tail)]))).warnings.map((w) => w.code),
    ).toContain('MALFORMED_FORMAT');
  }
  b[4] = 2;
  expect((await inspectBytes(b)).warnings.map((w) => w.code)).toContain('UNSUPPORTED_VARIANT');
  const unknown = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 99, 0]);
  expect((await inspectBytes(unknown)).warnings.map((w) => w.code)).toContain('UNSUPPORTED_VARIANT');
  const many = Buffer.concat([unknown.subarray(0, 8), Buffer.alloc(4097 * 2)]);
  expect((await inspectBytes(many)).warnings.map((w) => w.code)).toContain('FORMAT_LIMIT');
});
it.each([false, true])('recognizes ZIP/JAR/APK by central-directory contents (ZIP64=%s)', async (wide) => {
  for (const [names, format, kind] of [
    [[], 'zip', 'unknown'],
    [['hello.txt'], 'zip', 'unknown'],
    [['META-INF/MANIFEST.MF'], 'jar', 'unknown'],
    [['AndroidManifest.xml'], 'zip', 'unknown'],
    [['classes.dex'], 'zip', 'unknown'],
    [['AndroidManifest.xml', 'classes2.dex'], 'apk', 'android'],
  ] as const) {
    const result = await inspectBytes(zip(names, wide));
    expect(result).toMatchObject({
      format,
      kind,
      details: {
        format,
        entryCount: names.length,
        sampledEntries: [...names],
        truncated: false,
        zip64: wide,
      },
    });
    expect(result.warnings).toEqual([]);
    expect(FormatDetails.safeParse(result.details).success).toBe(true);
  }
});
it('samples bounded ZIP names and reports incomplete inventories explicitly', async () => {
  const result = await inspectBytes(zip(Array.from({ length: 10_001 }, (_, i) => 'file' + String(i))));
  expect(result.details).toMatchObject({ entryCount: 10_001, truncated: true });
  expect(result.details?.format === 'zip' && result.details.sampledEntries.length).toBe(10_000);
  expect(result.warnings.map((w) => w.code)).toContain('FORMAT_LIMIT');
  expect((await inspectBytes(zip(['x'.repeat(4097)]))).details).toMatchObject({
    truncated: true,
    sampledEntries: [],
  });
});
it('warns about archive traversal and unsupported/encrypted names without extraction', async () => {
  const b = zip(['../danger']),
    cd = b.indexOf(Buffer.from('504b0102', 'hex'));
  b.writeUInt16LE(1, cd + 8);
  expect((await inspectBytes(b)).warnings.map((w) => w.code)).toEqual([
    'UNSAFE_ARCHIVE_PATH',
    'ENCRYPTED_ARCHIVE',
  ]);
  b[cd + 46] = 0xff;
  b[30] = 0xff;
  expect((await inspectBytes(b)).warnings.map((w) => w.code)).toContain('UNSUPPORTED_VARIANT');
  b.writeUInt16LE(0x800, cd + 8);
  expect((await inspectBytes(b)).warnings.map((w) => w.code)).toContain('MALFORMED_FORMAT');
});
it.each([
  ['missing EOCD', -22, 0],
  ['multidisk', -18, 1],
  ['count mismatch', -12, 2],
  ['central offset', -6, 0xfffffff0],
  ['central size', -10, 0xffffff00],
] as const)('rejects malformed ZIP %s', async (_label, where, value) => {
  const b = zip(['a']);
  b.writeUInt32LE(value, b.length + where);
  expect((await inspectBytes(b)).warnings.length).toBeGreaterThan(0);
});
it('validates ZIP64 integers and locator identity', async () => {
  const b = zip(['a'], true),
    locator = b.length - 42;
  b.writeBigUInt64LE(0xffffffffffffffffn, locator + 8);
  expect((await inspectBytes(b)).warnings.map((w) => w.code)).toContain('MALFORMED_FORMAT');
  b.writeUInt32LE(0, locator);
  expect((await inspectBytes(b)).warnings.map((w) => w.code)).toContain('MALFORMED_FORMAT');
});
it('rejects fabricated local ZIP metadata instead of reporting an APK', async () => {
  for (const damage of ['signature', 'name', 'payload'] as const) {
    const b = zip(['AndroidManifest.xml', 'classes.dex']);
    if (damage === 'signature') b.writeUInt32LE(0, b.indexOf(Buffer.from('504b0304', 'hex'), 4));
    else if (damage === 'name') b[30] = 120;
    else b.writeUInt32LE(0xffff0000, b.indexOf(Buffer.from('504b0102', 'hex')) + 20);
    const result = await inspectBytes(b);
    expect(result.kind).not.toBe('android');
    expect(result.warnings.length).toBeGreaterThan(0);
  }
});
it('validates ASAR pickles, nested files, links and external references as data', async () => {
  const result = await inspectBytes(asar());
  expect(result).toMatchObject({
    format: 'asar',
    kind: 'electron',
    details: { fileCount: 2, truncated: false },
  });
  expect(result.warnings).toEqual([]);
  const links = await inspectBytes(
    asar({ files: { l: { link: '../outside' }, u: { unpacked: true, size: 3 } } }),
  );
  expect(links.warnings.map((w) => w.code)).toEqual(['ARCHIVE_LINK', 'UNPACKED_ASAR']);
  for (const data of [
    {},
    { files: [] },
    { files: { '..': {} } },
    { files: { bad: null } },
    { files: { bad: { size: -1 } } },
    { files: { bad: { size: 1, offset: '0' } } },
    { files: { bad: { size: 0, offset: '9007199254740999' } } },
  ]) {
    const invalid = await inspectBytes(asar(data));
    expect(invalid.format).toBe('unknown');
    expect(invalid.warnings.map((w) => w.code)).toContain('MALFORMED_FORMAT');
  }
  const count = await inspectBytes(
    asar({
      files: Object.fromEntries(
        Array.from({ length: 10_001 }, (_, i) => [String(i), { size: 0, offset: '0' }]),
      ),
    }),
  );
  expect(count.warnings.map((w) => w.code)).toContain('FORMAT_LIMIT');
});
it('bounds ASAR JSON depth before parsing and rejects malformed UTF-8/pickle sizes', async () => {
  const nested = '{"files":' + '{"a":'.repeat(20_000) + '{}' + '}'.repeat(20_000) + '}';
  const b = asar();
  for (const offset of [4, 8, 12]) {
    const copy = Buffer.from(b);
    copy.writeUInt32LE(0xffffffff, offset);
    expect((await inspectBytes(copy)).warnings.map((w) => w.code)).toContain('MALFORMED_FORMAT');
  }
  b[16] = 0xff;
  expect((await inspectBytes(b)).warnings.map((w) => w.code)).toContain('MALFORMED_FORMAT');
  const size = 8 + Math.ceil(Buffer.byteLength(nested) / 4) * 4,
    raw = Buffer.alloc(size + 8);
  raw.writeUInt32LE(4);
  raw.writeUInt32LE(size, 4);
  raw.writeUInt32LE(size - 4, 8);
  raw.writeUInt32LE(Buffer.byteLength(nested), 12);
  raw.write(nested, 16);
  expect((await inspectBytes(raw)).warnings.map((w) => w.code)).toContain('FORMAT_LIMIT');
});
it.each([
  ['#!/bin/sh\necho NEVER_RUN', 'a.bin', 'text', 'source', 'ascii'],
  ['const x = 1;', 'a.ts', 'text', 'source', 'ascii'],
  ['\ufeffhello', 'a.txt', 'text', 'unknown', 'utf-8-bom'],
  ['café', 'a.txt', 'text', 'unknown', 'utf-8'],
  ['<!DOCTYPE html><html>', 'a.exe', 'html', 'web', 'ascii'],
  ['\n<html lang="en">', '', 'html', 'web', 'ascii'],
] as const)('recognizes text %s as data', async (text, name, format, kind, encoding) => {
  expect(await inspectBytes(Buffer.from(text), name)).toMatchObject({ format, kind, details: { encoding } });
});
it('does not classify binary controls or invalid UTF-8 as text; bounds and explains prefix sniffing', async () => {
  for (const bytes of [[0], [1], [0xff]])
    expect((await inspectBytes(Buffer.from(bytes), 'fake.js')).format).toBe('unknown');
  const long = Buffer.from('a'.repeat(8191) + 'éMORE');
  expect((await inspectBytes(long)).warnings.map((w) => w.code)).toContain('TEXT_SAMPLE');
});
it('propagates cancellation, I/O errors and short reads instead of disguising them as malformed content', async () => {
  await expect(inspectBytes(Buffer.alloc(0), '', AbortSignal.abort())).rejects.toMatchObject({
    code: 'CANCELLED',
  });
  await expect(
    inspectFormat({ sizeBytes: 4, readRange: () => Promise.resolve(Buffer.alloc(0)) }),
  ).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  await expect(
    inspectFormat({ sizeBytes: 4, readRange: () => Promise.reject(Error('I/O')) }),
  ).rejects.toThrow('I/O');
  const controller = new AbortController();
  await expect(
    inspectFormat(
      {
        sizeBytes: 1,
        readRange: () => {
          controller.abort();
          return Promise.resolve(Buffer.from('x'));
        },
      },
      '',
      controller.signal,
    ),
  ).rejects.toMatchObject({ code: 'CANCELLED' });
  const reader = new FormatReader({
    sizeBytes: FORMAT_LIMITS.readBytes + 1,
    readRange: (_offset, length) => Promise.resolve(Buffer.alloc(length)),
  });
  await expect(reader.read(0, FORMAT_LIMITS.readBytes + 1)).rejects.toMatchObject({ code: 'FORMAT_LIMIT' });
  await expect(reader.read(-1, 1)).rejects.toMatchObject({ code: 'MALFORMED_FORMAT' });
});
