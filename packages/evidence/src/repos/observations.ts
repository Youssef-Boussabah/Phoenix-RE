import { Observation, EvidenceRef, PhoenixError } from '@phoenix/contracts';
import { type Database } from '../db/database.js';
import { Repository, jobIncludesTarget, input, encode, now } from './shared.js';
export class Observations extends Repository<Observation> {
  constructor(db: Database) {
    super(
      db,
      'observations',
      Observation,
      'id targetId:target_id jobId:job_id requestId:request_id producer:producer_json* kind type data:data_json* dataArtifactId:data_artifact_id targetDigest:target_digest createdAt:created_at',
    );
  }
  override insert(value: unknown): Observation {
    const o = input(Observation, value);
    if (o.jobId && !jobIncludesTarget(this.db, o.jobId, o.targetId))
      throw new PhoenixError('INVALID_REQUEST', 'Observation job target disagrees');
    if (o.requestId) {
      const invocation = this.db.get(
        'SELECT target_id, job_id FROM tool_invocations WHERE request_id=?',
        o.requestId,
      );
      if (
        invocation?.['target_id'] !== o.targetId ||
        (o.jobId !== undefined && invocation['job_id'] !== o.jobId)
      )
        throw new PhoenixError('INVALID_REQUEST', 'Observation invocation provenance disagrees');
    }
    return super.insert(o);
  }
}
export class EvidenceRefs extends Repository<EvidenceRef> {
  constructor(db: Database) {
    super(
      db,
      'evidence_refs',
      EvidenceRef,
      'id kind artifactId:artifact_id observationId:observation_id location locator:locator_json*',
      'id',
      false,
    );
  }
  override insert(value: unknown): EvidenceRef {
    const e = input(EvidenceRef, value);
    this.db.run(
      `INSERT INTO evidence_refs (${this.mapping.map((f) => f.column).join(',')},created_at) VALUES (?,?,?,?,?,?,?)`,
      ...encode(e, this.mapping),
      now(),
    );
    return e;
  }
}
