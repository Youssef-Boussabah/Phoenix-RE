import { expect, it } from 'vitest';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ProcessRequest } from '@phoenix/contracts';
import { createProcessRunner, processEnvironment } from '../src/index.js';
import { tempDir } from './support.js';
const runner = createProcessRunner({ allowExecution: true, workflow: 'WP2 real test processes' });
function request(code: string, overrides: Partial<ProcessRequest> = {}): ProcessRequest {
  return {
    file: process.execPath,
    args: ['-e', code],
    cwd: process.cwd(),
    timeoutMs: 5000,
    maxOutputBytes: 8192,
    signal: new AbortController().signal,
    ...overrides,
  };
}
it('captures actual stdout/stderr, exit codes, cwd and argument boundaries', async () => {
  const root = await tempDir();
  const args = ['spaces here', '$(touch injected)', '; echo unsafe', '"quotes"', 'é'];
  const result = await runner.runProcess(
    request(
      'process.stdout.write(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd()}));process.stderr.write("err");process.exitCode=7',
      {
        cwd: root,
        args: [
          '-e',
          'process.stdout.write(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd()}));process.stderr.write("err");process.exitCode=7',
          ...args,
        ],
      },
    ),
  );
  expect(JSON.parse(Buffer.from(result.stdout).toString())).toEqual({ args, cwd: await realpath(root) });
  expect(Buffer.from(result.stderr).toString()).toBe('err');
  expect(result.exitCode).toBe(7);
  expect(result.signal).toBeNull();
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
});
it('requires explicit workflow authorization and validates execution limits', async () => {
  await expect(
    createProcessRunner({ allowExecution: false, workflow: 'inspection' }).runProcess(request('')),
  ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  await expect(
    createProcessRunner({ allowExecution: true, workflow: '' }).runProcess(request('')),
  ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  const policy = { allowExecution: false, workflow: 'test' },
    bound = createProcessRunner(policy);
  policy.allowExecution = true;
  await expect(bound.runProcess(request(''))).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  for (const overrides of [
    { file: 'relative' },
    { cwd: 'relative' },
    { file: process.execPath + '\0' },
    { args: ['\0'] },
    { timeoutMs: 0 },
    { timeoutMs: 0.5 },
    { maxOutputBytes: -1 },
    { maxOutputBytes: 64 * 1024 * 1024 + 1 },
  ])
    await expect(runner.runProcess(request('', overrides))).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  await expect(runner.runProcess(request('', { file: path.resolve('script.cmd') }))).rejects.toMatchObject({
    code: 'NOT_SUPPORTED',
  });
  await expect(
    runner.runProcess(request('', { file: path.resolve('does-not-exist') })),
  ).rejects.toMatchObject({ code: 'PROVIDER_FAILED' });
});
it('does not inherit secrets, NODE_OPTIONS or unapproved environment overrides', async () => {
  const testRunner = createProcessRunner(
    { allowExecution: true, workflow: 'env test' },
    { ...process.env, PHOENIX_SECRET: 'do not expose', NODE_OPTIONS: '--bad-option' },
  );
  const result = await testRunner.runProcess(
    request('process.stdout.write(JSON.stringify(process.env))', {
      env: { LANG: 'C' },
    }),
  );
  const env = JSON.parse(Buffer.from(result.stdout).toString()) as Record<string, string>;
  expect(env['PHOENIX_SECRET']).toBeUndefined();
  expect(env['NODE_OPTIONS']).toBeUndefined();
  expect(env['LANG']).toBe('C');
  if (process.platform === 'win32') expect(env['SystemRoot']).toBeDefined();
  expect(
    processEnvironment(
      { Path: 'one', SystemRoot: 'C:\\Windows' },
      { PATH: 'two', SystemRoot: 'C:\\Windows' },
      true,
    ),
  ).toEqual({ PATH: 'two', SystemRoot: 'C:\\Windows' });
  expect(() => processEnvironment({ PATH: 'a\0b' })).toThrow();
});
it('kills a real timed-out process and honors AbortSignal before/during execution', async () => {
  await expect(
    runner.runProcess(request('setInterval(()=>{},1000)', { timeoutMs: 100 })),
  ).rejects.toMatchObject({ code: 'TIMEOUT' });
  const before = new AbortController();
  before.abort();
  await expect(runner.runProcess(request('', { signal: before.signal }))).rejects.toMatchObject({
    code: 'CANCELLED',
  });
  const during = new AbortController();
  const pending = runner.runProcess(request('setInterval(()=>{},1000)', { signal: during.signal }));
  const assertion = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  await delay(100);
  during.abort();
  await assertion;
});
it('enforces one combined byte cap for both output streams, including zero and UTF-8', async () => {
  const exact = await runner.runProcess(
    request('process.stdout.write("é");process.stderr.write("ab")', { maxOutputBytes: 4 }),
  );
  expect(exact.stdout.byteLength + exact.stderr.byteLength).toBe(4);
  for (const code of [
    'process.stdout.write("x".repeat(100000));setInterval(()=>{},1000)',
    'process.stderr.write("x".repeat(100000));setInterval(()=>{},1000)',
  ])
    await expect(runner.runProcess(request(code, { maxOutputBytes: 10 }))).rejects.toMatchObject({
      code: 'OUTPUT_LIMIT_EXCEEDED',
    });
  await expect(
    runner.runProcess(request('process.stdout.write("x")', { maxOutputBytes: 0 })),
  ).rejects.toMatchObject({ code: 'OUTPUT_LIMIT_EXCEEDED' });
  expect((await runner.runProcess(request('', { maxOutputBytes: 0 }))).exitCode).toBe(0);
});
it.skipIf(process.platform === 'win32')('reports an actual POSIX termination signal', async () => {
  const result = await runner.runProcess(request('process.kill(process.pid,"SIGTERM")'));
  expect(result.exitCode).toBeNull();
  expect(result.signal).toBe('SIGTERM');
});
for (const mode of ['abort', 'timeout', 'parent-exit'] as const)
  it(`cleans real descendants on ${mode}`, async (context) => {
    if (mode === 'parent-exit' && process.platform === 'win32')
      context.skip(
        'Win32 taskkill cannot track descendants after the parent exits; requires future Job Objects',
      );
    const root = await tempDir(),
      marker = path.join(root, 'child-pid'),
      heartbeat = path.join(root, 'heartbeat');
    const controller = new AbortController();
    const childCode = `const fs=require('node:fs'); fs.writeFileSync(${JSON.stringify(marker)},String(process.pid)); setInterval(()=>fs.writeFileSync(${JSON.stringify(heartbeat)},String(Date.now())),20);`;
    const parentCode = `const {spawn}=require('node:child_process');const fs=require('node:fs');spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'inherit'});${mode === 'parent-exit' ? `const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(marker)})){clearInterval(t);process.exit(0);}},10);` : 'setInterval(()=>{},1000);'}`;
    const pending = runner.runProcess(
      request(parentCode, { signal: controller.signal, timeoutMs: mode === 'timeout' ? 1000 : 5000 }),
    );
    const settled = pending.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    let pid: number | undefined;
    try {
      for (let i = 0; i < 150; i++) {
        try {
          pid = Number(await readFile(marker, 'utf8'));
          break;
        } catch {
          await delay(20);
        }
      }
      expect(pid, 'descendant actually started').toBeGreaterThan(0);
      if (mode === 'abort') controller.abort();
      const outcome = await settled;
      if (mode === 'parent-exit') expect(outcome).toMatchObject({ value: { exitCode: 0 } });
      else expect(outcome).toMatchObject({ error: { code: mode === 'abort' ? 'CANCELLED' : 'TIMEOUT' } });
      let dead = false;
      for (let i = 0; i < 100; i++) {
        try {
          process.kill(pid ?? 0, 0);
          if (process.platform === 'linux') {
            const stat = await readFile(`/proc/${String(pid)}/stat`, 'utf8');
            if (stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z')) {
              dead = true;
              break;
            }
          }
        } catch {
          dead = true;
          break;
        }
        await delay(20);
      }
      expect(dead, 'descendant terminated (Linux zombie is already exited)').toBe(true);
      const before = await readFile(heartbeat, 'utf8').catch(() => 'not written');
      await delay(100);
      expect(await readFile(heartbeat, 'utf8').catch(() => 'not written')).toBe(before);
    } finally {
      controller.abort();
      await settled;
      if (pid !== undefined)
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already exited */
        }
    }
  }, 10000);
