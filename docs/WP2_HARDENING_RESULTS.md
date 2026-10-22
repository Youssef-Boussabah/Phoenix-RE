# WP2 independent-review hardening results

Date: 2026-10-22. Scope: targeted corrections following the supplied Claude Opus 5.5 **PASS WITH FIXES** review. Priority: P0. Owner remains unassigned (D-014 OPEN).

**Result:** all requested checks pass on **Linux Node 26.8.1 and Node 24.11.0**, with **606 tests in 19 files, zero failed or skipped**. This preserves the 578-test WP2 baseline and adds 28 cases. The toolkit's 82 tests include real filesystem/process regressions and explicitly labeled Windows event simulations. WP2 is ready for its Git commit/review and WP3 can begin. Formal Windows/macOS/hosted-CI acceptance remains pending. Nothing was committed, pushed or published.

## Findings and corrections

| Finding                         | Evidence and correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows post-exit termination   | The baseline exit handler called the same stop function as timeout/abort; that function unconditionally initiated tree termination. The runner now tracks observed exit/close, checks exitCode/signalCode, starts cleanup once and preserves the first failure. Normal Windows exit never initiates taskkill, and late timeout/abort cannot schedule it. Live-child timeout/cancel/output overflow still initiate bounded termination. POSIX retains detached-group cleanup after parent exit. Windows lifecycle tests simulate these events on Linux; no Windows OS execution is claimed.                                            |
| Raw synchronous spawn exception | A real Linux invocation with a 4 MiB argument reproduced raw Error/E2BIG. The same reproduction now yields PhoenixError/INVALID_REQUEST with details `{phase: 'spawn', systemCode: 'E2BIG'}`. Synchronous and asynchronous launch errors use safe OS-code context only. EINVAL maps to INVALID_REQUEST; ENOEXEC maps to NOT_SUPPORTED; other launch errors map to PROVIDER_FAILED. Arguments/environment/raw Node messages are absent from serialized errors.                                                                                                                                                                         |
| Batch alias bypasses            | Basename recognition accounts for Win32 trailing dots/spaces and colon/alternate-stream suffixes before refusing .bat/.cmd. Tests cover six aliases. Windows executable/cwd paths also reject unsafe Windows segments and ambiguous drive-less roots.                                                                                                                                                                                                                                                                                                                                                                                 |
| macOS cwd assertion             | The child cwd expectation now uses realpath(root), permitting /var versus /private/var canonicalization while still checking the actual child cwd. Linux executes this corrected test; macOS remains unexecuted.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Invalid filename fixture        | Invalid UTF-8 is now a separate test. Fixture creation skips only EILSEQ with a clear filesystem-capability reason; unexpected errors still fail. Other unusual-name tests remain independent. Linux successfully creates the fixture and exercises actual rejection; no skip occurs locally. APFS behavior remains pending macOS execution.                                                                                                                                                                                                                                                                                          |
| Coarse timestamp dependency     | The mutation fixture changes file size deterministically. The POSIX replacement case deliberately keeps size equal and checks changed inode identity. Production safe-read.ts is unchanged: metadata verification remains best effort, with no assertion that it detects every same-size/same-timestamp edit.                                                                                                                                                                                                                                                                                                                         |
| Logger path/key leaks           | The baseline split-path probe returned an unmasked private workspace path, and credentials/auth/pwd/passphrase fields retained values. Terminal sequences are now neutralized before path matching. Both whitespace-aware credential masking and the control-joined view are checked, preventing Bearer/newline leakage. Every logger includes the current home plus custom paths, with reusable regexes compiled at construction. Keys include the reported credential forms without masking author metadata. Error details use the same redaction. Invisible/bidi/control characters are escaped or represented by bounded markers. |
| Invalid/oversized logging field | A field that exceeds its budget becomes an omission marker; independent request IDs and useful sibling metadata survive. Accessors are not invoked. Root fields must be plain objects, at most 32 supplied top-level fields are retained (plus an omission marker), keys at 256 characters, and individual fields have 256 child-property checks, 8192 input-character and 4096 serialized-byte budgets, in addition to shared JSON limits. Text input above 16,384 characters is omitted; sanitized text caps at 8192 characters. Total NDJSON limits remain enforced.                                                               |
| Environment overrides           | Inherited environment is still filtered. Explicit unsupported overrides now reject with INVALID_REQUEST rather than silently disappearing. No new names were allowlisted. A caller cannot substitute a different Windows SystemRoot. Tests prove inherited NODE_OPTIONS/secrets stay absent and requested unsupported variables fail.                                                                                                                                                                                                                                                                                                 |
| Windows paths                   | Defensive path validation adds COM0/LPT0 and CONIN$/CONOUT$ aliases. Fully qualified path checks reject drive-relative and drive-less rooted storage/process/PATH inputs while retaining normal drive/UNC paths. Tests use Windows path semantics on Linux, not a Windows filesystem.                                                                                                                                                                                                                                                                                                                                                 |
| Directory change during hashing | A deterministic timing wrapper performs an actual new-file write and observable directory-mtime change after traversal has begun. All stats remain real; no synthetic success/failure metadata is supplied. The existing walker reports TARGET_CHANGED instead of returning a digest. No production hash algorithm or traversal changes were needed.                                                                                                                                                                                                                                                                                  |
| Retained pipes                  | Execution timeout stops at parent exit. The separate 2.5-second output-drain deadline reports PROVIDER_FAILED with phase=output-drain for retained pipes after otherwise normal exit. A prior timeout, cancellation or output-limit failure retains its original reason. TIMEOUT with phase=execution concerns running execution. The real escaped-session regression and simulated Windows exit/drain test assert this distinction.                                                                                                                                                                                                  |

