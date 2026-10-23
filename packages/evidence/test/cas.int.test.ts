import { it, expect } from 'vitest';
import { chmod, readFile, writeFile, unlink, readdir, stat, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createEvidenceStore } from '@phoenix/evidence';
import { fixture, cleanup, id } from './helpers.js';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const b of stream) chunks.push(b);
  return Buffer.concat(chunks);
}
function bytesStream(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield await Promise.resolve(chunk);
    },
  };
}
it('deduplicates concurrent real writes, sets read-only permissions and survives reopen', async () => {
  const f = await fixture();
  let reopened;
  try {
    const data = Buffer.from('actual persisted artifact\n');
    const writes = await Promise.all(
      Array.from({ length: 12 }, () => f.store.artifacts.putBytes(data, 'text/plain')),
    );
    expect(new Set(writes.map((a) => a.id)).size).toBe(1);
    const a = writes[0];
    if (!a) throw new Error();
    expect(a.sha256).toBe(hash(data));
    expect(f.store.repos.artifacts.list()).toEqual([a]);
    const path = join(f.directory, 'artifacts', 'sha256', a.sha256.slice(0, 2), a.sha256);
    expect(await readFile(path)).toEqual(data);
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o222).toBe(0);
    expect(await readdir(join(f.directory, 'artifacts', 'tmp'))).toEqual([]);
    expect(await collect(f.store.artifacts.read(a.id))).toEqual(data);
    await f.store.close();
    reopened = await createEvidenceStore({ dataDir: f.directory });
    expect(await collect(reopened.artifacts.open(a.sha256))).toEqual(data);
    expect(await reopened.artifacts.fingerprint(a.sha256)).toEqual({
      sha256: a.sha256,
      sizeBytes: data.length,
    });
    expect(await reopened.artifacts.reconcile()).toEqual([{ artifact: a, healthy: true }]);
  } finally {
    await cleanup(f.directory, f.store, ...(reopened ? [reopened] : []));
  }
});
it('streams many bounded chunks, enforces exact size including zero bytes', async () => {
  const f = await fixture();
  try {
    const chunk = Buffer.alloc(65536, 42),
      count = 64;
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (let i = 0; i < count; i++) yield await Promise.resolve(chunk);
      },
    };
    const a = await f.store.artifacts.putStream(stream, 'application/octet-stream', chunk.length * count);
    expect(a.sizeBytes).toBe(chunk.length * count);
    expect((await f.store.artifacts.fingerprint(a.sha256)).sizeBytes).toBe(a.sizeBytes);
    const empty = await f.store.artifacts.putStream(bytesStream(), 'empty', 0);
    expect(empty.sha256).toBe(hash(Buffer.alloc(0)));
  } finally {
    await cleanup(f.directory, f.store);
  }
});
it.each(['limit', 'producer', 'invalid-chunk'])(
  'cleans failed %s temporary writes and leaves no artifact row',
  async (mode) => {
    const f = await fixture();
    try {
      const stream = {
        async *[Symbol.asyncIterator]() {
          yield await Promise.resolve(Buffer.from('a'));
          if (mode === 'producer') throw new Error('private input');
          if (mode === 'invalid-chunk') yield 'wrong' as unknown as Uint8Array;
          else yield Buffer.from('too much');
        },
      };
      await expect(
        f.store.artifacts.putStream(stream, 'text/plain', mode === 'limit' ? 1 : 100),
      ).rejects.toMatchObject({
        code:
          mode === 'limit'
            ? 'OUTPUT_LIMIT_EXCEEDED'
            : mode === 'invalid-chunk'
              ? 'INVALID_REQUEST'
              : 'STORAGE_ERROR',
      });
      expect(await readdir(join(f.directory, 'artifacts', 'tmp'))).toEqual([]);
      expect(f.store.repos.artifacts.list()).toEqual([]);
    } finally {
      await cleanup(f.directory, f.store);
    }
  },
);
it.each([-1, NaN, 1.5, Infinity])('rejects invalid stream limit %s', async (limit) => {
  const f = await fixture();
  try {
    await expect(f.store.artifacts.putStream(bytesStream(), 'text', limit)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  } finally {
    await cleanup(f.directory, f.store);
  }
});
it('detects missing blobs, tampering, wrong metadata sizes and refuses corrupt dedupe', async () => {
  const f = await fixture();
  try {
    const a = await f.store.artifacts.putBytes(Buffer.from('content'), 'text/plain');
    const path = join(f.directory, 'artifacts', 'sha256', a.sha256.slice(0, 2), a.sha256);
    await chmod(path, 0o600);
    await writeFile(path, 'changed');
    await expect(f.store.artifacts.fingerprint(a.sha256)).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    await expect(f.store.artifacts.putBytes(Buffer.from('content'), 'text/plain')).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
    });
    expect(await readFile(path, 'utf8')).toBe('changed');
    expect(await readdir(join(f.directory, 'artifacts', 'tmp'))).toEqual([]);
    expect(await f.store.artifacts.reconcile()).toEqual([{ artifact: a, healthy: false }]);
    await unlink(path);
    await expect(collect(f.store.artifacts.open(a.sha256))).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    expect(await f.store.artifacts.reconcile()).toEqual([{ artifact: a, healthy: false }]);
    // A repeat upload repairs a missing blob for an existing, matching row.
    expect(await f.store.artifacts.putBytes(Buffer.from('content'), 'text/plain')).toEqual(a);
    f.store.db.exec('DROP TRIGGER artifacts_no_update');
    f.store.db.run('UPDATE artifacts SET size_bytes=? WHERE id=?', 99, a.id);
    await expect(f.store.artifacts.fingerprint(a.sha256)).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
  } finally {
    await cleanup(f.directory, f.store);
  }
});
it('rejects invalid digest paths and non-file blobs without opening them', async () => {
  const f = await fixture();
  try {
    await expect(collect(f.store.artifacts.open('../secret'))).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    const digest = 'b'.repeat(64);
    await mkdir(join(f.directory, 'artifacts', 'sha256', 'bb', digest), { recursive: true });
    await expect(f.store.artifacts.fingerprint(digest)).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    await expect(collect(f.store.artifacts.read(id('art')))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  } finally {
    await cleanup(f.directory, f.store);
  }
});
it('keeps published orphan recoverable when the database write fails', async () => {
  const f = await fixture();
  try {
    f.store.db.exec(
      "CREATE TRIGGER reject_artifact BEFORE INSERT ON artifacts BEGIN SELECT RAISE(ABORT,'test failure'); END;",
    );
    const bytes = Buffer.from('recoverable');
    await expect(f.store.artifacts.putBytes(bytes, 'text')).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    expect(f.store.repos.artifacts.list()).toEqual([]);
    expect((await f.store.artifacts.fingerprint(hash(bytes))).sizeBytes).toBe(bytes.length);
    f.store.db.exec('DROP TRIGGER reject_artifact');
    const a = await f.store.artifacts.putBytes(bytes, 'text');
    expect(a.sha256).toBe(hash(bytes));
    await expect(
      Promise.resolve().then(() => f.store.repos.artifacts.register({ ...a, id: id('art'), sizeBytes: 999 })),
    ).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
  } finally {
    await cleanup(f.directory, f.store);
  }
});
it('drains pending writes before shutdown and refuses subsequent writes and reads', async () => {
  const f = await fixture();
  try {
    const put = f.store.artifacts.putBytes(Buffer.from('pending'), 'text');
    await f.store.close();
    const a = await put;
    await expect(f.store.artifacts.putBytes(Buffer.alloc(0), 'text')).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
    });
    await expect(collect(f.store.artifacts.open(a.sha256))).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
  } finally {
    await cleanup(f.directory, f.store);
  }
});
