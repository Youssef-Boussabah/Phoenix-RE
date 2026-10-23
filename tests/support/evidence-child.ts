// Test-only source resolver: child processes exercise clean-checkout sources, never dist.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@phoenix/contracts')
      return nextResolve(new URL('../../packages/contracts/src/index.ts', import.meta.url).href, context);
    if (specifier === '@phoenix/evidence')
      return nextResolve(new URL('../../packages/evidence/src/index.ts', import.meta.url).href, context);
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.includes('/packages/')) {
      const source = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(source))) return nextResolve(source.href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { createEvidenceStore } = await import('@phoenix/evidence');
const { JobEvent } = await import('@phoenix/contracts');
const { randomUUID } = await import('node:crypto');
const [directory, mode, jobId] = process.argv.slice(2);
if (!directory || !mode || !jobId) throw new Error('Missing test arguments');
const store = await createEvidenceStore({ dataDir: directory });
if (mode === 'crash') {
  store.db.exec('BEGIN IMMEDIATE');
  store.db.run(
    'INSERT INTO job_events (id,job_id,type,payload_json,created_at) VALUES (?,?,?,?,?)',
    `evt_${randomUUID().replaceAll('-', '')}`,
    jobId,
    'job_started',
    JSON.stringify({ runner: 'interrupted' }),
    new Date().toISOString(),
  );
  process.send?.('locked');
  setInterval(() => undefined, 1000);
} else if (mode === 'hold') {
  store.db.exec('BEGIN IMMEDIATE');
  process.send?.('locked');
  setTimeout(() => {
    store.db.exec('COMMIT');
    void store.close().then(() => {
      process.disconnect();
    });
  }, 250);
} else if (mode === 'blocked') {
  try {
    store.db.run(
      'INSERT INTO projects VALUES (?, ?, ?)',
      `prj_${randomUUID().replaceAll('-', '')}`,
      'blocked',
      new Date().toISOString(),
    );
    process.send?.('unexpected-success');
  } catch (error) {
    process.send?.(
      error instanceof Error && 'retryable' in error
        ? { code: 'STORAGE_ERROR', retryable: error.retryable }
        : {},
    );
  }
  await store.close();
  process.disconnect();
} else {
  process.send?.('ready');
  process.once('message', () => {
    void (async () => {
      for (let i = 0; i < 40; i++) {
        const { seq, ...event } = JobEvent.parse({
          schemaVersion: 1,
          id: `evt_${randomUUID().replaceAll('-', '')}`,
          jobId,
          seq: 0,
          type: 'job_started',
          payload: { runner: `child-${String(i)}` },
          createdAt: new Date().toISOString(),
        });
        if (seq !== 0) throw new Error('Unexpected sequence');
        store.repos.events.append(event);
        await store.artifacts.putBytes(Buffer.from('cross-process CAS'), 'text/plain');
      }
      await store.close();
      process.disconnect();
    })().catch((error: unknown) => {
      process.stderr.write(String(error));
      process.exitCode = 1;
      process.disconnect();
    });
  });
}
