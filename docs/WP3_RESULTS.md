# WP3 formats, classification and intake results

Date: 2026-10-22. Priority: P0. Owner: unassigned (D-014 OPEN). Governing documents: SOT v1.0.2, accepted ADRs 0001–0006/0008 and M0 plan `3.3, `4.1, WP3, `7.4 and `8.

**Result:** WP3 is implemented and ready for independent review. All seven requested checks pass on **Linux Node 26.8.1 and Node 24.11.0**. Each runtime executes **737 tests in 23 files, 0 failed, 0 skipped**, both normally and with coverage. The four WP3 test files contribute **124 tests**; the other 613 tests also execute unchanged, including the process-lifecycle additions already present at task start. **WP4 can begin** against these interfaces. This does not declare three-OS acceptance, M0-Foundation, or the complete M0 product exit finished.

> **Historical baseline:** The metrics and implementation descriptions below record WP3 before independent-review corrections. Current PIE, structural-validity, compatibility, ZIP identity, warning-cap and URL privacy behavior is recorded in [WP3 hardening results](WP3_HARDENING_RESULTS.md) and [accepted ADR-0009](adr/ADR-0009-wp3-eligibility-and-url-identity.md). The original readiness statement is superseded by that report.

## Implemented components

Everything remains inside `@phoenix/toolkit`. The runtime dependency graph is unchanged:

```text
@phoenix/toolkit → @phoenix/contracts → zod
```

- Bounded signature and structure inspection for ELF32/64 (little/big endian), PE32/PE32+, thin Mach-O32/64 and universal/fat Mach-O (including 64-bit offsets and swapped headers), WASM v1, Java class headers, DEX, ZIP/JAR/APK, ASAR, UTF-8 text/source and HTML.
- Native metadata: ELF ABI/machine/type/hex entry, table offsets/counts/strides, program/section bounds, section names, interpreter and Android/AppImage markers; PE machine/optional-header class/DLL/subsystem/section metadata and bounded CLR identification; Mach-O unsigned CPU/subtype, file type, flags, OS commands, load-command/segment metadata and multiple slices.
- Reusable byte-source inspection, file classification with a streamed SHA-256, directory inventories/format histograms and explainable classification signals. Root/nested macOS bundles, packaged Electron layouts, source ecosystem markers, static sites and unknown trees have deterministic rules. Explicit native executables take precedence over bundled libraries when choosing application platform metadata.
- Validated `TargetDescription` objects, separate intake host/target platform and conservative compatibility policy. URLs are recognized without DNS or network access; no target or configuration script is executed.
- Read-only intake using WP2 handles, path normalization/containment, literal exclusions, symlink/special-file policy and the existing exact `phoenix-tree-sha256-v1` algorithm. An optional range-inspection callback extends the existing walker so parsing and hashing share its verified handle. Stream/close ownership remains with the walker, including callback failures.

