import { it, expect } from 'vitest';
import { fixture, cleanup, job, event } from './helpers.js';
it.each(['finish', 'transition'])('rejects a contradictory %s event in new-job creation', async (type) => {
  const f = await fixture();
  try {
    const j = job(f.t),
      contradiction =
        type === 'finish'
          ? event(j, { type: 'job_finished', payload: { state: 'failed' } })
          : event(j, { type: 'job_state_changed', payload: { from: 'ready', to: 'planning' } });
    expect(() => f.store.repos.jobs.create(j, [contradiction])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    expect(() => f.store.repos.jobs.get(j.id)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(f.store.repos.events.list(j.id)).toEqual([]);
  } finally {
    await cleanup(f.directory, f.store);
  }
});
it('rejects direct finish and state-change events for a stored created job', async () => {
  const f = await fixture();
  try {
    for (const e of [
      event(f.j, { type: 'job_finished', payload: { state: 'failed' } }),
      event(f.j, { type: 'job_state_changed', payload: { from: 'ready', to: 'planning' } }),
      event(f.j, { type: 'job_state_changed', payload: { from: 'created', to: 'created' } }),
    ])
      expect(() => f.store.repos.events.append(e)).toThrow(
        expect.objectContaining({ code: 'INVALID_REQUEST' }),
      );
    expect(f.store.repos.events.list(f.j.id)).toHaveLength(1);
    f.store.repos.jobs.save({ ...f.j, state: 'failed', version: 1, finishedAt: f.j.createdAt }, 0);
    const finish = f.store.repos.events.list(f.j.id).find((e) => e.type === 'job_finished');
    if (!finish) throw new Error();
    const { seq, ...draft } = finish;
    expect(seq).toBeGreaterThan(0);
    expect(f.store.repos.events.append(draft)).toEqual(finish);
  } finally {
    await cleanup(f.directory, f.store);
  }
});
