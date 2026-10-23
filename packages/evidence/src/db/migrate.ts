import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PhoenixError, IsoTimestamp } from '@phoenix/contracts';
import { type Database } from './database.js';
import { initialMigration } from '../migrations/0001_init.js';
export interface Migration {
  version: number;
  name: string;
  sql: string;
}
export const migrations: readonly Migration[] = [initialMigration];
export const checksum = (sql: string): string => createHash('sha256').update(sql).digest('hex');
const metadataSql = `CREATE TABLE IF NOT EXISTS schema_migrations (
 version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
) STRICT`;
export function migrate(
  db: Database,
  backupDir: string,
  code: readonly Migration[] = migrations,
  readOnly = false,
): string | undefined {
  if (!code.length || code.some((m, i) => m.version !== i + 1 || !m.name || !m.sql))
    throw new PhoenixError('MIGRATION_FAILED', 'Invalid migration definitions');
  const exists = db.get("SELECT name FROM sqlite_schema WHERE name='schema_migrations'");
  if (!exists) {
    if (readOnly) throw new PhoenixError('MIGRATION_FAILED', 'Read-only database requires initialization');
    db.exec(metadataSql);
  }
  const validate = (): number => {
    const applied = db.all('SELECT * FROM schema_migrations ORDER BY version');
    if (applied.some((r) => typeof r['version'] === 'number' && r['version'] > code.length))
      throw new PhoenixError('DB_SCHEMA_TOO_NEW', 'Database schema requires newer PHOENIX');
    for (const [i, row] of applied.entries()) {
      const m = code[i];
      if (
        !m ||
        row['version'] !== m.version ||
        row['name'] !== m.name ||
        !IsoTimestamp.safeParse(row['applied_at']).success
      )
        throw new PhoenixError('MIGRATION_FAILED', 'Invalid migration metadata');
      if (row['checksum'] !== checksum(m.sql))
        throw new PhoenixError('MIGRATION_CHECKSUM_MISMATCH', 'Applied migration SQL checksum differs');
    }
    return applied.length;
  };
  const from = validate();
  if (from === code.length) return undefined;
  if (readOnly) throw new PhoenixError('MIGRATION_FAILED', 'Read-only database requires migration');
  let backup: string | undefined;
  const tables = db.all(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT IN ('schema_migrations','sqlite_sequence')",
  );
  if (
    tables.some(
      (r) =>
        typeof r['name'] === 'string' && db.get(`SELECT 1 FROM "${r['name'].replaceAll('"', '""')}" LIMIT 1`),
    )
  ) {
    mkdirSync(backupDir, { recursive: true });
    backup = join(
      backupDir,
      `phoenix-${new Date().toISOString().replaceAll(':', '-')}-v${String(from)}-${randomUUID()}.db`,
    );
    db.run('VACUUM INTO ?', backup);
  }
  for (const m of code.slice(from)) {
    try {
      db.transaction(() => {
        const current = validate();
        if (current >= m.version) return;
        db.exec(m.sql);
        db.run(
          'INSERT INTO schema_migrations VALUES (?, ?, ?, ?)',
          m.version,
          m.name,
          checksum(m.sql),
          new Date().toISOString(),
        );
      });
    } catch (error) {
      if (error instanceof PhoenixError && error.code !== 'STORAGE_ERROR') throw error;
      throw new PhoenixError('MIGRATION_FAILED', 'Migration rolled back');
    }
  }
  return backup;
}
