import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { PhoenixError } from '@phoenix/contracts';
import { checkAbort, safeInteger, unreadable } from '../internal.js';

export const MAX_RANGE_BYTES = 1_048_576;
export const READ_CHUNK_BYTES = 65_536;
export function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs &&
    a.mode === b.mode
  );
}
export interface RegularFile {
  readonly sizeBytes: number;
  readRange(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;
  stream(signal?: AbortSignal): AsyncIterable<Uint8Array>;
  verify(): Promise<void>;
  close(): Promise<void>;
}
/** lstat + nonblocking/no-follow open + fstat: avoid opening substituted FIFOs or final symlinks. */
export async function openRegularFile(file: string): Promise<RegularFile> {
  let handle: FileHandle | undefined;
  try {
    const before = await lstat(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink())
      throw new PhoenixError('TARGET_UNREADABLE', 'Target is not a regular file');
    const flags =
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
    handle = await open(file, flags);
    const opened = handle;
    const initial = await opened.stat({ bigint: true });
    if (!initial.isFile() || !sameFile(before, initial))
      throw new PhoenixError('TARGET_CHANGED', 'Target changed while opening');
    const sizeBytes = Number(initial.size);
    safeInteger(sizeBytes, 'file size');
    let closed = false;
    let streaming = false;
    const close = async (): Promise<void> => {
      if (!closed) {
        closed = true;
        await opened.close();
      }
    };
    const verify = async (): Promise<void> => {
      try {
        if (closed) throw new PhoenixError('TARGET_UNREADABLE', 'File handle is closed');
        if (
          !sameFile(initial, await opened.stat({ bigint: true })) ||
          !sameFile(initial, await lstat(file, { bigint: true }))
        )
          throw new PhoenixError('TARGET_CHANGED', 'Target changed during inspection');
      } catch (error) {
        if (error instanceof PhoenixError) throw error;
        throw new PhoenixError('TARGET_CHANGED', 'Target disappeared during inspection', { cause: error });
      }
    };
    const readRange = async (offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> => {
      safeInteger(offset, 'offset');
      safeInteger(length, 'range length', 0, MAX_RANGE_BYTES);
      checkAbort(signal);
      try {
        await verify();
        const buffer = Buffer.alloc(Math.min(length, Math.max(0, sizeBytes - offset)));
        let total = 0;
        while (total < buffer.length) {
          checkAbort(signal);
          const { bytesRead } = await opened.read(buffer, total, buffer.length - total, offset + total);
          if (bytesRead === 0) throw new PhoenixError('TARGET_CHANGED', 'Unexpected end of target');
          total += bytesRead;
        }
        checkAbort(signal);
        await verify();
        return buffer;
      } catch (error) {
        throw unreadable(error);
      }
    };
    const stream = async function* (signal?: AbortSignal): AsyncGenerator<Uint8Array> {
      if (streaming) throw new PhoenixError('INVALID_REQUEST', 'File stream is single use');
      streaming = true;
      try {
        for (let offset = 0; offset < sizeBytes; offset += READ_CHUNK_BYTES) {
          yield await readRange(offset, Math.min(READ_CHUNK_BYTES, sizeBytes - offset), signal);
        }
        checkAbort(signal);
        await verify();
      } finally {
        await close();
      }
    };
    return { sizeBytes, readRange, stream, verify, close };
  } catch (error) {
    await handle?.close();
    throw unreadable(error);
  }
}
/** Opening is lazy; iterator completion, cancellation and early return always close the handle. */
export async function* readFileStream(file: string, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  checkAbort(signal);
  const opened = await openRegularFile(file);
  try {
    yield* opened.stream(signal);
  } finally {
    await opened.close();
  }
}