## Modified files and scope preservation

Production changes:

- `packages/toolkit/src/platform/process.ts`: launch normalization, lifecycle/termination guards, environment and executable checks, separate timeout/drain classification.
- `packages/toolkit/src/platform/paths.ts`: additional Windows aliases and fully qualified path helper; platform storage validation.
- `packages/toolkit/src/platform/which.ts`: fully qualified Windows PATH candidates.
- `packages/toolkit/src/log/logger.ts`: redaction order, home inclusion, cached patterns, field preservation/bounds and safe error-detail serialization.

Existing tests changed: `packages/toolkit/test/{process,filesystem,tree,platform}.test.ts`. New regression files: `process-lifecycle.test.ts`, `logger-hardening.test.ts`, `tree-changes.test.ts`. Existing assertions were corrected to express the reviewed behavior, not removed to conceal failures. The metadata replacement case is strengthened with a same-size replacement inode, and the retained-pipe case additionally checks its phase.

Documentation changed: `packages/toolkit/README.md`, `docs/WP2_RESULTS.md` (explicit historical-baseline label), M0 plan implementation notes, canonical SOT implementation-status link, and this new report. The earlier WP2 edits to root configuration/docs/lockfile remain preserved; hardening adds no dependency or lockfile change.

The foundation commit remains **7cf1900 — feat: establish PHOENIX foundation and hardened contracts**. Existing uncommitted WP2 work was preserved; a task-start toolkit copy under /tmp was used for comparison. No Git commit, remote mutation, push or publication occurred.

No contracts, schemas, accepted ADRs, state-machine edges, job-budget semantics or dependency boundaries changed. The 97 snapshots were checked without regeneration. SOT stays **v1.0.2**: these are implementation fixes, with no architectural version increment or new ADR warranted. ADR-0007 stays proposed/unapproved and must be resolved before WP6. No WP3 parser, classifier, intake or later subsystem was implemented.

Runtime graph remains:

```text
@phoenix/toolkit → @phoenix/contracts → zod
```

## Regressions and actual verification

New cases cover Windows exit/abort/timeout/output/close order, already-exited PID metadata, one-time cleanup, stalled taskkill, retained pipes, synchronous invalid-executable errors, real E2BIG, batch aliases, explicit environment rejection, additional path aliases/roots, ANSI/OSC/C0/zero-width path splitting, default/custom homes, sensitive keys, valid metadata preservation, getters/cycles/big fields/fanout, invisible characters, error details, regex reuse, whitespace credentials and a real directory mutation. The invalid-UTF-8 fixture split adds an independent capability-specific case.

Process-lifecycle tests use mocked child events, fake time and Windows platform metadata to verify production control flow. Logger unusual-home tests inject /srv/unusual person. These are deterministic simulations, not evidence of real Windows/macOS OS behavior. Real Linux process tests still spawn Node, inspect descendant PIDs/heartbeats and verify cleanup. The directory timing wrapper intercepts when a real filesystem mutation happens; its stat results and hash traversal are real. It does not fabricate a digest or failure.

Commands actually executed include inspection with rg/file reads/Git status/log/diff, a task-start `cp -a` backup, project-local edits and Prettier, typecheck/lint/check/build, direct before/after Node reproduction probes, and focused tests:

