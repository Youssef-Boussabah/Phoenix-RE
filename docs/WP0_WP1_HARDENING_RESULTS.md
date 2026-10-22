# WP0/WP1 hardening results

Date: 2026-10-22. Scope: targeted corrections from the complete Claude Opus 5.5 review, supplied in the project instruction. The architecture review was not restarted. No WP2, persistence, frontend, provider or AI engine was implemented. All work remains uncommitted; no remotes, pushes or publication were performed.

**Result:** the required hardening and semantic tests pass on Linux Node 26.8.1 and Node 24.11.0. All eleven specified surviving mutations and a canary are detected on both runtimes, independently of JSON Schema snapshot checks. ADR-0007 remains proposed and requires approval before WP6. The patch is ready for initial-commit review; formal three-OS WP0 acceptance remains pending.

## Confirmed bugs and corrections

| Finding | Independently observed before correction                                                                                                      | Correction and validation                                                                                                                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1      | Exact 5,000-level ToolInvokeInput reproduction throws RangeError; 20,000-level error construction and normalization also throw                | Iterative validation and detached copying; depth/node/UTF-8 size limits; no recursive runtime JSON parser; controlled invalid results; adversarial tests across every arbitrary JSON field                            |
| M2      | TargetDescription accepts file, javascript and ftp URLs                                                                                       | Shared HTTP(S)-only schema on applicable URL fields; manifest URI syntax and associated identity checked; runtime protocol annotations in snapshots                                                                   |
| M3      | ready has no failed edge while the original plan proposes charging job age                                                                    | Proposed ADR-0007 records ready failure and active-versus-idle accounting; current edges and duration semantics are unchanged                                                                                         |
| M4      | Nonterminal job_finished, completed errors, absent terminal finishedAt, ready error/finishedAt and bogus/fractional/negative budgets all pass | Terminal event states; terminal iff finishedAt; active/completed errors forbidden; CANCELLED reasons belong to cancellation; defined budget names and safe counters at/beyond limit; current mode/state compatibility |
| M5      | Eleven listed semantic changes were not covered adequately                                                                                    | Explicit positive/negative tests for each listed mutation and literal enum expectations; real scratch-copy mutation runs with a canary; no snapshot regeneration involved                                             |
| m1      | Spaced homes leak, Basic/quoted credentials leak, URLs are altered, redacted keys collide                                                     | Bounded sanitizer protects HTTP URL text, redacts credentials/userinfo/query secrets, handles root/Windows/UNC homes and retains colliding keys with suffixes; no recursive details visitor                           |
| m2      | Unknown state throws TypeError; invalid mode can pass; unparsed budgets are trusted                                                           | Validate mode/from/to before lookup; canTransition returns false and assertTransition throws PhoenixError predictably; budget helper validates its input and uses parsed usage values                                 |
| m3      | Direct getBuiltinModule/fetch calls and non-.ts source files evade checks                                                                     | Check direct built-in acquisition, fetch and globalThis.fetch; scan .ts/.mts/.cts; actual-file negative tests; production contracts compile without ambient Node types                                                |
| m4      | File tree digests, URL sources without URLs, mismatched internal URI IDs and traversal exclusions pass                                        | Source/digest/URL and manifest target/artifact URI identity refinements; canonical relative path/literal exclusion schemas; no filesystem implementation                                                              |
| m5      | Successful null providers and mismatched status identities pass                                                                               | Shared dotted ProviderId schema, nonempty versions, required successful/partial provider identity, matched ProviderStatus IDs                                                                                         |
| m6      | Explicit null and absent observation data were insufficiently documented                                                                      | Explicit JSON null is a recorded value serialized as TEXT `"null"`; absent data maps to SQL NULL and requires an artifact; tests preserve this distinction without a database implementation                          |
| m7      | High-bit Mach-O CPU values already pass; no existing acceptance bug claimed                                                                   | Explicit unsigned 32-bit upper/lower bounds; thin/fat regressions for 0x80000002, 0x80000003 and 0xffffffff; reject negative/fractional/overflow                                                                      |
| m8      | Tooling negative tests and ordinary-test type execution are missing                                                                           | Snapshot/license negative tests; pnpm test now typechecks first; path tests reject lone surrogates; original tree encoding vectors remain encoding-only tests                                                         |
| m9      | Public streams reference Node types                                                                                                           | Portable AsyncIterable<Uint8Array>; standalone production contract compilation and a no-Node, skipLibCheck=false public type consumer                                                                                 |
| m10     | Plan describes accepted ADRs as proposed and future repositories/projects as built                                                            | Accepted decision history labeled; current unit-only test configuration and future work distinguished; original results labeled historical                                                                            |

