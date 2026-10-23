# WP4 — Initial persistent evidence implementation results

> Historical baseline: independent review found five major defects in this implementation. The corrected behavior, current validation and commit readiness are recorded in [WP4 hardening results](WP4_HARDENING_RESULTS.md). The 962 passing tests and coverage below describe the initial implementation, not proof that the reviewed defects were absent.

Date: 2026-10-22. Owner: unassigned (D-014 OPEN). Governing specification: SOT v1.0.2, accepted ADRs 0001–0006, 0008 and 0009. ADR-0007 remains proposed. Baseline: ec4ffb6; working tree was clean before implementation. No commit or push performed.

**Result:** local implementation and all required verification sequences pass on Linux Node **24.11.0** and **26.8.1**. Each normal and clean run executes **962 tests in 28 files, zero failures/skips**: all 890 existing tests plus 72 new persistence integration tests. Evidence line coverage is **94.06%**, above the unchanged 85% gate. Actual Windows/macOS execution of WP4 remains pending GitHub Actions.

## Implemented components and public APIs

`@phoenix/evidence` depends only on contracts and Node built-ins. It contains the prescribed database adapter, migration module, embedded initial SQL migration, individual entity repositories, CAS and `createEvidenceStore({dataDir,readOnly?})`. See [package API and lifecycle documentation](../packages/evidence/README.md). Store initialization creates the local directory, opens SQLite, verifies/applies migrations and constructs repositories. Failure closes the connection; shutdown drains pending artifact puts and closes SQLite idempotently.

Repositories implement projects, immutable target manifests and supersession, artifact metadata, versioned jobs, steps/attempts, append-only events, invocation request/envelope provenance, observations, evidence references, finding revisions and evidence links, and validated polymorphic relations. Incoming values use the existing shared schemas. Read paths parse serialized JSON and shared contracts, verify duplicated manifest/invocation projections, and fail closed. Typed evidence pagination computes observation/finding staleness. Lists are bounded and deterministic. Artifact evidence queries follow target snapshots, artifact-backed observations, evidence references and current finding citations; verify jobs retain both reference and candidate provenance.

No findings or observations are created to populate empty stores. No toolkit/core import, provider, orchestrator, planner, fetcher or reconstruction implementation was added.

## Database and migrations

File-backed node:sqlite DatabaseSync; STRICT tables; foreign_keys ON; journal_mode WAL; synchronous NORMAL; busy_timeout 5000; defensive mode feature-detected. Node 26 supports enableDefensive; local Node 24.11.0 does not. Read-only connections validate the current schema and refuse pending migrations. Prepared statements bind record values.

The initial migration retains every §5.6 table, primary/foreign key, CHECK, index and required trigger. Additional UPDATE/DELETE triggers protect immutable targets, artifacts, evidence references, finding-evidence links and relations; DELETE triggers also protect observations and finding revisions. `schema_migrations` records version, name, exact-SQL SHA-256 and UTC millisecond application timestamp. Open verifies contiguous valid metadata, checksums and future versions. Each migration runs in its own immediate transaction. Existing data is backed up with parameterized SQLite VACUUM INTO before pending migrations; backup and migration are separate operations. No speculative second production migration exists.

## CAS, consistency and recovery

CAS uses artifacts/sha256/<first-two>/<digest> and artifacts/tmp. Stream chunks are bounded by the caller's hard limit, detached, hashed and fully written; the stage is fsynced and closed. Atomic no-clobber hard-link publication replaces the plan's rename detail because rename can overwrite an existing destination. The supported local filesystem must permit hard links; unsupported publication fails safely. Existing bytes are rehashed for deduplication. File permissions become read-only; directory sync is attempted on supported POSIX filesystems. Windows lock errors have a strict ten-retry bound; Windows behavior has not been verified locally.

Open/read stream bytes; explicit fingerprint validates hash and metadata size. Bounded reconciliation reports registered missing/corrupted blobs without deleting history. Repeated uploads safely deduplicate across processes. The first registered media type/ID wins for equal bytes.

SQLite and CAS do **not** form an atomic transaction. A failure after publication can leave a valid unregistered blob; a crash can leave staging files. Re-upload verifies/reuses orphan bytes, or restores missing bytes for an existing matching row. Corruption is never overwritten automatically. Reconciliation does not scan orphan files or garbage collect. WAL recovery and fsync do not promise survival of every hardware/power-loss fault. Database backups do not include artifact backups.

## Job and evidence guarantees

BEGIN IMMEDIATE / COMMIT / ROLLBACK with nested SAVEPOINTs compose repository writes. Promise callbacks are rejected by TypeScript and thenables are rejected at runtime. Async work must never be launched inside a transaction callback.

Jobs enforce existing modes/states, optimistic versions, immutable identity and terminal records. Creation, transition and finish events are persisted with job changes automatically when absent; supplied lifecycle events are checked for consistency. Step updates and supplied events roll back with the job. Steps persist attempts/leases without implementing a lease coordinator. Event IDs support exact idempotent replay; sequences are globally ordered and append-only. Finding revisions preserve history, cite immutable evidence in the same transaction, and reject contradictory or missing provenance. Observation TEXT "null" preserves explicit JSON null; SQL NULL means absent inline data and requires a backing artifact.

One implementation clarification: the existing tool_invocations.params_json stores the validated AnalysisRequest, including its params and limits, to retain the complete request contract without adding schema columns. Request/envelope query projections are validated on read. No shared contract or established snapshot changed.

