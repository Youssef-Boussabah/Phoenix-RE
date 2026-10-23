import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asar, crc32, zip } from '../../tests/support/synth.ts';
import { hashDirectory } from '../../packages/toolkit/dist/index.js';

const root = fileURLToPath(new URL('../../tests/fixtures/', import.meta.url));
const pngChunk = (type: string, data: Buffer): Buffer => {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1);
ihdr.writeUInt32BE(1, 4);
ihdr[8] = 8;
ihdr[9] = 6;
await writeFile(
  path.join(root, 'misc/png-named.exe'),
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 42, 84, 126, 255]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]),
);
await copyFile(path.join(root, 'native/hello-linux-x64.elf'), path.join(root, 'misc/elf-named.png'));
await writeFile(path.join(root, 'misc/empty.bin'), Buffer.alloc(0));
await writeFile(path.join(root, 'misc/sample.zip'), zip(['notes.txt']));
await writeFile(path.join(root, 'misc/sample.jar'), zip(['META-INF/MANIFEST.MF', 'Original.class']));
await writeFile(path.join(root, 'misc/sample.apk'), zip(['AndroidManifest.xml', 'classes.dex']));
await writeFile(path.join(root, 'dirs/electron-packaged/resources/app.asar'), asar());

const expectations: [string, string, string, string[], string?][] = [
  ['native/hello-linux-x64.elf', 'elf', 'elf', ['x64'], 'executable'],
  ['native/hello-linux-x86.elf', 'elf', 'elf', ['x86'], 'executable'],
  ['native/hello-windows-x64.exe', 'pe', 'pe', ['x64'], 'executable'],
  ['native/hello-windows-x86.exe', 'pe', 'pe', ['x86'], 'executable'],
  ['native/hello-macos-arm64.macho', 'macho', 'macho', ['arm64'], 'executable'],
  ['native/hello-macos-arm64.o', 'macho', 'macho', ['arm64'], 'object'],
  ['native/hello.wasm', 'wasm', 'wasm', ['wasm32'], 'unknown'],
  ['native/src/hello.c', 'source', 'text', []],
  ['misc/png-named.exe', 'unknown', 'unknown', []],
  ['misc/elf-named.png', 'elf', 'elf', ['x64'], 'executable'],
  ['misc/empty.bin', 'unknown', 'empty', []],
  ['misc/sample.zip', 'unknown', 'zip', []],
  ['misc/sample.jar', 'unknown', 'jar', []],
  ['misc/sample.apk', 'android', 'apk', []],
  ['dirs/electron-packaged/resources/app.asar', 'electron', 'asar', []],
  ['dirs/source-node/package.json', 'unknown', 'text', []],
  ['dirs/source-node/index.js', 'source', 'text', []],
  ['dirs/static-site/index.html', 'web', 'html', []],
];
const files = [];
for (const [relative, kind, format, arches, binaryType] of expectations) {
  const data = await readFile(path.join(root, relative));
  files.push({
    path: relative,
    sha256: createHash('sha256').update(data).digest('hex'),
    size: data.length,
    expected: { kind, format, arches, ...(binaryType === undefined ? {} : { binaryType }) },
  });
}
const directories = [];
for (const [name, kind] of [
  ['source-node', 'source'],
  ['static-site', 'web'],
  ['electron-packaged', 'electron'],
] as const) {
  const relative = `dirs/${name}`,
    tree = await hashDirectory(path.join(root, relative));
  directories.push({
    path: relative,
    algorithm: tree.algorithm,
    digest: tree.digest,
    expected: { kind, format: 'directory' },
  });
}
await writeFile(
  path.join(root, 'fixtures.lock.json'),
  JSON.stringify({ schemaVersion: 1, files, directories }, null, 2) + '\n',
);