The before/after reproduction probes used the preserved pre-hardening source at `/tmp/phoenix-hardening-before` and a separate compiled baseline at `/tmp/phoenix-review-baseline`. The original source was never swapped back into the working tree. Raw probe results remain at `/tmp/phoenix-hardening-before-reproductions.json` and `/tmp/phoenix-hardening-after-reproductions.json`. Twenty matched probes showed the reported invalid records now rejected, the deep error paths safe, and the already-valid Mach-O case still valid.

## Bounds, semantics and remaining limits

`JSON_LIMITS` defines root depth zero, maximum depth **64**, **50,000** value-node occurrences and **1,048,576** serialized UTF-8 bytes per arbitrary JSON field/object. Keys, escaping and punctuation count toward bytes. Whole metadata and error objects share one cap. Shared acyclic references are copied as separate serialized occurrences; cycles, accessors, nonplain objects, sparse arrays and non-JSON values are rejected without calling getters/toJSON. Normal validation preserves `__proto__` data as an own property without prototype pollution. Error sanitization replaces cyclic/non-JSON primitive values with markers and omits details exceeding the bounds; messages are capped at 8192 characters after redaction expansion.

The future HTTP layer still needs its aggregate 1 MiB body limit before decoding. Contract field validation is not a raw JSON text parser or global document-size quota. Inline outputs also honor the lower requested byte limit; larger outputs use artifacts. Redaction is a bounded pattern matcher, not a universal secret detector. The boundary checker handles direct patterns, not arbitrary aliases, eval or generated code; code review remains necessary.

Relative paths require NFC, well-formed Unicode, POSIX separators and nonempty segments; traversal, absolute/drive paths, backslashes and NUL are rejected. Exclusions are literal names or relpaths, matching the existing CLI specification; no glob matcher was introduced. WP2 must still implement realpath containment, filesystem-name handling and normalized collision detection. Unsupported filesystem names must not silently yield a digest of a renamed or incomplete tree.

Lifecycle error reasons are optional for terminal failure/partial/cancellation, preserving the existing optional field. If present, only cancellation uses CANCELLED; active/completed jobs carry no final error. Step errors remain separate. No extra ready-state edge or active-time persistence field was added.

## Files changed

Production contracts changed: `target.ts`, `evidence.ts`, `provider.ts`, `job.ts`, `events.ts`, `errors.ts`, `job-state-machine.ts`, `provider-interfaces.ts`, `engine.ts`, `schema-registry.ts`, `index.ts`, `operations/inspect-assets.ts`; new `json.ts` and `paths.ts`. `packages/contracts/tsconfig.json` now compiles without ambient Node types. JSON Schema snapshots were intentionally regenerated and reviewed: **97 total**, including eight new schemas (bounded value/object, relative path, exclusion, HTTP URL, provider ID, terminal state and budget name). Existing schema IDs retain the unpublished contract version.

Tests added: `packages/contracts/test/json.test.ts`, `hardening.test.ts`, `review-mutations.test.ts`, `tests/tooling.test.ts`, `tests/portable-contracts.ts`, `tests/tsconfig.portable.json`. Existing `fixtures.ts`, `schemas.test.ts`, `errors.test.ts` and `tests/boundaries.test.ts` were updated. The independent 363 state/mode tests were retained unchanged.

Tooling changed: `scripts/check-boundaries.ts`, `scripts/contracts-snapshot.ts`, `scripts/check-licenses.ts`; new `scripts/review-mutations.ts`. Root package scripts add semantic mutations, portable typechecking and ordinary-test typechecking. No dependency or lockfile changes were required.

Documentation changed: canonical SOT, M0 plan, historical WP0/WP1 results, root README, CONTRIBUTING and contracts README; new ADR-0007, ADR-0008 and this report. The SOT is **1.0.2**, with prior decisions and changelog entries preserved. Original historical Markdown and local DOCX bytes remain unchanged and the DOCX remains ignored.

## Regression tests and actual verification

Added semantic tests cover every listed mutation, not only null/undefined. Committed enums are pinned to literal expected lists. Adversarial cases include 20,000-level objects/arrays, cycles, exact and exceeded depth/node/byte bounds, UTF-8/escape accounting, shared references, getters/proxies, sparse/extra-property arrays, non-JSON types, redaction expansion/collisions, source and URI identities, path traversal/normalization/surrogates, lifecycle errors/timestamps, invalid mode/state inputs, provider identities, null persistence semantics and unsigned Mach-O fields. Tooling checks have positive and negative scratch-directory tests.

Commands actually executed on **both Linux Node 26.8.1 and Node 24.11.0**:

```sh
pnpm check
pnpm build
pnpm test
pnpm test:coverage
pnpm contracts:check
pnpm boundaries
pnpm licenses:check
```

