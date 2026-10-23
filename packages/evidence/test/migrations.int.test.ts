import { describe, it, expect } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createEvidenceStore,
  openDatabase,
  migrate,
  migrations,
  checksum,
  storageError,
} from '@phoenix/evidence';
import { PhoenixError } from '@phoenix/contracts';
import { time } from './helpers.js';
async function temporary(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'wp4-migrate-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}
describe('real SQLite migrations', () => {
  it('creates STRICT schema, connection pragmas, and reopens without new migrations', async () =>
    temporary(async (dir) => {
      const s = await createEvidenceStore({ dataDir: dir });
      expect(s.db.get('PRAGMA journal_mode')?.['journal_mode']).toBe('wal');
      expect(s.db.get('PRAGMA foreign_keys')?.['foreign_keys']).toBe(1);
      expect(s.db.get('PRAGMA synchronous')?.['synchronous']).toBe(1);
      expect(s.db.get('PRAGMA busy_timeout')?.['timeout']).toBe(5000);
      expect(s.db.all("SELECT * FROM pragma_table_list WHERE name='projects'")[0]?.['strict']).toBe(1);
      const metadata = s.db.all('SELECT * FROM schema_migrations');
      expect(metadata).toHaveLength(1);
      expect(metadata[0]?.['checksum']).toBe(checksum(migrations[0]?.sql ?? ''));
      await s.close();
      const reopened = await createEvidenceStore({ dataDir: dir });
      try {
        expect(reopened.db.all('SELECT * FROM schema_migrations')).toEqual(metadata);
      } finally {
        await reopened.close();
      }
      expect(await readdir(dir)).not.toContain('backups');
    }));
  it.each(['checksum', 'name', 'timestamp', 'gap', 'future'])(
    'fails closed for invalid migration %s',
    async (kind) =>
      temporary(async (dir) => {
        const db = openDatabase(join(dir, 'phoenix.db'));
        try {
          migrate(db, join(dir, 'backups'));
          const sql: Record<string, string> = {
            checksum: "UPDATE schema_migrations SET checksum='changed'",
            name: "UPDATE schema_migrations SET name='wrong'",
            timestamp: "UPDATE schema_migrations SET applied_at='bad'",
            gap: 'UPDATE schema_migrations SET version=0',
            future: 'UPDATE schema_migrations SET version=999',
          };
          db.exec(sql[kind] ?? '');
          expect(() => migrate(db, join(dir, 'backups'))).toThrow(
            expect.objectContaining({
              code:
                kind === 'checksum'
                  ? 'MIGRATION_CHECKSUM_MISMATCH'
                  : kind === 'future'
                    ? 'DB_SCHEMA_TOO_NEW'
                    : 'MIGRATION_FAILED',
            }),
          );
        } finally {
          db.close();
        }
        await expect(createEvidenceStore({ dataDir: dir })).rejects.toBeInstanceOf(PhoenixError);
      }),
  );
  it('backs up real data with VACUUM INTO before a pending migration', async () =>
    temporary((dir) => {
      const db = openDatabase(join(dir, 'phoenix.db'));
      try {
        migrate(db, join(dir, 'backups'));
        db.run('INSERT INTO projects VALUES (?,?,?)', 'prj_' + 'a'.repeat(32), 'before', time);
        const next = [
          ...migrations,
          { version: 2, name: 'test_only', sql: 'CREATE TABLE test_added (value TEXT) STRICT;' },
        ];
        const backup = migrate(db, join(dir, 'backups'), next);
        expect(backup).toBeTypeOf('string');
        const copy = openDatabase(backup ?? '', { readOnly: true });
        try {
          expect(copy.get('SELECT name FROM projects')?.['name']).toBe('before');
          expect(copy.all('SELECT * FROM schema_migrations')).toHaveLength(1);
        } finally {
          copy.close();
        }
        expect(db.get("SELECT name FROM sqlite_schema WHERE name='test_added'")).toBeDefined();
      } finally {
        db.close();
      }
    }));
  it('rolls back failed DDL and does not mark the migration applied', async () =>
    temporary((dir) => {
      const db = openDatabase(join(dir, 'phoenix.db'));
      try {
        migrate(db, join(dir, 'backups'));
        expect(() =>
          migrate(db, join(dir, 'backups'), [
            ...migrations,
            { version: 2, name: 'bad', sql: 'CREATE TABLE rollback_me (x TEXT); INVALID SQL;' },
          ]),
        ).toThrow(expect.objectContaining({ code: 'MIGRATION_FAILED' }));
        expect(db.get("SELECT name FROM sqlite_schema WHERE name='rollback_me'")).toBeUndefined();
        expect(db.all('SELECT * FROM schema_migrations')).toHaveLength(1);
      } finally {
        db.close();
      }
    }));
  it.each([
    { code: [] },
    { code: [{ version: 2, name: 'bad', sql: 'SELECT 1' }] },
    { code: [{ version: 1, name: '', sql: 'SELECT 1' }] },
  ])('rejects invalid code migration lists', async ({ code }) =>
    temporary((dir) => {
      const db = openDatabase(join(dir, 'phoenix.db'));
      try {
        expect(() => migrate(db, dir, code)).toThrow(expect.objectContaining({ code: 'MIGRATION_FAILED' }));
      } finally {
        db.close();
      }
    }),
  );
  it('read-only mode validates without initializing or migrating', async () =>
    temporary(async (dir) => {
      const s = await createEvidenceStore({ dataDir: dir });
      await s.close();
      const ro = await createEvidenceStore({ dataDir: dir, readOnly: true });
      try {
        expect(ro.repos.projects.list()).toEqual([]);
        expect(() => ro.repos.projects.create({ name: 'no' })).toThrow(
          expect.objectContaining({ code: 'STORAGE_ERROR' }),
        );
        await expect(ro.artifacts.putBytes(Buffer.from('x'), 'text/plain')).rejects.toMatchObject({
          code: 'STORAGE_ERROR',
        });
        expect(() =>
          migrate(ro.db, dir, [...migrations, { version: 2, name: 'pending', sql: 'SELECT 1' }], true),
        ).toThrow(expect.objectContaining({ code: 'MIGRATION_FAILED' }));
      } finally {
        await ro.close();
      }
      const empty = join(dir, 'empty.db');
      const db = openDatabase(empty);
      db.close();
      const reader = openDatabase(empty, { readOnly: true });
      try {
        expect(() => migrate(reader, dir, undefined, true)).toThrow(
          expect.objectContaining({ code: 'MIGRATION_FAILED' }),
        );
      } finally {
        reader.close();
      }
    }));
  it('normalizes file/open failures without leaking input', async () =>
    temporary(async (dir) => {
      const file = join(dir, 'invalid');
      await writeFile(file, 'not sqlite');
      expect(() => openDatabase(file)).toThrow(expect.objectContaining({ code: 'STORAGE_ERROR' }));
      await expect(createEvidenceStore({ dataDir: file })).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    }));
  it('rolls back synchronous and nested transaction failures', async () =>
    temporary((dir) => {
      const db = openDatabase(join(dir, 't.db'));
      try {
        db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY) STRICT');
        expect(() =>
          db.transaction(() => {
            db.run('INSERT INTO t VALUES (?)', 1);
            throw new Error('synthetic');
          }),
        ).toThrow(expect.objectContaining({ code: 'STORAGE_ERROR' }));
        expect(db.all('SELECT * FROM t')).toEqual([]);
        db.transaction(() => {
          db.run('INSERT INTO t VALUES (?)', 1);
          expect(() =>
            db.transaction(() => {
              db.run('INSERT INTO t VALUES (?)', 2);
              throw new Error();
            }),
          ).toThrow();
          db.run('INSERT INTO t VALUES (?)', 3);
        });
        expect(db.all('SELECT id FROM t').map((r) => r['id'])).toEqual([1, 3]);
        // @ts-expect-error async callbacks must be rejected at compile time and runtime
        expect(() => db.transaction(async () => Promise.resolve(1))).toThrow(
          expect.objectContaining({ code: 'STORAGE_ERROR' }),
        );
        db.close();
        db.close();
        expect(() => db.all('SELECT 1')).toThrow(expect.objectContaining({ code: 'STORAGE_ERROR' }));
      } finally {
        db.close();
      }
    }));
  it('marks busy failures retryable and preserves typed errors', () => {
    expect(storageError(new Error('database is locked')).retryable).toBe(true);
    const e = new PhoenixError('CONFLICT', 'version');
    expect(storageError(e)).toBe(e);
  });
});