```sh
pnpm exec vitest run --project unit packages/toolkit/test
```

The final focused run passed **82 tests in 8 files** on Linux Node 26. The full Node 24 suite also executes every one of these regressions. An intermediate mock-launch fixture consumed the wrong queued mock result and timed out; resetting that test mock fixed the fixture. No production assertion was relaxed for it.

Each required command below was actually executed and passed under **both** runtimes after the final production changes:

```sh
pnpm check
pnpm build
pnpm test
pnpm test:coverage
pnpm contracts:check
pnpm boundaries
pnpm licenses:check
```

System Node remains v26.8.1. The existing isolated v24.11.0 binary was selected per command with:

```sh
env PATH=/tmp/phoenix-node24/node_modules/node-linux-x64/bin:$PATH pnpm <command>
```

Real process/socket tests used approved host access because the restricted sandbox blocks required OS primitives. No system package, runtime or dependency was installed/updated. Prior scratch-copy semantic mutation testing was not rerun: contracts are unchanged, and all existing semantic regression tests run in the ordinary suite.

| Check                                                  | Linux Node 26.8.1     | Linux Node 24.11.0    |
| ------------------------------------------------------ | --------------------- | --------------------- |
| All seven requested commands                           | Pass                  | Pass                  |
| Runtime tests                                          | 606 pass, 19 files    | 606 pass, 19 files    |
| Failed/skipped tests                                   | 0 / 0                 | 0 / 0                 |
| Existing state/mode checks                             | All 363 pass          | All 363 pass          |
| Contract snapshots                                     | 97 unchanged/verified | 97 unchanged/verified |
| Typecheck including portable contracts / lint / format | Pass                  | Pass                  |
| Actual package/source boundaries                       | Pass                  | Pass                  |
| Installed license metadata                             | 145 packages pass     | 145 packages pass     |
| Combined lines / statements                            | 97.12% / 95.78%       | 97.12% / 95.78%       |
| Combined functions / branches                          | 98.06% / 92.15%       | 98.06% / 92.15%       |

Per-package coverage aggregates counters from coverage-summary.json, truncating percentages to two decimals:

| Package   | Lines            | Statements       | Functions        | Branches         |
| --------- | ---------------- | ---------------- | ---------------- | ---------------- |
| Contracts | 275/276 (99.63%) | 297/299 (99.33%) | 50/50 (100%)     | 210/213 (98.59%) |
| Toolkit   | 537/560 (95.89%) | 590/627 (94.09%) | 102/105 (97.14%) | 424/475 (89.26%) |

Existing >=95% contracts and >=85% toolkit gates all pass, unchanged. Coverage includes simulated Windows branches; it does not establish Windows execution, full semantic correctness or OS isolation. Coverage files remain ignored local artifacts.

## Limitations and readiness

- **Windows/macOS, hosted CI and relevant teammate hosts were not executed.** Formal cross-platform WP2/M0 acceptance is pending. Capability skips are limited to genuinely unavailable primitives or fixtures, with reasons; Linux skipped none.
- Windows taskkill is used only while the original child is observed running. It cannot supply reliable descendant containment after parent exit; a future **Job Object-based execution provider** is required. PID checks alone cannot eliminate every native exit/reuse race. POSIX descendants can escape their process group by starting a session. No Job Object, network isolation, CPU/memory sandbox or hostile-target containment was added.
- Realpath/lstat/handle checks reduce races without making the filesystem atomic. Same-size edits with unchanged/coarse timestamps, deliberately restored metadata, changes after final verification, and changes through hard-link aliases can evade metadata-only checks. Hard links remain valid regular files. Hashing proves only the bytes read; hostile concurrent writers require snapshots/isolation. No cryptographic change detection is claimed for an un-rehashed file.
- Logging recognizes bounded patterns, not every secret or arbitrary hostile in-process JavaScript behavior. Callers must supply diagnostic metadata, not raw sensitive payloads. Default stderr uses Node buffering; custom sinks own backpressure. Aggregate event overflow can still replace an event with a small truncation record after safe per-field salvage.
- Ownership/benchmark choices, ADR-0007 before WP6, contributor provenance and final dependency/distribution review remain open under existing decisions.

**Commit readiness:** the targeted WP2 corrections are ready for review and the WP2 Git commit, with the external platform gate recorded. No commit was made. **WP3 can safely begin against these locally verified services**, without implying that formal three-OS acceptance or the complete M0 milestone has finished.
