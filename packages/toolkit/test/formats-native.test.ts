import { expect, it } from 'vitest';
import { FormatDetails } from '@phoenix/contracts';
import { inspectBytes } from '../src/index.js';
import { elf, elfTables, pe, macho, fat } from '../../../tests/support/synth.js';

it.each([32, 64] as const)('reads ELF%s program/section tables and Android note evidence', async (bits) => {
  for (const little of [true, false]) {
    const bytes = elfTables(bits, little),
      result = await inspectBytes(bytes);
    expect(result.details).toMatchObject({ interpreter: '/lib/original' });
    expect(result.platform?.os).toBe('android');
    expect(result.kind).toBe('android');
    expect(result.header).toMatchObject({ programCount: 1, sectionCount: 3, sectionNameIndex: 1 });
    expect(result.sections.map((s) => s.name)).toEqual(['', '.shstrtab', '.note.android.ident']);
    expect(result.warnings).toEqual([]);
    bytes[bytes.length - 1] = 65;
    expect((await inspectBytes(bytes)).warnings.map((w) => w.code)).toContain('MALFORMED_FORMAT');
  }
});
it('validates ELF section names and file-backed/NOBITS bounds', async () => {
  for (const [offset, value] of [
    [50, 9],
    [128, 1],
    [140, 0xfffffff0],
    [164, 9999],
    [180, 0xffffffff],
  ] as const) {
    const bytes = elfTables(32, true);
    if (offset === 50) bytes.writeUInt16LE(value, offset);
    else bytes.writeUInt32LE(value, offset);
    expect((await inspectBytes(bytes)).warnings.length).toBeGreaterThan(0);
  }
  const b = elfTables(32, true);
  b.writeUInt32LE(8, 168);
  b.writeUInt32LE(0xffffffff, 180);
  expect((await inspectBytes(b)).warnings).toEqual([]);
});
it('checks Mach-O load-command sizing and non-macOS platform metadata', async () => {
  for (const platform of [1, 2]) {
    const b = Buffer.concat([macho(), Buffer.alloc(24)]);
    b.writeUInt32LE(1, 16);
    b.writeUInt32LE(24, 20);
    b.writeUInt32LE(0x32, 32);
    b.writeUInt32LE(24, 36);
    b.writeUInt32LE(platform, 40);
    expect((await inspectBytes(b)).platform).toMatchObject({
      os: platform === 1 ? 'macos' : 'unknown',
      osBasis: 'header',
    });
    for (const size of [0, 12, 32]) {
      b.writeUInt32LE(size, 36);
      expect((await inspectBytes(b)).warnings.map((w) => w.code)).toContain('MALFORMED_FORMAT');
    }
  }
});

it.each([32, 64] as const)(
  'parses ELF%s in both byte orders without losing entry addresses',
  async (bits) => {
    for (const little of [true, false]) {
      const result = await inspectBytes(elf(bits, little));
      expect(result.details).toMatchObject({
        format: 'elf',
        class: bits === 64 ? 'elf64' : 'elf32',
        data: little ? 'lsb' : 'msb',
        entry: bits === 64 ? '0xffffffffffffffff' : '0x8048000',
      });
      expect(result.header).toMatchObject({ programCount: 0, sectionCount: 0 });
      expect(result.platform).toMatchObject({ os: 'linux', osBasis: 'header', bitness: bits });
      expect(result.warnings).toEqual([]);
      expect(FormatDetails.safeParse(result.details).success).toBe(true);
    }
  },
);
it('distinguishes ambiguous, FreeBSD and unknown ELF ABIs and AppImage', async () => {
  for (const [abi, os, basis] of [
    [0, 'linux', 'assumed'],
    [9, 'freebsd', 'header'],
    [255, 'unknown', 'header'],
  ] as const) {
    const b = elf();
    b[7] = abi;
    b.set([65, 73, 2], 8);
    const result = await inspectBytes(b);
    expect(result.platform).toMatchObject({ os, osBasis: basis, arches: ['other'] });
    expect(result.warnings.some((w) => w.code === 'AMBIGUOUS_OS')).toBe(abi === 0);
    expect(result.warnings.some((w) => w.code === 'APPIMAGE')).toBe(true);
  }
});
it.each([false, true])('parses PE (wide=%s), file sections, DLL and CLR metadata', async (wide) => {
  for (const clr of [false, true]) {
    const b = pe(wide, clr);
    b.writeUInt16LE(0x2002, 86);
    const result = await inspectBytes(b);
    expect(result.kind).toBe(clr ? 'dotnet' : 'pe');
    expect(result.details).toMatchObject({
      format: 'pe',
      magic: wide ? 'pe32+' : 'pe32',
      isDll: true,
      subsystem: 3,
      sectionCount: 1,
      hasClrHeader: clr,
    });
    expect(result.sections).toEqual([{ name: '.text', offset: 512, size: 512, address: '0x1000', type: 0 }]);
    expect(result.platform).toMatchObject({
      os: 'windows',
      arches: [wide ? 'x64' : 'x86'],
      binaryType: 'shared-library',
    });
    expect(result.warnings).toEqual([]);
  }
});
it.each([false, true])('parses Mach-O 32/64 bit and unsigned CPUs (little=%s)', async (little) => {
  for (const wide of [false, true])
    for (const cpu of [7, 12, 0x1000007, 0x100000c, 0x80000003]) {
      const result = await inspectBytes(macho(wide, little, cpu, 0x80000002));
      expect(result.details).toMatchObject({
        cpuType: cpu,
        cpuSubtype: 0x80000002,
        bits: wide ? 64 : 32,
        fileType: 2,
        loadCommandCount: 0,
      });
      expect(result.platform?.endianness).toBe(little ? 'little' : 'big');
      expect(FormatDetails.safeParse(result.details).success).toBe(true);
    }
});
it.each([false, true])(
  'parses fat Mach-O with 32/64 bit offsets and either byte order (wide=%s)',
  async (wide) => {
    for (const little of [false, true]) {
      const result = await inspectBytes(fat(wide, little));
      expect(result.details).toEqual({
        format: 'macho-fat',
        arches: [
          { cpuType: 0x1000007, cpuSubtype: 0, offset: 96, size: 32 },
          { cpuType: 0x100000c, cpuSubtype: 0, offset: 128, size: 32 },
        ],
      });
      expect(result.platform?.arches).toEqual(['x64', 'arm64']);
      expect(result.warnings.map((w) => w.code)).toEqual(['AMBIGUOUS_OS']);
    }
  },
);

