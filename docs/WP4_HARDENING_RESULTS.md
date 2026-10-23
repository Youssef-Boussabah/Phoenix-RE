# WP4 independent-review corrections

Date: 2026-10-23. Owner: unassigned (D-014 OPEN). Review: PASS WITH FIXES; five confirmed major defects, no critical defects. Scope: M1–M5 and the small lifecycle-event guard. Governing SOT remains **v1.0.2**; accepted ADRs and shared contracts are unchanged. ADR-0007 remains proposed. All uncommitted WP4 work was preserved; nothing staged, committed, pushed or published.

The [initial WP4 report](WP4_RESULTS.md) is a historical baseline. Its 962 passing tests did not detect the reviewed defects. **Prior hardening result:** all 24 required verification command invocations pass on Linux Node **24.11.0** and **26.8.1**. Each normal/clean test and coverage run passes **1,002 tests in 34 files**, with **0 failures/skips**: the original 962 plus 40 new regressions. Evidence line coverage is **94.74%**. These are the prior hardening totals; the final M1 section below records the latest path-field correction and verification. Windows/macOS execution remains pending actual hosted CI.

## Confirmed defects and corrections

| Finding                                                                         | Correction                                                                                                                                                                                                                                       | Production files under packages/evidence/src       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| M1: source text rejected and embedded URL suffixes leaked                       | Validate authoritative URL/HTTP(S) URI strings separately, before Zod URL normalization. Treat source-derived text as untrusted content: preserve safe text, normalize unambiguous URLs, redact ambiguous complete suffixes with a fixed marker. | repos/privacy.ts                                   |
| M2: target snapshot metadata could contradict artifact metadata                 | Inside the target transaction and before idempotence/supersession, check attached file artifact hash/digest/size, snapshot semantics, inventory existence/type/source. Mismatches roll back rather than being repaired.                          | repos/targets.ts, index.ts                         |
| M3: finding references could cite unrelated or absent bytes                     | Require a target-to-artifact association for every citation, validate supplied observation provenance, and synchronously verify actual registered CAS content within the revision transaction.                                                   | repos/findings.ts, cas/artifact-store.ts, index.ts |
| M4: SQLite auto-rollback could let a caught nested error escape into autocommit | Check owned transaction state before/after every adapter operation and before commit/release. Poison the owner when its transaction disappears; refuse subsequent operations until the outer scope unwinds. Cleanup checks real SQLite state.    | db/database.ts                                     |
| M5: nested full scans in evidence.list                                          | Replace OR-based artifact/target and target/job joins with indexed UNION ALL arms. Deduplicate the complete selection before deterministic pagination. Add the five required association indexes.                                                | repos/evidence.ts, migrations/0001_init.ts         |
| Optional: contradictory lifecycle events                                        | Reject finish events for active jobs and state-change events inconsistent with the stored state/accepted edge. Apply the same guard to direct append and events supplied at creation. Identical-ID replay still returns the original event.      | repos/events.ts                                    |

The SQLite PRAGMAs, defensive-mode feature detection, foreign keys, STRICT tables, VACUUM INTO backups, migration locking, streaming CAS writer, atomic no-clobber publication, deduplication and recovery paths remain in place. No new dependency, runner, provider, planner, vault or network fetcher was added.

## Privacy reproduction and prevention

The original metadata regex stopped at apostrophes/quotes, markup and Unicode whitespace. Actual examples with `name=o'brien&sig=CANARY_APOSTROPHE` and a nonbreaking space followed by `&sig=CANARY_NBSP` reached ordinary SQLite content. It also threw on malformed source strings such as `https://`, `https: is required`, tab-bearing shebangs and ZIP names like `docs/http:[x]`.

