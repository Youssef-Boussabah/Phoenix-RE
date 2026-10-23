#!/usr/bin/env bash
# Optional developer-only regeneration. CI consumes checked-in bytes instead.
set -euo pipefail
cd "$(dirname "$0")/../../tests/fixtures/native"
clang -O1 -fuse-ld=lld -nostdlib -Wl,-e,main -Wl,--build-id=none -o hello-linux-x64.elf src/hello.c
clang --target=i386-unknown-linux-gnu -O1 -fuse-ld=lld -nostdlib -Wl,-e,main -Wl,--build-id=none -o hello-linux-x86.elf src/hello.c
clang --target=x86_64-pc-windows-msvc -O1 -fuse-ld=lld -nostdlib -Wl,/entry:main -Wl,/subsystem:console -Wl,/timestamp:0 -o hello-windows-x64.exe src/hello.c
clang --target=i686-pc-windows-msvc -O1 -fuse-ld=lld -nostdlib -Wl,/entry:main -Wl,/subsystem:console -Wl,/timestamp:0 -o hello-windows-x86.exe src/hello.c
clang --target=arm64-apple-macos13 -O1 -fuse-ld=lld -nostdlib -Wl,-e,_main -Wl,-no_uuid -Wl,-no_adhoc_codesign -o hello-macos-arm64.macho src/hello.c
clang --target=arm64-apple-macos13 -O1 -c -o hello-macos-arm64.o src/hello.c
clang --target=wasm32 -O1 -nostdlib -Wl,--no-entry -Wl,--export-all -o hello.wasm src/hello.c
