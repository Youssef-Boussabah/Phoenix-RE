import { it, expect } from 'vitest';
import { join } from 'node:path';
import { createEvidenceStore, openDatabase, migrations, checksum } from '@phoenix/evidence';
import { fixture, cleanup } from './helpers.js';
it('rejects an old unshipped checksum without deleting or reinitializing its database', async () => {
  const f = await fixture();
  const initialChecksum = '45bd2992140cb0ccf0776987bde07b01e378c40d35994bb24a5c086a493cd482';
  try {
    expect(checksum(migrations[0]?.sql ?? '')).not.toBe(initialChecksum);
    f.store.db.run('UPDATE schema_migrations SET checksum=?', initialChecksum);
    await f.store.close();
    await expect(createEvidenceStore({ dataDir: f.directory })).rejects.toMatchObject({
      code: 'MIGRATION_CHECKSUM_MISMATCH',
    });
    const db = openDatabase(join(f.directory, 'phoenix.db'), { readOnly: true });
    try {
      expect(db.get('SELECT checksum FROM schema_migrations')?.['checksum']).toBe(initialChecksum);
      expect(db.get('SELECT name FROM projects WHERE id=?', f.project.id)?.['name']).toBe(f.project.name);
      expect(db.get('SELECT id FROM targets WHERE id=?', f.t.id)?.['id']).toBe(f.t.id);
    } finally {
      db.close();
    }
  } finally {
    await cleanup(f.directory, f.store);
  }
});