The authoritative `url` and HTTP(S) `uri` fields are strictly validated and serialized as normalized origin/path only. Raw values are checked before shared-schema normalization can strip tabs/newlines. Accessor properties are rejected without invoking getters; descriptor/validation errors are converted to fixed non-secret INVALID_REQUEST messages. The input contract is unchanged. Arbitrary metadata, warnings, sampled entries and classification text are handled separately. Unsafe delimiters cannot split a credential-bearing suffix: ambiguous content from the URL-looking scheme through the end of the field becomes `[URL_REDACTED]`. Once access syntax appears, trailing content is conservatively treated as access context. Safe ordinary text and unambiguous identity URLs remain intact; redaction may deliberately remove additional trailing source text. Metadata-key collisions receive stable numeric suffixes instead of rejecting a valid local intake. Text scanning is iterative and linear in field length; repeated safe URLs do not recurse.

Local filesystem identity is preserved. Real WP3 describeTarget outputs for Python shebang comments, shell scripts with tabs/URL-like text and a ZIP with `docs/http:[x]` all persist and reopen. Regression inputs cover apostrophes, double quotes, angle brackets, NBSP, em spaces, line separators, tabs, newlines and ASCII-space suffixes. Canary tests persist records, close SQLite, inspect the actual phoenix.db bytes, reopen, and recheck repository output. Authoritative credential-bearing URLs sanitize both URL and URI; separate intakes still use opaque intake IDs and never merge solely by origin/path. Errors contain no raw input values.

Origin/path or arbitrary text can themselves be sensitive. This is the ADR-0009 persistence policy, not general secret discovery. No protected retrieval identity or equivalent source is inferred from the sanitized URL.

## Target/artifact and finding provenance invariants

A file target with an artifact must declare the matching SHA-256 algorithm/digest/hash and, if supplied, matching size. A complete file snapshot requires an artifact. Reference targets may retain matching artifact attachments; legitimate incomplete references remain valid without a digest/artifact. Inventory attachments require registered artifacts with `application/vnd.phoenix.inventory+json` media type and directory source semantics. Foreign keys remain enforced. Validation precedes same-source deduplication, so an invalid attachment cannot be hidden by an idempotent return.

Every cited artifact must be the target's snapshot/inventory or an observation dataArtifactId for that target. If observationId is present, that observation must belong to the target and either identify the cited output or interpret the target's own snapshot/inventory. An unrelated evidence_refs row is not a provenance chain. This applies even when observationId is omitted. Empty hypotheses remain legal; non-hypothesis statuses still require citations.

`artifacts.verifyRegistered(id)` is a synchronous read-side verifier used by finding commits. It opens a regular CAS file without following a final symlink where supported, hashes in 64 KiB chunks, checks the registered hash/size, and closes the descriptor on every path. Missing, non-file, corrupt or metadata-only blobs fail with STORAGE_ERROR. Multi-chunk real output bytes are covered. This keeps the repository API synchronous and avoids awaiting inside a SQLite transaction.

Failed finding validation rolls back the current-revision pointer, new revision, newly inserted evidence references and evidence links. Tests cover cross-target references with/without observationId, unrelated artifact IDs, missing physical content, actual target snapshot/inventory evidence, actual observation output and revision rollback. Existing positive fixtures now explicitly associate their output artifact with the observation and use actual CAS hashes/sizes; all original assertions remain.

Filesystem verification is point-in-time. It does not make SQLite and filesystem writes atomic, prevent later external tampering, or back up artifact bytes. Synchronous verification holds the SQLite writer lock while hashing; very large citations can increase contention. The data directory remains a trusted local namespace.

## SQLite auto-rollback behavior

Real WAL databases use max_page_count to exhaust pages during a zeroblob insert. SQLite automatically removes the active transaction/savepoints. Both nested and non-nested tests intentionally catch that error inside the outer callback, attempt later writes and then return. The adapter refuses the late write and event append, and the owning transaction still fails with STORAGE_ERROR. Assertions outside the callback prove that outer-1 and outer-2 are absent and no partial job version/state/events survive. A subsequent independent transaction succeeds on the same connection.

