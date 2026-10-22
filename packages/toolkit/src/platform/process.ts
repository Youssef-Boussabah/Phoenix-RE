import { spawn } from 'node:child_process';
import type { ChildProcess, ChildProcessByStdio } from 'node:child_process';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { PhoenixError } from '@phoenix/contracts';
import type { ProcessRequest, ProcessResult, ProcessRunner } from '@phoenix/contracts';
import { isFullyQualifiedPath, validateWindowsPath } from './paths.js';
import { checkAbort, safeInteger } from '../internal.js';

export const PROCESS_ENV_ALLOWLIST = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'LOCALAPPDATA',
  'LANG',
  'LC_ALL',
  'JAVA_HOME',
] as const;
export interface ExecutionAuthorization {
  allowExecution: boolean;
  workflow: string;
}
export interface BoundedProcessResult extends ProcessResult {
  signal: NodeJS.Signals | null;
}
export interface BoundedProcessRunner extends ProcessRunner {
  runProcess(input: ProcessRequest): Promise<BoundedProcessResult>;
}
export function processEnvironment(
  base: Readonly<NodeJS.ProcessEnv>,
  overrides: Readonly<Record<string, string>> = {},
  windows = process.platform === 'win32',
): Record<string, string> {
  const output: Record<string, string> = {};
  const allowedName = (key: string): string | undefined =>
    PROCESS_ENV_ALLOWLIST.find((name) => (windows ? name.toLowerCase() === key.toLowerCase() : name === key));
  for (const [key, value] of Object.entries(overrides)) {
    const allowed = allowedName(key);
    if (allowed === undefined)
      throw new PhoenixError('INVALID_REQUEST', 'Unsupported process environment override');
    if (windows && allowed === 'SystemRoot') {
      const hostRoot = Object.entries(base).find(([name]) => name.toLowerCase() === 'systemroot')?.[1];
      if (hostRoot !== undefined && hostRoot !== value)
        throw new PhoenixError('INVALID_REQUEST', 'SystemRoot override must match the host');
    }
  }
  for (const source of [base, overrides])
    for (const [key, value] of Object.entries(source)) {
      const allowed = allowedName(key);
      if (allowed !== undefined && value !== undefined) {
        if (value.includes('\0')) throw new PhoenixError('INVALID_REQUEST', 'Invalid process environment');
        output[allowed] = value;
      }
    }
  return output;
}
function running(child: ChildProcess): boolean {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}
function killParent(child: ChildProcess): void {
  if (running(child)) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* Cleanup remains best effort. */
    }
  }
}
function spawnFailure(cause: unknown): PhoenixError {
  const code = (cause as NodeJS.ErrnoException | null)?.code;
  const systemCode = typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code : 'UNKNOWN';
  return new PhoenixError(
    systemCode === 'E2BIG' || systemCode === 'EINVAL'
      ? 'INVALID_REQUEST'
      : systemCode === 'ENOEXEC'
        ? 'NOT_SUPPORTED'
        : 'PROVIDER_FAILED',
    'Could not start process',
    { cause, details: { phase: 'spawn', systemCode } },
  );
}
function batchFile(file: string): boolean {
  // Win32 strips trailing dots/spaces and interprets streams after ':' on the basename.
  const base = path.win32.basename(file).split(':')[0] ?? '';
  return /\.(?:bat|cmd)$/i.test(base.replace(/[. ]+$/, ''));
}
/** POSIX groups include descendants retaining stdio. Windows taskkill is best effort, not a job object. */
async function terminateTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return;
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  } else {
    // Never launch a PID-based killer once Node has observed this child exit.
    if (!running(child)) return;
    const systemRoot = process.env['SystemRoot'];
    if (systemRoot === undefined) {
      killParent(child);
      return;
    }
    await new Promise<void>((resolve) => {
      const killer = spawn(
        path.win32.join(systemRoot, 'System32', 'taskkill.exe'),
        ['/T', '/F', '/PID', String(child.pid)],
        { shell: false, windowsHide: true, stdio: 'ignore', env: processEnvironment(process.env) },
      );
      const timer = setTimeout(() => {
        killer.kill();
        killParent(child);
        resolve();
      }, 2000);
      killer.once('error', () => {
        clearTimeout(timer);
        killParent(child);
        resolve();
      });
      killer.once('close', () => {
        clearTimeout(timer);
        killParent(child);
        resolve();
      });
    });
  }
}
export function createProcessRunner(
  authorization: ExecutionAuthorization,
  baseEnv: Readonly<NodeJS.ProcessEnv> = process.env,
): BoundedProcessRunner {
  // Copy authorization once; mutating a job policy later cannot silently enable an existing runner.
  const authorized = authorization.allowExecution && authorization.workflow.trim().length > 0;
  return {
    async runProcess(input: ProcessRequest): Promise<BoundedProcessResult> {
      if (!authorized)
        throw new PhoenixError('POLICY_DENIED', 'Process execution requires explicit workflow authorization');
      checkAbort(input.signal);
      safeInteger(input.timeoutMs, 'process timeout', 1, 3_600_000);
      safeInteger(input.maxOutputBytes, 'process output limit', 0, 64 * 1024 * 1024);
      if (
        !isFullyQualifiedPath(input.file) ||
        input.file.includes('\0') ||
        !isFullyQualifiedPath(input.cwd) ||
        input.cwd.includes('\0') ||
        input.args.some((arg) => arg.includes('\0'))
      )
        throw new PhoenixError(
          'INVALID_REQUEST',
          'Process requires absolute executable and working directory with valid arguments',
        );
      if (batchFile(input.file))
        throw new PhoenixError('NOT_SUPPORTED', 'Batch scripts require a dedicated hardened launcher');
      if (process.platform === 'win32') {
        for (const value of [input.file, input.cwd]) {
          const relative = value.slice(path.win32.parse(value).root.length).replaceAll('\\', '/');
          if (relative) validateWindowsPath(relative);
        }
      }
      const env = processEnvironment(baseEnv, input.env);
      const started = performance.now();
      let child: ChildProcessByStdio<null, Readable, Readable>;
      try {
        child = spawn(input.file, [...input.args], {
          cwd: input.cwd,
          env,
          shell: false,
          windowsHide: true,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (cause) {
        throw spawnFailure(cause);
      }
      return new Promise<BoundedProcessResult>((resolve, reject) => {
        const stdout: Buffer[] = [],
          stderr: Buffer[] = [];
        let bytes = 0;
        let failure: PhoenixError | undefined;
        let termination: Promise<void> | undefined;
        let cleanupTimer: NodeJS.Timeout | undefined;
        let exited = false;
        let closed = false;
        const startDrain = (): void => {
          if (cleanupTimer !== undefined || closed) return;
          cleanupTimer = setTimeout(() => {
            failure ??= new PhoenixError('PROVIDER_FAILED', 'Process descendants retained output pipes', {
              details: { phase: 'output-drain' },
            });
            child.stdout.destroy();
            child.stderr.destroy();
            killParent(child);
          }, 2500);
        };
        const terminate = (): void => {
          if (termination !== undefined || closed) return;
          // POSIX owns the detached group even after parent exit; Windows only owns a live child PID.
          if (process.platform === 'win32' && (exited || !running(child))) return;
          termination = terminateTree(child).catch((cause: unknown) => {
            failure ??= new PhoenixError('PROVIDER_FAILED', 'Process-tree cleanup failed', { cause });
            killParent(child);
          });
        };
        const stop = (error: PhoenixError): void => {
          if (closed) return;
          if (!exited && !running(child)) onExit();
          // Late abort/timeout cannot overwrite an observed execution outcome.
          if (!exited || error.code === 'OUTPUT_LIMIT_EXCEEDED') failure ??= error;
          startDrain();
          terminate();
        };
        const capture = (destination: Buffer[], chunk: Buffer): void => {
          if (failure !== undefined) return;
          if (chunk.length > input.maxOutputBytes - bytes) {
            stop(new PhoenixError('OUTPUT_LIMIT_EXCEEDED', 'Process output limit exceeded'));
            return;
          }
          bytes += chunk.length;
          destination.push(chunk);
        };
        child.stdout.on('data', (chunk: Buffer) => {
          capture(stdout, chunk);
        });
        child.stderr.on('data', (chunk: Buffer) => {
          capture(stderr, chunk);
        });
        child.on('error', (cause) => {
          if (!closed) failure ??= spawnFailure(cause);
        });
        const abort = (): void => {
          stop(new PhoenixError('CANCELLED', 'Process cancelled'));
        };
        const timer = setTimeout(() => {
          stop(
            new PhoenixError('TIMEOUT', 'Process execution timed out', { details: { phase: 'execution' } }),
          );
        }, input.timeoutMs);
        const onExit = (): void => {
          if (exited || closed) return;
          exited = true;
          clearTimeout(timer);
          input.signal.removeEventListener('abort', abort);
          startDrain();
          if (process.platform !== 'win32') terminate();
        };
        child.once('exit', onExit);
        input.signal.addEventListener('abort', abort, { once: true });
        if (input.signal.aborted) abort();
        child.once('close', (exitCode, signal) => {
          closed = true;
          clearTimeout(timer);
          clearTimeout(cleanupTimer);
          input.signal.removeEventListener('abort', abort);
          void (async () => {
            if (termination !== undefined) await termination;
            if (failure !== undefined) reject(failure);
            else
              resolve({
                exitCode,
                signal,
                stdout: Buffer.concat(stdout),
                stderr: Buffer.concat(stderr),
                durationMs: Math.max(0, Math.round(performance.now() - started)),
              });
          })();
        });
      });
    },
  };
}
