import type { CpuArch } from '@phoenix/contracts';
import { FORMAT_LIMITS, inBounds, requireFormat, uint } from './reader.js';
import type { FormatInspection, FormatReader } from './reader.js';

export async function parsePe(reader: FormatReader, result: FormatInspection): Promise<void> {
  const dos = await reader.read(0, 64);
  const peOffset = uint(dos, 60, 4, true);
  requireFormat(
    peOffset >= 64 && inBounds(peOffset, 24, reader.size),
    'MZ header has no bounded PE header',
    'DOS_STUB_ONLY',
  );
  const coff = await reader.read(peOffset, 24);
  requireFormat(coff.readUInt32LE(0) === 0x00004550, 'MZ file has no PE signature', 'DOS_STUB_ONLY');
  result.format = 'pe';
  result.kind = 'pe';
  const machine = coff.readUInt16LE(4),
    count = coff.readUInt16LE(6),
    optionalSize = coff.readUInt16LE(20),
    flags = coff.readUInt16LE(22);
  requireFormat(optionalSize >= 2 && optionalSize <= 4096, 'Invalid PE optional header size');
  const h = await reader.read(peOffset + 24, optionalSize);
  const magic = h.readUInt16LE(0),
    wide = magic === 0x20b;
  requireFormat(magic === 0x10b || wide, 'Unsupported PE optional header magic', 'UNSUPPORTED_VARIANT');
  const fixed = wide ? 112 : 96;
  requireFormat(h.length >= fixed, 'Truncated PE optional header');
  const directories = h.readUInt32LE(wide ? 108 : 92);
  requireFormat(
    directories <= Math.floor((h.length - fixed) / 8),
    'PE data directories exceed optional header',
  );
  const arches: Readonly<Record<number, CpuArch>> = {
    0x14c: 'x86',
    0x8664: 'x64',
    0x1c0: 'arm',
    0x1c4: 'arm',
    0xaa64: 'arm64',
    0x5064: 'riscv64',
  };
  result.details = {
    format: 'pe',
    machine,
    magic: wide ? 'pe32+' : 'pe32',
    characteristics: flags,
    isDll: (flags & 0x2000) !== 0,
    subsystem: h.readUInt16LE(68),
    sectionCount: count,
    timeDateStamp: coff.readUInt32LE(8),
    hasClrHeader: false,
  };
  result.platform = {
    os: 'windows',
    osBasis: 'header',
    arches: [arches[machine] ?? 'other'],
    bitness: wide ? 64 : 32,
    endianness: 'little',
    binaryType: flags & 0x2000 ? 'shared-library' : flags & 2 ? 'executable' : 'unknown',
  };
  result.header = {
    peOffset,
    optionalHeaderSize: optionalSize,
    entryPointRva: h.readUInt32LE(16),
    numberOfRvaAndSizes: directories,
    sizeOfHeaders: h.readUInt32LE(60),
  };
  requireFormat(count <= FORMAT_LIMITS.tableEntries, 'PE section count exceeds limit', 'FORMAT_LIMIT');
  const table = await reader.read(peOffset + 24 + optionalSize, count * 40);
  for (let i = 0; i < count; i++) {
    const s = table.subarray(i * 40, (i + 1) * 40);
    const offset = s.readUInt32LE(20),
      size = s.readUInt32LE(16);
    requireFormat(inBounds(offset, size, reader.size), 'PE section outside file');
    result.sections.push({
      name: s.subarray(0, 8).toString('ascii').replace(/\0.*$/s, ''),
      offset,
      size,
      type: s.readUInt32LE(36),
      address: '0x' + s.readUInt32LE(12).toString(16),
    });
  }
  if (directories > 14) {
    const rva = h.readUInt32LE(fixed + 14 * 8),
      size = h.readUInt32LE(fixed + 14 * 8 + 4);
    if (rva !== 0 || size !== 0) {
      requireFormat(rva !== 0 && size >= 72, 'Invalid CLR directory');
      let offset: number | undefined;
      if (inBounds(rva, size, h.readUInt32LE(60))) offset = rva;
      for (let i = 0; i < count; i++) {
        const s = table.subarray(i * 40, (i + 1) * 40),
          base = s.readUInt32LE(12);
        if (rva >= base && inBounds(rva - base, size, s.readUInt32LE(16)))
          offset = s.readUInt32LE(20) + rva - base;
      }
      requireFormat(offset !== undefined, 'CLR directory is not backed by file bytes');
      const clr = await reader.read(offset, 72);
      requireFormat(clr.readUInt32LE(0) >= 72 && clr.readUInt32LE(0) <= size, 'Invalid CLR header size');
      result.details.hasClrHeader = true;
      result.kind = 'dotnet';
    }
  }
}
