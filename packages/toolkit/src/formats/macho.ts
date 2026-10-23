import type { CpuArch } from '@phoenix/contracts';
import { FORMAT_LIMITS, inBounds, requireFormat, uint, warning } from './reader.js';
import type { FormatInspection, FormatReader } from './reader.js';

export function machoArch(cpu: number): CpuArch {
  return (
    ({ 7: 'x86', 12: 'arm', 16777223: 'x64', 16777228: 'arm64' } as Readonly<Record<number, CpuArch>>)[cpu] ??
    'other'
  );
}
export async function parseMachO(reader: FormatReader, result: FormatInspection): Promise<void> {
  const first = await reader.read(0, 4),
    magic = first.readUInt32BE(0);
  const little = magic === 0xcefaedfe || magic === 0xcffaedfe;
  const wide = magic === 0xfeedfacf || magic === 0xcffaedfe;
  const length = wide ? 32 : 28,
    h = await reader.read(0, length);
  const u = (o: number): number => uint(h, o, 4, little);
  const cpu = u(4),
    fileType = u(12),
    count = u(16),
    commandSize = u(20);
  result.details = {
    format: 'macho',
    cpuType: cpu,
    cpuSubtype: u(8),
    fileType,
    loadCommandCount: count,
    flags: u(24),
    bits: wide ? 64 : 32,
  };
  result.platform = {
    os: 'macos',
    osBasis: 'assumed',
    arches: [machoArch(cpu)],
    bitness: wide ? 64 : 32,
    endianness: little ? 'little' : 'big',
    binaryType:
      fileType === 1
        ? 'object'
        : fileType === 2
          ? 'executable'
          : fileType === 4
            ? 'core'
            : fileType === 6
              ? 'shared-library'
              : fileType === 8
                ? 'bundle'
                : 'unknown',
  };
  result.header = { headerSize: length, loadCommandBytes: commandSize };
  requireFormat(
    count <= FORMAT_LIMITS.tableEntries && commandSize <= 4 * 1024 ** 2,
    'Mach-O load commands exceed limits',
    'FORMAT_LIMIT',
  );
  requireFormat(
    inBounds(length, commandSize, reader.size) && count <= Math.floor(commandSize / 8),
    'Mach-O load commands outside file',
  );
  const commands = await reader.read(length, commandSize);
  let offset = 0;
  for (let i = 0; i < count; i++) {
    requireFormat(inBounds(offset, 8, commands.length), 'Truncated Mach-O load command');
    const cmd = uint(commands, offset, 4, little),
      size = uint(commands, offset + 4, 4, little);
    requireFormat(
      size >= 8 && size % (wide ? 8 : 4) === 0 && inBounds(offset, size, commands.length),
      'Invalid Mach-O load command size',
    );
    const c = commands.subarray(offset, offset + size);
    if (cmd === 0x24 || cmd === 0x32) {
      requireFormat(size >= (cmd === 0x32 ? 24 : 16), 'Truncated Mach-O platform command');
      const macos = cmd === 0x24 || uint(c, 8, 4, little) === 1;
      result.platform.os = macos ? 'macos' : 'unknown';
      result.platform.osBasis = 'header';
    }
    if (cmd === 1 || cmd === 0x19) {
      const segment64 = cmd === 0x19,
        fixed = segment64 ? 72 : 56;
      requireFormat(size >= fixed, 'Truncated Mach-O segment');
      const fileOffset = uint(c, segment64 ? 40 : 32, segment64 ? 8 : 4, little),
        fileSize = uint(c, segment64 ? 48 : 36, segment64 ? 8 : 4, little),
        sections = uint(c, segment64 ? 64 : 48, 4, little);
      requireFormat(inBounds(fileOffset, fileSize, reader.size), 'Mach-O segment outside file');
      requireFormat(
        sections <= FORMAT_LIMITS.tableEntries && sections * (segment64 ? 80 : 68) <= size - fixed,
        'Mach-O section table outside command',
      );
      result.sections.push({
        name: c.subarray(8, 24).toString('ascii').replace(/\0.*$/s, ''),
        type: cmd,
        offset: fileOffset,
        size: fileSize,
      });
    }
    offset += size;
  }
  requireFormat(offset === commands.length, 'Mach-O command count and size disagree');
  if (result.platform.osBasis === 'assumed')
    warning(result, 'AMBIGUOUS_OS', 'Mach-O without an OS load command is provisionally treated as macOS');
}
export async function parseFatMachO(reader: FormatReader, result: FormatInspection): Promise<void> {
  const h = await reader.read(0, 8),
    magic = h.readUInt32BE(0);
  const little = magic === 0xbebafeca || magic === 0xbfbafeca,
    wide = magic === 0xcafebabf || magic === 0xbfbafeca;
  const count = uint(h, 4, 4, little),
    stride = wide ? 32 : 20;
  requireFormat(
    count >= 1 && count <= 19,
    'Fat Mach-O architecture count exceeds supported range',
    'FORMAT_LIMIT',
  );
  const tableEnd = 8 + count * stride,
    table = await reader.read(8, count * stride);
  const arches: { cpuType: number; cpuSubtype: number; offset: number; size: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = table.subarray(i * stride, (i + 1) * stride);
    const cpuType = uint(a, 0, 4, little),
      cpuSubtype = uint(a, 4, 4, little),
      offset = uint(a, 8, wide ? 8 : 4, little),
      size = uint(a, wide ? 16 : 12, wide ? 8 : 4, little),
      align = uint(a, wide ? 24 : 16, 4, little);
    requireFormat(
      align <= 32 &&
        offset % 2 ** align === 0 &&
        offset >= tableEnd &&
        size >= 28 &&
        inBounds(offset, size, reader.size),
      'Invalid fat Mach-O slice bounds or alignment',
    );
    requireFormat(
      !arches.some((x) => offset < x.offset + x.size && x.offset < offset + size),
      'Overlapping fat Mach-O slices',
    );
    const slice = await reader.read(offset, 28),
      smagic = slice.readUInt32BE(0),
      slittle = smagic === 0xcefaedfe || smagic === 0xcffaedfe;
    requireFormat(
      [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(smagic) &&
        uint(slice, 4, 4, slittle) === cpuType &&
        uint(slice, 8, 4, slittle) === cpuSubtype,
      'Fat slice header disagrees with architecture table',
    );
    requireFormat(
      inBounds(smagic === 0xfeedfacf || smagic === 0xcffaedfe ? 32 : 28, uint(slice, 20, 4, slittle), size),
      'Fat slice load commands outside slice',
    );
    arches.push({ cpuType, cpuSubtype, offset, size });
  }
  result.details = { format: 'macho-fat', arches };
  result.header = { architectureCount: count, tableEntrySize: stride };
  result.platform = {
    os: 'macos',
    osBasis: 'assumed',
    arches: [...new Set(arches.map((a) => machoArch(a.cpuType)))],
  };
  warning(
    result,
    'AMBIGUOUS_OS',
    'Universal Mach-O slices identified; OS and load-command contents are not fully validated',
  );
}
