import { createHash } from 'node:crypto';
import { lstat, opendir, readlink } from 'node:fs/promises';
import path from 'node:path';
import type { BigIntStats } from 'node:fs';
import type { InventoryEntry } from '@phoenix/contracts';
import { PhoenixError } from '@phoenix/contracts';
import { openRegularFile, sameFile } from '../fs/safe-read.js';
import type { RegularFile } from '../fs/safe-read.js';
import { checkAbort, safeInteger, unreadable } from '../internal.js';
import {
  comparePaths,
  isExcluded,
  normalizeExcludes,
  toPosixRel,
  assertContained,
} from '../platform/paths.js';
import { hashStream } from './sha256.js';

export type TreeRecord =
  readonly ['F', string, string, number] | readonly ['L', string, string] | readonly ['D' | 'O', string];
export const TREE_ALGORITHM = 'phoenix-tree-sha256-v1';
export function encodeTreeRecord(record: TreeRecord): string {
  return JSON.stringify(record) + '\n';
}
export interface TreeHashOptions {
  exclude?: readonly string[];
  maxEntries?: number;
  maxTotalBytes?: number;
  signal?: AbortSignal;
  /** Read ranges only; the walker owns streaming/closing this verified handle. */
  inspectFile?: (file: RegularFile, relativePath: string) => Promise<void>;
}
export interface TreeHashResult {
  algorithm: typeof TREE_ALGORITHM;
  digest?: string;
  entries: InventoryEntry[];
  excluded: string[];
  totalBytes: number;
  truncated: boolean;
  warnings: { code: string; message: string }[];
}
/** Bounded iterative walk, with original native paths kept separately from canonical identities. */
export async function hashDirectory(root: string, options: TreeHashOptions = {}): Promise<TreeHashResult> {
  const excludes = normalizeExcludes(options.exclude ?? ['.git']);
  const maxEntries = options.maxEntries ?? 50_000;
  const maxTotalBytes = options.maxTotalBytes ?? 4 * 1024 ** 3;
  safeInteger(maxEntries, 'maximum entries');
  safeInteger(maxTotalBytes, 'maximum total bytes');
  checkAbort(options.signal);
  try {
    const actualRoot = await assertContained(root, root);
    const rootStat = await lstat(actualRoot, { bigint: true });
    const pending = [{ native: actualRoot, relative: '', stat: rootStat }];
    const checked: { native: string; stat: BigIntStats }[] = [];
    const names = new Set<string>();
    const entries: InventoryEntry[] = [];
    const records: TreeRecord[] = [];
    let visited = 0;
    let totalBytes = 0;
    let truncated = false;
    // latin1 preserves every directory-name byte; fatal UTF-8 decoding rejects lossy names.
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    while (pending.length && !truncated) {
      checkAbort(options.signal);
      const directory = pending.pop();
      if (directory === undefined) break;
      await assertContained(actualRoot, directory.native);
      if (!sameFile(directory.stat, await lstat(directory.native, { bigint: true })))
        throw new PhoenixError('TARGET_CHANGED', 'Directory changed during inspection');
      checked.push({ native: directory.native, stat: directory.stat });
      const dir = await opendir(directory.native, { encoding: 'latin1', bufferSize: 32 });
      for await (const entry of dir) {
        checkAbort(options.signal);
        if (visited++ >= maxEntries) {
          truncated = true;
          break;
        }
        let nativeName: string;
        try {
          nativeName = decoder.decode(Buffer.from(entry.name, 'latin1'));
        } catch {
          throw new PhoenixError('INVALID_REQUEST', 'Filesystem name is not valid UTF-8');
        }
        const native = path.join(directory.native, nativeName);
        const relative = toPosixRel(
          directory.relative === '' ? nativeName : directory.relative + '/' + nativeName,
          'posix',
        );
        if (names.has(relative)) throw new PhoenixError('CONFLICT', 'Path normalization collision');
        names.add(relative);
        if (isExcluded(relative, excludes)) continue;
        const stat = await lstat(native, { bigint: true });
        checked.push({ native, stat });
        if (stat.isSymbolicLink()) {
          const payload = await readlink(native, { encoding: 'buffer' });
          // Byte-for-byte UTF-8 payload: no NFC normalization or separator rewriting.
          try {
            decoder.decode(payload);
          } catch {
            throw new PhoenixError('INVALID_REQUEST', 'Symlink payload is not valid UTF-8');
          }
          const digest = createHash('sha256').update(payload).digest('hex');
          records.push(['L', relative, digest]);
          entries.push({ path: relative, type: 'symlink', sha256: digest });
        } else if (stat.isDirectory()) {
          records.push(['D', relative]);
          entries.push({ path: relative, type: 'directory' });
          pending.push({ native, relative, stat });
        } else if (stat.isFile()) {
          const size = Number(stat.size);
          safeInteger(size, 'file size');
          if (size > maxTotalBytes - totalBytes) {
            truncated = true;
            break;
          }
          await assertContained(actualRoot, native);
          const opened = await openRegularFile(native);
          let hashed: { sha256: string; sizeBytes: number };
          try {
            await options.inspectFile?.(opened, relative);
            hashed = await hashStream(opened.stream(options.signal), {
              ...(options.signal === undefined ? {} : { signal: options.signal }),
              maxBytes: maxTotalBytes - totalBytes,
            });
          } finally {
            await opened.close();
          }
          if (hashed.sizeBytes !== size)
            throw new PhoenixError('TARGET_CHANGED', 'File changed during inventory');
          totalBytes += size;
          records.push(['F', relative, hashed.sha256, size]);
          entries.push({ path: relative, type: 'file', sizeBytes: size, sha256: hashed.sha256 });
        } else {
          records.push(['O', relative]);
          entries.push({ path: relative, type: 'other' });
        }
      }
    }
    // A stable read is best effort, not an atomic snapshot of an adversarial filesystem.
    for (const item of checked) {
      checkAbort(options.signal);
      if (!sameFile(item.stat, await lstat(item.native, { bigint: true })))
        throw new PhoenixError('TARGET_CHANGED', 'Tree changed during inspection');
    }
    entries.sort((a, b) => comparePaths(a.path, b.path));
    const result: TreeHashResult = {
      algorithm: TREE_ALGORITHM,
      entries,
      excluded: excludes,
      totalBytes,
      truncated,
      warnings: [],
    };
    if (truncated) {
      result.warnings.push({
        code: 'INVENTORY_TRUNCATED',
        message: 'Inventory limit reached; no digest produced',
      });
      return result;
    }
    records.sort((a, b) => comparePaths(a[1], b[1]));
    const hash = createHash('sha256').update(JSON.stringify([TREE_ALGORITHM, excludes]) + '\n');
    for (const record of records) hash.update(encodeTreeRecord(record));
    result.digest = hash.digest('hex');
    return result;
  } catch (error) {
    throw unreadable(error);
  }
}
