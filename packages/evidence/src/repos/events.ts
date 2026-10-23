import {
  JobEvent,
  JobMode,
  JobState,
  TerminalJobState,
  PhoenixErrorShape,
  canTransition,
  PhoenixError,
} from '@phoenix/contracts';
import { type Database } from '../db/database.js';
import { input, read, parseJson, json } from './shared.js';
type WithoutSequence<T> = T extends unknown ? Omit<T, 'seq'> : never;
export type EventDraft = WithoutSequence<JobEvent>;
export class Events {
  readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  private decode(row: Record<string, unknown>): JobEvent {
    return read(JobEvent, {
      schemaVersion: 1,
      id: row['id'],
      jobId: row['job_id'],
      seq: row['seq'],
      type: row['type'],
      payload: parseJson(row['payload_json']),
      createdAt: row['created_at'],
    });
  }
  append(value: EventDraft): JobEvent {
    const draft = input(JobEvent, { ...value, seq: 0 });
    return this.db.transaction(() => {
      const existing = this.db.get('SELECT * FROM job_events WHERE id=?', draft.id);
      if (existing) {
        const e = this.decode(existing);
        if (json({ ...e, seq: 0 }) !== json(draft))
          throw new PhoenixError('CONFLICT', 'Event replay differs from original');
        return e;
      }
      const job = this.db.get('SELECT state,mode,target_id,error_json FROM jobs WHERE id=?', draft.jobId);
      if (job) {
        const state = read(JobState, job['state']),
          mode = read(JobMode, job['mode']);
        if (
          draft.type === 'job_finished' &&
          (!TerminalJobState.safeParse(state).success ||
            draft.payload.state !== state ||
            json(draft.payload.error) !==
              json(
                job['error_json'] === null
                  ? undefined
                  : read(PhoenixErrorShape, parseJson(job['error_json'])),
              ))
        )
          throw new PhoenixError('INVALID_REQUEST', 'Finish event contradicts persisted job');
        if (
          draft.type === 'job_state_changed' &&
          (draft.payload.to !== state || !canTransition(mode, draft.payload.from, draft.payload.to))
        )
          throw new PhoenixError('INVALID_REQUEST', 'State change event contradicts persisted job');
        if (
          draft.type === 'job_created' &&
          (state !== 'created' || draft.payload.mode !== mode || draft.payload.targetId !== job['target_id'])
        )
          throw new PhoenixError('INVALID_REQUEST', 'Creation event contradicts persisted job');
      }
      const r = this.db.run(
        'INSERT INTO job_events (id,job_id,type,payload_json,created_at) VALUES (?,?,?,?,?)',
        draft.id,
        draft.jobId,
        draft.type,
        json(draft.payload),
        draft.createdAt,
      );
      return read(JobEvent, { ...draft, seq: Number(r.lastInsertRowid) });
    });
  }
  list(jobId: string, after = 0, limit = 100): JobEvent[] {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 5000
    )
      throw new PhoenixError('INVALID_REQUEST', 'Invalid event pagination');
    return this.db
      .all('SELECT * FROM job_events WHERE job_id=? AND seq>? ORDER BY seq LIMIT ?', jobId, after, limit)
      .map((r) => this.decode(r));
  }
}