it('preserves explicitly provided cwd paths containing spaces', async () => {
  const root = await tempDir();
  await writeFile(path.join(root, 'safe'), 'ok');
  const result = await runner.runProcess(
    request('process.stdout.write(require("node:fs").readFileSync("safe"))', { cwd: root }),
  );
  expect(Buffer.from(result.stdout).toString()).toBe('ok');
});
it.skipIf(process.platform === 'win32')(
  'bounds retained pipes from an escaped session without claiming sandbox containment',
  async () => {
    const root = await tempDir(),
      marker = path.join(root, 'escaped-pid');
    const childCode = `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`;
    const code = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{detached:true,stdio:'inherit'});const t=setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(marker)})){clearInterval(t);process.exit(0);}},10);`;
    try {
      await expect(runner.runProcess(request(code))).rejects.toMatchObject({
        code: 'PROVIDER_FAILED',
        details: { phase: 'output-drain' },
      });
    } finally {
      const pid = Number(await readFile(marker, 'utf8'));
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already exited */
      }
    }
  },
  10000,
);
it('normalizes real oversized-argument spawn failures without exposing arguments', async () => {
  const pending = runner.runProcess(
    request('', { args: ['-e', '', 'SENSITIVE_ARG_' + 'x'.repeat(4 * 1024 * 1024)] }),
  );
  await expect(pending).rejects.toMatchObject({
    name: 'PhoenixError',
    code: 'INVALID_REQUEST',
    details: { phase: 'spawn', systemCode: 'E2BIG' },
  });
  try {
    await pending;
  } catch (error) {
    expect(JSON.stringify(error)).not.toContain('SENSITIVE_ARG_');
  }
});
it('rejects unsupported environment overrides explicitly', async () => {
  for (const key of ['NODE_OPTIONS', 'PYTHONSTARTUP', 'PHOENIX_SECRET', 'LD_PRELOAD'])
    await expect(runner.runProcess(request('', { env: { [key]: 'sensitive value' } }))).rejects.toMatchObject(
      { code: 'INVALID_REQUEST' },
    );
  expect(() =>
    processEnvironment({ SystemRoot: 'C:\\Windows' }, { systemroot: 'D:\\Other' }, true),
  ).toThrow();
});
it.each([
  'script.cmd.',
  'script.bat ',
  'script.CmD. . ',
  'script.cmd:stream',
  'script.bat::$DATA',
  'script.cmd :stream',
])('refuses Win32 batch alias %s before spawning', async (name) => {
  await expect(runner.runProcess(request('', { file: path.resolve(name) }))).rejects.toMatchObject({
    code: 'NOT_SUPPORTED',
  });
});