const damaged: [string, () => Buffer, (b: Buffer) => void, string][] = [
  [
    'ELF header beyond EOF',
    () => elf(),
    (b) => {
      b.writeUInt16BE(65535, 40);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'ELF class',
    () => elf(),
    (b) => {
      b[4] = 3;
    },
    'UNSUPPORTED_VARIANT',
  ],
  [
    'ELF byte order',
    () => elf(),
    (b) => {
      b[5] = 0;
    },
    'UNSUPPORTED_VARIANT',
  ],
  [
    'ELF ident version',
    () => elf(),
    (b) => {
      b[6] = 2;
    },
    'UNSUPPORTED_VARIANT',
  ],
  [
    'ELF version',
    () => elf(),
    (b) => {
      b.writeUInt32BE(0, 20);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'ELF header size',
    () => elf(),
    (b) => {
      b.writeUInt16BE(0, 40);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'ELF extended count',
    () => elf(),
    (b) => {
      b.writeUInt16BE(0xffff, 44);
    },
    'UNSUPPORTED_VARIANT',
  ],
  [
    'ELF huge count',
    () => elf(),
    (b) => {
      b.writeUInt16BE(4097, 44);
    },
    'FORMAT_LIMIT',
  ],
  [
    'ELF invalid stride',
    () => elf(),
    (b) => {
      b.writeUInt16BE(1, 44);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'ELF unsafe integer',
    () => elf(64),
    (b) => {
      b.writeBigUInt64BE(0xffffffffffffffffn, 32);
      b.writeUInt16BE(1, 56); // Offset is meaningful only for a nonempty program table.
    },
    'MALFORMED_FORMAT',
  ],
  [
    'PE outside pointer',
    () => pe(),
    (b) => {
      b.writeUInt32LE(0xfffffff0, 60);
    },
    'DOS_STUB_ONLY',
  ],
  [
    'PE wrong signature',
    () => pe(),
    (b) => {
      b[64] = 1;
    },
    'DOS_STUB_ONLY',
  ],
  [
    'PE optional size',
    () => pe(),
    (b) => {
      b.writeUInt16LE(1, 84);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'PE optional truncation',
    () => pe(),
    (b) => {
      b.writeUInt16LE(90, 84);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'PE optional magic',
    () => pe(),
    (b) => {
      b.writeUInt16LE(3, 88);
    },
    'UNSUPPORTED_VARIANT',
  ],
  [
    'PE directory count',
    () => pe(),
    (b) => {
      b.writeUInt32LE(17, 180);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'PE section count',
    () => pe(),
    (b) => {
      b.writeUInt16LE(4097, 70);
    },
    'FORMAT_LIMIT',
  ],
  [
    'PE section bounds',
    () => pe(),
    (b) => {
      b.writeUInt32LE(1000, 332);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'PE CLR size',
    () => pe(),
    (b) => {
      b.writeUInt32LE(1, 300);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'PE CLR RVA',
    () => pe(),
    (b) => {
      b.writeUInt32LE(0xffffffff, 296);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'PE CLR header',
    () => pe(),
    (b) => {
      b.writeUInt32LE(71, 512);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'Mach huge load count',
    () => macho(),
    (b) => {
      b.writeUInt32LE(4097, 16);
    },
    'FORMAT_LIMIT',
  ],
  [
    'Mach outside commands',
    () => macho(),
    (b) => {
      b.writeUInt32LE(8, 20);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'Fat huge offsets',
    () => fat(true),
    (b) => {
      b.writeBigUInt64BE(0xffffffffffffffffn, 16);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'Fat overlapping slices',
    () => fat(),
    (b) => {
      b.writeUInt32BE(96, 36);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'Fat slice identity',
    () => fat(),
    (b) => {
      b.writeUInt32BE(7, 8);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'Fat bad alignment',
    () => fat(),
    (b) => {
      b.writeUInt32BE(33, 24);
    },
    'MALFORMED_FORMAT',
  ],
  [
    'Fat zero count',
    () => fat(true),
    (b) => {
      b.writeUInt32BE(0, 4);
    },
    'FORMAT_LIMIT',
  ],
];
it.each(damaged)('rejects %s safely', async (_name, build, damage, code) => {
  const b = build();
  damage(b);
  const result = await inspectBytes(b);
  expect(result.warnings.map((w) => w.code)).toContain(code);
});
