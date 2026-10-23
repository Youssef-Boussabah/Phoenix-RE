# Original PHOENIX WP3 fixtures

All source, byte builders and generated data here are independently authored PHOENIX fixtures under the repository MIT license. No downloaded target executables or REA code are included. Programs are **never executed** by classification or fixture tests.

`fixtures.lock.json` records every fixture file's exact size, SHA-256 and independently specified expected kind/format/CPU and native binaryType. WP3 hardening adds these expectations without changing fixture bytes or hashes. It additionally pins the approved tree digests of three directory fixtures. Tests consume these checked-in bytes on all operating systems; CI needs no cross-compiler. Text files remain LF-normalized; `.gitattributes` names each actual binary explicitly. Symlinks are created only in temporary test directories.

## Provenance and regeneration

Generated on Linux, 2026-10-22, using installed clang **22.1.8**, LLVM lld **22.1.8** and Node **26.8.1**. No system packages were installed. From the repository root:

```sh
bash scripts/fixtures/build-native.sh
pnpm build
node scripts/fixtures/build-data.ts
pnpm exec prettier --write tests/fixtures/fixtures.lock.json
pnpm exec vitest run --project unit packages/toolkit/test/formats-fixtures.test.ts
```

Review byte/hash differences before changing the lock. Toolchain versions and linkers can change output; regeneration is a deliberate developer operation. The native script records the exact commands, strips nondeterministic PE timestamps/Mach-O UUIDs, uses no CRT/libc (`-nostdlib`), and never runs the results. Its freestanding entry point is not a demonstration runtime program. The same installed toolchain reproduces the pinned native bytes.

| Files                                | Provenance                                                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `native/hello-linux-{x64,x86}.elf`   | ELF64/ELF32 linked from our `native/src/hello.c`                                                                                                |
| `native/hello-windows-{x64,x86}.exe` | PE32+/PE32 cross-linked from the same C                                                                                                         |
| `native/hello-macos-arm64.{macho,o}` | arm64 Mach-O executable and relocatable object from the same C                                                                                  |
| `native/hello.wasm`                  | wasm32 binary compiled/linked from the same C                                                                                                   |
| `misc/elf-named.png`                 | Exact copy of our ELF64; extension spoof                                                                                                        |
| `misc/png-named.exe`                 | Original 1×1 RGBA PNG; generator builds chunks and CRCs                                                                                         |
| `misc/sample.{zip,jar,apk}`          | Original ZIP stored entries, local headers, central directory and CRCs; JAR/APK fixtures test container names, not executable Java/Android code |
| `misc/empty.bin`                     | Zero bytes                                                                                                                                      |
| `dirs/source-node`                   | Our tiny source/manifest; its scripts are inert data                                                                                            |
| `dirs/static-site`                   | Our static HTML                                                                                                                                 |
| `dirs/electron-packaged`             | Structural Electron layout containing our generated, valid ASAR pickle/tree; not a runnable Electron installation                               |

`tests/support/synth.ts` supplies explicitly synthetic ELF big-endian/program/section inputs, PE CLR cases, thin/fat Mach-O, Java/DEX headers, ZIP/ZIP64, ASAR and text variants. They are **metadata fixtures**, not compiler-produced executable programs. Malformed variants, hostile counts/offsets, prefix truncations and seeded bytes are generated in memory, not mislabeled real binaries.

## Format references

Implementations are original; these primary format descriptions were consulted for layout facts:

- [System V ELF header](https://gabi.xinuos.com/elf/02-eheader.html)
- [Microsoft PE/COFF format](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format)
- [Apple Mach-O headers](https://github.com/apple-oss-distributions/xnu/blob/main/EXTERNAL_HEADERS/mach-o/loader.h)
- [WebAssembly binary format](https://webassembly.github.io/spec/core/binary/index.html)
- [Java class header](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-4.html)
- [Android DEX format](https://source.android.com/docs/core/runtime/dex-format)
- [PKWARE ZIP specification](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
- [Electron ASAR disk format](https://github.com/electron/asar/blob/main/src/disk.ts) and [pickle layout](https://github.com/electron/asar/blob/main/src/pickle.ts)
