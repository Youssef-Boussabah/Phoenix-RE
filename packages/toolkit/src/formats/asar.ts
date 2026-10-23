import { decodeUtf8, FORMAT_LIMITS, inBounds, requireFormat, warning } from './reader.js';
import type { FormatInspection, FormatReader } from './reader.js';
import { parseDataJson } from './data-json.js';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export async function parseAsar(reader: FormatReader, result: FormatInspection): Promise<void> {
  const h = await reader.read(0, 16),
    headerSize = h.readUInt32LE(4),
    jsonSize = h.readUInt32LE(12);
  requireFormat(
    h.readUInt32LE(0) === 4 && headerSize >= 8 && headerSize <= FORMAT_LIMITS.asarHeaderBytes,
    'Invalid or oversized ASAR pickle header',
  );
  requireFormat(
    h.readUInt32LE(8) === headerSize - 4 &&
      headerSize === 8 + Math.ceil(jsonSize / 4) * 4 &&
      inBounds(8, headerSize, reader.size),
    'ASAR pickle sizes disagree',
  );
  const json = decodeUtf8(await reader.read(16, jsonSize));
  const parsed = parseDataJson(json);
  requireFormat(object(parsed) && object(parsed['files']), 'ASAR header requires a files object');
  const pending: Record<string, unknown>[] = [parsed['files']];
  let visited = 0,
    fileCount = 0;
  while (pending.length > 0) {
    const files = pending.pop();
    if (files === undefined) break;
    for (const name in files) {
      requireFormat(
        ++visited <= FORMAT_LIMITS.archiveEntries,
        'ASAR entry count exceeds limit',
        'FORMAT_LIMIT',
      );
      requireFormat(
        name.length > 0 &&
          name !== '.' &&
          name !== '..' &&
          !/[\/\\\0]/.test(name) &&
          !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(name),
        'Invalid ASAR entry name',
      );
      const item = files[name];
      requireFormat(object(item), 'Invalid ASAR entry');
      if (object(item['files'])) pending.push(item['files']);
      else if (typeof item['link'] === 'string')
        warning(result, 'ARCHIVE_LINK', 'ASAR links recorded but never followed');
      else {
        const size = item['size'];
        requireFormat(
          typeof size === 'number' && Number.isSafeInteger(size) && size >= 0,
          'Invalid ASAR file size',
        );
        if (item['unpacked'] === true)
          warning(result, 'UNPACKED_ASAR', 'ASAR references external unpacked files; not read');
        else {
          const offset = item['offset'];
          requireFormat(
            typeof offset === 'string' &&
              /^\d{1,16}$/.test(offset) &&
              inBounds(Number(offset), size, reader.size - 8 - headerSize),
            'ASAR file outside payload',
          );
        }
        fileCount++;
      }
    }
  }
  result.kind = 'electron';
  result.format = 'asar';
  result.details = { format: 'asar', headerSize, fileCount, truncated: false };
  result.header = { jsonBytes: jsonSize };
}
