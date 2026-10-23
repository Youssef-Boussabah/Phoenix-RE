import { PhoenixError } from '@phoenix/contracts';
import type {
  FileFormat,
  FormatDetails,
  TargetKind,
  TargetPlatform,
  TargetWarning,
} from '@phoenix/contracts';
import { checkAbort, safeInteger } from '../internal.js';

export const FORMAT_LIMITS = Object.freeze({
  headBytes: 65_536,
  textBytes: 8192,
  tableEntries: 4096,
  archiveEntries: 10_000,
  asarHeaderBytes: 32 * 1024 ** 2,
  readBytes: 36 * 1024 ** 2,
  warnings: 32,
});
/** Byte access only: callers retain ownership of their WP2 handle or memory buffer. */
export interface FormatSource {
  sizeBytes: number;
  readRange(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;
}
export interface FormatSection {
  name?: string;
  type: number;
  offset: number;
  size: number;
  address?: string;
}
export interface FormatInspection {
  /** Outcome of supported metadata checks; never a full loader/VM validity guarantee. */
  structuralStatus: StructuralStatus;
  format: FileFormat;
  kind: TargetKind;
  details?: FormatDetails;
  platform?: TargetPlatform;
  header: Record<string, number | string>;
  sections: FormatSection[];
  warnings: TargetWarning[];
}
export type StructuralStatus = 'validated' | 'incomplete' | 'invalid';
export class FormatFault extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export function requireFormat(
  condition: boolean,
  message: string,
  code = 'MALFORMED_FORMAT',
): asserts condition {
  if (!condition) throw new FormatFault(code, message);
}
export function inBounds(offset: number, length: number, size: number): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset <= size &&
    length <= size - offset
  );
}
export function exactNumber(value: bigint): number {
  requireFormat(value <= BigInt(Number.MAX_SAFE_INTEGER), 'Offset or size exceeds safe integer range');
  return Number(value);
}
export function uint(buffer: Buffer, offset: number, bytes: 2 | 4 | 8, little: boolean): number {
  requireFormat(inBounds(offset, bytes, buffer.length), 'Truncated integer');
  if (bytes === 8)
    return exactNumber(little ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset));
  return bytes === 2
    ? little
      ? buffer.readUInt16LE(offset)
      : buffer.readUInt16BE(offset)
    : little
      ? buffer.readUInt32LE(offset)
      : buffer.readUInt32BE(offset);
}
export function address(buffer: Buffer, offset: number, bytes: 4 | 8, little: boolean): string {
  requireFormat(inBounds(offset, bytes, buffer.length), 'Truncated address');
  return (
    '0x' +
    (bytes === 8
      ? little
        ? buffer.readBigUInt64LE(offset)
        : buffer.readBigUInt64BE(offset)
      : BigInt(uint(buffer, offset, 4, little))
    ).toString(16)
  );
}
export function warning(result: FormatInspection, code: string, message: string): void {
  if (result.warnings.length < FORMAT_LIMITS.warnings) result.warnings.push({ code, message });
}
export function decodeUtf8(
  bytes: Uint8Array,
  options: { stream?: boolean; ignoreBOM?: boolean } = {},
): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: options.ignoreBOM ?? false }).decode(bytes, {
      stream: options.stream ?? false,
    });
  } catch (error) {
    if (error instanceof TypeError && 'code' in error && error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA')
      throw new FormatFault('MALFORMED_FORMAT', 'Invalid UTF-8 structure');
    throw error;
  }
}
export class FormatReader {
  private used = 0;
  private head: Buffer = Buffer.alloc(0);
  readonly source: FormatSource;
  readonly signal: AbortSignal | undefined;
  constructor(source: FormatSource, signal?: AbortSignal) {
    this.source = source;
    this.signal = signal;
    safeInteger(source.sizeBytes, 'format source size');
  }
  get size(): number {
    return this.source.sizeBytes;
  }
  async initialize(): Promise<Buffer> {
    this.head = await this.read(0, Math.min(this.size, FORMAT_LIMITS.headBytes));
    return this.head;
  }
  async read(offset: number, length: number): Promise<Buffer> {
    checkAbort(this.signal);
    requireFormat(inBounds(offset, length, this.size), 'Structure extends beyond the file');
    if (inBounds(offset, length, this.head.length)) return this.head.subarray(offset, offset + length);
    requireFormat(
      length <= FORMAT_LIMITS.readBytes - this.used,
      'Parser read budget exceeded',
      'FORMAT_LIMIT',
    );
    this.used += length;
    const parts: Uint8Array[] = [];
    for (let position = 0; position < length; position += 1_048_576) {
      checkAbort(this.signal);
      const count = Math.min(1_048_576, length - position);
      const bytes = await this.source.readRange(offset + position, count, this.signal);
      if (bytes.byteLength !== count)
        throw new PhoenixError('TARGET_CHANGED', 'Short read during format inspection');
      parts.push(bytes);
    }
    return Buffer.concat(parts, length);
  }
}
