# WP3 independent-review corrections

Date: 2026-10-22. Owner: unassigned (D-014 OPEN). Scope: WP3 correction patch only. Governing specification remains SOT **v1.0.2**; [ADR-0009](adr/ADR-0009-wp3-eligibility-and-url-identity.md) records the explicitly owner-approved policy. No WP4/WP5 or later implementation was started.

**Result:** all seven required commands pass on **Linux Node 26.8.1 and Node 24.11.0**. Both runtimes execute **890 tests in 24 files: 0 failed, 0 skipped**, normally and with coverage. All 737 existing tests are retained, plus 153 hardening regressions. Eight targeted source mutations and a canary are detected on both runtimes. WP3 is ready for its commit/review, with actual Windows/macOS execution still pending.

## Confirmed defects and corrections

| Finding                       | Reproduction and correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1: PIE identity              | Before the patch, both compiled ELF fixtures and read-only inspection of `/usr/bin/ls` returned shared-library despite PT_INTERP. All three now report executable with validated supported structure. ET_EXEC remains executable. ET_DYN without distinguishing evidence stays unknown, since absence of an interpreter does not establish library identity or exclude static PIE. PT_INTERP must be bounded, unique, nonempty, UTF-8, absolute and uniquely NUL-terminated; malformed cases invalidate structure. No binary was executed. |
| M2: malformed compatibility   | ELF/PE could retain OS/CPU/type after a failed table check and still appear eligible. Toolkit-local structuralStatus now records validated/incomplete/invalid supported checks. Format faults preserve partial facts and explicit warnings, but omit successful structural parsing signals. File and directory/application compatibility receive this status independently of warning truncation. Omitted status defaults to incomplete/unknown. Truncated directory inventories cannot confer compatibility.                              |
| M3: conservative policy       | Owner-approved ADR-0009 formalizes unknown for OSABI-0 Linux assumptions, unparsed universal Mach-O executable/platform evidence, missing validity/identity and unknown host CPUs. Compatibility requires explicit executable identity plus supported validation and established OS/CPU evidence. This is eligibility information, never a loader/execution guarantee or authorization. Existing optimistic examples are labeled historical in the plan. No full fat-slice analyzer was added.                                             |
| ZIP sentinel bypass           | A plain central entry with local offset 0xffffffff previously contributed APK evidence. A sentinel now requires a bounded ZIP64 extra field; missing/malformed fields reject as malformed. Properly declared but unsupported per-entry ZIP64 values produce incomplete metadata and cannot identify APK/JAR. They are not silently treated as validated offsets.                                                                                                                                                                           |
| ZIP ambiguity                 | Complete, supported and portable identities are required for APK/JAR classification. Duplicate names after NFC, separator/dot normalization and conservative case folding produce ARCHIVE_NAME_AMBIGUOUS and withhold package identity. Unsafe traversal/absolute/Windows reserved/ADS/control/bidi names, unknown encodings, encryption and incomplete sampling also withhold identity. Metadata and warnings remain bounded; nothing is extracted or inflated.                                                                           |
| URL privacy                   | Previously JSON serialization retained userinfo/query/fragment secrets. `targetIdentityUrl` and intake now return only normalized HTTP(S) origin/path, in both url and displayName. Every query and fragment is omitted, including signed URLs. URL_ACCESS_CONTEXT_REMOVED explicitly says this is **not an equivalent retrievable source**. Exact access context belongs in future protected handling, never ordinary manifest url/uri fields. No network request is made.                                                                |
| Warning cap                   | An extension warning could increase 32 parser warnings to 33. File classification now combines sources, deterministically prioritizes structural faults and mismatch, then caps the final list at **32**. A full buffer cannot hide the fatal parser diagnostic.                                                                                                                                                                                                                                                                           |
| Secondary parser/error issues | Leading HTML comments and head are recognized with a bounded linear scan; zero-count ELF program offsets are ignored rather than converted/read. UTF-8/JSON failures become FormatFault only at their decoding sites; arbitrary reader/programming TypeError, SyntaxError and RangeError propagate instead of being mislabeled malformed input. Matching unknown CPU labels also cannot produce compatible.                                                                                                                                |

`structuralStatus: validated` means the supported bounded metadata checks completed; it does not certify complete format conformance, OS loader acceptance or every runtime dependency. Shared TargetDescription schemas remain unchanged: public descriptions carry failure warnings and conservative compatibility, while the richer local inspection outcome is available to toolkit callers.

## Policy and documentation

Accepted [ADR-0009](adr/ADR-0009-wp3-eligibility-and-url-identity.md) records the explicit approval from the current review-corrections instruction. Existing ADRs are untouched. SOT implementation/decision/changelog references, the M0 plan and toolkit README link the policy; SOT stays **1.0.2** because no shared schema or product architecture changes.

The plan preserves the old optimistic examples as history, then states current behavior. Tests use real parser results for OSABI-0 and fat Mach-O uncertainty and real compiled PIE evidence; manually constructed policy-matrix cases explicitly supply validation outcomes rather than imply that headers alone prove validity.

