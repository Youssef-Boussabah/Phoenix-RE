/** Original byte builders. These are structural test inputs, not compiler-produced programs. */
export function elf(bits: 32 | 64 = 32, little = false): Buffer {
  const b = Buffer.alloc(bits === 64 ? 64 : 52);
  b.set([127, 69, 76, 70, bits === 32 ? 1 : 2, little ? 1 : 2, 1, 3]);
  const u16 = (value: number, o: number): void => {
    if (little) b.writeUInt16LE(value, o);
    else b.writeUInt16BE(value, o);
  };
  const u32 = (value: number, o: number): void => {
    if (little) b.writeUInt32LE(value, o);
    else b.writeUInt32BE(value, o);
  };
  u16(2, 16);
  u16(bits === 32 ? 8 : 62, 18);
  u32(1, 20);
  if (bits === 64) {
    if (little) b.writeBigUInt64LE(0xffffffffffffffffn, 24);
    else b.writeBigUInt64BE(0xffffffffffffffffn, 24);
  } else u32(0x8048000, 24);
  u16(b.length, bits === 64 ? 52 : 40);
  return b;
}
export function pe(wide = false, clr = true): Buffer {
  const b = Buffer.alloc(1024),
    optional = 88,
    length = wide ? 240 : 224,
    section = optional + length;
  b.write('MZ');
  b.writeUInt32LE(64, 60);
  b.write('PE\0\0', 64);
  b.writeUInt16LE(wide ? 0x8664 : 0x14c, 68);
  b.writeUInt16LE(1, 70);
  b.writeUInt16LE(length, 84);
  b.writeUInt16LE(2, 86);
  b.writeUInt16LE(wide ? 0x20b : 0x10b, optional);
  b.writeUInt32LE(512, optional + 60);
  b.writeUInt16LE(3, optional + 68);
  b.writeUInt32LE(16, optional + (wide ? 108 : 92));
  b.write('.text', section);
  b.writeUInt32LE(512, section + 8);
  b.writeUInt32LE(0x1000, section + 12);
  b.writeUInt32LE(512, section + 16);
  b.writeUInt32LE(512, section + 20);
  if (clr) {
    const directory = optional + (wide ? 112 : 96) + 14 * 8;
    b.writeUInt32LE(0x1000, directory);
    b.writeUInt32LE(72, directory + 4);
    b.writeUInt32LE(72, 512);
  }
  return b;
}
export function elfTables(bits: 32 | 64, little: boolean): Buffer {
  const wide = bits === 64,
    phoff = wide ? 64 : 52,
    phsize = wide ? 56 : 32,
    shsize = wide ? 64 : 40,
    shoff = phoff + phsize,
    stringsOffset = shoff + 3 * shsize;
  const names = Buffer.from('\0.shstrtab\0.note.android.ident\0'),
    interpreter = Buffer.from('/lib/original\0'),
    dataOffset = stringsOffset + names.length;
  const b = Buffer.alloc(dataOffset + interpreter.length);
  elf(bits, little).copy(b);
  const u16 = (v: number, o: number): void => {
    if (little) b.writeUInt16LE(v, o);
    else b.writeUInt16BE(v, o);
  };
  const u32 = (v: number, o: number): void => {
    if (little) b.writeUInt32LE(v, o);
    else b.writeUInt32BE(v, o);
  };
  const word = (v: number, o: number): void => {
    if (!wide) u32(v, o);
    else if (little) b.writeBigUInt64LE(BigInt(v), o);
    else b.writeBigUInt64BE(BigInt(v), o);
  };
  word(phoff, wide ? 32 : 28);
  word(shoff, wide ? 40 : 32);
  for (const [o, v] of [
    [wide ? 54 : 42, phsize],
    [wide ? 56 : 44, 1],
    [wide ? 58 : 46, shsize],
    [wide ? 60 : 48, 3],
    [wide ? 62 : 50, 1],
  ] as const)
    u16(v, o);
  u32(3, phoff);
  word(dataOffset, phoff + (wide ? 8 : 4));
  word(interpreter.length, phoff + (wide ? 32 : 16));
  u32(1, shoff + shsize);
  u32(3, shoff + shsize + 4);
  word(stringsOffset, shoff + shsize + (wide ? 24 : 16));
  word(names.length, shoff + shsize + (wide ? 32 : 20));
  u32(11, shoff + 2 * shsize);
  u32(7, shoff + 2 * shsize + 4);
  word(dataOffset, shoff + 2 * shsize + (wide ? 24 : 16));
  names.copy(b, stringsOffset);
  interpreter.copy(b, dataOffset);
  return b;
}
export function macho(wide = true, little = true, cpu = wide ? 0x100000c : 7, subtype = 0): Buffer {
  const b = Buffer.alloc(wide ? 32 : 28);
  const u = (v: number, o: number): void => {
    if (little) b.writeUInt32LE(v, o);
    else b.writeUInt32BE(v, o);
  };
  u(wide ? 0xfeedfacf : 0xfeedface, 0);
  u(cpu, 4);
  u(subtype, 8);
  u(2, 12);
  return b;
}
export function fat(wide = false, little = false): Buffer {
  const b = Buffer.alloc(160),
    stride = wide ? 32 : 20;
  const u = (v: number, o: number): void => {
    if (little) b.writeUInt32LE(v, o);
    else b.writeUInt32BE(v, o);
  };
  const big = (v: number, o: number): void => {
    if (little) b.writeBigUInt64LE(BigInt(v), o);
    else b.writeBigUInt64BE(BigInt(v), o);
  };
  u(wide ? 0xcafebabf : 0xcafebabe, 0);
  u(2, 4);
  for (const [i, cpu] of [0x1000007, 0x100000c].entries()) {
    const o = 8 + i * stride,
      offset = 96 + i * 32;
    u(cpu, o);
    u(0, o + 4);
    if (wide) {
      big(offset, o + 8);
      big(32, o + 16);
      u(5, o + 24);
    } else {
      u(offset, o + 8);
      u(32, o + 12);
      u(5, o + 16);
    }
    macho(true, true, cpu).copy(b, offset);
  }
  return b;
}
export function javaClass(): Buffer {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(0xcafebabe);
  b.writeUInt16BE(65, 6);
  b.writeUInt16BE(1, 8);
  return b;
}
export function dex(): Buffer {
  const b = Buffer.alloc(112);
  b.write('dex\n039\0');
  b.writeUInt32LE(112, 32);
  b.writeUInt32LE(112, 36);
  b.writeUInt32LE(0x12345678, 40);
  return b;
}
export function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zip(names: readonly string[], zip64 = false): Buffer {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const n = Buffer.from(name),
      data = Buffer.from('original PHOENIX fixture\n'),
      crc = crc32(data);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(0x800, 6);
    l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(data.length, 18);
    l.writeUInt32LE(data.length, 22);
    l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    locals.push(l, n, data);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(zip64 ? 0xffff : names.length, 8);
  end.writeUInt16LE(zip64 ? 0xffff : names.length, 10);
  end.writeUInt32LE(zip64 ? 0xffffffff : cd.length, 12);
  end.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  if (!zip64) return Buffer.concat([...locals, cd, end]);
  const z = Buffer.alloc(56),
    locator = Buffer.alloc(20);
  z.writeUInt32LE(0x06064b50);
  z.writeBigUInt64LE(44n, 4);
  z.writeUInt16LE(45, 12);
  z.writeUInt16LE(45, 14);
  z.writeBigUInt64LE(BigInt(names.length), 24);
  z.writeBigUInt64LE(BigInt(names.length), 32);
  z.writeBigUInt64LE(BigInt(cd.length), 40);
  z.writeBigUInt64LE(BigInt(offset), 48);
  locator.writeUInt32LE(0x07064b50);
  locator.writeBigUInt64LE(BigInt(offset + cd.length), 8);
  locator.writeUInt32LE(1, 16);
  return Buffer.concat([...locals, cd, z, locator, end]);
}
export function asar(
  header: unknown = {
    files: {
      'index.js': { size: 0, offset: '0' },
      nested: { files: { 'package.json': { size: 0, offset: '0' } } },
    },
  },
): Buffer {
  const json = Buffer.from(JSON.stringify(header)),
    size = 8 + Math.ceil(json.length / 4) * 4,
    b = Buffer.alloc(size + 8);
  b.writeUInt32LE(4);
  b.writeUInt32LE(size, 4);
  b.writeUInt32LE(size - 4, 8);
  b.writeUInt32LE(json.length, 12);
  json.copy(b, 16);
  return b;
}
export function syntheticInputs(): Buffer[] {
  const badPe = pe();
  badPe.writeUInt32LE(0xfffffff0, 60);
  return [
    elf(),
    elfTables(32, false),
    elfTables(64, true),
    elf(64),
    elf(64, true),
    pe(),
    pe(true, false),
    badPe,
    macho(),
    macho(false, false),
    fat(),
    fat(true),
    javaClass(),
    dex(),
    zip(['AndroidManifest.xml', 'classes.dex']),
    zip(['META-INF/MANIFEST.MF'], true),
    asar(),
    Buffer.from('\ufeffconst answer = 42;'),
    Buffer.from('#!/usr/bin/env python3\nprint(42)'),
  ];
}
