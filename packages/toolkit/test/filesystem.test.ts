import { expect, it } from 'vitest';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import {
  openRegularFile,
  readFileStream,
  hashStream,
  hashFileTo,
  MAX_RANGE_BYTES,
  createProcessRunner,
} from '../src/index.js';
import { tempDir, makeSymlink } from './support.js';

it('reads bounded ranges without altering bytes or modification time', async () => {
  const root = await tempDir(),
    file = path.join(root, 'data');
  await writeFile(file, 'abcdef');
  const opened = await openRegularFile(file);
  try {
    expect(opened.sizeBytes).toBe(6);
    expect(Buffer.from(await opened.readRange(1, 3)).toString()).toBe('bcd');
    expect(Buffer.from(await opened.readRange(5, 10)).toString()).toBe('f');
    expect((await opened.readRange(100, 10)).byteLength).toBe(0);
    expect((await opened.readRange(0, 0)).byteLength).toBe(0);
    for (const [offset, length] of [
      [-1, 1],
      [0, -1],
      [0, 0.5],
      [0, MAX_RANGE_BYTES + 1],
      [Number.MAX_SAFE_INTEGER + 1, 1],
    ] as const)
      await expect(opened.readRange(offset, length)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await opened.verify();
  } finally {
    await opened.close();
  }
  await opened.close();
  await expect(opened.readRange(0, 1)).rejects.toMatchObject({ code: 'TARGET_UNREADABLE' });
});
it('rejects missing files, directories, links and special files', async (context) => {
  const root = await tempDir(),
    file = path.join(root, 'file');
  await writeFile(file, 'x');
  await expect(openRegularFile(root)).rejects.toMatchObject({ code: 'TARGET_UNREADABLE' });
  await expect(openRegularFile(path.join(root, 'missing'))).rejects.toMatchObject({
    code: 'TARGET_UNREADABLE',
  });
  await makeSymlink(file, path.join(root, 'link'), context);
  await expect(openRegularFile(path.join(root, 'link'))).rejects.toMatchObject({ code: 'TARGET_UNREADABLE' });
});
it.skipIf(process.platform === 'win32')(
  'rejects a real FIFO and socket without opening/blocking',
  async () => {
    const root = await tempDir(),
      fifo = path.join(root, 'fifo'),
      socket = path.join(root, 'socket');
    const runner = createProcessRunner({ allowExecution: true, workflow: 'create test FIFO' });
    const { findExecutable } = await import('../src/platform/which.js');
    const mkfifo = await findExecutable('mkfifo');
    expect(mkfifo, 'POSIX mkfifo utility required for real FIFO regression').toBeDefined();
    if (mkfifo === undefined) throw Error('mkfifo unavailable');
    expect(
      (
        await runner.runProcess({
          file: mkfifo,
          args: [fifo],
          cwd: root,
          timeoutMs: 2000,
          maxOutputBytes: 1024,
          signal: new AbortController().signal,
        })
      ).exitCode,
    ).toBe(0);
    await expect(openRegularFile(fifo)).rejects.toMatchObject({ code: 'TARGET_UNREADABLE' });
    const { hashDirectory } = await import('../src/hash/tree.js');
    const inventory = await hashDirectory(root);
    expect(inventory.entries).toEqual([{ path: 'fifo', type: 'other' }]);
    expect(inventory.digest).toBeDefined();
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socket, resolve);
    });
    try {
      await expect(openRegularFile(socket)).rejects.toMatchObject({ code: 'TARGET_UNREADABLE' });
      await expect(openRegularFile('/dev/null')).rejects.toMatchObject({ code: 'TARGET_UNREADABLE' });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        }),
      );
    }
  },
);
it('detects edits, replacements and disappearance using verified metadata', async () => {
  const root = await tempDir(),
    file = path.join(root, 'data');
  await writeFile(file, 'original');
  let opened = await openRegularFile(file);
  await writeFile(file, 'modified with a reliably different size');
  await expect(opened.readRange(0, 1)).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  await opened.close();
  opened = await openRegularFile(file);
  if (process.platform !== 'win32') {
    await rename(file, file + '.old');
    await writeFile(file, Buffer.alloc(opened.sizeBytes, 88));
    await expect(opened.verify()).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
    await opened.close();
    opened = await openRegularFile(file);
    await unlink(file);
    await expect(opened.verify()).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  }
  await opened.close();
});
it('streams large files and closes on early return, cancellation and mutation', async () => {
  const root = await tempDir(),
    file = path.join(root, 'large');
  await writeFile(file, Buffer.alloc(2 * 1024 * 1024, 42));
  let chunks = 0,
    total = 0;
  for await (const chunk of readFileStream(file)) {
    chunks++;
    total += chunk.length;
    expect(chunk.length).toBeLessThanOrEqual(65536);
  }
  expect(total).toBe(2 * 1024 * 1024);
  expect(chunks).toBe(32);
  const opened = await openRegularFile(file);
  for await (const chunk of opened.stream()) {
    expect(chunk.length).toBeGreaterThan(0);
    break;
  }
  await expect(opened.verify()).rejects.toMatchObject({ code: 'TARGET_UNREADABLE' });
  const ac = new AbortController();
  ac.abort();
  await expect(readFileStream(file, ac.signal).next()).rejects.toMatchObject({ code: 'CANCELLED' });
  const controller = new AbortController(),
    iterator = readFileStream(file, controller.signal);
  await iterator.next();
  controller.abort();
  await expect(iterator.next()).rejects.toMatchObject({ code: 'CANCELLED' });
  const changing = readFileStream(file);
  await changing.next();
  await writeFile(file, 'changed');
  await expect(changing.next()).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  const single = await openRegularFile(file);
  for await (const chunk of single.stream()) {
    expect(chunk.length).toBeGreaterThan(0);
    break;
  }
  await expect(single.stream()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
  });
  // Windows deletion would fail here if a stream leaked an open handle.
  await unlink(file);
});
it.each([
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['a'.repeat(1000000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
])('hashes SHA-256 known-answer vector %#', async (input, expected) => {
  function* stream() {
    for (let i = 0; i < input.length; i += 4096) yield Buffer.from(input.slice(i, i + 4096));
  }
  expect(await hashStream(stream())).toEqual({ sha256: expected, sizeBytes: input.length });
});
it('hashes and tees in one pass, with byte limits and sink-failure cleanup', async () => {
  const root = await tempDir(),
    file = path.join(root, 'data');
  await writeFile(file, 'abc');
  const parts: Buffer[] = [];
  const result = await hashFileTo(file, (chunk) => {
    parts.push(Buffer.from(chunk));
    return Promise.resolve();
  });
  expect(Buffer.concat(parts).toString()).toBe('abc');
  expect(result.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  await expect(hashFileTo(file, undefined, { maxBytes: 2 })).rejects.toMatchObject({
    code: 'OUTPUT_LIMIT_EXCEEDED',
  });
  await expect(hashFileTo(file, () => Promise.reject(Error('sink failed')))).rejects.toThrow('sink failed');
  await unlink(file);
});
it('detects a real source mutation during a single-pass hash/copy and closes the source', async () => {
  const root = await tempDir(),
    file = path.join(root, 'changing');
  await writeFile(file, Buffer.alloc(3 * 65536, 1));
  let changed = false;
  await expect(
    hashFileTo(file, async () => {
      if (!changed) {
        changed = true;
        await writeFile(file, 'changed during stream');
      }
    }),
  ).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  expect(changed).toBe(true);
  await unlink(file);
});
it('checks cancellation after an asynchronous sink and releases the stream', async () => {
  const root = await tempDir(),
    file = path.join(root, 'cancel');
  await writeFile(file, 'abc');
  const controller = new AbortController();
  await expect(
    hashFileTo(
      file,
      () => {
        controller.abort();
        return Promise.resolve();
      },
      { signal: controller.signal },
    ),
  ).rejects.toMatchObject({ code: 'CANCELLED' });
  await unlink(file);
});
