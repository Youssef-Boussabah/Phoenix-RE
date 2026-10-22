# WP2 platform implementation results

Date: 2026-10-22. Priority: P0. Owner: unassigned (D-014 OPEN). Scope: toolkit platform services only, governed by SOT v1.0.2, accepted ADRs 0001–0006/0008 and M0 plan §4.1/§7 WP2/§8.

**Result:** the platform implementation builds and passes every requested verification command on **Linux Node 26.8.1 and Node 24.11.0**. Both runtimes execute **578 tests in 16 files, with no failures or skips**: the existing 524 tests plus 54 toolkit tests. Formal WP2 three-OS acceptance remains **pending** because Windows, macOS and hosted CI were not executed. WP3 can begin against these locally validated services; no WP3 functionality was implemented.

> **Historical baseline:** This report records the initial WP2 implementation before independent-review corrections. Current behavior and verification are recorded in [WP2 hardening results](WP2_HARDENING_RESULTS.md). In particular, post-exit Windows taskkill, spawn normalization, environment override handling and logger behavior below are superseded. Baseline test counts remain historical.

## Components and files

Created `packages/toolkit`, with private package manifest, strict composite TypeScript project, package README and one public entry point. Source files:

```text
src/
  index.ts
  internal.ts
  ids.ts
  platform/host.ts
  platform/paths.ts
  platform/which.ts
  platform/process.ts
  fs/safe-read.ts
  hash/sha256.ts
  hash/tree.ts
  log/logger.ts
```

Implemented host OS/CPU/WSL/translation metadata, per-platform data-directory selection and PHOENIX_HOME; canonical/native path handling, containment and normalized-name resolution; read-only verified file handles and bounded range/stream access; branded UUIDv7 IDs; streaming SHA-256 and hash/tee; deterministic directory hashing; PATH/PATHEXT discovery and authorized version probes; bounded explicitly authorized process execution; redacted structured NDJSON diagnostics.

New tests: `packages/toolkit/test/{platform,filesystem,tree,process,ids-logging}.test.ts` and `test/support.ts` for real temporary directories and conditional symlink setup. New documentation: package README and this report.

Modified: `pnpm-lock.yaml`, `tsconfig.json`, `tsconfig.check.json`, `vitest.config.ts`, root README, CONTRIBUTING, M0 plan and canonical SOT. The documentation records implementation status without changing product commitments or accepting new architecture. The existing CI matrix already discovers the new package tests; its workflow is unchanged. The existing boundary checker already authorizes toolkit→contracts and confines process imports to platform/process.ts; its production rules did not need alteration and pass against actual toolkit sources. No existing tests were removed or weakened.

Runtime graph:

```text
@phoenix/toolkit → @phoenix/contracts → zod
```

No third-party dependency was added. The lockfile adds only the toolkit workspace importer. No contracts, schemas or accepted ADRs changed. The 97 existing schema snapshots were checked, never regenerated. ADR-0007 stays proposed, with approval required before WP6. No WP2 commit, remote initialization/change, push or publication occurred. The pre-existing foundation commit is preserved.

## Engineering choices

The package README documents each public service and its bounds. Important details:

- Paths retain original native filenames for I/O and use NFC POSIX names for identity. Canonical lookup scans native components (bounded to 50,000 names per component), resolves NFD names and rejects normalization ambiguity. Invalid Unicode/UTF-8, traversal and unsupported separators fail explicitly. Windows native validation rejects reserved device names, alternate streams, trailing dots/spaces and forbidden characters. Containment uses native path-relative semantics and realpath verification with lstat component checks; it preserves case instead of assuming a filesystem's case behavior.
- Regular-file reads use lstat, read-only handles, POSIX no-follow/nonblocking flags and fstat identity checks. Size, modification/change times, device/inode and mode are compared during inspection. Range reads cap at 1 MiB; streams use 64 KiB chunks. Iterators close handles on completion, failure, cancellation and early return. Explicitly opened handles remain caller-owned and require finally/close. A standalone file open validates its final component; directory callers must use the contained resolver first.
- UUIDv7 uses a 48-bit millisecond timestamp, correct version/variant and cryptographic random tail. A sequence preserves within-process order during same-millisecond generation or clock rollback; overflow advances logical time. IDs are not secrets.
- Tree hashing implements the approved JSON-array/LF record format exactly, with UTF-8 byte ordering, NFC collision checks and unmodified UTF-8 link payload hashing. Literal exclusions are sorted/deduplicated in the header and reported. Default limits are 50,000 visited entries and 4 GiB regular-file bytes. A limit produces INVENTORY_TRUNCATED and no digest. Links are recorded without traversal; special entries are O records and never opened. The walker does not classify formats or implement WP3 intake.
- The runner is constructed with explicit named workflow authorization, uses absolute file/cwd, argument arrays and shell:false, and refuses .bat/.cmd. It filters inherited and provided environment through the documented allowlist, excluding NODE_OPTIONS and secrets. Timeout, cancellation and combined output overflow reject with sanitized errors; normal nonzero exits preserve their exit code. Signal reporting extends the toolkit result structurally without altering shared ProcessResult. Retained output pipes have a 2.5-second cleanup deadline.
- Host detection never executes an imported target. Rosetta sysctl is optional through an explicitly supplied runner; missing translation information stays unknown. Executable lookup never launches candidates. Version probes require an authorized runner. Store Python aliases are filtered best effort.
- Logs use bounded detached contract sanitization plus logging-specific terminal/bidi escaping, credential/private-key/payload redaction and home/configured private-path masking. Default maximum NDJSON event size is 16 KiB; overflow becomes a small truncation record. No source or raw process output is logged automatically.

