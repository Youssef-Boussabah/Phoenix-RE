import { it, expect } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEvidenceStore } from '@phoenix/evidence';
import { fixture, cleanup, event } from './helpers.js';
function child(directory: string, mode: string, jobId: string) {
  const process = fork(
    fileURLToPath(new URL('../../../tests/support/evidence-child.ts', import.meta.url)),
    [directory, mode, jobId],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] },
  );
  let stderr = '';
  process.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const completion = new Promise<void>((resolve, reject) => {
    process.once('error', reject);
    process.once('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGKILL') resolve();
      else reject(new Error(`Test child failed ${String(code)} ${stderr}`));
    });
  });
  const message = new Promise<unknown>((resolve, reject) => {
    process.once('message', resolve);
    process.once('error', reject);
    process.once('exit', () => {
      reject(new Error('Child exited before message: ' + stderr));
    });
  });
  return { process, completion, message };
}
async function stop(p: ChildProcess, done: Promise<void>): Promise<void> {
  if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
  await done;
}
it('concurrent writers in two actual processes serialize events and deduplicate CAS', async () => {
  const f = await fixture();
  const c = child(f.directory, 'write', f.j.id);
  try {
    expect(await c.message).toBe('ready');
    c.process.send('start');
    for (let i = 0; i < 40; i++) {
      f.store.repos.events.append(
        event(f.j, { type: 'job_started', payload: { runner: `parent-${String(i)}` } }),
      );
      await f.store.artifacts.putBytes(Buffer.from('cross-process CAS'), 'text/plain');
    }
    await c.completion;
    const events = f.store.repos.events.list(f.j.id);
    expect(events).toHaveLength(81);
    expect(new Set(events.map((e) => e.seq)).size).toBe(81);
    expect(events.map((e) => e.seq)).toEqual(events.map((e) => e.seq).sort((a, b) => a - b));
    expect(f.store.repos.artifacts.list()).toHaveLength(1);
  } finally {
    await stop(c.process, c.completion);
    await cleanup(f.directory, f.store);
  }
}, 20000);
it('busy timeout waits for a separate process transaction and then succeeds', async () => {
  const f = await fixture();
  const c = child(f.directory, 'hold', f.j.id);
  try {
    expect(await c.message).toBe('locked');
    f.store.repos.events.append(event(f.j));
    await c.completion;
    expect(f.store.repos.events.list(f.j.id)).toHaveLength(2);
  } finally {
    await stop(c.process, c.completion);
    await cleanup(f.directory, f.store);
  }
}, 15000);
it('normalizes a real exhausted busy timeout from a separate process', async () => {
  const f = await fixture();
  f.store.db.exec('BEGIN IMMEDIATE');
  const c = child(f.directory, 'blocked', f.j.id);
  try {
    expect(await c.message).toEqual({ code: 'STORAGE_ERROR', retryable: true });
    await c.completion;
  } finally {
    f.store.db.exec('ROLLBACK');
    await stop(c.process, c.completion);
    await cleanup(f.directory, f.store);
  }
}, 15000);
it('recovers a file-backed WAL database after killing a process during an uncommitted write', async () => {
  const f = await fixture();
  f.store.repos.events.append(event(f.j));
  const initial = f.store.repos.events.list(f.j.id);
  const c = child(f.directory, 'crash', f.j.id);
  let reopened;
  try {
    expect(await c.message).toBe('locked');
    c.process.kill('SIGKILL');
    await c.completion;
    await f.store.close();
    reopened = await createEvidenceStore({ dataDir: f.directory });
    expect(reopened.repos.events.list(f.j.id)).toEqual(initial);
    expect(reopened.db.get('PRAGMA integrity_check')?.['integrity_check']).toBe('ok');
    reopened.repos.events.append(event(f.j));
    expect(reopened.repos.events.list(f.j.id)).toHaveLength(3);
  } finally {
    await stop(c.process, c.completion);
    await cleanup(f.directory, f.store, ...(reopened ? [reopened] : []));
  }
}, 15000);
