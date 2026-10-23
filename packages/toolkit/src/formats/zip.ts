import path from 'node:path';
import { RelativePath, PhoenixError } from '@phoenix/contracts';
import { validateWindowsPath } from '../platform/paths.js';
import { decodeUtf8, exactNumber, FORMAT_LIMITS, inBounds, requireFormat, warning } from './reader.js';
import type { FormatInspection, FormatReader } from './reader.js';

/** Central directory only. No decompression, extraction, CRC validation or archive execution. */
export async function parseZip(reader: FormatReader, result: FormatInspection): Promise<void> {
  const tailOffset = Math.max(0, reader.size - 65_557),
    tail = await reader.read(tailOffset, reader.size - tailOffset);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) {
      eocd = i;
      break;
    }
  }
  requireFormat(eocd >= 0, 'ZIP end-of-central-directory record missing');
  const h = tail.subarray(eocd),
    end = tailOffset + eocd;
  requireFormat(
    h.readUInt16LE(4) === 0 && h.readUInt16LE(6) === 0 && h.readUInt16LE(8) === h.readUInt16LE(10),
    'Multi-volume ZIP is unsupported',
    'UNSUPPORTED_VARIANT',
  );
  let count = h.readUInt16LE(10),
    size = h.readUInt32LE(12),
    offset = h.readUInt32LE(16),
    centralEnd = end;
  const zip64 = count === 0xffff || size === 0xffffffff || offset === 0xffffffff;
  if (zip64) {
    const locator = await reader.read(end - 20, 20);
    requireFormat(
      locator.readUInt32LE(0) === 0x07064b50 &&
        locator.readUInt32LE(4) === 0 &&
        locator.readUInt32LE(16) === 1,
      'Invalid ZIP64 locator',
    );
    const location = exactNumber(locator.readBigUInt64LE(8)),
      z = await reader.read(location, 56);
    requireFormat(
      z.readUInt32LE(0) === 0x06064b50 &&
        z.readBigUInt64LE(4) >= 44n &&
        inBounds(location, exactNumber(z.readBigUInt64LE(4)) + 12, end - 20),
      'Invalid ZIP64 end record',
    );
    requireFormat(
      z.readUInt32LE(16) === 0 && z.readUInt32LE(20) === 0 && z.readBigUInt64LE(24) === z.readBigUInt64LE(32),
      'Multi-volume ZIP64 is unsupported',
      'UNSUPPORTED_VARIANT',
    );
    count = exactNumber(z.readBigUInt64LE(32));
    size = exactNumber(z.readBigUInt64LE(40));
    offset = exactNumber(z.readBigUInt64LE(48));
    centralEnd = location;
  }
  requireFormat(
    inBounds(offset, size, centralEnd) && count <= Math.floor(size / 46),
    'ZIP central directory bounds disagree with entry count',
  );
  const names: string[] = [];
  const normalizedNames = new Set<string>();
  let identityEligible = true;
  result.details = { format: 'zip', entryCount: count, sampledEntries: names, truncated: true, zip64 };
  result.header = { centralDirectoryOffset: offset, centralDirectoryBytes: size };
  let position = offset,
    sampledBytes = 0;
  for (let i = 0; i < Math.min(count, FORMAT_LIMITS.archiveEntries); i++) {
    requireFormat(inBounds(position, 46, offset + size), 'Truncated ZIP central entry');
    const c = await reader.read(position, 46);
    requireFormat(c.readUInt32LE(0) === 0x02014b50, 'Invalid ZIP central entry signature');
    const length = c.readUInt16LE(28),
      extra = c.readUInt16LE(30),
      comment = c.readUInt16LE(32),
      flags = c.readUInt16LE(8);
    const recordBytes = 46 + length + extra + comment;
    requireFormat(
      length > 0 && inBounds(position, recordBytes, offset + size),
      'Invalid ZIP central entry length',
    );
    requireFormat(c.readUInt16LE(34) === 0, 'Multi-volume ZIP entry is unsupported', 'UNSUPPORTED_VARIANT');
    if (length > 4096 || sampledBytes + length > 1_048_576) {
      warning(result, 'FORMAT_LIMIT', 'ZIP name sampling byte limit reached');
      break;
    }
    const raw = await reader.read(position + 46, length);
    let name: string;
    if ((flags & 0x800) !== 0) name = decodeUtf8(raw, { ignoreBOM: true });
    else if (raw.some((b) => b >= 128)) {
      identityEligible = false;
      name = '[unsupported-name-encoding]';
      warning(
        result,
        'UNSUPPORTED_VARIANT',
        'Non-UTF-8 ZIP name not decoded (CP437/extra-field names unsupported)',
      );
    } else name = raw.toString('ascii');
    const normalized = name.replaceAll('\\', '/').normalize('NFC').replace(/\/$/, '');
    let unsafe =
      name.includes('\\') ||
      /[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/.test(name) ||
      !RelativePath.safeParse(normalized).success;
    try {
      validateWindowsPath(normalized);
    } catch (error) {
      if (!(error instanceof PhoenixError) || error.code !== 'INVALID_REQUEST') throw error;
      unsafe = true;
    }
    if (unsafe) {
      identityEligible = false;
      warning(
        result,
        'UNSAFE_ARCHIVE_PATH',
        'ZIP contains a nonportable or traversal name; nothing is extracted',
      );
    }
    const identity = path.posix.normalize(normalized).toLowerCase();
    if (normalizedNames.has(identity)) {
      identityEligible = false;
      warning(
        result,
        'ARCHIVE_NAME_AMBIGUOUS',
        'Duplicate portable entry identity; package classification withheld',
      );
    }
    normalizedNames.add(identity);
    if ((flags & 1) !== 0) {
      identityEligible = false;
      warning(result, 'ENCRYPTED_ARCHIVE', 'ZIP contains encrypted entries; names only inspected');
    }
    const local = c.readUInt32LE(42);
    const compressed = c.readUInt32LE(20);
    const sentinelCount = [local, compressed, c.readUInt32LE(24)].filter((v) => v === 0xffffffff).length;
    if (sentinelCount > 0) {
      const fields = await reader.read(position + 46 + length, extra);
      let cursor = 0,
        zip64Field = false;
      while (cursor < fields.length) {
        requireFormat(inBounds(cursor, 4, fields.length), 'Invalid ZIP extra field header');
        const id = fields.readUInt16LE(cursor),
          bytes = fields.readUInt16LE(cursor + 2);
        requireFormat(inBounds(cursor + 4, bytes, fields.length), 'Invalid ZIP extra field bounds');
        if (id === 1 && bytes >= sentinelCount * 8) zip64Field = true;
        cursor += 4 + bytes;
      }
      requireFormat(zip64Field, 'ZIP sentinel has no required ZIP64 extra field');
      requireFormat(
        false,
        'ZIP64 per-entry values are unsupported; package identity withheld',
        'UNSUPPORTED_VARIANT',
      );
    } else {
      requireFormat(inBounds(local, 30, offset), 'ZIP local header pointer outside payload');
      const localHeader = await reader.read(local, 30);
      requireFormat(
        localHeader.readUInt32LE(0) === 0x04034b50 && localHeader.readUInt16LE(26) === length,
        'ZIP local header disagrees with central metadata',
      );
      const localName = await reader.read(local + 30, length);
      requireFormat(localName.equals(raw), 'ZIP local and central names disagree');
      requireFormat(
        inBounds(local + 30 + length + localHeader.readUInt16LE(28), compressed, offset),
        'ZIP compressed payload outside file',
      );
    }
    names.push(name);
    sampledBytes += length;
    position += recordBytes;
  }
  const complete = names.length === count;
  requireFormat(!complete || position === offset + size, 'ZIP central directory size mismatch');
  result.details.truncated = !complete;
  if (!complete)
    warning(result, 'FORMAT_LIMIT', 'ZIP central-directory names sampled; classification may be incomplete');
  const apk =
    identityEligible &&
    complete &&
    names.includes('AndroidManifest.xml') &&
    names.some((n) => /^classes(?:\d+)?\.dex$/.test(n));
  const format = apk
    ? 'apk'
    : identityEligible && complete && names.includes('META-INF/MANIFEST.MF')
      ? 'jar'
      : 'zip';
  result.format = format;
  result.kind = apk ? 'android' : 'unknown';
  result.details.format = format;
  if (apk) result.platform = { os: 'android', osBasis: 'header', arches: [] };
}
