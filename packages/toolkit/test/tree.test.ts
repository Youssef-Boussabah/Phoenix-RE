import { expect, it } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { hashDirectory, encodeTreeRecord } from '../src/index.js';
import type { TreeRecord } from '../src/index.js';
import { tempDir, makeSymlink } from './support.js';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
it('matches an independently written fixed tree digest and creation-order permutation', async () => {
  const a = await tempDir(),
    b = await tempDir();
  await mkdir(path.join(a, 'empty'));
  await writeFile(path.join(a, 'z'), 'abc');
  await writeFile(path.join(a, 'a'), '');
  await writeFile(path.join(b, 'a'), '');
  await writeFile(path.join(b, 'z'), 'abc');
  await mkdir(path.join(b, 'empty'));
  // Literal expected byte stream, independent of toolkit serialization/sorting helpers.
  const expected =
    '["phoenix-tree-sha256-v1",[".git"]]\n' +
    '["F","a","e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",0]\n' +
    '["D","empty"]\n' +
    '["F","z","ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",3]\n';
  const result = await hashDirectory(a);
  expect(result.digest).toBe(sha(expected));
  expect((await hashDirectory(b)).digest).toBe(result.digest);
  expect(result.entries.map((e) => e.path)).toEqual(['a', 'empty', 'z']);
  expect(result.totalBytes).toBe(3);
  expect((await hashDirectory(a, { exclude: [] })).digest).not.toBe(result.digest);
});
it('normalizes NFC/NFD names identically and rejects actual normalization collisions', async (context) => {
  const a = await tempDir(),
    b = await tempDir();
  await writeFile(path.join(a, 'café'), 'x');
  await writeFile(path.join(b, 'cafe\u0301'), 'x');
  expect((await hashDirectory(a)).digest).toBe((await hashDirectory(b)).digest);
  await writeFile(path.join(a, 'cafe\u0301'), 'y');
  const { readdir } = await import('node:fs/promises');
  if ((await readdir(a)).length !== 2)
    context.skip('Filesystem normalizes Unicode names; cannot create NFC/NFD collision');
  await expect(hashDirectory(a)).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('keeps case-distinct files distinct on case-sensitive filesystems', async (context) => {
  const root = await tempDir();
  await writeFile(path.join(root, 'A'), 'a');
  await writeFile(path.join(root, 'a'), 'b');
  const result = await hashDirectory(root);
  if (result.entries.length !== 2)
    context.skip('Filesystem is case-insensitive; distinct case names cannot coexist');
  expect(result.entries.map((e) => e.path)).toEqual(['A', 'a']);
});
it('uses literal basename/path exclusions, sorted and deduplicated, without hidden omissions', async () => {
  const root = await tempDir();
  await mkdir(path.join(root, '.git'));
  await writeFile(path.join(root, '.git', 'secret'), 'secret');
  await mkdir(path.join(root, 'sub'));
  await writeFile(path.join(root, 'sub', 'skip'), 'skip');
  await writeFile(path.join(root, 'keep'), 'keep');
  const result = await hashDirectory(root, { exclude: ['sub/skip', '.git', '.git'] });
  expect(result.excluded).toEqual(['.git', 'sub/skip']);
  expect(result.entries.map((e) => e.path)).toEqual(['keep', 'sub']);
  expect((await hashDirectory(root, { exclude: ['.git', 'sub/skip'] })).digest).toBe(result.digest);
  expect((await hashDirectory(root, { exclude: ['.git'] })).digest).not.toBe(result.digest);
  await expect(hashDirectory(root, { exclude: ['../bad'] })).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
  });
});
it('never returns a digest for count/byte truncation, including zero limits', async () => {
  const root = await tempDir();
  await writeFile(path.join(root, 'f'), 'abc');
  for (const limits of [{ maxEntries: 0 }, { maxTotalBytes: 2 }, { maxTotalBytes: 0 }]) {
    const result = await hashDirectory(root, limits);
    expect(result.digest).toBeUndefined();
    expect(result.truncated).toBe(true);
    expect(result.warnings[0]?.code).toBe('INVENTORY_TRUNCATED');
  }
  expect((await hashDirectory(root, { maxEntries: 1, maxTotalBytes: 3 })).digest).toBeDefined();
  await expect(hashDirectory(root, { maxEntries: -1 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  const ac = new AbortController();
  ac.abort();
  await expect(hashDirectory(root, { signal: ac.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
});
it('hashes link payloads without following links outside the root', async (context) => {
  const root = await tempDir(),
    outside = await tempDir();
  await writeFile(path.join(outside, 'secret'), 'never read');
  await makeSymlink(outside, path.join(root, 'link'), context, true);
  const result = await hashDirectory(root);
  expect(result.entries.map((e) => e.type)).toEqual(['symlink']);
  const { readlink } = await import('node:fs/promises');
  const payload = await readlink(path.join(root, 'link'));
  expect(result.digest).toBe(
    sha(
      JSON.stringify(['phoenix-tree-sha256-v1', ['.git']]) +
        '\n' +
        JSON.stringify(['L', 'link', sha(payload)]) +
        '\n',
    ),
  );
  await writeFile(path.join(outside, 'secret'), 'changed outside');
  expect((await hashDirectory(root)).digest).toBe(result.digest);
});
it.skipIf(process.platform === 'win32')(
  'handles real newline/control/quote names and rejects backslashes',
  async () => {
    const root = await tempDir();
    for (const name of [
      'line\nbreak',
      'carriage\rreturn',
      'tab\tname',
      'quote"name',
      'control\x01',
      'é',
      '😀',
    ])
      await writeFile(path.join(root, name), name);
    const result = await hashDirectory(root);
    expect(result.entries).toHaveLength(7);
    expect(result.digest).toBeDefined();
    expect(result.entries.map((e) => e.path)).toEqual([
      'carriage\rreturn',
      'control\x01',
      'line\nbreak',
      'quote"name',
      'tab\tname',
      'é',
      '😀',
    ]);
    await writeFile(path.join(root, 'back\\slash'), 'x');
    await expect(hashDirectory(root)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  },
);
it('retains the approved adversarial record encoding vectors', async () => {
  const vectors = JSON.parse(
    await readFile(new URL('../../../tests/tree-hash-vectors.json', import.meta.url), 'utf8'),
  ) as { record: TreeRecord; utf8Hex: string }[];
  for (const vector of vectors) {
    const encoded = encodeTreeRecord(vector.record);
    expect(Buffer.from(encoded).toString('hex')).toBe(vector.utf8Hex);
    expect(JSON.parse(encoded)).toEqual(vector.record);
    expect(encoded.split('\n')).toHaveLength(2);
  }
});

it.skipIf(process.platform === 'win32')(
  'rejects invalid UTF-8 filenames when the filesystem permits them',
  async (context) => {
    const bad = await tempDir();
    try {
      await writeFile(Buffer.concat([Buffer.from(bad + '/'), Buffer.from([0xff])]), 'x');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EILSEQ')
        context.skip(
          'Filesystem rejects invalid UTF-8 filename bytes (EILSEQ); cannot construct this fixture',
        );
      throw error;
    }
    await expect(hashDirectory(bad)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  },
);
