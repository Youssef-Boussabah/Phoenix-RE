import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { HostInfo, IntakeOptions, TargetDescription } from '@phoenix/contracts';
import type { HostOs, TargetKind, TargetPlatform } from '@phoenix/contracts';
import {
  describeTarget,
  hostCompatibility,
  inspectInventory,
  hashDirectory,
  classifyFile,
} from '../src/index.js';
import { asar, elf, pe } from '../../../tests/support/synth.js';
import { zip } from '../../../tests/support/synth.js';
import { tempDir, makeSymlink } from './support.js';

const fixtures = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));
export const host = HostInfo.parse({
  os: 'linux',
  arch: 'x64',
  osRelease: 'test',
  nodeVersion: 'test',
  isWsl: false,
  phoenixVersion: 'test',
});
const describe = (file: string, options: Partial<IntakeOptions> = {}) =>
  describeTarget({ type: 'path', path: file }, options, host);

it('recognizes HTTP(S) URLs without network calls and keeps credentials out of display names', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw Error('NETWORK FORBIDDEN');
  });
  try {
    const result = await describeTarget(
      { type: 'url', url: 'https://user:secret@example.com/app?q=private' },
      {},
      host,
    );
    expect(result.source.displayName).toBe('https://example.com/app');
    expect(result.kind).toBe('web');
    expect(result.classification.signals[0]?.basis).toBe('url-scheme');
    expect(result.digest).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    for (const url of ['file:///tmp/a', 'javascript:alert(1)', 'ftp://example.com', 'ssh:example'])
      await expect(describeTarget({ type: 'url', url }, {}, host)).rejects.toMatchObject({
        code: 'NOT_SUPPORTED',
      });
  } finally {
    fetch.mockRestore();
  }
});
it('rejects invalid options, missing targets, final symlinks and cancellation', async (context) => {
  const root = await tempDir();
  for (const source of [null, undefined, 1, {}, { type: 'other' }])
    await expect(
      describeTarget(source as Parameters<typeof describeTarget>[0], {}, host),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(describe(root, { maxEntries: 0 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(describe(path.join(root, 'missing'))).rejects.toMatchObject({ code: 'TARGET_UNREADABLE' });
  await expect(
    describeTarget({ type: 'path', path: root }, {}, host, AbortSignal.abort()),
  ).rejects.toMatchObject({ code: 'CANCELLED' });
  await writeFile(path.join(root, 'file'), elf());
  await writeFile(path.join(root, 'bad\uFFFD.elf'), elf());
  const invalidUnicode = path.join(root, 'bad\uD800.elf');
  await expect(describe(invalidUnicode)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(classifyFile(invalidUnicode)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await makeSymlink(path.join(root, 'file'), path.join(root, 'link'), context);
  await expect(describe(path.join(root, 'link'))).rejects.toMatchObject({ code: 'TARGET_UNREADABLE' });
});
it('keeps inspection read-only and deterministic without launching a script or creating app storage', async () => {
  const root = await tempDir(),
    target = path.join(root, 'do-not-execute.js'),
    marker = path.join(root, 'EXECUTED');
  await writeFile(
    target,
    'import {writeFileSync} from "node:fs"; writeFileSync(' + JSON.stringify(marker) + ',"BAD");',
  );
  const before = await lstat(target, { bigint: true }),
    bytes = await readFile(target);
  const first = await describe(target),
    second = await describe(target);
  expect(first.classification).toEqual(second.classification);
  expect(first.digest).toEqual(second.digest);
  expect(first.kind).toBe('source');
  expect(await readdir(root)).toEqual(['do-not-execute.js']);
  expect(await readFile(target)).toEqual(bytes);
  const after = await lstat(target, { bigint: true });
  expect([after.mtimeNs, after.size]).toEqual([before.mtimeNs, before.size]);
  expect(TargetDescription.safeParse(first).success).toBe(true);
});
it('gives byte signatures precedence over filenames', async () => {
  const native = await describe(path.join(fixtures, 'misc/elf-named.png'));
  const image = await describe(path.join(fixtures, 'misc/png-named.exe'));
  expect(native.kind).toBe('elf');
  expect(image.kind).toBe('unknown');
  for (const result of [native, image])
    expect(result.warnings.map((w) => w.code)).toContain('EXTENSION_MISMATCH');
});
it.each([
  ['pyproject.toml', 'Python'],
  ['setup.py', 'Python'],
  ['Cargo.toml', 'Rust'],
  ['go.mod', 'Go'],
  ['pom.xml', 'Java'],
  ['build.gradle', 'Java/JVM'],
  ['build.gradle.kts', 'Java/JVM'],
  ['CMakeLists.txt', 'C/C++'],
  ['Makefile', 'make project'],
  ['a.sln', '.NET'],
  ['a.csproj', '.NET'],
] as const)('classifies %s projects as data', async (name, ecosystem) => {
  const root = await tempDir();
  await writeFile(path.join(root, name), 'original fixture');
  const result = await describe(root);
  expect(result.kind).toBe('source');
  expect(result.classification.signals.some((s) => s.description.includes(ecosystem))).toBe(true);
});
it('classifies sites, unknown trees and explicit Git inventories with directory/source precedence', async () => {
  const root = await tempDir();
  await writeFile(path.join(root, 'index.html'), '<html>original</html>');
  expect((await describe(root)).kind).toBe('web');
  await writeFile(path.join(root, 'package.json'), '{"scripts":{"start":"NEVER_EXECUTE"}}');
  expect((await describe(root)).kind).toBe('source');
  const empty = await tempDir();
  expect((await describe(empty)).kind).toBe('unknown');
  await mkdir(path.join(empty, '.git'));
  expect((await describe(empty, { exclude: [] })).kind).toBe('source');
  expect((await describe(empty)).kind).toBe('unknown');
});
it('classifies validated packaged Electron layouts and obtains native platform from their executable', async () => {
  for (const nested of [false, true]) {
    const root = await tempDir(),
      prefix = nested ? path.join(root, 'App') : root;
    await mkdir(path.join(prefix, 'resources'), { recursive: true });
    await writeFile(path.join(prefix, 'resources', 'app.asar'), asar());
    await writeFile(path.join(prefix, 'app.exe'), pe(true, false));
    const library = pe(false, false);
    library.writeUInt16LE(0x2002, 86);
    await writeFile(path.join(prefix, 'aaa-library.dll'), library);
    const result = await describe(root);
    expect(result.kind).toBe('electron');
    expect(result.platform).toMatchObject({ os: 'windows', arches: ['x64'] });
  }
  const root = await tempDir();
  await mkdir(path.join(root, 'resources', 'app'), { recursive: true });
  await writeFile(path.join(root, 'resources', 'app', 'package.json'), '{}');
  expect((await describe(root)).kind).toBe('electron');
  await writeFile(path.join(root, 'resources', 'app', 'package.json'), 'INVALID_JSON');
  expect((await describe(root)).kind).toBe('unknown');
});
it('recognizes macOS root/nested bundles and Electron framework/ASAR evidence', async () => {
  for (const nested of [false, true]) {
    const root = await tempDir(),
      prefix = nested ? path.join(root, 'Original.app') : root;
    await mkdir(path.join(prefix, 'Contents', 'MacOS'), { recursive: true });
    await writeFile(path.join(prefix, 'Contents', 'Info.plist'), '<?xml version="1.0"?><plist/>');
    await copyFile(
      path.join(fixtures, 'native/hello-macos-arm64.macho'),
      path.join(prefix, 'Contents', 'MacOS', 'Original'),
    );
    const result = await describe(root);
    expect(result.kind).toBe('macho');
    expect(result.platform?.arches).toEqual(['arm64']);
    await mkdir(path.join(prefix, 'Contents', 'Frameworks', 'Electron Framework.framework'), {
      recursive: true,
    });
    expect((await describe(root)).kind).toBe('electron');
  }
  const root = await tempDir();
  await mkdir(path.join(root, 'Contents', 'Resources'), { recursive: true });
  await writeFile(path.join(root, 'Contents', 'Info.plist'), 'plist marker');
  await writeFile(path.join(root, 'Contents', 'Resources', 'app.asar'), asar());
  expect((await describe(root)).kind).toBe('electron');
});
it('does not follow directory symlinks and records excluded/truncated inventory honestly', async (context) => {
  const root = await tempDir(),
    outside = await tempDir();
  await writeFile(path.join(outside, 'app.asar'), asar());
  await makeSymlink(outside, path.join(root, 'resources'), context, true);
  const result = await describe(root);
  expect(result.kind).toBe('unknown');
  expect(result.inventory?.symlinkCount).toBe(1);
  await writeFile(path.join(root, 'large'), Buffer.alloc(100));
  const truncated = await describe(root, { maxTotalBytes: 1 });
  expect(truncated.inventory?.truncated).toBe(true);
  expect(truncated.digest).toBeUndefined();
  expect(truncated.warnings.map((w) => w.code)).toContain('INVENTORY_TRUNCATED');
  const excluded = await describe(root, { exclude: ['large'] });
  expect(excluded.inventory?.excluded).toEqual(['large']);
  expect(excluded.inventory?.fileCount).toBe(0);
});
it('bounds JSON config size/depth and warnings while retaining inventory metadata', async () => {
  const root = await tempDir(),
    file = path.join(root, 'package.json');
  for (const value of ['[]', 'null', '{"a":'.repeat(70) + '0' + '}'.repeat(70), 'x'.repeat(1_048_577)]) {
    await writeFile(file, value);
    const result = await describe(root);
    expect(result.kind).toBe('source');
    expect(result.warnings.map((w) => w.code)).toContain(
      value.length > 1_048_576 ? 'CONFIG_LIMIT' : 'INVALID_CONFIG',
    );
  }
  for (let i = 0; i < 130; i++) await writeFile(path.join(root, String(i) + '.exe'), '');
  const result = await describe(root);
  expect(result.warnings.length).toBeLessThanOrEqual(129);
  expect(result.warnings.map((w) => w.code)).toContain('WARNINGS_TRUNCATED');
});
it('uses one walker for format inventories and the exact WP2 tree hash', async () => {
  const root = path.join(fixtures, 'dirs/source-node'),
    options = IntakeOptions.parse({});
  const inventory = await inspectInventory(root, options);
  expect(inventory.tree.digest).toBe((await hashDirectory(root)).digest);
  expect(inventory.tree.entries.find((e) => e.path === 'index.js')).toMatchObject({
    format: 'text',
    type: 'file',
  });
});
it('keeps bounded warnings and classifications independent of directory creation order', async () => {
  const roots = [await tempDir(), await tempDir()];
  const names = Array.from({ length: 130 }, (_, i) => String(i).padStart(3, '0') + '.exe');
  const results = [];
  for (const [i, root] of roots.entries()) {
    for (const name of i === 0 ? names : [...names].reverse()) await writeFile(path.join(root, name), '');
    results.push(await describe(root));
  }
  expect(results[0]?.warnings).toEqual(results[1]?.warnings);
  expect(results[0]?.digest).toEqual(results[1]?.digest);
  expect(results[0]?.warnings).toHaveLength(128);
  expect(results[0]?.warnings.at(-1)).toEqual({
    code: 'WARNINGS_TRUNCATED',
    message: '133 further file warnings omitted',
  });
});
it('inspects archives outside the initial head and handles portable Unicode paths read-only', async () => {
  const root = await tempDir(),
    nested = path.join(root, 'Phoenix tést 目录');
  await mkdir(nested);
  const file = path.join(nested, 'original.jar');
  const names = ['META-INF/MANIFEST.MF', ...Array.from({ length: 1500 }, (_, i) => 'item' + String(i))];
  await writeFile(file, zip(names));
  const result = await describe(file);
  expect(result.classification.format).toBe('jar');
  expect(result.formatDetails).toMatchObject({ entryCount: 1501, truncated: false });
  expect(result.sha256).toBeDefined();
  expect(result.warnings).toEqual([]);
});
it('does not trust ASAR or HTML extensions when directory contents contradict them', async () => {
  const root = await tempDir();
  await mkdir(path.join(root, 'resources'));
  await writeFile(path.join(root, 'resources', 'app.asar'), 'NOT AN ASAR');
  await writeFile(path.join(root, 'index.html'), pe());
  expect((await describe(root)).kind).toBe('unknown');
});
it('detects actual mutation during its inspection callback without producing a digest', async () => {
  const root = await tempDir(),
    file = path.join(root, 'a');
  await writeFile(file, 'original');
  await expect(
    hashDirectory(root, {
      inspectFile: async (handle) => {
        await handle.readRange(0, 1);
        await writeFile(file, 'CHANGED SIZE');
      },
    }),
  ).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
});

it.each([
  ['linux', 'x64', 'linux', ['x64'], 'compatible'],
  ['linux', 'arm64', 'linux', ['x64'], 'incompatible'],
  ['linux', 'x64', 'windows', ['x64'], 'incompatible'],
  ['macos', 'arm64', 'macos', ['x64'], 'emulation-required'],
  ['macos', 'arm64', 'macos', ['x64', 'arm64'], 'compatible'],
  ['windows', 'x64', 'windows', ['x64'], 'compatible'],
  ['windows', 'arm64', 'windows', ['x64'], 'incompatible'],
  ['linux', 'x64', 'unknown', [], 'unknown'],
  ['linux', 'x64', 'linux', ['other'], 'unknown'],
  ['linux', 'x64', 'linux', [], 'unknown'],
] as const)('computes host/target policy for %s/%s target %s/%s', (os, arch, targetOs, arches, expected) => {
  const platform: TargetPlatform = {
    os: targetOs,
    osBasis: 'header',
    arches: [...arches],
    binaryType: 'executable',
  };
  expect(hostCompatibility(platform, { ...host, os, arch }, 'elf', 'validated')).toMatchObject({
    staticAnalysis: 'supported',
    nativeExecution: expected,
  });
});
it('separates static inspection, assumed OS, nonexecutables and runtime requirements', () => {
  expect(hostCompatibility(undefined, host, 'unknown').nativeExecution).toBe('unknown');
  for (const kind of ['web', 'source', 'wasm', 'dotnet'] satisfies TargetKind[])
    expect(hostCompatibility(undefined, host, kind).nativeExecution).toBe('not-applicable');
  for (const binaryType of ['object', 'shared-library', 'core', 'bundle'] as const)
    expect(
      hostCompatibility(
        { os: 'linux', osBasis: 'header', arches: ['x64'], binaryType },
        host,
        'elf',
        'validated',
      ).nativeExecution,
    ).toBe('not-applicable');
  expect(
    hostCompatibility({ os: 'linux', osBasis: 'assumed', arches: ['x64'] }, host, 'elf').nativeExecution,
  ).toBe('unknown');
  expect(
    hostCompatibility({ os: 'any', osBasis: 'not-applicable', arches: [] }, host, 'unknown').nativeExecution,
  ).toBe('not-applicable');
  for (const os of ['linux', 'windows', 'macos'] satisfies HostOs[])
    expect(
      hostCompatibility({ os, osBasis: 'header', arches: ['x64'] }, { ...host, os }, 'elf').staticAnalysis,
    ).toBe('supported');
});