All adapter operations check DatabaseSync.isTransaction when an owned callback is active. Loss of that transaction poisons its owner through all nested scopes. COMMIT/RELEASE cannot run on a lost owner, and cleanup does not release stale savepoints. Ordinary caught nested failures still use a valid SAVEPOINT and can preserve the outer transaction's legitimate work. Promise-returning callbacks remain rejected by the existing type test and runtime check. Trusted raw database access is not an authorization to manipulate transaction control from inside owned callbacks.

## Evidence query plans and scaling

The original plan scanned targets and jobs as right-hand LEFT JOIN inputs for each artifact. A real local baseline, before changing the query/indexes, measured three page reads at each size:

| Fixture size                                                      | Original median | Corrected median              |
| ----------------------------------------------------------------- | --------------- | ----------------------------- |
| 1,000 artifacts / 500 target associations, plus one base target   | 52.00 ms        | 4.41 ms (Node 26 full suite)  |
| 5,000 artifacts / 2,500 target associations, plus one base target | 2,177.31 ms     | 24.23 ms (Node 26 full suite) |

These are measured on this Linux host, not the reviewer's machine; the reviewer's 85 ms / 4.1 s figures are not presented as local results. Corrected focused runs measured approximately 2 ms and 10 ms respectively. Final normal-suite Node 24 medians were 5.22 ms and 36.89 ms. The original baseline was an isolated probe; final corrected samples run alongside the full parallel test suite. These measurements show the removed scaling cliff, not a controlled universal speedup ratio.

Indexed arms cover global/orphan artifacts, target snapshots and inventories, primary/candidate jobs, observation data, observation references and current finding citations. Final DISTINCT preserves inclusion despite overlapping arms. Tests compare complete selected rows to a retained test-only legacy query across project, target, job, combined, artifact-only and small-page selections. They test shared artifacts, candidate-target verification jobs, inventory links, orphan scope, pagination, stable order, stale values and duplicate elimination.

EXPLAIN QUERY PLAN assertions require the artifact/inventory/primary/candidate/data-artifact indexes, reject nested job scans and retain no LEFT JOIN in the new plan. Benchmarks use 1,000 and 5,000 real SQLite rows, five page samples at each size, structural plan assertions and generous timing bounds for shared/instrumented CI hosts. They do not assert machine-independent latency. Global pages still process associations linearly; this is not a constant-time or complete query-performance guarantee.

## Initial migration and checksum

The initial migration is uncommitted/unshipped. It adds indexes on targets(artifact_id), targets(inventory_artifact_id), jobs(target_id), jobs(candidate_target_id) and observations(data_artifact_id). No table, constraint or history trigger was removed and no speculative second migration was generated.

- Initial SQL SHA-256: `45bd2992140cb0ccf0776987bde07b01e378c40d35994bb24a5c086a493cd482`
- Corrected SQL SHA-256: `5fff0cf9e9e467423894d7bf35a7c38cf88cca4aac7542bfa68213df69165ece`

A regression proves that an earlier development checksum produces MIGRATION_CHECKSUM_MISMATCH while preserving the actual database and its project/target rows. No real user database was opened or modified. Use a separately initialized disposable store when replacing old development fixtures; never silently delete data. After publication, schema changes require a new forward migration, not edits to an applied migration.

## Regression files and verification

New tests:

- hardening-privacy.int.test.ts: real WP3 inputs, canary persistence/reopen/raw-file checks, authoritative URL handling, safe text and repeated URL content.
- hardening-provenance.int.test.ts: digest/size/inventory errors, transaction rollback, target/observation evidence chains, actual content and missing/corrupted bytes.
- hardening-transactions.int.test.ts: real SQLITE_FULL auto-rollback, both nesting paths, lost-owner operation guards, job/event rollback and connection reuse.
- hardening-query.int.test.ts and support/{legacy-evidence-query,query-fixtures}.ts: independent inclusion reference, query plans and realistic scaling.
- hardening-events.int.test.ts: contradictory creation/direct lifecycle events and terminal replay.
- hardening-migrations.int.test.ts: old checksum rejection without data deletion.

