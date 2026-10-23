export type Signature =
  | 'empty'
  | 'elf'
  | 'dos'
  | 'macho'
  | 'macho-fat'
  | 'java-class'
  | 'wasm'
  | 'dex'
  | 'zip'
  | 'asar'
  | 'unknown';

/** Ordered byte signatures, never extension-based. MZ and archive matches require structural confirmation. */
export function detectSignature(head: Uint8Array, size: number): Signature {
  const b = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
  if (size === 0) return 'empty';
  if (b.subarray(0, 4).equals(Buffer.from([0x7f, 69, 76, 70]))) return 'elf';
  if (b.subarray(0, 2).toString('ascii') === 'MZ') return 'dos';
  const magic = b.length >= 4 ? b.readUInt32BE(0) : 0;
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(magic)) return 'macho';
  if ([0xcafebabe, 0xcafebabf].includes(magic)) {
    return magic === 0xcafebabf || (b.length >= 8 && b.readUInt32BE(4) >= 1 && b.readUInt32BE(4) <= 19)
      ? 'macho-fat'
      : 'java-class';
  }
  if (magic === 0xbebafeca || magic === 0xbfbafeca) return 'macho-fat';
  if (magic === 0x0061736d) return 'wasm';
  if (b.length >= 8 && /^dex\n\d{3}\0$/.test(b.subarray(0, 8).toString('latin1'))) return 'dex';
  if (magic === 0x504b0304 || magic === 0x504b0506 || magic === 0x504b0606) return 'zip';
  if (b.length >= 4 && b.readUInt32LE(0) === 4) return 'asar';
  return 'unknown';
}
