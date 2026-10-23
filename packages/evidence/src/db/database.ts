import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite';
import { PhoenixError } from '@phoenix/contracts';
export type Row = Record<string, SQLOutputValue>;
export type Parameter = SQLInputValue;
export function storageError(error: unknown): PhoenixError {
  if (error instanceof PhoenixError) return error;
  const busy = error instanceof Error && /busy|locked/i.test(error.message);
  return new PhoenixError(
    'STORAGE_ERROR',
    busy ? 'Database is busy or locked' : 'Evidence storage operation failed',
    { retryable: busy },
  );
}
export function storage<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw storageError(error);
  }
}
export class Database {
  readonly raw: DatabaseSync;
  private depth = 0;
  private closed = false;
  private aborted = false;
  constructor(path: string, options: { readOnly?: boolean } = {}) {
    this.raw = storage(() => new DatabaseSync(path, { readOnly: options.readOnly ?? false }));
    try {
      this.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');
      if (!options.readOnly) this.get('PRAGMA journal_mode=WAL');
      const defensive = this.raw as DatabaseSync & { enableDefensive?: (enabled: boolean) => void };
      defensive.enableDefensive?.(true);
    } catch (error) {
      this.raw.close();
      throw error;
    }
  }
  private assertTransaction(): void {
    if (this.depth > 0 && (this.aborted || !this.raw.isTransaction)) {
      this.aborted = true;
      throw new PhoenixError('STORAGE_ERROR', 'The active transaction was aborted');
    }
  }
  private operation<T>(fn: () => T): T {
    return storage(() => {
      this.assertTransaction();
      try {
        return fn();
      } finally {
        this.assertTransaction();
      }
    });
  }
  exec(sql: string): void {
    this.operation(() => {
      this.raw.exec(sql);
    });
  }
  run(sql: string, ...params: Parameter[]) {
    return this.operation(() => this.raw.prepare(sql).run(...params));
  }
  get(sql: string, ...params: Parameter[]): Row | undefined {
    return this.operation(() => this.raw.prepare(sql).get(...params));
  }
  all(sql: string, ...params: Parameter[]): Row[] {
    return this.operation(() => this.raw.prepare(sql).all(...params));
  }
  transaction<T>(fn: () => T extends PromiseLike<unknown> ? never : T): T {
    const level = this.depth,
      savepoint = `evidence_${String(level)}`;
    this.assertTransaction();
    storage(() => {
      this.raw.exec(level === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
    });
    this.depth++;
    try {
      this.assertTransaction();
      const result: unknown = fn();
      if (result !== null && (typeof result === 'object' || typeof result === 'function') && 'then' in result)
        throw new PhoenixError('STORAGE_ERROR', 'Transactions require synchronous callbacks');
      this.assertTransaction();
      storage(() => {
        this.raw.exec(level === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
      });
      if (level > 0) this.assertTransaction();
      return result as T;
    } catch (error) {
      // SQLITE_FULL/IOERR may already have rolled back *all* savepoints. Never
      // issue a stale RELEASE or allow the still-running owner to autocommit.
      if (!this.raw.isTransaction) this.aborted = true;
      else {
        try {
          this.raw.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
        } catch {
          this.aborted = true;
          throw new PhoenixError('STORAGE_ERROR', 'Transaction cleanup failed');
        }
      }
      throw storageError(error);
    } finally {
      this.depth--;
      if (level === 0) this.aborted = false;
    }
  }
  close(): void {
    if (!this.closed) {
      storage(() => {
        this.raw.close();
      });
      this.closed = true;
    }
  }
}
export function openDatabase(path: string, options: { readOnly?: boolean } = {}): Database {
  return new Database(path, options);
}
