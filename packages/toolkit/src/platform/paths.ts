import path from 'node:path';
import { homedir } from 'node:os';
import { lstat, realpath, opendir } from 'node:fs/promises';
import { ExcludePattern, PhoenixError, RelativePath } from '@phoenix/contracts';
import type { HostOs } from '@phoenix/contracts';
import { unreadable } from '../internal.js';

export type PathFlavor = 'posix' | 'win32';
function wellFormed(value: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}
export function nfc(value: string): string {
  if (!wellFormed(value)) throw new PhoenixError('INVALID_REQUEST', 'Invalid Unicode path');
  return value.normalize('NFC');
}
export function validateWindowsPath(relativePath: string): void {
  if (
    relativePath
      .split('/')
      .some(
        (segment) =>
          /[<>:"|?*\x00-\x1f]|[. ]$/.test(segment) ||
          /^(?:CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/i.test(segment),
      )
  )
    throw new PhoenixError('INVALID_REQUEST', 'Path is not representable safely on Windows');
}
export function toPosixRel(
  value: string,
  flavor: PathFlavor = process.platform === 'win32' ? 'win32' : 'posix',
): string {
  const normalized = nfc(flavor === 'win32' ? value.replaceAll('\\', '/') : value);
  const parsed = RelativePath.safeParse(normalized);
  if (!parsed.success) throw new PhoenixError('INVALID_REQUEST', 'Expected a canonical relative path');
  if (flavor === 'win32') validateWindowsPath(parsed.data);
  return parsed.data;
}
export function normalizeExcludes(excludes: readonly string[]): string[] {
  return [
    ...new Set(
      excludes.map((value) => {
        const parsed = ExcludePattern.safeParse(nfc(value));
        if (!parsed.success) throw new PhoenixError('INVALID_REQUEST', 'Invalid literal exclusion');
        return parsed.data;
      }),
    ),
  ].sort(comparePaths);
}
export function comparePaths(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}
export function isExcluded(relativePath: string, excludes: readonly string[]): boolean {
  return excludes.some((exclude) =>
    exclude.includes('/')
      ? relativePath === exclude || relativePath.startsWith(exclude + '/')
      : relativePath.split('/').includes(exclude),
  );
}
/** Windows rooted paths such as \foo depend on a drive and are not fully qualified. */
export function isFullyQualifiedPath(
  value: string,
  flavor: PathFlavor = process.platform === 'win32' ? 'win32' : 'posix',
): boolean {
  if (flavor === 'posix') return path.posix.isAbsolute(value);
  let native = value.replaceAll('/', '\\');
  if (native.startsWith('\\\\?\\')) {
    native = native.slice(4);
    if (/^UNC\\/i.test(native)) native = '\\\\' + native.slice(4);
  }
  return /^[a-z]:\\/i.test(native) || /^\\\\(?![?.]\\)[^\\]+\\[^\\]+(?:\\|$)/.test(native);
}
export function isPathWithin(
  root: string,
  candidate: string,
  flavor: PathFlavor = process.platform === 'win32' ? 'win32' : 'posix',
): boolean {
  const api = path[flavor];
  if (flavor === 'win32' && (!isFullyQualifiedPath(root, flavor) || !isFullyQualifiedPath(candidate, flavor)))
    return false;
  const rel = api.relative(api.resolve(root), api.resolve(candidate));
  return !api.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + api.sep);
}
/** Existing paths only. Every component below the root must be free of links/junctions. */
export async function assertContained(root: string, candidate: string): Promise<string> {
  try {
    if (!isPathWithin(root, candidate))
      throw new PhoenixError('TARGET_UNREADABLE', 'Path escapes target root');
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
      throw new PhoenixError('TARGET_UNREADABLE', 'Target root must be a directory, not a link');
    const actualRoot = await realpath(root);
    const rel = path.relative(path.resolve(root), path.resolve(candidate));
    let current = actualRoot;
    for (const segment of rel === '' ? [] : rel.split(path.sep)) {
      current = path.join(current, segment);
      if ((await lstat(current)).isSymbolicLink())
        throw new PhoenixError('TARGET_UNREADABLE', 'Symlink or junction traversal denied');
    }
    const actual = await realpath(current);
    if (!isPathWithin(actualRoot, actual))
      throw new PhoenixError('TARGET_UNREADABLE', 'Resolved path escapes target root');
    return actual;
  } catch (error) {
    throw unreadable(error);
  }
}
export async function resolveRelativePath(root: string, relativePath: string): Promise<string> {
  // Serialized input must already be canonical, rather than silently changing its identity.
  if (!RelativePath.safeParse(relativePath).success)
    throw new PhoenixError('INVALID_REQUEST', 'Invalid canonical relative path');
  if (process.platform === 'win32') validateWindowsPath(relativePath);
  const anchor = await assertContained(root, root);
  let current = anchor;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  for (const segment of relativePath.split('/')) {
    let matched: string | undefined;
    let scanned = 0;
    try {
      const directory = await opendir(current, { encoding: 'latin1', bufferSize: 32 });
      for await (const entry of directory) {
        if (++scanned > 50_000)
          throw new PhoenixError('OUTPUT_LIMIT_EXCEEDED', 'Directory name lookup limit exceeded');
        let name: string;
        try {
          name = decoder.decode(Buffer.from(entry.name, 'latin1'));
        } catch {
          throw new PhoenixError('INVALID_REQUEST', 'Filesystem name is not valid UTF-8');
        }
        if (nfc(name) !== segment) continue;
        if (matched !== undefined) throw new PhoenixError('CONFLICT', 'Path normalization collision');
        matched = name;
      }
      if (matched === undefined)
        throw new PhoenixError('TARGET_UNREADABLE', 'Relative target path not found');
      current = await assertContained(anchor, path.join(current, matched));
    } catch (error) {
      throw unreadable(error);
    }
  }
  return current;
}
export function defaultDataDir(
  options: { os?: HostOs; env?: Readonly<NodeJS.ProcessEnv>; home?: string } = {},
): string {
  const env = options.env ?? process.env;
  const os =
    options.os ??
    (process.platform === 'win32'
      ? 'windows'
      : process.platform === 'darwin'
        ? 'macos'
        : process.platform === 'linux'
          ? 'linux'
          : undefined);
  const api = os === 'windows' ? path.win32 : path.posix;
  const home = options.home ?? homedir();
  const override = env['PHOENIX_HOME'];
  if (override !== undefined) {
    if (
      !isFullyQualifiedPath(override, os === 'windows' ? 'win32' : 'posix') ||
      override.includes('\0') ||
      !wellFormed(override)
    )
      throw new PhoenixError('INVALID_REQUEST', 'PHOENIX_HOME must be an absolute path');
    return api.normalize(override);
  }
  if (os === 'windows') {
    const base = env['LOCALAPPDATA'] ?? api.join(home, 'AppData', 'Local');
    if (!isFullyQualifiedPath(base, 'win32'))
      throw new PhoenixError('INVALID_REQUEST', 'LOCALAPPDATA must be absolute');
    return api.join(base, 'PHOENIX');
  }
  if (os === 'macos') return api.join(home, 'Library', 'Application Support', 'PHOENIX');
  if (os === 'linux') {
    const xdg = env['XDG_DATA_HOME'];
    return api.join(
      xdg !== undefined && api.isAbsolute(xdg) ? xdg : api.join(home, '.local', 'share'),
      'phoenix',
    );
  }
  throw new PhoenixError('HOST_INCOMPATIBLE', 'Unsupported host operating system');
}
