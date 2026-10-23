import { JobStep, PhoenixError } from '@phoenix/contracts';
import { type Database } from '../db/database.js';
import { Repository, input, encode } from './shared.js';
export class Steps extends Repository<JobStep> {
  constructor(db: Database) {
    super(
      db,
      'job_steps',
      JobStep,
      'id jobId:job_id stepKey:step_key status attempt maxAttempts:max_attempts leaseOwner:lease_owner leaseExpiresAt:lease_expires_at output:output_json* error:error_json* createdAt:created_at startedAt:started_at finishedAt:finished_at',
    );
  }
  save(value: unknown, expectedAttempt: number): JobStep {
    const s = input(JobStep, value);
    return this.db.transaction(() => {
      const old = this.get(s.id);
      if (old.attempt !== expectedAttempt) throw new PhoenixError('CONFLICT', 'Step attempt has changed');
      if (
        s.jobId !== old.jobId ||
        s.stepKey !== old.stepKey ||
        s.createdAt !== old.createdAt ||
        s.maxAttempts !== old.maxAttempts ||
        s.attempt < old.attempt ||
        s.attempt > old.attempt + 1 ||
        s.attempt > s.maxAttempts
      )
        throw new PhoenixError('INVALID_REQUEST', 'Invalid step update');
      this.db.run(
        `UPDATE job_steps SET ${this.mapping.map((f) => `${f.column}=?`).join(',')} WHERE id=? AND attempt=?`,
        ...encode(s, this.mapping),
        s.id,
        expectedAttempt,
      );
      return s;
    });
  }
  override insert(value: unknown): JobStep {
    const s = input(JobStep, value);
    if (s.attempt > s.maxAttempts) throw new PhoenixError('INVALID_REQUEST', 'Step attempt exceeds maximum');
    return super.insert(s);
  }
}
