import { requireFormat } from './reader.js';
import type { FormatInspection, FormatReader } from './reader.js';

export async function parseJavaClass(reader: FormatReader, result: FormatInspection): Promise<void> {
  const h = await reader.read(0, 10);
  const majorVersion = h.readUInt16BE(6),
    minorVersion = h.readUInt16BE(4);
  requireFormat(
    h.readUInt32BE(0) === 0xcafebabe && majorVersion >= 45 && h.readUInt16BE(8) > 0,
    'Invalid Java class header',
  );
  result.details = { format: 'java-class', majorVersion, minorVersion };
  result.header = { constantPoolCount: h.readUInt16BE(8) };
  result.platform = { os: 'any', osBasis: 'not-applicable', arches: [], binaryType: 'object' };
}
