import { it, expect } from 'vitest';
import { fixture, cleanup, event } from './helpers.js';
it.each([false, true])(
  'poisons the transaction after real SQLITE_FULL auto-rollback (nested=%s)',
  async (nested) => {
    const f = await fixture();
    try {
      f.store.db.exec('CREATE TABLE full_test (id TEXT PRIMARY KEY, data BLOB) STRICT');
      const previous = f.store.db.get('PRAGMA max_page_count')?.['max_page_count'];
      const pages = Number(f.store.db.get('PRAGMA page_count')?.['page_count']);
      f.store.db.get(`PRAGMA max_page_count=${String(pages + 16)}`);
      const initial = f.store.repos.events.list(f.j.id);
      let autoRollback = false,
        lateWriteBlocked = false;
      expect(() => {
        f.store.db.transaction(() => {
          f.store.db.run('INSERT INTO full_test VALUES (?,?)', 'outer-1', Buffer.from('first'));
          f.store.repos.jobs.save({ ...f.j, state: 'fingerprinting', version: 1 }, 0);
          const exhaust = () => {
            f.store.db.run('INSERT INTO full_test VALUES (?,zeroblob(1000000))', 'full');
          };
          try {
            if (nested) f.store.db.transaction(exhaust);
            else exhaust();
          } catch (error) {
            expect(error).toMatchObject({ code: 'STORAGE_ERROR' });
            autoRollback = !f.store.db.raw.isTransaction;
          }
          // The callback catches both errors; the owning transaction must still fail.
          try {
            f.store.db.run('INSERT INTO full_test VALUES (?,?)', 'outer-2', Buffer.from('late'));
          } catch (error) {
            expect(error).toMatchObject({ code: 'STORAGE_ERROR' });
            lateWriteBlocked = true;
          }
          expect(() =>
            f.store.repos.events.append(event(f.j, { type: 'job_started', payload: { runner: 'late' } })),
          ).toThrow(expect.objectContaining({ code: 'STORAGE_ERROR' }));
        });
      }).toThrow(expect.objectContaining({ code: 'STORAGE_ERROR' }));
      expect(autoRollback).toBe(true);
      expect(lateWriteBlocked).toBe(true);
      expect(f.store.db.all('SELECT id FROM full_test')).toEqual([]);
      expect(f.store.repos.jobs.get(f.j.id)).toEqual(f.j);
      expect(f.store.repos.events.list(f.j.id)).toEqual(initial);
      f.store.db.get(`PRAGMA max_page_count=${String(previous)}`);
      f.store.db.transaction(() => {
        f.store.db.run('INSERT INTO full_test VALUES (?,?)', 'independent', Buffer.from('ok'));
        f.store.repos.jobs.save({ ...f.j, state: 'fingerprinting', version: 1 }, 0);
      });
      expect(f.store.db.all('SELECT id FROM full_test').map((r) => r['id'])).toEqual(['independent']);
      expect(f.store.repos.jobs.get(f.j.id).state).toBe('fingerprinting');
      expect(f.store.repos.events.list(f.j.id)).toHaveLength(initial.length + 1);
    } finally {
      await cleanup(f.directory, f.store);
    }
  },
);
it('checks transaction state before get/all/exec and cannot RELEASE an aborted owner', async () => {
  const f = await fixture();
  let blocked = 0;
  try {
    expect(() => {
      f.store.db.transaction(() => {
        f.store.db.run('CREATE TABLE lost (value TEXT) STRICT');
        f.store.db.raw.exec('ROLLBACK'); // deterministic lost-owner seam, not a production switch
        for (const read of [
          () => f.store.db.get('SELECT 1'),
          () => f.store.db.all('SELECT 1'),
          () => {
            f.store.db.exec("INSERT INTO projects VALUES ('bad','bad','bad')");
          },
        ])
          try {
            read();
          } catch (error) {
            expect(error).toMatchObject({ code: 'STORAGE_ERROR' });
            blocked++;
          }
      });
    }).toThrow(expect.objectContaining({ code: 'STORAGE_ERROR' }));
    expect(blocked).toBe(3);
    expect(f.store.db.get("SELECT name FROM sqlite_schema WHERE name='lost'")).toBeUndefined();
    expect(f.store.repos.projects.list()).toHaveLength(1);
  } finally {
    await cleanup(f.directory, f.store);
  }
});
