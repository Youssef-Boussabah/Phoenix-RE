import { createHash } from 'node:crypto';
import { constants, lstatSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { open, mkdir, link, unlink, chmod, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import {
  ArtifactRef,
  Sha256Hex,
  PhoenixError,
  type ArtifactWriter,
  type ByteStream,
} from '@phoenix/contracts';
import { type Artifacts } from '../repos/artifacts.js';
import { newId, input, stored } from '../repos/shared.js';
import { storageError } from '../db/database.js';
function code(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}
// No-clobber hard-link publication avoids rename's overwrite race. Windows lock errors
// use the same strictly bounded retry policy as the planned rename implementation.
async function publish(stage: string, destination: string): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      await link(stage, destination);
      return true;
    } catch (error) {
      if (code(error) === 'EEXIST') return false;
      if (
        process.platform === 'win32' &&
        ['EPERM', 'EBUSY', 'EACCES'].includes(code(error) ?? '') &&
        attempt < 10
      ) {
        await setTimeout(Math.min(10 * 2 ** attempt, 100));
        continue;
      }
      throw error;
    }
  }
}
async function removeStage(path: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await unlink(path);
      return;
    } catch (error) {
      if (code(error) === 'ENOENT') return;
      if (
        process.platform === 'win32' &&
        ['EPERM', 'EBUSY', 'EACCES'].includes(code(error) ?? '') &&
        attempt < 10
      ) {
        // Another deduplicating writer may have set the linked blob read-only.
        await chmod(path, 0o600);
        await setTimeout(Math.min(10 * 2 ** attempt, 100));
        continue;
      }
      throw error;
    }
  }
}
async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(code(error) ?? '')) throw error;
  } finally {
    await handle.close();
  }
}
export class ArtifactStore implements ArtifactWriter {
  readonly root: string;
  readonly records: Artifacts;
  readonly readOnly: boolean;
  private closing = false;
  private closed = false;
  private readonly pending = new Set<Promise<ArtifactRef>>();
  constructor(root: string, records: Artifacts, readOnly = false) {
    this.root = root;
    this.records = records;
    this.readOnly = readOnly;
  }
  private path(hash: string): string {
    input(Sha256Hex, hash);
    return join(this.root, 'sha256', hash.slice(0, 2), hash);
  }
  putBytes(bytes: Uint8Array, mediaType: string): Promise<ArtifactRef> {
    return this.putStream(
      (async function* () {
        yield await Promise.resolve(bytes);
      })(),
      mediaType,
      bytes.byteLength,
    );
  }
  putStream(stream: ByteStream, mediaType: string, maxBytes: number): Promise<ArtifactRef> {
    if (this.closing || this.readOnly)
      return Promise.reject(new PhoenixError('STORAGE_ERROR', 'Artifact store is closed or read-only'));
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || typeof mediaType !== 'string')
      return Promise.reject(new PhoenixError('INVALID_REQUEST', 'Invalid artifact limits or media type'));
    const promise = this.write(stream, mediaType, maxBytes);
    this.pending.add(promise);
    void promise.finally(() => this.pending.delete(promise)).catch(() => undefined);
    return promise;
  }
  private async write(stream: ByteStream, mediaType: string, maxBytes: number): Promise<ArtifactRef> {
    const temporary = join(this.root, 'tmp', newId('stage'));
    let staged = false;
    try {
      await mkdir(join(this.root, 'tmp'), { recursive: true });
      const handle = await open(temporary, 'wx', 0o600);
      staged = true;
      const hash = createHash('sha256');
      let size = 0;
      try {
        for await (const chunk of stream) {
          if (!(chunk instanceof Uint8Array))
            throw new PhoenixError('INVALID_REQUEST', 'Artifact streams must yield bytes');
          if (chunk.byteLength > maxBytes - size)
            throw new PhoenixError('OUTPUT_LIMIT_EXCEEDED', 'Artifact byte limit exceeded');
          // Detach each bounded chunk from the producer while hashing/writing it.
          const bytes = Buffer.from(chunk);
          hash.update(bytes);
          size += bytes.byteLength;
          for (let offset = 0; offset < bytes.byteLength;) {
            const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset);
            if (bytesWritten === 0)
              throw new PhoenixError('STORAGE_ERROR', 'Artifact write made no progress');
            offset += bytesWritten;
          }
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      const digest = hash.digest('hex'),
        destination = this.path(digest),
        directory = join(this.root, 'sha256', digest.slice(0, 2));
      await mkdir(directory, { recursive: true });
      await publish(temporary, destination);
      // Verify even on dedupe: an existing pathname is not proof of valid bytes.
      const fingerprint = await this.fingerprint(digest);
      if (fingerprint.sizeBytes !== size) throw new PhoenixError('STORAGE_ERROR', 'Artifact size mismatch');
      await removeStage(temporary);
      staged = false;
      await chmod(destination, 0o444);
      await syncDirectory(directory);
      await syncDirectory(join(this.root, 'sha256'));
      await syncDirectory(this.root);
      return this.records.register({ id: newId('art'), sha256: digest, sizeBytes: size, mediaType });
    } catch (error) {
      throw storageError(error);
    } finally {
      if (staged)
        await removeStage(temporary).catch((error: unknown) => {
          if (code(error) !== 'ENOENT') throw storageError(error);
        });
    }
  }
  async *open(hash: string): AsyncGenerator<Uint8Array> {
    if (this.closed) throw new PhoenixError('STORAGE_ERROR', 'Artifact store is closed');
    const path = this.path(hash);
    try {
      const stat = await lstat(path);
      if (!stat.isFile()) throw new PhoenixError('STORAGE_ERROR', 'Artifact is not a regular file');
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        for await (const chunk of handle.createReadStream({ autoClose: false })) yield chunk as Buffer;
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw storageError(error);
    }
  }
  /** Synchronous, bounded verification for evidence commits: never await in SQLite. */
  verifyRegistered(id: string): ArtifactRef {
    return stored(() => {
      if (this.closed) throw new PhoenixError('STORAGE_ERROR', 'Artifact store is closed');
      const artifact = this.records.get(id),
        path = this.path(artifact.sha256);
      if (!lstatSync(path).isFile())
        throw new PhoenixError('STORAGE_ERROR', 'Artifact is not a regular file');
      const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        if (!fstatSync(fd).isFile())
          throw new PhoenixError('STORAGE_ERROR', 'Artifact is not a regular file');
        const hash = createHash('sha256'),
          buffer = Buffer.alloc(64 * 1024);
        let size = 0,
          length: number;
        while ((length = readSync(fd, buffer)) > 0) {
          size += length;
          hash.update(buffer.subarray(0, length));
          if (size > artifact.sizeBytes) throw new PhoenixError('STORAGE_ERROR', 'Artifact size mismatch');
        }
        if (size !== artifact.sizeBytes || hash.digest('hex') !== artifact.sha256)
          throw new PhoenixError('STORAGE_ERROR', 'Artifact fingerprint mismatch');
        return artifact;
      } finally {
        closeSync(fd);
      }
    });
  }
  async fingerprint(hash: string): Promise<{ sha256: string; sizeBytes: number }> {
    const digest = createHash('sha256');
    let sizeBytes = 0;
    for await (const chunk of this.open(hash)) {
      digest.update(chunk);
      sizeBytes += chunk.byteLength;
    }
    if (digest.digest('hex') !== hash) throw new PhoenixError('STORAGE_ERROR', 'Artifact SHA-256 mismatch');
    const record = this.records.byHash(hash);
    if (record && record.sizeBytes !== sizeBytes)
      throw new PhoenixError('STORAGE_ERROR', 'Artifact metadata size mismatch');
    return { sha256: hash, sizeBytes };
  }
  async *read(id: string): AsyncGenerator<Uint8Array> {
    const a = this.records.get(id);
    yield* this.open(a.sha256);
  }
  async reconcile(page: unknown = {}): Promise<{ artifact: ArtifactRef; healthy: boolean }[]> {
    const result: { artifact: ArtifactRef; healthy: boolean }[] = [];
    for (const artifact of this.records.list(page)) {
      try {
        await this.fingerprint(artifact.sha256);
        result.push({ artifact, healthy: true });
      } catch (error) {
        if (error instanceof PhoenixError && error.code === 'STORAGE_ERROR')
          result.push({ artifact, healthy: false });
        else throw error;
      }
    }
    return result;
  }
  async close(): Promise<void> {
    this.closing = true;
    await Promise.allSettled(this.pending);
    this.closed = true;
  }
}
