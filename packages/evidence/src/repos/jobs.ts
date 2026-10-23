import { Job, JobStep, EventId, PhoenixError, assertTransition, isTerminal } from '@phoenix/contracts';
import { type Database } from '../db/database.js';
import { Repository, encode, input, newId } from './shared.js';
import { type Events, type EventDraft } from './events.js';
import { type Steps } from './steps.js';
export class Jobs extends Repository<Job> {
  readonly events: Events;
  readonly steps: Steps;
  constructor(db: Database, events: Events, steps: Steps) {
    super(
      db,
      'jobs',
      Job,
      'id projectId:project_id targetId:target_id candidateTargetId:candidate_target_id basedOnJobId:based_on_job_id mode objective state version budget:budget_json* policy:policy_json* host:host_json* error:error_json* createdAt:created_at updatedAt:updated_at finishedAt:finished_at',
    );
    this.events = events;
    this.steps = steps;
  }
  private scope(j: Job): void {
    for (const id of [j.targetId, j.candidateTargetId])
      if (
        id !== undefined &&
        this.db.get('SELECT project_id FROM targets WHERE id=?', id)?.['project_id'] !== j.projectId
      )
        throw new PhoenixError('STORAGE_ERROR', 'Job target must belong to project');
    if (j.basedOnJobId && this.get(j.basedOnJobId).projectId !== j.projectId)
      throw new PhoenixError('INVALID_REQUEST', 'Based-on job must belong to project');
  }
  override insert(value: unknown): Job {
    return this.create(value);
  }
  create(value: unknown, events: EventDraft[] = []): Job {
    const j = input(Job, value);
    if (j.state !== 'created' || j.version !== 0)
      throw new PhoenixError('INVALID_REQUEST', 'New jobs must be created at version zero');
    return this.db.transaction(() => {
      this.scope(j);
      super.insert(j);
      const supplied = events.filter((e) => e.type === 'job_created');
      if (
        supplied.length > 1 ||
        supplied.some((e) => e.payload.mode !== j.mode || e.payload.targetId !== j.targetId)
      )
        throw new PhoenixError('INVALID_REQUEST', 'Job creation event contradicts job');
      this.appendFor(
        j,
        supplied.length
          ? events
          : [
              {
                schemaVersion: 1,
                id: EventId.parse(newId('evt')),
                jobId: j.id,
                type: 'job_created',
                payload: { mode: j.mode, targetId: j.targetId },
                createdAt: j.createdAt,
              },
              ...events,
            ],
      );
      return j;
    });
  }
  private appendFor(j: Job, events: EventDraft[]): void {
    for (const e of events) {
      if (e.jobId !== j.id) throw new PhoenixError('INVALID_REQUEST', 'Event belongs to another job');
      this.events.append(e);
    }
  }
  save(
    value: unknown,
    expectedVersion: number,
    events: EventDraft[] = [],
    steps: { record: unknown; expectedAttempt?: number }[] = [],
  ): Job {
    const j = input(Job, value);
    return this.db.transaction(() => {
      const old = this.get(j.id);
      if (old.version !== expectedVersion || j.version !== old.version + 1)
        throw new PhoenixError('CONFLICT', 'Job version has changed');
      if (isTerminal(old.state))
        throw new PhoenixError('INVALID_STATE_TRANSITION', 'Terminal jobs are immutable');
      if (old.state !== j.state) assertTransition(old.mode, old.state, j.state);
      for (const key of [
        'projectId',
        'targetId',
        'candidateTargetId',
        'basedOnJobId',
        'mode',
        'objective',
        'createdAt',
      ] as const)
        if (old[key] !== j[key]) throw new PhoenixError('INVALID_REQUEST', 'Immutable job identity changed');
      this.scope(j);
      this.db.run(
        `UPDATE jobs SET ${this.mapping.map((f) => `${f.column}=?`).join(',')} WHERE id=? AND version=?`,
        ...encode(j, this.mapping),
        j.id,
        expectedVersion,
      );
      for (const s of steps) {
        const step = input(JobStep, s.record);
        if (step.jobId !== j.id) throw new PhoenixError('INVALID_REQUEST', 'Step belongs to another job');
        if (s.expectedAttempt === undefined) this.steps.insert(step);
        else this.steps.save(step, s.expectedAttempt);
      }
      const transitionEvents = events.filter((e) => e.type === 'job_state_changed');
      if (
        transitionEvents.some((e) => e.payload.from !== old.state || e.payload.to !== j.state) ||
        (old.state === j.state && transitionEvents.length > 0) ||
        transitionEvents.length > 1
      )
        throw new PhoenixError('INVALID_REQUEST', 'State change event contradicts job');
      const append = [...events];
      if (old.state !== j.state && transitionEvents.length === 0)
        append.push({
          schemaVersion: 1,
          id: EventId.parse(newId('evt')),
          jobId: j.id,
          type: 'job_state_changed',
          payload: { from: old.state, to: j.state },
          createdAt: j.updatedAt,
        });
      if (isTerminal(j.state)) {
        const finished = events.filter((e) => e.type === 'job_finished');
        if (
          finished.length > 1 ||
          finished.some(
            (e) => e.payload.state !== j.state || JSON.stringify(e.payload.error) !== JSON.stringify(j.error),
          )
        )
          throw new PhoenixError('INVALID_REQUEST', 'Finish event contradicts job');
        if (finished.length === 0)
          append.push({
            schemaVersion: 1,
            id: EventId.parse(newId('evt')),
            jobId: j.id,
            type: 'job_finished',
            payload: {
              state: j.state as 'completed' | 'partial' | 'failed' | 'cancelled',
              ...(j.error === undefined ? {} : { error: j.error }),
            },
            createdAt: j.updatedAt,
          });
      } else if (events.some((e) => e.type === 'job_finished'))
        throw new PhoenixError('INVALID_REQUEST', 'Active job cannot have a finish event');
      if (events.some((e) => e.type === 'job_created'))
        throw new PhoenixError('INVALID_REQUEST', 'Job already exists');
      this.appendFor(j, append);
      return j;
    });
  }
}