Incomplete local manifests retain their actual unknown/truncated metadata and absent digest. Local sources require absolute paths; idempotence by digest applies only when both digests exist. A later intake for the same local source with an unknown or different digest records a new superseding manifest, conservatively marking prior observations stale. URL sanitization that would alter a localPath is rejected. URL-bearing strings with control characters are rejected to avoid splitting an access URL at a regex boundary and retaining secret suffixes.

## URL identity and privacy

ADR-0009 takes priority over the older sanitized-URL source-key example. All HTTP(S) strings in manifest fields and metadata keys/values are transformed with Node URL to origin and normalized pathname; userinfo, queries and fragments are removed. Both url and HTTP(S) uri are sanitized together. Warnings, displayName, classification strings and metadata cannot retain those original access URLs. Ambiguous sanitized metadata keys are rejected. Errors never serialize raw record values or SQLite error text.

URL source identity is opaque `intake:<target-id>`; replay of the same immutable manifest/ID is idempotent. Separate intakes with identical sanitized origin/path never deduplicate or supersede one another. URL manifests cannot carry localPath or supplied supersession. General URL idempotence waits for protected exact source identity. No raw-URL hash/cache surrogate, credential vault, secret-bearing column or URL fetcher exists. The public identity is explicitly not an equivalent retrievable source. Arbitrary path segments/free text can still be sensitive; this is not a universal secret detector.

## Tests and validation

Real temporary SQLite WAL databases and real filesystem artifacts cover fresh/repeated initialization, migration checksums and metadata errors, future schema rejection, backup contents, failed DDL rollback, nested rollback, compile-time/runtime async-transaction rejection, read-only opening, constraints/FKs, immutable history triggers, findings and provenance, corrupted serialized records, CAS deduplication, byte limits/cleanup, hash/size corruption, missing/non-file blobs, published-orphan recovery, shutdown draining, and reopen persistence.

A test-only child entry point resolves source modules through Node registerHooks, without importing generated dist files or changing production resolution. Tests run two actual processes for event/CAS contention, wait for a held transaction, exhaust the real 5000 ms busy timeout, and kill a process during uncommitted WAL writes before reopening/integrity-checking. Production evidence modules never spawn processes or expose crash switches.

Credential-bearing manifests are persisted and reopened; tests inspect ordinary database rows and repository output for the supplied userinfo/query/signature/fragment secrets. Two query-dependent resources remain separate. The original 890 tests and 97 schema snapshots are retained.

## Node 24/26 and clean-build verification

The final code passed the following commands in order on **each** installed runtime:

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

| Verification                             | Linux Node 24.11.0                     | Linux Node 26.8.1 |
| ---------------------------------------- | -------------------------------------- | ----------------- |
| All seven normal commands                | PASS                                   | PASS              |
| All five clean-build commands            | PASS                                   | PASS              |
| Test and coverage runs, normal and clean | 962 passed; 28 files; 0 failed/skipped | Same              |
| Compiled files before clean-build check  | None                                   | None              |
| Contract snapshots                       | 97 verified; unchanged                 | Same              |
| Package boundaries                       | PASS                                   | PASS              |
| Dependency licenses                      | 145 installed packages checked         | Same              |

Node 26 is the system v26.8.1 at /usr/bin/node. Node 24 is the existing v24.11.0 at /tmp/phoenix-node24/node_modules/node-linux-x64/bin/node, selected through per-process PATH. No runtime/system package was installed. The offline pnpm workspace update added only workspace links/importers, with no new third-party dependency.

The clean-build driver enumerated all package dist directories immediately after `pnpm clean` and recorded an empty file list before `pnpm check`. TypeScript source mappings and Vitest aliases resolve the new workspace before build. As designed, the contracts-check stage inside `pnpm check` subsequently builds packages for snapshot verification. The test-only child resolver independently reads sources; it never requires stale dist output.

Local command logs and machine-readable results are retained under `/tmp/phoenix-wp4-node{24,26}-{normal,clean}-*.log`, `/tmp/phoenix-wp4-verification.json`, and `/tmp/phoenix-wp4-node{24,26}-clean-absence.json`. These are local verification artifacts, not committed repository files. Final verification ran outside the sandbox so preserved real socket/process tests could execute.

## Coverage

The same evidence counters were observed in all four final coverage runs (Node 24/26, normal/clean):

| Metric              | Covered / total | Coverage   |
| ------------------- | --------------- | ---------- |
| Evidence lines      | 554 / 589       | **94.06%** |
| Evidence statements | 616 / 663       | 92.91%     |
| Evidence functions  | 152 / 156       | 97.44%     |
| Evidence branches   | 449 / 522       | 86.02%     |

The evidence line gate remains 85%. Existing contracts/toolkit coverage gates and their tests/assertions are unchanged and pass. Contracts retain 275/276 covered lines; toolkit retains 1221/1247. No established snapshot was regenerated. Windows retry and directory-sync exception paths remain platform-specific coverage limitations; coverage is not proof of complete conformance.

## Remaining risks and acceptance

Actual WP4 Windows/macOS hosted execution is pending. Hard-link availability, readonly unlink races, antivirus interference, directory fsync differences and SQLite lock behavior require the existing five-job CI matrix. No mocked OS behavior counts as platform validation. User-managed local data directories and local disks are required; hostile namespace replacement and network filesystems are outside M0 guarantees. Read iterators must be consumed or closed by their caller. CAS/DB reconciliation is explicit and non-destructive. No deletion/GC, artifact-inclusive backup, protected URL source identity, or WP6 scheduling/recovery policy is implemented.

**Initial readiness assessment (superseded by independent review):** ready for independent review and a subsequent reviewed commit. No commit, push, remote change or hosted CI trigger was performed. The WP4 three-OS exit remains pending actual hosted execution of the new integration tests; Linux success alone does not satisfy it. No work package after WP4 is started.
