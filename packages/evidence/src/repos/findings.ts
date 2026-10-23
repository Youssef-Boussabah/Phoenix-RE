import {
  Finding,
  type TargetManifest,
  type Observation,
  type EvidenceRef,
  PhoenixError,
  JobId,
} from '@phoenix/contracts';
import { type Database } from '../db/database.js';
import { stored, jobIncludesTarget, input, json, parseJson, pagination } from './shared.js';
import { type ArtifactStore } from '../cas/artifact-store.js';
import { type Observations } from './observations.js';
import { type Targets } from './targets.js';
import { type EvidenceRefs } from './observations.js';
export class Findings {
  readonly db: Database;
  readonly refs: EvidenceRefs;
  readonly artifacts: ArtifactStore;
  readonly targets: Targets;
  readonly observations: Observations;
  constructor(
    db: Database,
    refs: EvidenceRefs,
    artifacts: ArtifactStore,
    targets: Targets,
    observations: Observations,
  ) {
    this.db = db;
    this.refs = refs;
    this.artifacts = artifacts;
    this.targets = targets;
    this.observations = observations;
  }
  private validateEvidence(target: TargetManifest, e: EvidenceRef): void {
    const own = e.artifactId === target.artifactId || e.artifactId === target.inventoryArtifactId;
    if (e.observationId !== undefined) {
      const observation: Observation = stored(() => this.observations.get(e.observationId ?? ''));
      if (observation.targetId !== target.id || (!own && observation.dataArtifactId !== e.artifactId))
        throw new PhoenixError(
          'INVALID_REQUEST',
          'Finding evidence observation does not establish artifact provenance',
        );
    } else if (
      !own &&
      !this.db.get(
        'SELECT 1 FROM observations WHERE target_id=? AND data_artifact_id=? LIMIT 1',
        target.id,
        e.artifactId,
      )
    )
      throw new PhoenixError('INVALID_REQUEST', 'Finding evidence has no artifact provenance for its target');
    this.artifacts.verifyRegistered(e.artifactId);
  }
  append(value: unknown, options: { jobId?: JobId; reason?: string } = {}): Finding {
    const f = input(Finding, value);
    if (
      new Set(f.evidence.map((e) => e.id)).size !== f.evidence.length ||
      (options.reason !== undefined && (typeof options.reason !== 'string' || options.reason.length > 4000))
    )
      throw new PhoenixError('INVALID_REQUEST', 'Invalid finding revision metadata');
    if (options.jobId) input(JobId, options.jobId);
    return this.db.transaction(() => {
      const old = this.db.get('SELECT * FROM findings WHERE id=?', f.id);
      if (old) {
        if (
          old['current_revision'] !== f.revision - 1 ||
          old['target_id'] !== f.targetId ||
          (options.jobId !== undefined && old['job_id'] !== options.jobId)
        )
          throw new PhoenixError('CONFLICT', 'Finding revision or provenance has changed');
        this.db.run('UPDATE findings SET current_revision=? WHERE id=?', f.revision, f.id);
      } else {
        if (f.revision !== 1) throw new PhoenixError('CONFLICT', 'First finding revision must be one');
        if (options.jobId && !jobIncludesTarget(this.db, options.jobId, f.targetId))
          throw new PhoenixError('INVALID_REQUEST', 'Finding job target disagrees');
        this.db.run(
          'INSERT INTO findings VALUES (?,?,?,?,?)',
          f.id,
          f.targetId,
          options.jobId ?? null,
          1,
          f.createdAt,
        );
      }
      this.db.run(
        'INSERT INTO finding_revisions VALUES (?,?,?,?,?,?,?,?)',
        f.id,
        f.revision,
        f.statement,
        f.status,
        json(f.limitations),
        json(f.author),
        options.reason ?? null,
        f.createdAt,
      );
      const target = this.targets.get(f.targetId);
      for (const e of f.evidence) {
        const existing = this.db.get('SELECT id FROM evidence_refs WHERE id=?', e.id);
        if (existing) {
          if (json(this.refs.get(e.id)) !== json(e))
            throw new PhoenixError('CONFLICT', 'Evidence reference is immutable');
        } else this.refs.insert(e);
        this.validateEvidence(target, e);
        this.db.run('INSERT INTO finding_evidence VALUES (?,?,?)', f.id, f.revision, e.id);
      }
      return f;
    });
  }
  get(id: string, revision?: number): Finding {
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1))
      throw new PhoenixError('INVALID_REQUEST', 'Invalid finding revision');
    const row = this.db.get(
      `SELECT f.target_id,r.* FROM findings f JOIN finding_revisions r ON r.finding_id=f.id AND r.revision=${revision === undefined ? 'f.current_revision' : '?'} WHERE f.id=?`,
      ...(revision === undefined ? [id] : [revision, id]),
    );
    if (!row) {
      if (revision === undefined && this.db.get('SELECT id FROM findings WHERE id=?', id))
        throw new PhoenixError('STORAGE_ERROR', 'Current finding revision is missing');
      throw new PhoenixError('NOT_FOUND', 'Finding revision does not exist');
    }
    return stored(() =>
      Finding.parse({
        schemaVersion: 1,
        id: row['finding_id'],
        targetId: row['target_id'],
        statement: row['statement'],
        status: row['status'],
        revision: row['revision'],
        limitations: parseJson(row['limitations_json']),
        author: parseJson(row['author_json']),
        createdAt: row['created_at'],
        evidence: this.db
          .all(
            'SELECT evidence_ref_id FROM finding_evidence WHERE finding_id=? AND revision=? ORDER BY evidence_ref_id',
            id,
            Number(row['revision']),
          )
          .map((r) => this.refs.get(String(r['evidence_ref_id']))),
      }),
    );
  }
  history(id: string, after = 0, limit = 100): Finding[] {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 5000
    )
      throw new PhoenixError('INVALID_REQUEST', 'Invalid history pagination');
    return this.db
      .all(
        'SELECT revision FROM finding_revisions WHERE finding_id=? AND revision>? ORDER BY revision LIMIT ?',
        id,
        after,
        limit,
      )
      .map((r) => this.get(id, Number(r['revision'])));
  }
  list(page: unknown = {}): Finding[] {
    const p = pagination(page);
    return this.db
      .all('SELECT id FROM findings WHERE id>? ORDER BY id LIMIT ?', p.cursor, p.limit)
      .map((r) => this.get(String(r['id'])));
  }
}
