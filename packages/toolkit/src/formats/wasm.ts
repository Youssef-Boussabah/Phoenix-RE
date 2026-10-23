import { requireFormat, warning } from './reader.js';
import type { FormatInspection, FormatReader } from './reader.js';

export async function parseWasm(reader: FormatReader, result: FormatInspection): Promise<void> {
  const h = await reader.read(0, 8),
    version = h.readUInt32LE(4);
  result.details = { format: 'wasm', version };
  result.platform = { os: 'any', osBasis: 'not-applicable', arches: ['wasm32'], binaryType: 'unknown' };
  requireFormat(version === 1, 'Unsupported WebAssembly version', 'UNSUPPORTED_VARIANT');
  let offset = 8,
    count = 0;
  while (offset < reader.size) {
    requireFormat(++count <= 4096, 'WebAssembly section count exceeds limit', 'FORMAT_LIMIT');
    const b = await reader.read(offset, Math.min(6, reader.size - offset));
    const id = b[0] ?? 255;
    let size = 0,
      bytes = 1,
      done = false;
    for (; bytes < b.length; bytes++) {
      const v = b[bytes] ?? 0;
      requireFormat(bytes < 5 || v <= 15, 'WebAssembly section length overflows u32');
      size += (v & 127) * 2 ** ((bytes - 1) * 7);
      if ((v & 128) === 0) {
        bytes++;
        done = true;
        break;
      }
    }
    requireFormat(done && size <= reader.size - offset - bytes, 'Truncated WebAssembly section');
    if (id > 13)
      warning(result, 'UNSUPPORTED_VARIANT', 'Unrecognized WebAssembly section; payload not interpreted');
    result.sections.push({ type: id, offset: offset + bytes, size });
    offset += bytes + size;
  }
  result.header = { sectionCount: count };
}