Paths are relative to packages/evidence/test. The original repositories.int.test.ts retains its test count and assertions, with stronger valid provenance/hash fixtures and raw URL input to avoid prior schema normalization hiding the control-character test.

Temporarily restoring each saved pre-fix implementation to its original source location demonstrates the new tests detect M1, M2, M3 and M4. Files are restored in finally blocks after every probe. Tests must actually execute; import/compilation errors are not accepted as detection. The M5 before/after evidence uses actual query plans and measured page reads. Final all-green verification uses only the corrected source.

| Saved implementation restored | Executed tests | Assertion failures |
| ----------------------------- | -------------- | ------------------ |
| M1 privacy                    | 15             | 14                 |
| M2 targets                    | 16             | 7                  |
| M3 findings                   | 16             | 5                  |
| M4 transaction helper         | 3              | 3                  |

All four probes executed their stated tests; none were import/compilation failures. Source restoration completed before final verification.

## Prior hardening normal and clean-build verification

Every command below passed in the stated order under both installed runtimes:

```sh
pnpm check
pnpm build
pnpm test
pnpm test:coverage
pnpm contracts:check
pnpm boundaries
pnpm licenses:check
```

Then, on each runtime:

```sh
pnpm clean
pnpm check
pnpm build
pnpm test
pnpm test:coverage
```

| Gate                                                 | Node 24.11.0 (Linux)                                        | Node 26.8.1 (Linux) |
| ---------------------------------------------------- | ----------------------------------------------------------- | ------------------- |
| Seven normal commands                                | PASS                                                        | PASS                |
| Five clean-build commands                            | PASS                                                        | PASS                |
| Tests, normal and clean                              | 1,002 passed; 34 files; 0 failed/skipped                    | Same                |
| Coverage runs, normal and clean                      | 1,002 passed; all gates pass                                | Same                |
| Generated files immediately before clean-build check | None                                                        | None                |
| Shared schema snapshots                              | 97 verified, unchanged                                      | Same                |
| Boundaries                                           | PASS; evidence depends only on contracts and Node built-ins | Same                |
| License inventory                                    | 145 installed packages checked                              | Same                |

Node 26 is /usr/bin/node; Node 24 is the existing /tmp/phoenix-node24/node_modules/node-linux-x64/bin/node, selected through per-process PATH. No Node/system package or third-party dependency was installed. The driver checked every package dist directory after clean and before check, recording empty file lists. The subsequent contracts-check stage intentionally builds packages; source typechecking and test/child resolution do not require previous compiled outputs.

An initial sandboxed full run failed six preserved toolkit tests, including a real socket listen EPERM; all evidence tests passed. The final sequences ran outside that sandbox and pass. After a final raw-URL accessor guard, the entire two-runtime sequence was repeated; this table records the final source, not an earlier intermediate run.

Final logs are `/tmp/phoenix-wp4-hardening-node{24,26}-{normal,clean}-*.log`; command results are `/tmp/phoenix-wp4-hardening-verification.json`; clean-absence records and per-command query samples share the same prefix. Original query plans/timings are in `/tmp/phoenix-wp4-query-before.json`; regression probe logs use `/tmp/phoenix-wp4-hardening-regression-M{1,2,3,4}.log`. These are local artifacts, not committed files.

## Prior hardening coverage

All four final coverage runs agree:

| Evidence metric | Covered / total | Coverage   |
| --------------- | --------------- | ---------- |
| Lines           | 667 / 704       | **94.74%** |
| Statements      | 739 / 792       | 93.31%     |
| Functions       | 162 / 166       | 97.59%     |
| Branches        | 550 / 634       | 86.75%     |