WP4 must persist sanitized intake identity URLs in **both url and HTTP(S) uri**, never reconstruct them from raw credential-bearing inputs, and must not merge sources merely because sanitized identities match. Distinct query-dependent resources can share an identity. Schema shape/protocol validation alone does not sanitize arbitrary caller-built manifests. Future network workflows must obtain protected access context separately; they must not silently fetch a query-stripped substitute. No vault, fetcher or persistence code is added here.

The original [WP3 results](WP3_RESULTS.md) are labeled a historical baseline; their old readiness statement and PIE/privacy limitations are superseded by this report.

## Files changed in this correction task

Production:

- `formats/{elf,inspect,reader,data-json,asar,text,zip}.ts`: PIE/header handling, explicit structural outcome, narrow decoding faults, HTML and ZIP identity checks.
- `intake/{classify-file,classify-dir,inventory,compatibility,describe}.ts`: capped diagnostics, validation propagation, conservative eligibility and private URL handling.
- New `intake/url.ts`; toolkit `src/index.ts` exports the helper and StructuralStatus type.

Tests/tooling:

- New `packages/toolkit/test/wp3-hardening.test.ts` (153 tests).
- Existing `formats-native.test.ts` retains its unsafe-offset assertion with a nonzero program count, because a zero-count offset is undefined. Existing manual compatibility cases supply explicit validation; expected outcomes are retained. `formats-fixtures.test.ts` adds native binaryType lock checks and a sanitized URL golden/serialization assertion.
- New `scripts/review-wp3-mutations.ts` operates only on disposable copies and refuses to count import/compilation failures as successful mutation detection.
- `scripts/fixtures/build-data.ts` and `tests/fixtures/fixtures.lock.json` add native binaryType expectations; no fixture bytes/hashes change.
- The one WP3 golden snapshot and fixture README.

Documentation: this report, accepted ADR-0009, WP3 baseline banner, toolkit README, M0 plan and SOT references.

Paths above under formats/intake are relative to `packages/toolkit/src/`. The existing uncommitted WP3 tree, binary attributes, native fixtures, tree-hash callback and package boundaries were preserved. No dependency, lockfile, contract/schema snapshot, accepted prior decision, system package or Git remote changed.

## Regression and reproduction outcomes

New regressions cover:

- Both real compiled PIE fixtures, ET_EXEC, inconclusive ET_DYN, six malformed interpreter variants, unused offsets and real-parser compatibility policy.
- An actual Electron directory with a PIE main executable, then real mutation of that main; invalid native metadata cannot confer application-level eligibility.
- **103 realistic section-offset mutations** of intact compiled ELF64/PE32+ fixtures (52 ELF, 51 PE). Each asserts invalid supported structure, MALFORMED_FORMAT, preserved x64 observations, no successful parsing signal, a schema-valid description and unknown compatibility on a matching host. These are 103 Vitest tests, distinct from the retained prefix/random probes.
- Basic-style URL userinfo, access-token queries, signed URLs and fragments. Serialized descriptions and the golden contain none of the supplied secret values. Public queries are also deliberately removed. HTTP(S)-only checks and throwing fetch spies remain in place.
- Exact ZIP offset-sentinel bypass, bounded valid-unsupported and malformed ZIP64 extra fields, duplicate/Unicode/case/separator ambiguity, unsafe portable names and final 32-warning boundaries.
- HTML comments/head and bounded repeated-comment input; arbitrary programming errors after the initial head read. Real-file/no-write/no-execution assertions and all existing WP2/WP3 tests continue to execute.

The pre-fix reproductions were rerun against the built corrected package: both fixtures and `/usr/bin/ls` are executable/validated with **unknown** Linux eligibility due to OSABI-0; malformed ELF/PE return invalid/unknown; invalid ZIP offset returns unknown kind; the credential-bearing URL serializes to `https://example.com/app` without the supplied secret.

## Fixtures and golden changes

All **18 existing fixture sizes and SHA-256 values** and all **three directory locks** are unchanged, compared directly against the task-start lock and verified by fixture tests on both runtimes. No binary generation was performed in this task.

Eight native/spoof lock entries add binaryType assertions: six executable entries (including the ELF copy), one Mach-O object and one WASM unknown type. The original fixture bytes remain the evidence.

The reviewed golden diff contains exactly:

1. Three existing classifierVersion strings change from 1.0.0-wp3 to **1.0.1-wp3**, recording changed classification/cache rules.
2. A fourth URL input containing synthetic credentials/query/fragment produces only a safe origin/path and the explicit access-context-removal warning.

Existing PE header facts, directory digest/inventory and ordinary URL results otherwise stay unchanged. The **97 established JSON Schema snapshots are checked without regeneration**.

## Actual verification

Development ran focused Vitest suites, `pnpm typecheck`, `pnpm lint`, Prettier on changed files, build/reproduction probes, fixture-lock/golden comparisons and Git status/diff/check. The Node 26 mutation subprocess was initially denied by the sandbox with EPERM; the disposable-copy check was rerun outside it with the required OS capabilities. The final suites likewise execute outside the sandbox so preserved real socket/process tests can run.

