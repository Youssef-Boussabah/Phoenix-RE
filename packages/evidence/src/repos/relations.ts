import {
  RelationType,
  RelationId,
  IsoTimestamp,
  PhoenixError,
  ProjectId,
  TargetId,
  ArtifactId,
  JobId,
  StepId,
  RequestId,
  ObservationId,
  EvidenceRefId,
  FindingId,
} from '@phoenix/contracts';
import { type Database } from '../db/database.js';
import { stored, input, pagination } from './shared.js';
const endpoints = {
  project: ['projects', 'id', ProjectId],
  target: ['targets', 'id', TargetId],
  artifact: ['artifacts', 'id', ArtifactId],
  job: ['jobs', 'id', JobId],
  step: ['job_steps', 'id', StepId],
  invocation: ['tool_invocations', 'request_id', RequestId],
  observation: ['observations', 'id', ObservationId],
  evidence: ['evidence_refs', 'id', EvidenceRefId],
  finding: ['findings', 'id', FindingId],
} as const;
export type EntityType = keyof typeof endpoints;
export interface Relation {
  id: RelationId;
  fromType: EntityType;
  fromId: string;
  relation: RelationType;
  toType: EntityType;
  toId: string;
  createdAt: string;
}
export class Relations {
  readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  private validate(r: Relation): Relation {
    input(RelationId, r.id);
    input(RelationType, r.relation);
    input(IsoTimestamp, r.createdAt);
    for (const [type, id] of [
      [r.fromType, r.fromId],
      [r.toType, r.toId],
    ] as const) {
      if (!Object.hasOwn(endpoints, type))
        throw new PhoenixError('INVALID_REQUEST', 'Unknown relation entity type');
      const [table, key, schema] = endpoints[type];
      input<string>(schema, id);
      if (!this.db.get(`SELECT 1 FROM ${table} WHERE ${key}=?`, id))
        throw new PhoenixError('STORAGE_ERROR', 'Relation endpoint does not exist');
    }
    return r;
  }
  append(value: Relation): Relation {
    return this.db.transaction(() => {
      const r = this.validate(value);
      this.db.run(
        'INSERT INTO relations VALUES (?,?,?,?,?,?,?)',
        r.id,
        r.fromType,
        r.fromId,
        r.relation,
        r.toType,
        r.toId,
        r.createdAt,
      );
      return r;
    });
  }
  get(id: string): Relation {
    const r = this.db.get('SELECT * FROM relations WHERE id=?', id);
    if (!r) throw new PhoenixError('NOT_FOUND', 'Relation does not exist');
    return stored(() =>
      this.validate({
        id: RelationId.parse(r['id']),
        fromType: r['from_type'] as EntityType,
        fromId: String(r['from_id']),
        relation: RelationType.parse(r['relation']),
        toType: r['to_type'] as EntityType,
        toId: String(r['to_id']),
        createdAt: IsoTimestamp.parse(r['created_at']),
      }),
    );
  }
  list(page: unknown = {}): Relation[] {
    const p = pagination(page);
    return this.db
      .all('SELECT id FROM relations WHERE id>? ORDER BY id LIMIT ?', p.cursor, p.limit)
      .map((r) => this.get(String(r['id'])));
  }
}