See the [toolkit API and parser limits](../packages/toolkit/README.md#format-inspection-and-intake-wp3) for exact capabilities. These are functioning metadata parsers, **not full loader/VM validators, decompilers or archive extractors**.

## Files created and modified

New production modules:

```text
packages/toolkit/src/formats/
  reader.ts signature.ts inspect.ts data-json.ts
  elf.ts pe.ts macho.ts wasm.ts dex.ts javaclass.ts zip.ts asar.ts text.ts
packages/toolkit/src/intake/
  classify-file.ts classify-dir.ts inventory.ts compatibility.ts describe.ts
```

New tests and fixtures:

- `packages/toolkit/test/{formats-native,formats-data,formats-fixtures,intake}.test.ts`.
- `packages/toolkit/test/__snapshots__/formats-fixtures.test.ts.snap`: one reviewed golden array of file, directory and URL descriptions, normalizing only local path/time.
- `tests/support/synth.ts`: original, explicitly synthetic structural/adversarial byte builders.
- `scripts/fixtures/build-native.sh` and `scripts/fixtures/build-data.ts`.
- `tests/fixtures/native/`: seven compiler-produced binaries plus our C source.
- `tests/fixtures/misc/`: our PNG/ELF extension spoofs, empty file and ZIP/JAR/APK containers.
- `tests/fixtures/dirs/{source-node,static-site,electron-packaged}/`.
- `tests/fixtures/fixtures.lock.json` and `tests/fixtures/README.md`.
- This report.

Modified: toolkit `src/hash/tree.ts` and `src/index.ts`, precise binary `.gitattributes` entries, toolkit/root READMEs, M0 plan implementation record and SOT implementation-status paragraph. No manifest, dependency lockfile, shared contract, JSON Schema snapshot, TS project graph, CI workflow or accepted ADR was changed.

The repository started at **ea23049 — fix(toolkit): handle Windows process and path portability** with an existing uncommitted change to `packages/toolkit/test/process-lifecycle.test.ts`. That change was preserved and is not a WP3 edit. No commit, staging, push, publication, remote change, system-package installation or unrelated-project modification was performed.

## Engineering decisions and clarifications

1. **Reuse WP2 rather than add a walker.** Range parsing occurs before the same handle streams its hash; the existing before/after/final metadata checks still apply. Callback failure/cancellation closes the handle. The approved hash record bytes are unchanged, as verified by existing vectors and locked directory digests.
2. **Byte/structure evidence wins.** MZ alone is not PE. ASAR requires consistent pickle/JSON/tree/payload structure. PE CLR pointers must map to a bounded CLI header. ZIP entry names are checked against bounded local headers where supported, preventing fabricated central names from silently yielding APK classification. Text extensions only influence already-recognized text. Unknown/empty inputs have explicit heuristic signals.
3. **Conservative compatibility.** Static metadata inspection works across hosts. An assumed ELF System V→Linux mapping is labeled and does not establish native compatibility. Rosetta requirements are policy information, not proof of installation. Object/library/core metadata cannot authorize execution. Mixed x86 DLL/x64 executable fixtures exercise executable precedence.
4. **Respect included inventory.** Excluded entries do not provide directory classification signals; a Git-only tree with the default excluded `.git` therefore remains unknown. Package JSON is data only, ≤1 MiB/depth 64; invalid root manifests still supply a probable source marker with a warning, while an Electron package-layout rule requires valid JSON. These clarifications are recorded in the plan.
5. **Bound work and output explicitly.** Shared metadata-read budget 36 MiB/file; first head 64 KiB, text prefix 8 KiB, WP2 ranges ≤1 MiB. Native tables/commands are capped, ZIP names sampled, ASAR header ≤32 MiB/tree ≤10,000/depth ≤64. File offsets/sizes must be safe integers; 64-bit addresses stay hex strings. Directory warning selection is sorted and bounded independently of creation order.
6. **No architectural migration.** All outputs validate against current contracts; no schema/version change or new ADR is needed. SOT remains **1.0.2** with an implementation-status link. ADR-0007 remains proposed and must be resolved before WP6.

During implementation, regression tests exposed/corrected contradictory DEX empty-data offsets, ELF declared headers extending beyond EOF, potential DLL-before-executable platform selection, and lone-surrogate path substitution by Node. The latter reuses WP2 Unicode validation without rewriting native NFD paths; a real U+FFFD-named file proves an invalid surrogate input cannot silently inspect another file. Explicit positive/negative tests now cover each; no assertions were weakened.

## Fixture provenance and reproducibility

All fixture source/builders are original PHOENIX code under the repository MIT license. No proprietary/downloaded target executables, REA code or runtime dependency was introduced. The [fixture README](../tests/fixtures/README.md) records exact commands, primary format references, ownership and regeneration policy.

The installed Linux clang/lld **22.1.8** toolchain built real ELF64/x64, ELF32/x86, PE32+/x64, PE32/x86, arm64 Mach-O executable/object and wasm32 fixtures from our C, without CRT/libc. A second execution of `bash scripts/fixtures/build-native.sh` reproduced the pinned native SHA-256 values; the fixture test verified them without regenerating the lock. No generated binary was executed.

The lock covers **18 fixture files and three directory tree digests**. JAR/APK fixtures are real generated ZIP containers with original entry payloads and identifying names, not compiled/runnable Java or Android applications. The Electron layout is structural with a valid generated ASAR, not a runnable Electron installation. Synthetic Java/DEX/native edge headers are labeled as such. Cross-platform CI consumes committed bytes without invoking clang. Only the actual binary fixture paths have binary Git attributes; source, JSON, HTML and documentation retain LF text rules.

Data generation was followed by intentional fixture text formatting and lock/golden updates. Positive fixture expectations, hashes, runtime validation, semantic negatives and independent WP2 tree vectors remain separate gates; snapshot regeneration alone was not treated as validation.

## Tests and commands actually executed

Development commands included `pnpm typecheck`, `pnpm lint`, targeted `pnpm exec vitest run --project unit packages/toolkit/test/...` runs, Prettier on the listed changed files, `bash scripts/fixtures/build-native.sh` (twice), `pnpm build`, `node scripts/fixtures/build-data.ts`, `pnpm exec prettier --write tests/fixtures/fixtures.lock.json` and targeted WP3 `--update` only for its new golden snapshot. Git status/log/diff/check-ignore inspections and compiler/runtime version checks were read-only.

The final command set was executed sequentially under **each** runtime:

```sh
pnpm check
pnpm build
pnpm test
pnpm test:coverage
pnpm contracts:check
pnpm boundaries
pnpm licenses:check
```

Node 26 uses existing system **v26.8.1**. Node 24 uses the existing isolated binary selected per process:

```sh
env PATH=/tmp/phoenix-node24/node_modules/node-linux-x64/bin:$PATH pnpm <command>
```

`pnpm exec node --version` verified the selected runtime in both final loops. Plain logs and per-runtime coverage summaries were saved under `/tmp/phoenix-wp3-node{24,26}-*`, outside Git.

| Check                  | Linux Node 26.8.1                                        | Linux Node 24.11.0 |
| ---------------------- | -------------------------------------------------------- | ------------------ |
| `pnpm check`           | PASS: format, lint, types, boundaries, schemas, licenses | PASS               |
| `pnpm build`           | PASS                                                     | PASS               |
| `pnpm test`            | 737 passed, 0 failed, 0 skipped; 23 files                | Same               |
| `pnpm test:coverage`   | 737 passed, 0 failed, 0 skipped; unchanged gates pass    | Same               |
| `pnpm contracts:check` | 97 existing schemas verified, no regeneration            | Same               |
| `pnpm boundaries`      | PASS, including new source imports                       | PASS               |
| `pnpm licenses:check`  | PASS, 145 installed packages                             | Same               |

The initial sandbox coverage attempt failed **six preserved WP2 tests**: Unix socket creation was denied with EPERM and subprocess output capture was restricted. The complete suite was rerun with the required real OS capabilities outside the sandbox; it passed on both runtimes. An initial new DEX negative test and an intermediate lint check also failed during development and were corrected before the final runs. Final results above are actual executions, not suppression of those failures.

New tests exercise:

- Real compiled fixtures, expected hashes/architectures, real read-only bytes/mtime checks and locked directory digests.
- ELF32/64 endian variants, 64-bit entry preservation, interpreter/program/section tables, Android note names, ABI uncertainty/AppImage, table/count/stride/name/offset/header bounds and NOBITS.
- PE32/+, executable/DLL/CLR, section/header/directory/CLR bounds; Mach-O thin/fat, unsigned high-bit CPUs/subtypes, swapped/fat64 forms, alignment/overlap/identity and load-command errors.
- WASM section-length overflow/truncation/count limits; Java/DEX headers and invalid endian/size/table/version combinations.
- ZIP/JAR/APK entry-based identification, ZIP64, central/local corruption, unsupported encodings/encryption/path names, bounded sampling, ASAR pickles/tree/payload limits, 20,000-level JSON, links/external references, UTF-8/BOM/shebang/HTML and invalid/binary controls.
- **19,676 prefix inspections** (every length 0…min(size,4096) for all 18 locked files plus 19 synthetic inputs) and **2,000 seeded adversarial buffers**, in a grouped robustness test. These are probe counts, not additional Vitest test counts.
- Source ecosystem and directory precedence, macOS/Electron layouts, cross-host compatibility policy, no fetch for URL recognition, no target execution, no target writes, exclusions/symlinks/truncation, real changed-file detection through the callback, Unicode paths, metadata beyond the initial cache, bounded/deterministic warnings and cancellation.

## Coverage

Both runtime JSON summaries agree. Percentages below aggregate covered/total counters and truncate to two decimals, rather than averaging file percentages.

| Scope          | Lines              | Statements         | Functions        | Branches           |
| -------------- | ------------------ | ------------------ | ---------------- | ------------------ |
| Formats        | 476/478 (99.58%)   | 512/519 (98.65%)   | 37/37 (100%)     | 497/536 (92.72%)   |
| Intake         | 139/141 (98.58%)   | 152/154 (98.70%)   | 23/23 (100%)     | 168/177 (94.91%)   |
| Entire toolkit | 1156/1183 (97.71%) | 1258/1304 (96.47%) | 162/165 (98.18%) | 1090/1189 (91.67%) |
| Contracts      | 275/276 (99.63%)   | 297/299 (99.33%)   | 50/50 (100%)     | 210/213 (98.59%)   |

Overall V8 summary: lines **98.08%**, statements **97%**, functions **98.6%**, branches **92.72%**. WP3's ≥85% formats/intake line gate and existing package gates all pass without being weakened. Coverage and seeded probes do not prove complete format conformance or filesystem race freedom.

## Platform status, limitations and remaining work

- **Actual WP3 execution: Linux only**, under both requested Node versions. Windows/macOS compatibility matrices are deterministic policy tests on Linux, not real-host validation. The existing hosted three-OS workflow will discover these tests/bytes; it was not triggered or observed for this patch. Previous WP2 CI status does not establish WP3 acceptance. Teammate Windows/macOS execution and hosted CI remain required.
- ELF extended numbering/complete note semantics/PIE distinction, complete Mach-O fat slice validation, modern WASM feature/memory64/component analysis, full Java/DEX validation and DEX041 containers remain unsupported. Format recognition is bounded metadata, not proof that a loader accepts or executes a file.
- ZIP reads metadata only: no decompression, CRC/authenticity/package validation, multivolume support or full ZIP64 per-entry/legacy-name decoding. Unsupported features warn; samples retain their truncated status. ASAR links/unpacked content are never followed. No application is unpacked.
- Read-only handles and realpath/metadata checks reduce races; they are not an atomic snapshot. Same-size/same-timestamp or restored-metadata changes, hard-link aliases, writers after final verification and excluded content retain WP2's documented limitations. Hashes describe bytes read, not an immutable hostile namespace.
- Single-file hashing streams to EOF with caller cancellation; directory byte/entry budgets are enforced by the walker. `maxSnapshotBytes` belongs to future snapshot persistence and has no effect in stateless WP3. No provider/HTTP envelope is implemented; future consumers must honor JSON/output limits and store large inventories/metadata as artifacts.
- Compatibility does not verify loaders, emulators, dependencies or permission to execute. Local paths and original URLs can be sensitive; future remote serialization must strip local paths and apply its disclosure/redaction policy.
- No new architectural decision, dependency or shared-contract defect remains blocking WP4. Accepted owner/distribution review items and proposed ADR-0007 remain open on their existing schedule. No WP4+ functionality was started.

**Readiness:** ready for independent WP3 review. WP4 can safely begin using the verified contracts/toolkit interfaces; final cross-platform WP3 acceptance remains conditional on actual Windows/macOS runs. No WP3 commit was made.
