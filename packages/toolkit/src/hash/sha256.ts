import { createHash } from 'node:crypto';
import { PhoenixError } from '@phoenix/contracts';
import { readFileStream } from '../fs/safe-read.js';
import { checkAbort, safeInteger } from '../internal.js';

export interface HashOptions {
  signal?: AbortSignal;
  maxBytes?: number;
}
export async function hashStream(
  stream: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  options: HashOptions = {},
  sink?: (chunk: Uint8Array) => Promise<void>,
): Promise<{ sha256: string; sizeBytes: number }> {
  const max = options.maxBytes ?? Number.MAX_SAFE_INTEGER;
  safeInteger(max, 'maximum hash bytes');
  const hash = createHash('sha256');
  let sizeBytes = 0;
  checkAbort(options.signal);
  for await (const chunk of stream) {
    checkAbort(options.signal);
    sizeBytes += chunk.byteLength;
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes > max)
      throw new PhoenixError('OUTPUT_LIMIT_EXCEEDED', 'Hash input exceeds byte limit');
    hash.update(chunk);
    if (sink !== undefined) await sink(chunk);
  }
  checkAbort(options.signal);
  return { sha256: hash.digest('hex'), sizeBytes };
}
export function hashFileTo(
  file: string,
  sink?: (chunk: Uint8Array) => Promise<void>,
  options: HashOptions = {},
): Promise<{ sha256: string; sizeBytes: number }> {
  return hashStream(readFileStream(file, options.signal), options, sink);
}
