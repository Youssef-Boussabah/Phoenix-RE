import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { isFullyQualifiedPath } from './paths.js';
import { PhoenixError } from '@phoenix/contracts';
import type { ProcessRunner } from '@phoenix/contracts';

export interface ExecutableLookupOptions {
  env?: Readonly<NodeJS.ProcessEnv>;
  platform?: 'win32' | 'posix';
}
export function isWindowsStoreAlias(candidate: string): boolean {
  return /(?:^|[\\/])WindowsApps[\\/]python(?:3(?:\.\d+)?)?\.exe$/i.test(candidate);
}
export function executableCandidates(name: string, options: ExecutableLookupOptions = {}): string[] {
  if (!name || name.includes('\0') || /[\\/]/.test(name) || /^[a-z]:/i.test(name))
    throw new PhoenixError('INVALID_REQUEST', 'Expected executable basename');
  const windows = (options.platform ?? (process.platform === 'win32' ? 'win32' : 'posix')) === 'win32';
  const api = windows ? path.win32 : path.posix;
  const env = options.env ?? process.env;
  const getEnv = (key: string): string | undefined =>
    windows ? Object.entries(env).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1] : env[key];
  const extensions = windows
    ? [
        ...new Set(
          (getEnv('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ext) => /^\.[a-z0-9]+$/i.test(ext)),
        ),
      ]
    : [''];
  const suffixes =
    windows && extensions.some((ext) => name.toLowerCase().endsWith(ext.toLowerCase())) ? [''] : extensions;
  return (getEnv('PATH') ?? '')
    .split(windows ? ';' : ':')
    .map((dir) => dir.replace(/^"(.*)"$/, '$1'))
    .filter((dir) => isFullyQualifiedPath(dir, windows ? 'win32' : 'posix'))
    .flatMap((dir) => suffixes.map((ext) => api.join(dir, name + ext)));
}
export async function findExecutable(
  name: string,
  options: ExecutableLookupOptions = {},
): Promise<string | undefined> {
  for (const candidate of executableCandidates(name, options)) {
    if (isWindowsStoreAlias(candidate)) continue;
    try {
      const metadata = await stat(candidate);
      if (!metadata.isFile() || metadata.size === 0) continue;
      await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch {
      /* Missing, inaccessible, or not executable: continue PATH search. */
    }
  }
  return undefined;
}
/** Execution is opt-in through the caller's already-authorized runner; lookup itself never launches. */
export async function discoverVersion(
  file: string,
  args: readonly string[],
  runner: ProcessRunner,
  signal: AbortSignal,
): Promise<string> {
  const result = await runner.runProcess({
    file,
    args,
    cwd: path.dirname(file),
    timeoutMs: 5000,
    maxOutputBytes: 8192,
    signal,
  });
  if (result.exitCode !== 0) throw new PhoenixError('PROVIDER_FAILED', 'Version probe failed');
  // The caller must parse the tool-specific version; retain stderr for tools like Java.
  return Buffer.concat([result.stdout, result.stderr]).toString('utf8').trim();
}
