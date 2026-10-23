import { resolve, isAbsolute } from 'node:path';
import { TargetManifest, PhoenixError } from '@phoenix/contracts';
import { type Database } from '../db/database.js';
import { stored, newId, parseJson, json, pagination } from './shared.js';
import { type Artifacts } from './artifacts.js';
import { privateManifest } from './privacy.js';
export class Targets {
  readonly db: Database;
  readonly artifacts: Artifacts;
  constructor(db: Database, artifacts: Artifacts) {
    this.db = db;
    this.artifacts = artifacts;
  }
  private validateArtifacts(t: TargetManifest): void {
    if (t.artifactId !== undefined) {
      const artifact = stored(() => this.artifacts.get(t.artifactId ?? ''));
      if (
        t.source.type !== 'file' ||
        t.digest?.algorithm !== 'sha256' ||
        t.sha256 !== artifact.sha256 ||
        t.digest.value !== artifact.sha256 ||
        (t.sizeBytes !== undefined && t.sizeBytes !== artifact.sizeBytes)
      )
        throw new PhoenixError('INVALID_REQUEST', 'Target snapshot digest or size disagrees with artifact');
    }
    if (t.inventoryArtifactId !== undefined) {
      const inventory = stored(() => this.artifacts.get(t.inventoryArtifactId ?? ''));
      if (t.source.type !== 'directory' || inventory.mediaType !== 'application/vnd.phoenix.inventory+json')
        throw new PhoenixError('INVALID_REQUEST', 'Invalid target inventory artifact');
    }
    if (
      t.source.type === 'file' &&
      t.intakeMode === 'snapshot' &&
      t.digest !== undefined &&
      t.artifactId === undefined
    )
      throw new PhoenixError('INVALID_REQUEST', 'A complete file snapshot requires an artifact');
  }
  private fromRow(row: Record<string, unknown>): TargetManifest {
    return stored(() => {
      const parsed = TargetManifest.parse(parseJson(row['manifest_json']));
      if (json(privateManifest(parsed)) !== json(parsed)) throw new Error('Unsafe persisted identity');
      const values = [
        parsed.id,
        parsed.projectId,
        parsed.kind,
        parsed.classification.format,
        parsed.source.type,
        parsed.intakeMode,
        parsed.digest?.algorithm ?? null,
        parsed.digest?.value ?? null,
        parsed.artifactId ?? null,
        parsed.inventoryArtifactId ?? null,
        parsed.supersedes ?? null,
        parsed.createdAt,
      ];
      const keys = [
        'id',
        'project_id',
        'kind',
        'format',
        'source_type',
        'intake_mode',
        'digest_algorithm',
        'digest',
        'artifact_id',
        'inventory_artifact_id',
        'supersedes_id',
        'created_at',
      ];
      if (keys.some((key, i) => row[key] !== values[i])) throw new Error('Manifest columns disagree');
      if (
        row['source_key'] !==
        (parsed.source.type === 'url' ? `intake:${parsed.id}` : resolve(parsed.localPath ?? ''))
      )
        throw new Error('Invalid source identity');
      return parsed;
    });
  }
  get(id: string): TargetManifest {
    const row = this.db.get('SELECT * FROM targets WHERE id=?', id);
    if (!row) throw new PhoenixError('NOT_FOUND', 'Target does not exist');
    return this.fromRow(row);
  }
  list(page: unknown = {}): TargetManifest[] {
    const p = pagination(page);
    return this.db
      .all('SELECT * FROM targets WHERE id>? ORDER BY id LIMIT ?', p.cursor, p.limit)
      .map((r) => this.fromRow(r));
  }
  add(value: unknown): TargetManifest {
    const t = privateManifest(value);
    if (t.source.type !== 'url' && (!t.localPath || !isAbsolute(t.localPath)))
      throw new PhoenixError('INVALID_REQUEST', 'Local targets require an absolute local path');
    const key = t.source.type === 'url' ? `intake:${t.id}` : resolve(t.localPath ?? '');
    return this.db.transaction(() => {
      this.validateArtifacts(t);
      const same = this.db.get('SELECT * FROM targets WHERE id=?', t.id);
      if (same) {
        const existing = this.fromRow(same);
        if (json(existing) === json(t)) return existing;
        throw new PhoenixError('CONFLICT', 'Target id already represents different evidence');
      }
      const prior = this.db.get(
        'SELECT * FROM targets WHERE project_id=? AND source_key=? ORDER BY rowid DESC LIMIT 1',
        t.projectId,
        key,
      );
      if (prior) {
        const previous = this.fromRow(prior);
        if (
          previous.digest !== undefined &&
          t.digest !== undefined &&
          json(previous.digest) === json(t.digest)
        )
          return previous;
        t.supersedes = previous.id;
      } else if (t.supersedes !== undefined)
        throw new PhoenixError('INVALID_REQUEST', 'Supersession requires an existing source');
      this.db.run(
        'INSERT INTO targets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        t.id,
        t.projectId,
        t.kind,
        t.classification.format,
        t.source.type,
        key,
        t.intakeMode,
        t.digest?.algorithm ?? null,
        t.digest?.value ?? null,
        t.artifactId ?? null,
        t.inventoryArtifactId ?? null,
        t.supersedes ?? null,
        json(t),
        t.createdAt,
      );
      if (t.supersedes)
        this.db.run(
          'INSERT INTO relations VALUES (?,?,?,?,?,?,?)',
          newId('rel'),
          'target',
          t.id,
          'supersedes',
          'target',
          t.supersedes,
          t.createdAt,
        );
      return t;
    });
  }
  stale(id: string, digest?: string): boolean {
    const target = this.get(id);
    return (
      !!this.db.get('SELECT 1 FROM targets WHERE supersedes_id=? LIMIT 1', id) ||
      (digest !== undefined && digest !== target.digest?.value)
    );
  }
}
