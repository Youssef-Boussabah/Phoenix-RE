import { randomUUID } from 'node:crypto';
import { PhoenixError, PageInput } from '@phoenix/contracts';
import { type Database, type Parameter, type Row, storage } from '../db/database.js';
export interface Schema<T> {
  parse(value: unknown): T;
}
export const now = (): string => new Date().toISOString();
export const newId = (prefix: string): string => `${prefix}_${randomUUID().replaceAll('-', '')}`;
export function input<T>(schema: Schema<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    throw new PhoenixError('INVALID_REQUEST', 'Invalid evidence record');
  }
}
export function stored<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof PhoenixError && error.code === 'STORAGE_ERROR') throw error;
    throw new PhoenixError('STORAGE_ERROR', 'Corrupted persisted evidence');
  }
}
export function read<T>(schema: Schema<T>, value: unknown): T {
  return stored(() => schema.parse(value));
}
export function json(value: unknown): string {
  return JSON.stringify(value);
}
export function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 16 * 1024 * 1024)
    throw new PhoenixError('STORAGE_ERROR', 'Invalid serialized evidence');
  return storage(() => JSON.parse(value) as unknown);
}
export interface Field {
  key: string;
  column: string;
  json?: boolean;
}
export function fields(spec: string): Field[] {
  return spec.split(' ').map((part) => {
    const [key = '', column = key] = part.split(':');
    return { key, column: column.replace(/\*$/, ''), json: column.endsWith('*') };
  });
}
export function encode(value: object, mapping: Field[]): Parameter[] {
  const record = value as Record<string, unknown>;
  return mapping.map((f) => {
    const v = record[f.key];
    if (v === undefined) return null;
    if (f.json) return json(v);
    if (typeof v !== 'string' && typeof v !== 'number')
      throw new PhoenixError('INVALID_REQUEST', 'Invalid storage field');
    return v;
  });
}
export function decode<T>(schema: Schema<T>, row: Row, mapping: Field[], versioned = true): T {
  const value: Record<string, unknown> = {};
  if (versioned) value['schemaVersion'] = 1;
  for (const f of mapping) {
    const v = row[f.column];
    if (v !== null && v !== undefined) value[f.key] = f.json ? parseJson(v) : v;
  }
  return read(schema, value);
}
export function pagination(value: unknown = {}): { limit: number; cursor: string } {
  const p = input(PageInput, value);
  return { limit: p.limit, cursor: p.cursor ?? '' };
}
export class Repository<T extends object> {
  readonly db: Database;
  readonly table: string;
  readonly schema: Schema<T>;
  readonly mapping: Field[];
  readonly key: string;
  readonly versioned: boolean;
  constructor(db: Database, table: string, schema: Schema<T>, spec: string, key = 'id', versioned = true) {
    this.db = db;
    this.table = table;
    this.schema = schema;
    this.mapping = fields(spec);
    this.key = key;
    this.versioned = versioned;
  }
  insert(value: unknown): T {
    const parsed = input(this.schema, value);
    this.db.run(
      `INSERT INTO ${this.table} (${this.mapping.map((f) => f.column).join(',')}) VALUES (${this.mapping.map(() => '?').join(',')})`,
      ...encode(parsed, this.mapping),
    );
    return parsed;
  }
  get(id: string): T {
    const row = this.db.get(`SELECT * FROM ${this.table} WHERE ${this.key}=?`, id);
    if (!row) throw new PhoenixError('NOT_FOUND', 'Evidence record does not exist');
    return decode(this.schema, row, this.mapping, this.versioned);
  }
  list(page: unknown = {}): T[] {
    const { limit, cursor } = pagination(page);
    return this.db
      .all(`SELECT * FROM ${this.table} WHERE ${this.key}>? ORDER BY ${this.key} LIMIT ?`, cursor, limit)
      .map((row) => decode(this.schema, row, this.mapping, this.versioned));
  }
}

export function jobIncludesTarget(db: Database, jobId: string, targetId: string): boolean {
  const job = db.get('SELECT target_id, candidate_target_id FROM jobs WHERE id=?', jobId);
  return job !== undefined && (job['target_id'] === targetId || job['candidate_target_id'] === targetId);
}