`pnpm check` includes formatting, typed lint, both normal and portable typechecks, boundaries, snapshot consistency and license metadata. `pnpm test` also typechecks before runtime tests. Schemas were regenerated deliberately with `pnpm contracts:snapshot`, then checked without mutation. Additional executed commands include targeted typecheck/lint/coverage runs, Prettier on changed files, the exact Opus reproduction plus assertions, isolated baseline compilation/probes, mutation commands below, Git status/remotes/ignore reads and source-document hashes. System Node remains 26.8.1; Node 24.11.0 is the pre-existing isolated `/tmp/phoenix-node24/node_modules/node-linux-x64/bin/node` binary, selected through the per-command PATH. No system installation/downgrade occurred.

| Check                                   | Node 26.8.1                         | Node 24.11.0                        |
| --------------------------------------- | ----------------------------------- | ----------------------------------- |
| All seven requested commands            | Passed                              | Passed                              |
| Unit/contract tests                     | **524 passed, 11 files**            | **524 passed, 11 files**            |
| State/mode combinations                 | All **363**                         | All **363**                         |
| Schema snapshots                        | **97 verified**                     | **97 verified**                     |
| Contracts lines                         | **99.63%**                          | **99.63%**                          |
| Contracts statements                    | **99.33%**                          | **99.33%**                          |
| Contracts functions                     | **100%**                            | **100%**                            |
| Contracts branches                      | **98.59%**                          | **98.59%**                          |
| Installed license metadata              | Passed, **145 entries**             | Passed, **145 entries**             |
| Exact deep ToolInvokeInput reproduction | Controlled invalid result; no throw | Controlled invalid result; no throw |
| Eleven semantic mutations and canary    | All detected                        | All detected                        |

All >=95% contracts coverage gates pass. Coverage measures executable contracts code only; type-only interfaces and tooling scripts are not included in those percentages. This is not proof of complete semantic testing. The prior 100% result is historical, not a current completeness claim. No ordinary tests fail or are skipped. Mutation failures are intentional detections. Intermediate type/lint/test failures were corrected; the first mutation launch was blocked by sandbox EPERM and succeeded with approved child-process execution.

Windows/macOS and hosted CI were **not executed**. No database/runner/doctor/provider integration or end-to-end tests are claimed; those implementations remain outside this patch.

## Mutation results

Executed `pnpm test:mutations` under Node 26 and the equivalent direct Node 24 script invocation with output `/tmp/phoenix-hardening-mutations-node24.json`. The harness copies source/tests to a disposable directory, links installed dependencies, verifies **12 green semantic tests**, detects a canary, applies one source mutation at a time and restores the scratch source in finally. It requires all twelve tests to execute for every mutant. It never edits production source or regenerates snapshots. Mutation processes required sandbox escalation for child-process permission; this does not affect ordinary tests.

| Opus surviving mutation                 | Node 26  | Node 24  |
| --------------------------------------- | -------- | -------- |
| Remove ProviderDescriptor ID format     | Detected | Detected |
| Permit arbitrary IntakeSource protocols | Detected | Detected |
| Remove objective length bounds          | Detected | Detected |
| Remove pagination limit bounds          | Detected | Detected |
| Permit arbitrary tool target objects    | Detected | Detected |
| Permit unknown Locator fields           | Detected | Detected |
| Remove cancelled StepStatus             | Detected | Detected |
| Remove android TargetKind               | Detected | Detected |
| Remove STORAGE_ERROR                    | Detected | Detected |
| Make isWsl optional                     | Detected | Detected |
| Permit nonpositive step_failed attempts | Detected | Detected |

This is **11/11 of the specified review survivors**, plus a canary, not a whole-project mutation score. The other four original Opus mutations were not specified in the supplied review and are not claimed rerun. Runtime tests and literal expectations detect these eleven without relying on snapshots accepting or rejecting regenerated schema output. Machine-readable results remain at `/tmp/phoenix-hardening-mutations.json` and `/tmp/phoenix-hardening-mutations-node24.json`.

## ADR status and commit readiness

**ADR-0007 is proposed, unapproved and unchanged by this patch.** It recommends ready-to-failed and durable charged execution time excluding idle waits; it must be resolved before WP6. Tests continue to reject ready-to-failed. ADR-0008 records accepted implementation hardening authorized by the project instruction; it does not accept ADR-0007.

The targeted pre-commit corrections are ready for review and the **initial commit**. No commit was made, as requested. Remaining issues are the proposed WP6 decision, pending real Windows/macOS/hosted CI validation, and the existing contributor/ownership/license/distribution review. The runtime dependency graph remains `@phoenix/contracts → zod`. WP2 has not begun.
