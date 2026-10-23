import type { CpuArch } from '@phoenix/contracts';
import { address, decodeUtf8, FORMAT_LIMITS, inBounds, requireFormat, uint, warning } from './reader.js';
import type { FormatInspection, FormatReader } from './reader.js';

export async function parseElf(reader: FormatReader, result: FormatInspection): Promise<void> {
  const ident = await reader.read(0, 16);
  const bits = ident[4] === 1 ? 32 : ident[4] === 2 ? 64 : undefined;
  requireFormat(
    bits !== undefined && (ident[5] === 1 || ident[5] === 2),
    'Unsupported ELF class or byte order',
    'UNSUPPORTED_VARIANT',
  );
  requireFormat(ident[6] === 1, 'Unsupported ELF identification version', 'UNSUPPORTED_VARIANT');
  const little = ident[5] === 1;
  const wide = bits === 64;
  const headerSize = wide ? 64 : 52;
  const h = await reader.read(0, headerSize);
  const u16 = (o: number): number => uint(h, o, 2, little);
  const word = (o: number): number => uint(h, o, wide ? 8 : 4, little);
  requireFormat(
    uint(h, 20, 4, little) === 1 && u16(wide ? 52 : 40) >= headerSize && u16(wide ? 52 : 40) <= reader.size,
    'Invalid ELF header version or size',
  );
  const machine = u16(18),
    type = u16(16),
    osabi = ident[7] ?? 0;
  const arches: Readonly<Record<number, CpuArch>> = {
    3: 'x86',
    62: 'x64',
    40: 'arm',
    183: 'arm64',
    243: wide ? 'riscv64' : 'other',
  };
  result.details = {
    format: 'elf',
    class: wide ? 'elf64' : 'elf32',
    data: little ? 'lsb' : 'msb',
    osabi,
    type,
    machine,
    entry: address(h, 24, wide ? 8 : 4, little),
  };
  result.platform = {
    os: osabi === 9 ? 'freebsd' : osabi === 0 || osabi === 3 ? 'linux' : 'unknown',
    osBasis: osabi === 0 ? 'assumed' : 'header',
    arches: [arches[machine] ?? 'other'],
    bitness: bits,
    endianness: little ? 'little' : 'big',
    binaryType:
      type === 1
        ? 'object'
        : type === 2
          ? 'executable'
          : type === 3
            ? 'unknown'
            : type === 4
              ? 'core'
              : 'unknown',
  };
  if (osabi === 0)
    warning(
      result,
      'AMBIGUOUS_OS',
      'ELF System V ABI does not establish the operating system; Linux is a provisional assumption',
    );
  if (ident.subarray(8, 11).equals(Buffer.from([65, 73, 2])))
    warning(result, 'APPIMAGE', 'AppImage marker; payload not unpacked');
  const phsize = u16(wide ? 54 : 42),
    phnum = u16(wide ? 56 : 44),
    shsize = u16(wide ? 58 : 46),
    shnum = u16(wide ? 60 : 48),
    shstr = u16(wide ? 62 : 50);
  // ELF says e_phoff is undefined when e_phnum is zero; do not even convert an unused u64.
  const phoff = phnum === 0 ? 0 : word(wide ? 32 : 28),
    shoff = word(wide ? 40 : 32);
  result.header = {
    headerSize: u16(wide ? 52 : 40),
    programOffset: phoff,
    programCount: phnum,
    programEntrySize: phsize,
    sectionOffset: shoff,
    sectionCount: shnum,
    sectionEntrySize: shsize,
    sectionNameIndex: shstr,
    abiVersion: ident[8] ?? 0,
    flags: uint(h, wide ? 48 : 36, 4, little),
  };
  requireFormat(
    phnum !== 0xffff && shstr !== 0xffff && !(shnum === 0 && shoff !== 0),
    'Extended ELF numbering is not supported',
    'UNSUPPORTED_VARIANT',
  );
  for (const [offset, stride, count, minimum] of [
    [phoff, phsize, phnum, wide ? 56 : 32],
    [shoff, shsize, shnum, wide ? 64 : 40],
  ]) {
    requireFormat(
      count !== undefined && offset !== undefined && stride !== undefined && minimum !== undefined,
      'Invalid table',
    );
    requireFormat(count <= FORMAT_LIMITS.tableEntries, 'ELF table count exceeds limit', 'FORMAT_LIMIT');
    requireFormat(
      count === 0 ||
        (offset >= headerSize &&
          stride >= minimum &&
          stride <= 256 &&
          inBounds(offset, stride * count, reader.size)),
      'ELF table outside file or invalid stride',
    );
  }
  const programs = await reader.read(phoff, phnum * phsize);
  for (let i = 0; i < phnum; i++) {
    const p = programs.subarray(i * phsize, (i + 1) * phsize);
    const ptype = uint(p, 0, 4, little),
      offset = uint(p, wide ? 8 : 4, wide ? 8 : 4, little),
      size = uint(p, wide ? 32 : 16, wide ? 8 : 4, little);
    requireFormat(inBounds(offset, size, reader.size), 'ELF program segment outside file');
    if (ptype === 3) {
      requireFormat(
        size >= 2 && size <= 4096 && result.details.interpreter === undefined,
        'Invalid or duplicate ELF interpreter',
      );
      const name = await reader.read(offset, size);
      requireFormat(
        name[name.length - 1] === 0 && !name.subarray(0, -1).includes(0),
        'ELF interpreter lacks a unique final terminator',
      );
      const interpreter = decodeUtf8(name.subarray(0, -1), { ignoreBOM: true });
      requireFormat(
        interpreter.startsWith('/') && !/[\x00-\x1f\x7f]/.test(interpreter),
        'ELF interpreter is not an absolute loader path',
      );
      result.details.interpreter = interpreter;
      if (type === 3) result.platform.binaryType = 'executable';
    }
  }
  const sections = await reader.read(shoff, shnum * shsize);
  let strings: Buffer = Buffer.alloc(0);
  if (shstr !== 0) {
    requireFormat(shstr < shnum, 'Invalid ELF section-name table index');
    const s = sections.subarray(shstr * shsize, (shstr + 1) * shsize);
    requireFormat(uint(s, 4, 4, little) === 3, 'ELF section-name table is not a string table');
    const size = uint(s, wide ? 32 : 20, wide ? 8 : 4, little);
    requireFormat(size <= 1_048_576, 'ELF section-name table exceeds limit', 'FORMAT_LIMIT');
    strings = await reader.read(uint(s, wide ? 24 : 16, wide ? 8 : 4, little), size);
  }
  for (let i = 0; i < shnum; i++) {
    const s = sections.subarray(i * shsize, (i + 1) * shsize);
    const stype = uint(s, 4, 4, little),
      offset = uint(s, wide ? 24 : 16, wide ? 8 : 4, little),
      size = uint(s, wide ? 32 : 20, wide ? 8 : 4, little);
    requireFormat(stype === 8 || inBounds(offset, size, reader.size), 'ELF section outside file');
    const nameOffset = uint(s, 0, 4, little);
    let name: string | undefined;
    if (strings.length > 0) {
      requireFormat(nameOffset < strings.length, 'ELF section name outside string table');
      const end = strings.indexOf(0, nameOffset);
      requireFormat(end >= nameOffset && end - nameOffset <= 4096, 'Invalid ELF section name');
      name = decodeUtf8(strings.subarray(nameOffset, end), { ignoreBOM: true });
    }
    result.sections.push({
      type: stype,
      offset,
      size,
      address: address(s, wide ? 16 : 12, wide ? 8 : 4, little),
      ...(name === undefined ? {} : { name }),
    });
    if (name === '.note.android.ident') {
      result.kind = 'android';
      result.platform.os = 'android';
      result.platform.osBasis = 'header';
    }
  }
}
