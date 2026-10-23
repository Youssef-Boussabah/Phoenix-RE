import { inBounds, requireFormat, uint } from './reader.js';
import type { FormatInspection, FormatReader } from './reader.js';

export async function parseDex(reader: FormatReader, result: FormatInspection): Promise<void> {
  const magic = await reader.read(0, 8),
    version = magic.subarray(4, 7).toString('ascii');
  result.details = { format: 'dex', version };
  result.platform = { os: 'android', osBasis: 'header', arches: [], binaryType: 'unknown' };
  requireFormat(
    ['035', '037', '038', '039', '040'].includes(version),
    'Unsupported DEX version (including v041 containers)',
    'UNSUPPORTED_VARIANT',
  );
  const h = await reader.read(0, 112),
    tag = h.readUInt32LE(40),
    little = tag === 0x12345678;
  requireFormat(little || tag === 0x78563412, 'Invalid DEX endian tag');
  const u = (o: number): number => uint(h, o, 4, little);
  requireFormat(u(32) === reader.size && u(36) === 112, 'DEX file/header size disagrees with input');
  for (const [position, stride] of [
    [56, 4],
    [64, 4],
    [72, 12],
    [80, 8],
    [88, 8],
    [96, 32],
  ]) {
    requireFormat(position !== undefined && stride !== undefined, 'Invalid DEX table');
    const count = u(position),
      offset = u(position + 4);
    requireFormat(
      count === 0 ? offset === 0 : offset >= 112 && inBounds(offset, count * stride, reader.size),
      'DEX table outside file',
    );
  }
  requireFormat(
    u(104) === 0 ? u(108) === 0 : u(108) >= 112 && inBounds(u(108), u(104), reader.size),
    'DEX data outside file',
  );
  result.header = { headerSize: 112, fileSize: u(32), endianTag: tag, classCount: u(96), methodCount: u(88) };
}
