import { expect, it } from 'vitest';
import { mkdir, writeFile, chmod, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { HostInfo } from '@phoenix/contracts';
import {
  detectHost,
  mapCpuArch,
  defaultDataDir,
  toPosixRel,
  nfc,
  isPathWithin,
  resolveRelativePath,
  assertContained,
  normalizeExcludes,
  executableCandidates,
  findExecutable,
  isWindowsStoreAlias,
  discoverVersion,
  createProcessRunner,
} from '../src/index.js';
import { tempDir, makeSymlink } from './support.js';

it('detects the real host without spawning imported software', async () => {
  const host = await detectHost('test');
  expect(HostInfo.safeParse(host).success).toBe(true);
  expect(host.os).toBe(
    ({ win32: 'windows', darwin: 'macos', linux: 'linux' } as Record<string, string>)[process.platform],
  );
  expect(host.nodeVersion).toBe(process.version);
});
it('handles WSL and missing kernel metadata', async () => {
  expect(
    (
      await detectHost('x', {
        platform: 'linux',
        env: {},
        readProcVersion: () => Promise.resolve('Linux Microsoft WSL2'),
      })
    ).isWsl,
  ).toBe(true);
  expect(
    (
      await detectHost('x', {
        platform: 'linux',
        env: { WSL_INTEROP: 'x' },
        readProcVersion: () => Promise.reject(Error()),
      })
    ).isWsl,
  ).toBe(true);
  expect(
    (
      await detectHost('x', {
        platform: 'linux',
        env: {},
        readProcVersion: () => Promise.reject(Error()),
      })
    ).isWsl,
  ).toBe(false);
  await expect(detectHost('x', { platform: 'freebsd' })).rejects.toMatchObject({ code: 'HOST_INCOMPATIBLE' });
});
it('reports translation best effort with an explicitly injected probe', async () => {
  const probe = {
    runProcess: () =>
      Promise.resolve({
        exitCode: 0,
        stdout: Buffer.from('1\n'),
        stderr: Buffer.alloc(0),
        durationMs: 1,
      }),
  };
  expect(
    (await detectHost('x', { platform: 'darwin', arch: 'x64', machine: 'arm64', processRunner: probe }))
      .translated,
  ).toBe(true);
  expect(
    (await detectHost('x', { platform: 'win32', arch: 'x64', env: { PROCESSOR_ARCHITEW6432: 'ARM64' } }))
      .translated,
  ).toBe(true);
  expect(
    (await detectHost('x', { platform: 'win32', arch: 'arm64', env: { PROCESSOR_ARCHITECTURE: 'ARM64' } }))
      .translated,
  ).toBe(false);
  expect(
    (await detectHost('x', { platform: 'darwin', arch: 'arm64', machine: 'arm64' })).translated,
  ).toBeUndefined();
  const failing = {
    runProcess: () => Promise.reject(Error('missing')),
  };
  expect(
    (await detectHost('x', { platform: 'darwin', arch: 'arm64', machine: 'arm64', processRunner: failing }))
      .translated,
  ).toBeUndefined();
  expect(
    (
      await detectHost('x', {
        platform: 'darwin',
        processRunner: {
          ...probe,
          runProcess: async () => ({ ...(await probe.runProcess()), stdout: Buffer.from('0') }),
        },
      })
    ).translated,
  ).toBe(false);
});
it.each([
  ['ia32', 'x86'],
  ['x86_64', 'x64'],
  ['ARM64', 'arm64'],
  ['arm', 'arm'],
  ['riscv64', 'riscv64'],
  ['wasm32', 'wasm32'],
  ['mips', 'other'],
  ['', 'unknown'],
])('maps CPU %s', (raw, expected) => {
  expect(mapCpuArch(raw)).toBe(expected);
});
it('selects platform data directories without creating them', () => {
  expect(defaultDataDir({ os: 'linux', home: '/users/a b', env: {} })).toBe(
    '/users/a b/.local/share/phoenix',
  );
  expect(defaultDataDir({ os: 'linux', home: '/users/a', env: { XDG_DATA_HOME: '/data' } })).toBe(
    '/data/phoenix',
  );
  expect(defaultDataDir({ os: 'linux', home: '/users/a', env: { XDG_DATA_HOME: 'relative' } })).toBe(
    '/users/a/.local/share/phoenix',
  );
  expect(defaultDataDir({ os: 'macos', home: '/Users/a', env: {} })).toBe(
    '/Users/a/Library/Application Support/PHOENIX',
  );
  expect(defaultDataDir({ os: 'windows', home: 'C:\\Users\\a', env: {} })).toBe(
    'C:\\Users\\a\\AppData\\Local\\PHOENIX',
  );
  expect(defaultDataDir({ os: 'windows', env: { LOCALAPPDATA: 'D:\\local' } })).toBe('D:\\local\\PHOENIX');
  expect(defaultDataDir({ os: 'linux', env: { PHOENIX_HOME: '/custom dir' } })).toBe('/custom dir');
  expect(() => defaultDataDir({ os: 'windows', env: { LOCALAPPDATA: 'relative' } })).toThrow();
  for (const override of ['', 'relative', '/a\0b', '/a\ud800'])
    expect(() => defaultDataDir({ os: 'linux', env: { PHOENIX_HOME: override } })).toThrow();
});
it('converts native separators without removing traversal and normalizes NFC', () => {
  expect(toPosixRel('src\\cafe\u0301.ts', 'win32')).toBe('src/café.ts');
  expect(toPosixRel('line\nbreak\tname', 'posix')).toBe('line\nbreak\tname');
  expect(nfc('cafe\u0301')).toBe('café');
  expect(normalizeExcludes(['z', 'cafe\u0301', 'café', 'a/b'])).toEqual(['a/b', 'café', 'z']);
  for (const invalid of [
    '',
    '/abs',
    '../a',
    'a/../b',
    'a/./b',
    'a//b',
    'a/',
    'a\0b',
    'a\\b',
    'C:x',
    'a\ud800',
  ])
    expect(() => toPosixRel(invalid, 'posix')).toThrow();
  for (const invalid of ['NUL', 'con.txt', 'COM1', 'LPT¹.txt', 'trailing.', 'a ', 'a:b', 'file?', 'a\r'])
    expect(() => toPosixRel(invalid, 'win32')).toThrow();
  expect(() => normalizeExcludes(['*.js'])).toThrow();
});
it('uses path components and drive semantics for containment', () => {
  expect(isPathWithin('/tmp/a', '/tmp/ab', 'posix')).toBe(false);
  expect(isPathWithin('/tmp/a', '/tmp/a/b', 'posix')).toBe(true);
  expect(isPathWithin('/tmp/a', '/tmp/A/b', 'posix')).toBe(false);
  expect(isPathWithin('C:\\Root', 'c:\\ROOT\\x', 'win32')).toBe(true);
  expect(isPathWithin('C:\\Root', 'D:\\Root\\x', 'win32')).toBe(false);
  expect(isPathWithin('\\\\server\\share\\a', '\\\\other\\share\\a', 'win32')).toBe(false);
});
it('contains actual paths, rejects symlinks/junctions and invalid serialized paths', async (context) => {
  const root = await tempDir(),
    outside = await tempDir();
  await mkdir(path.join(root, 'nested'));
  await writeFile(path.join(root, 'nested', 'file'), 'data');
  expect(await resolveRelativePath(root, 'nested/file')).toBe(
    await assertContained(root, path.join(root, 'nested', 'file')),
  );
  await expect(assertContained(root, outside)).rejects.toMatchObject({ code: 'TARGET_UNREADABLE' });
  await expect(resolveRelativePath(root, '../escape')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(resolveRelativePath(root, 'cafe\u0301')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(resolveRelativePath(root, 'missing')).rejects.toMatchObject({ code: 'TARGET_UNREADABLE' });
  await makeSymlink(outside, path.join(root, 'link'), context, true);
  await expect(resolveRelativePath(root, 'link')).rejects.toMatchObject({ code: 'TARGET_UNREADABLE' });
  await expect(assertContained(path.join(root, 'link'), path.join(root, 'link'))).rejects.toMatchObject({
    code: 'TARGET_UNREADABLE',
  });
});
it('handles long nested paths and non-ASCII spaces', async () => {
  const root = await tempDir(),
    rel = Array.from({ length: 10 }, (_, i) => `Phoenix tést directory ${String(i)}`).join('/');
  await mkdir(path.join(root, rel), { recursive: true });
  await writeFile(path.join(root, rel, 'data'), 'x');
  expect(await resolveRelativePath(root, rel + '/data')).toContain('Phoenix tést');
});
it('discovers real executables through temporary PATH without running them', async () => {
  const root = await tempDir(),
    bin = path.join(root, 'bin');
  await mkdir(bin);
  const name = process.platform === 'win32' ? 'probe.exe' : 'probe';
  await copyFile(process.execPath, path.join(bin, name));
  await chmod(path.join(bin, name), 0o755);
  expect(await findExecutable('probe', { env: { PATH: bin, PATHEXT: '.EXE' } })).toBe(
    path.join(bin, process.platform === 'win32' ? 'probe.EXE' : 'probe'),
  );
  await writeFile(path.join(bin, 'empty'), '', { mode: 0o755 });
  expect(await findExecutable('empty', { env: { PATH: bin } })).toBeUndefined();
  expect(await findExecutable('absent', { env: { PATH: bin } })).toBeUndefined();
  await mkdir(path.join(bin, 'dir'));
  expect(await findExecutable('dir', { env: { PATH: bin } })).toBeUndefined();
  if (process.platform !== 'win32') {
    await writeFile(path.join(bin, 'denied'), 'x', { mode: 0o644 });
    expect(await findExecutable('denied', { env: { PATH: bin } })).toBeUndefined();
  }
  expect(
    executableCandidates('x', {
      platform: 'win32',
      env: { Path: 'C:\\a;"D:\\b c";;relative', PATHEXT: '.EXE;.CMD;.EXE' },
    }),
  ).toEqual(['C:\\a\\x.EXE', 'C:\\a\\x.CMD', 'D:\\b c\\x.EXE', 'D:\\b c\\x.CMD']);
  expect(executableCandidates('x.exe', { platform: 'win32', env: { PATH: 'C:\\a' } })).toEqual([
    'C:\\a\\x.exe',
  ]);
  expect(executableCandidates('x', { platform: 'posix', env: { PATH: ':.:relative' } })).toEqual([]);
  expect(() => executableCandidates('../x')).toThrow();
  expect(isWindowsStoreAlias('C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe')).toBe(true);
  expect(isWindowsStoreAlias('C:\\Python\\python.exe')).toBe(false);
});
it('discovers version only through an authorized bounded runner', async () => {
  const runner = createProcessRunner({ allowExecution: true, workflow: 'tool version probe' });
  expect(await discoverVersion(process.execPath, ['--version'], runner, new AbortController().signal)).toBe(
    process.version,
  );
  await expect(
    discoverVersion(process.execPath, ['-e', 'process.exit(3)'], runner, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'PROVIDER_FAILED' });
});
it('resolves canonical paths to native NFD names and rejects ambiguous normalization', async (context) => {
  const root = await tempDir();
  await writeFile(path.join(root, 'cafe\u0301'), 'x');
  const native = await resolveRelativePath(root, 'café');
  await expect((await import('node:fs/promises')).readFile(native, 'utf8')).resolves.toBe('x');
  await writeFile(path.join(root, 'café'), 'other');
  const { readdir } = await import('node:fs/promises');
  if ((await readdir(root)).length !== 2)
    context.skip('Filesystem normalizes Unicode; cannot create ambiguous names');
  await expect(resolveRelativePath(root, 'café')).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('rejects additional Windows device aliases and drive-less rooted storage paths', () => {
  for (const name of ['COM0', 'com0.txt', 'LPT0', 'LPT0.txt', 'CONIN$', 'CONOUT$', 'conin$.txt'])
    expect(() => toPosixRel(name, 'win32')).toThrow();
  for (const directory of ['\\local', '/local', 'C:relative']) {
    expect(() => defaultDataDir({ os: 'windows', env: { PHOENIX_HOME: directory } })).toThrow();
    expect(() => defaultDataDir({ os: 'windows', env: { LOCALAPPDATA: directory } })).toThrow();
    expect(executableCandidates('tool', { platform: 'win32', env: { PATH: directory } })).toEqual([]);
    expect(isPathWithin('C:\\root', directory, 'win32')).toBe(false);
  }
  expect(defaultDataDir({ os: 'windows', env: { PHOENIX_HOME: '\\\\server\\share\\Phoenix' } })).toBe(
    '\\\\server\\share\\Phoenix',
  );
});