The approved evidence line gate remains 85%. Existing contracts/toolkit coverage gates remain unchanged and pass. No existing test/assertion was skipped or removed, and no established contract/fixture snapshot was regenerated. Coverage does not establish exhaustive conformance; platform-specific Windows retry/fsync paths still need real hosted execution.

## Remaining findings and readiness

Windows/macOS hosted CI remains pending. Linux tests and test-only fault injection do not count as Windows/macOS validation. CAS hard-link/permission/AV behavior, filesystem durability limitations and caller-owned read iterator cleanup remain the documented M0 platform risks. Source redaction is deliberately conservative; exact protected URL identity, artifact-inclusive backups and GC remain future work. Invocation params_json continues to contain the validated request including limits, as documented in the initial implementation; this correction does not introduce a new storage contract. No general lifecycle replay engine, scheduler, lease coordinator or execution-time policy was added. ADR-0007 is still proposed.

**Readiness:** M1–M5 and the optional lifecycle consistency guard are corrected, with no known local verification blocker. WP4 is ready for independent review and a reviewed commit. Actual Windows/macOS GitHub Actions remains a separate acceptance gate before another work package. Nothing was staged, committed or pushed; no history or remote was changed. No real user database was modified.

## Final M1 filesystem-path correction (2026-10-23)

Final review identified one remaining M1 defect: generic text sanitization changed valid `warnings[].path`, `classification.signals[].path` and `inventory.excluded[]` values such as `http:x/package.json` and `http:cache` into HTTP URLs, causing RelativePath validation to reject real WP3 output. `repos/privacy.ts` now restores only those known filesystem fields, at their original array positions, before final TargetManifest validation. Unicode, case, optional-path absence and localPath remain intact. No entire unsanitized warning/classification/inventory object is restored, and metadata.path receives no exemption. M2–M5, lifecycle handling, contracts, dependencies and the migration SQL/checksum are untouched by this patch.

Four regressions in `hardening-paths.int.test.ts` cover actual WP3 intake of invalid nested package.json, literal exclusions, classification/warning path alignment and optional fields, and credential-bearing metadata.path/nested metadata. Every case uses a real temporary SQLite database and closes/reopens it; security cases also inspect phoenix.db bytes for canaries. Malformed paths and messages are kept distinct: warning messages and classification descriptions still undergo redaction. The pre-fix source fails three of these four tests; the metadata security test already passes. The corrected source passes all four and all existing privacy/repository regressions (59 focused tests on each runtime). Colon-bearing physical filenames are used where the host permits them; serialized URL-looking relative paths are tested on every host without skips.

All seven normal commands and all five clean-build commands listed above were rerun in order on the final source under both installed Linux runtimes:

| Final path-correction gate                     | Node 24.11.0                               | Node 26.8.1 |
| ---------------------------------------------- | ------------------------------------------ | ----------- |
| Focused privacy/repository tests               | 59 passed                                  | 59 passed   |
| Normal verification / clean-build verification | PASS / PASS                                | PASS / PASS |
| Test and coverage runs, normal and clean       | 1,006 passed; 35 files; 0 failed/skipped   | Same        |
| Evidence line coverage                         | **94.80% (674/711)**                       | Same        |
| Compiled files before clean-build check        | None                                       | None        |
| Contract snapshots / boundaries / licenses     | 97 unchanged / PASS / 145 packages checked | Same        |

All original 1,002 tests remain, plus four path regressions; the evidence line gate remains 85%. No dependency, contract snapshot or approved correction was changed. Final command logs and clean-absence/coverage artifacts use `/tmp/phoenix-wp4-final-m1-node{24,26}-{normal,clean}-*`; `/tmp/phoenix-wp4-final-m1-verification.json` records all 24 successful command invocations. A final formatting check and git diff check also pass.

**Readiness:** WP4 is ready for independent review and commit, with no known local blocker. Existing conservative text-redaction and point-in-time CAS/filesystem limits remain nonblocking limitations; actual Windows/macOS CI is still pending before another work package. Nothing has been staged, committed or pushed.