These are implementation details within approved scope; no shared or published contract changed and no new architectural decision was introduced. SOT remains v1.0.2. The accepted state table and job-time semantics were untouched.

## Real regression evidence

The new tests exercise:

- 10,000 same-clock UUIDs, uniqueness/order, exact version/variant/timestamp, all ID prefixes and clock rollback.
- Real host detection plus injected OS/translation inputs, per-OS data-directory rules, environment overrides and invalid paths.
- Actual long/non-ASCII temporary paths, NFD lookup, NFC/NFD directory equality, ambiguous normalization rejection, case-preserving behavior, traversal/drive/UNC and Windows reserved-path rules.
- Real symlinks, out-of-root links, FIFO, Unix socket and /dev/null rejection; directories/missing files; file edits/replacement/removal; large streaming reads; early-return/cancellation cleanup; real mutation inside the hash/tee sink and failure cleanup.
- Empty/abc/million-a SHA-256 vectors, independently written tree bytes, creation-order permutations, empty directories, link payloads, special-entry records, literal exclusions and honest byte/count truncation. Real LF/CR/tab/quote/control/Unicode names and invalid UTF-8 filenames are covered on Linux. Committed adversarial JSON record vectors retain backslash/NUL encoding checks; actual backslash names fail under the accepted path contract.
- Temporary PATH lookup, executable permissions, missing/empty/nonregular candidates, PATHEXT candidate order and Windows Store alias recognition. A real Node --version probe verifies controlled version discovery.
- Real Node subprocesses for separate streams, nonzero exits, signal reporting, cwd, literal shell-like arguments, environment isolation, pre/during cancellation, timeout and exact/overflow/zero output caps.
- Real descendant PIDs and heartbeat files for cancellation, timeout and parent exit, proving process termination (an already-exited Linux zombie counts as terminated). A deliberately escaped session tests the retained-pipe deadline; the test explicitly cleans that process and does not claim the runner contained it.
- Structured logging, level filtering, credential forms, private-key blocks, URLs, home/UNC/configured paths, control/ANSI/OSC/bidi handling, excessive fields and 20,000-level input without recursive overflow. A final regression ensures control escaping cannot expand serialized errors past the contracts’ 8192-character message bound.

Host/translation injection and Windows path simulations test deterministic policy behavior, not actual Windows/macOS execution. No mocked process outcome establishes the termination claims above.

## Commands actually executed

Substantive setup/development checks included `pnpm install --offline`, targeted `pnpm exec vitest run --project unit packages/toolkit/test`, `pnpm typecheck`, `pnpm lint`, `pnpm exec eslint packages/toolkit --fix`, Prettier on changed files, `pnpm check`, `pnpm build` and repeated coverage after substantive changes. Inspection included rg, file reads, Git status/log/remotes/diff, and aggregation of coverage-summary.json. No system toolchain was installed, removed or changed.

Final requested command set, each executed successfully under **both** runtimes:

```sh
pnpm check
pnpm build
pnpm test
pnpm test:coverage
pnpm contracts:check
pnpm boundaries
pnpm licenses:check
```

Node 26 used the existing system Node v26.8.1. Node 24 used the existing isolated binary, selected for each command without modifying system configuration:

