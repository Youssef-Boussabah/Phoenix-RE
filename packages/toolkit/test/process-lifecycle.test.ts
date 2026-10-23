import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createProcessRunner } from '../src/platform/process.js';
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
const actualProcess = process;
function childFixture(pid = 12345) {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
}
let child = childFixture(),
  killer = childFixture(12346);
beforeEach(() => {
  vi.useFakeTimers();
  child = childFixture();
  killer = childFixture(12346);
  const simulated = Object.create(actualProcess) as NodeJS.Process;
  Object.defineProperties(simulated, {
    platform: { value: 'win32' },
    env: { value: { ...actualProcess.env, SystemRoot: 'C:\\Windows' } },
  });
  vi.stubGlobal('process', simulated);
  mocks.spawn.mockReset().mockReturnValueOnce(child).mockReturnValue(killer);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const input = (signal: AbortSignal) => ({
  file: 'C:\\Tools\\node.exe',
  args: ['--version'],
  cwd: 'C:\\work',
  timeoutMs: 100,
  maxOutputBytes: 10,
  signal,
});
const runner = () =>
  createProcessRunner({ allowExecution: true, workflow: 'simulated Windows lifecycle regression' });
function exitChild() {
  child.exitCode = 0;
  child.emit('exit', 0, null);
}
function closeChild() {
  child.emit('close', 0, null);
}
it('never launches Windows taskkill on normal exit or subsequent timeout/abort/close', async () => {
  const controller = new AbortController();
  const pending = runner().runProcess(input(controller.signal));
  exitChild();
  controller.abort();
  await vi.advanceTimersByTimeAsync(200);
  closeChild();
  expect(await pending).toMatchObject({ exitCode: 0 });
  await vi.advanceTimersByTimeAsync(3000);
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  expect(child.kill).not.toHaveBeenCalled();
});
it('does not target an already-exited PID before the exit callback arrives', async () => {
  const controller = new AbortController();
  const pending = runner().runProcess(input(controller.signal));
  child.exitCode = 0;
  controller.abort();
  exitChild();
  closeChild();
  expect(await pending).toMatchObject({ exitCode: 0 });
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
});
it.each(['abort', 'timeout', 'output'] as const)(
  'initiates Windows termination once for %s while running',
  async (reason) => {
    const controller = new AbortController();
    const pending = runner().runProcess(input(controller.signal));
    const assertion = expect(pending).rejects.toMatchObject({
      code: reason === 'abort' ? 'CANCELLED' : reason === 'timeout' ? 'TIMEOUT' : 'OUTPUT_LIMIT_EXCEEDED',
    });
    if (reason === 'abort') controller.abort();
    else if (reason === 'output') child.stdout.emit('data', Buffer.alloc(11));
    else await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.spawn.mock.calls[1]?.[0]).toBe('C:\\Windows\\System32\\taskkill.exe');
    exitChild();
    killer.emit('close', 0, null);
    closeChild();
    await assertion;
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(child.kill).not.toHaveBeenCalled();
  },
);
it('normalizes synchronous invalid-executable spawn errors in simulated Windows', async () => {
  mocks.spawn.mockReset().mockImplementationOnce(() => {
    throw Object.assign(Error('sensitive argument'), { code: 'ENOEXEC' });
  });
  const pending = runner().runProcess(input(new AbortController().signal));
  await expect(pending).rejects.toMatchObject({
    name: 'PhoenixError',
    code: 'NOT_SUPPORTED',
    details: { phase: 'spawn', systemCode: 'ENOEXEC' },
  });
  try {
    await pending;
  } catch (error) {
    expect(JSON.stringify(error)).not.toContain('sensitive argument');
  }
});
for (const delivery of ['synchronous', 'asynchronous'] as const)
  it.each([
    ['E2BIG', 'INVALID_REQUEST'],
    ['ENAMETOOLONG', 'INVALID_REQUEST'],
    ['EACCES', 'PROVIDER_FAILED'],
  ] as const)(`normalizes %s to %s for ${delivery} launch failure`, async (systemCode, code) => {
    const cause = Object.assign(Error('SENSITIVE_NODE_MESSAGE'), { code: systemCode });
    mocks.spawn.mockReset();
    if (delivery === 'synchronous')
      mocks.spawn.mockImplementationOnce(() => {
        throw cause;
      });
    else mocks.spawn.mockReturnValueOnce(child);
    const pending = runner().runProcess({
      ...input(new AbortController().signal),
      args: ['SENSITIVE_ARGUMENT'],
      env: { LANG: 'SENSITIVE_ENV_VALUE' },
    });
    if (delivery === 'asynchronous') {
      child.emit('error', cause);
      child.emit('close', -1, null);
    }
    await expect(pending).rejects.toMatchObject({
      name: 'PhoenixError',
      code,
      details: { phase: 'spawn', systemCode },
    });
    try {
      await pending;
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('SENSITIVE_');
    }
  });
it('rejects Windows drive-less executable and cwd paths before spawning', async () => {
  for (const patch of [
    { file: '\\Tools\\node.exe' },
    { cwd: '\\work' },
    { file: 'C:\\tool.exe:stream' },
    { file: 'C:\\COM0.exe' },
  ])
    await expect(
      runner().runProcess({ ...input(new AbortController().signal), ...patch }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it('classifies retained Windows pipes separately from execution timeout without killing an exited PID', async () => {
  const controller = new AbortController(),
    pending = runner().runProcess(input(controller.signal));
  const assertion = expect(pending).rejects.toMatchObject({
    code: 'PROVIDER_FAILED',
    details: { phase: 'output-drain' },
  });
  exitChild();
  controller.abort();
  await vi.advanceTimersByTimeAsync(2500);
  closeChild();
  await assertion;
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  expect(child.kill).not.toHaveBeenCalled();
});
it('bounds a stalled Windows taskkill and keeps the first timeout reason', async () => {
  const pending = runner().runProcess(input(new AbortController().signal));
  const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(2100);
  expect(killer.kill).toHaveBeenCalledOnce();
  expect(child.kill).toHaveBeenCalledOnce();
  exitChild();
  closeChild();
  await assertion;
  expect(mocks.spawn).toHaveBeenCalledTimes(2);
});