Every requested command was then executed sequentially on **both** existing runtimes:

```sh
pnpm check
pnpm build
pnpm test
pnpm test:coverage
pnpm contracts:check
pnpm boundaries
pnpm licenses:check
```

Node 26 is system **v26.8.1**; Node 24 is the existing **v24.11.0** at `/tmp/phoenix-node24/node_modules/node-linux-x64/bin/node`, selected through per-process PATH. `pnpm exec node --version` verified each selection; nothing was installed or downgraded.

| Check           | Linux Node 26.8.1                         | Linux Node 24.11.0 |
| --------------- | ----------------------------------------- | ------------------ |
| check / build   | PASS                                      | PASS               |
| test            | 890 passed, 0 failed, 0 skipped; 24 files | Same               |
| test:coverage   | 890 passed, unchanged coverage gates pass | Same               |
| contracts:check | 97 unchanged snapshots verified           | Same               |
| boundaries      | PASS                                      | PASS               |
| licenses:check  | 145 installed packages pass               | Same               |

Final logs and JSON summaries are local ignored artifacts under `/tmp/phoenix-wp3-hardening-node{24,26}-*`. Original 737 tests and prior semantic assertions remain; none were skipped/removed to make this patch pass.

Coverage counters agree on both runtimes; percentages aggregate covered/total and truncate to two decimals:

| Scope     | Lines              | Statements         | Functions        | Branches           |
| --------- | ------------------ | ------------------ | ---------------- | ------------------ |
| Formats   | 527/529 (99.62%)   | 570/578 (98.61%)   | 41/41 (100%)     | 535/574 (93.20%)   |
| Intake    | 153/154 (99.35%)   | 166/168 (98.80%)   | 26/26 (100%)     | 188/197 (95.43%)   |
| Toolkit   | 1221/1247 (97.91%) | 1330/1377 (96.58%) | 169/172 (98.25%) | 1148/1247 (92.06%) |
| Contracts | 275/276 (99.63%)   | 297/299 (99.33%)   | 50/50 (100%)     | 210/213 (98.59%)   |

Overall: **98.22% lines, 97.07% statements, 98.64% functions, 93.01% branches**. Coverage is not a complete conformance/security proof.

### Focused source mutations

Executed with `node scripts/review-wp3-mutations.ts <output.json>` under both runtimes. Baseline: **153/153 passing tests**; independent URL canary detected. Each mutant is applied separately in a temporary copy, restored, and tested without snapshot regeneration. All 153 tests must actually execute; import/compilation failures cannot count as kills.

| Deliberate regression                  | Result, both runtimes | Failing tests |
| -------------------------------------- | --------------------- | ------------- |
| PIE classified unknown                 | detected              | 4             |
| Structural compatibility guard removed | detected              | 105           |
| Assumed OS guard removed               | detected              | 2             |
| False successful structure signal      | detected              | 109           |
| ZIP sentinel-validation bypass         | detected              | 5             |
| Ambiguous ZIP entries trusted          | detected              | 18            |
| Original URL access context retained   | detected              | 5             |
| Final warning cap off by one           | detected              | 1             |
| Independent URL canary                 | detected              | 5             |

**Eight of eight targeted source mutations detected, zero survivors.** These tests address the reported patterns; this is not exhaustive mutation coverage of every parser.

## Remaining limitations and readiness

- **Actual execution is Linux only.** Windows/macOS paths/compatibility simulations are not host validation. No hosted CI was triggered/observed for this uncommitted patch; formal WP3 cross-platform acceptance remains pending GitHub Actions and relevant teammate hosts.
- ZIP is bounded metadata inspection with no extraction, inflation, CRC/content/package authenticity verification. Per-entry ZIP64 values, legacy/extra-field name decoding and multivolume archives remain unsupported. Large archives can amplify reads/stat checks through WP2 verified ranges; no performance optimization or latency guarantee is claimed.
- Universal Mach-O slice contents/executable/platform evidence remain unparsed. Thin Mach-O OS handling currently covers LC_VERSION_MIN_MACOSX and LC_BUILD_VERSION; unsupported commands cannot establish OS certainty. ELF static PIE/dynamic flag and richer platform inference remain future work. No full loader was implemented.
- WP2 metadata/race/hard-link limitations remain. Hashes describe read bytes, not an atomic hostile-writer snapshot. Exact URL access context and sensitive path identifiers require future protected handling; identity URLs are not equivalent sources or complete cache keys.
- **WP3 is ready for its commit/review** with these platform gates recorded. **WP4 and WP5 can begin safely after the correction commit**, enforcing the ADR-0009 persistence/eligibility requirements above. Neither package was begun. ADR-0007 remains proposed before WP6; contributor/distribution/owner assignments remain existing project issues.

**Separate pre-existing Git change:** `packages/toolkit/test/process-lifecycle.test.ts` contains the Windows CI error-normalization additions. Its task-start and final diffs are byte-identical. It was neither modified nor staged here and **must be excluded from the WP3 commit and committed separately**. No commit, push, publication or remote mutation was performed.