```sh
env PATH=/tmp/phoenix-node24/node_modules/node-linux-x64/bin:$PATH pnpm <command>
env PATH=/tmp/phoenix-node24/node_modules/node-linux-x64/bin:$PATH pnpm exec node --version
# v24.11.0
```

A first isolated PATH omitted pnpm's user-local directory and exited 127; preserving the original PATH corrected it before the successful full run. The first offline install was blocked from opening pnpm's external store database; rerunning with approved store access succeeded with no downloads. A restricted test launch reported Unix-socket EPERM and empty process captures; the full suites were rerun with approved host process/socket access and passed. Intermediate strict type/lint issues were corrected. None of those restricted/failed attempts is reported as a passing validation.

## Test and coverage results

| Check                                                    | Linux Node 26.8.1  | Linux Node 24.11.0 |
| -------------------------------------------------------- | ------------------ | ------------------ |
| All seven requested commands                             | Pass               | Pass               |
| Strict typecheck, portable contracts, typed lint, format | Pass               | Pass               |
| Build                                                    | Pass               | Pass               |
| Runtime tests                                            | 578 pass, 16 files | 578 pass, 16 files |
| Failed/skipped tests                                     | 0 / 0              | 0 / 0              |
| Existing state/mode combinations                         | All 363 pass       | All 363 pass       |
| Unchanged JSON Schema snapshots                          | 97 verified        | 97 verified        |
| Actual source/manifest boundaries                        | Pass               | Pass               |
| Installed license metadata                               | 145 packages pass  | 145 packages pass  |
| Combined line / statement coverage                       | 95.55% / 94.66%    | 95.55% / 94.66%    |
| Combined function / branch coverage                      | 95.52% / 92.37%    | 95.52% / 92.37%    |

Per-package totals aggregate the file counters in coverage-summary.json (percentages truncated to two decimals, matching Vitest):

| Package   | Lines            | Statements       | Functions      | Branches         |
| --------- | ---------------- | ---------------- | -------------- | ---------------- |
| Contracts | 275/276 (99.63%) | 297/299 (99.33%) | 50/50 (100%)   | 210/213 (98.59%) |
| Toolkit   | 413/444 (93.01%) | 448/488 (91.80%) | 78/84 (92.85%) | 311/351 (88.60%) |

The contracts >=95% gates remain intact; toolkit has separate >=85% gates for all four metrics. Coverage includes executable platform code, including the locally unexecuted Windows termination branch. It does not measure type-only behavior or prove complete security/semantic correctness. Reports are generated locally under ignored coverage/. The eleven prior semantic mutation regressions run as part of the ordinary tests; the separate scratch-copy mutation harness was not rerun for WP2, since contracts did not change.

## Platform status, limitations and remaining work

- **Linux Node 24/26:** executed as above, all requested commands pass.
- **Windows/macOS/hosted CI:** not executed; no run links or pass claim. The existing matrix will run all toolkit tests when the changes are submitted. Real teammate-host validation is also pending.
- Genuine platform-specific conditions: POSIX FIFO/socket/device and signal tests skip on Windows; Windows post-parent-exit descendant tracking cannot be asserted with taskkill and has an explicit skip reason. Symlink privilege, case-insensitive filesystems and filesystems that normalize Unicode may prevent constructing specific adversarial fixtures and report why. Linux skipped none.
- POSIX process groups cannot contain a child that creates a new session. Windows taskkill is best effort; it cannot reliably track descendants after the parent exits and does not replace a Windows Job Object. A future hardened execution provider needs stronger OS isolation. Environment filtering is not network isolation or CPU/memory enforcement.
- File/realpath metadata checks reduce races but are not an atomic snapshot. Concurrent adversarial namespace changes or deliberately restored metadata remain possible. Use read-only snapshots/isolation for hostile writers. Equivalent portable trees hash identically by the documented bytes; three-OS filesystem validation remains outstanding, and unsupported names are rejected rather than renamed silently.
- Exclusions deliberately omit content; the header records them. Executable discovery is not binary validation. Translation and Store alias detection are best effort. Logger redaction recognizes documented patterns, not every possible secret; callers must not supply raw sensitive payloads. Default stderr uses Node buffering; caller-provided sinks own backpressure.
- ADR-0007 remains proposed and must be resolved before WP6. Ownership/benchmark decisions and pre-distribution provenance/license review remain open under existing decisions.

**WP3 readiness:** ready for format parsers, classification and intake to consume these services. Formal cross-platform WP2 acceptance and the full M0 exit condition remain open; no later work package is claimed complete. All WP2 changes are local and uncommitted.
