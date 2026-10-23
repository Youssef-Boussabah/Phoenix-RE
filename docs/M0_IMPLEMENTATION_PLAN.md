# PHOENIX — M0 Foundation Implementation Plan

> **Document ID:** PHX-M0-PLAN-001
> **Status:** P-1 through P-6 accepted by project instruction on 2026-10-22; WP0/WP1 and hardening implemented; WP2 platform services and WP3 formats/intake implemented, validation recorded separately
> **Date:** 2026-10-22
> **Governing spec:** `docs/PHOENIX_ENGINEERING_SOURCE_OF_TRUTH.md` (PHX-SOT-001 v1.0.2). Where this plan and the source of truth (SOT) disagree, the SOT wins until a proposal in §9 is accepted through the SOT §20.2 workflow.
> **Audience:** the implementing coding agent (Codex) and reviewers.

---

## Implementation clarifications (2026-10-22)

These corrections govern the examples below and are recorded with ADR-0002, ADR-0003, ADR-0005, and ADR-0006.

1. **Zero tool budget:** `JobBudget.maxToolCalls` is a nonnegative safe integer, including zero. Exhaustion means `used >= limit`, checked before each step and each tool dispatch. Zero is immediately exhausted before any work; positive limits permit exactly that many calls. Wall-clock exhaustion also uses `elapsed >= maxWallClockMs`. The runner uses `failed` with `BUDGET_EXHAUSTED` in early states, `partial` where that edge exists. No runner is implemented in WP1.
2. **Unambiguous tree records:** §5.4 now uses canonical JSON arrays followed by LF. JSON escaping protects embedded newlines, quotes, backslashes, and control characters. Paths sort by normalized UTF-8 bytes. Reject normalized-path collisions and non-round-trippable Unicode names; never silently hash a different tree. WP2 must test adversarial filenames, ordering, normalization, exclusions, and truncation. WP1 includes encoding test vectors only; hashing and filesystem traversal remain WP2.
3. **Binary attributes:** remove `tests/fixtures/** binary`. Only actual generated binary fixture paths get `binary` attributes when WP3 creates them. Text source, JSON, README, and static-site fixtures retain LF normalization. WP0 has no binary fixtures.
4. **Crash injection:** production core/CLI/server must contain no environment-triggered exit hook. Implement fault injection only in a dedicated test entry point under `tests/support/`, injecting a callback through internal runner test seams. `PHOENIX_FAULT_POINTS` alone, including with `NODE_ENV=test`, must have no effect on production entry points. WP6/AT-11 must launch the test entry point for deliberate exits and verify production ignores both variables. WP0/WP1 create no crash hook.
5. **Contract consistency defects found during implementation:** top-level serialized/persisted documents (including observations, findings, events, projects, inventory artifacts and reports) carry `schemaVersion: 1`; nested values do not. Defaults are applied by parsing `{}` rather than bypassed by an outer empty-object default. Counts, offsets, sizes and limits are nonnegative safe integers; zero-based sequences allow zero. Require the documented target kind/hash/host equalities, candidate iff verify, null error data, and paired provider identity/version. Observations require inline data or an artifact, matching the planned database constraint. Zod custom refinements are enforced at runtime; generated JSON Schemas explicitly identify runtime-only constraints. No inference of JSON Schema parity is made. Serialized payloads use JSON values so required data cannot silently be undefined or hold bigint/functions/NaN. The SOT §18 events `hypothesis_updated`, `build_completed`, and `comparison_completed` are retained as contracts with no runtime producer yet. Snapshot scripts build the contracts first so Node can resolve the package’s NodeNext `.js` imports without an extra TS runtime. The root declares a development-only workspace dependency on contracts; its TypeScript path mapping lets checks typecheck before the first build.
6. **WP0/WP1 scope:** CI runs checks, build, unit/contract tests, coverage and dependency/license inventory. Integration, CLI doctor, process recovery, fixture hashing and end-to-end jobs are added in their work packages, not represented by empty packages or passing placeholder tests. Three-OS CI execution remains an external acceptance gate until actual runs exist.

## WP0/WP1 review hardening (2026-10-22)

[ADR-0008](adr/ADR-0008-contract-input-hardening.md) governs the original examples below. The executable schemas are in `packages/contracts/src`. JSON-value fields now use iterative `BoundedJsonValue`/`BoundedJsonObject` with root depth zero, maximum depth 64, 50,000 value-node occurrences, and 1,048,576 UTF-8 serialized bytes (including keys, punctuation and escapes). Whole metadata/error objects share one cap. JSON null is a valid explicit value; absent observation data requires an artifact. Persist explicit null as TEXT `"null"`, not SQL NULL. The future server body limit remains 1 MiB in aggregate and must be enforced before decoding; the field validator does not implement a raw JSON parser. Inline outputs honor both the field cap and the requested lower byte cap.

All applicable target URLs use HTTP(S)-only validation; JSON Schema URI format alone does not convey protocol permission. Provider IDs share the dotted ID schema and successful/partial envelopes require identity/version. ProviderStatus IDs agree. File targets use file digests, directory targets use tree digests, URL targets require their URL, and internal URI IDs match the associated identifiers.

Relative paths/exclusions are nonempty, well-formed Unicode, NFC and POSIX-relative, with no absolute/drive paths, NUL, backslashes, empty/dot/traversal segments. Exclusions are literal names/relpaths, not glob expressions. Intake must not silently rename unsupported filesystem names or hash a different tree. WP2 must still perform realpath containment and normalized collision checks. Mach-O CPU fields cover exactly unsigned 32-bit values.

Terminal jobs require `finishedAt`, active jobs forbid it. Active/completed jobs forbid final errors; cancellation reasons use CANCELLED and failure/partial reasons do not. `job_finished` permits only terminal states; budget exhaustion names only `maxWallClockMs` or `maxToolCalls`, with safe nonnegative integer counters satisfying `used >= limit`. Mode and state inputs are validated before transition lookup. The current transition edges remain unchanged. [ADR-0007](adr/ADR-0007-ready-failure-and-execution-time.md) is proposed only: resolve ready-state failure and idle-versus-active execution timing before WP6. Do not implement creation-time charging in WP6 until that decision is resolved.

Public byte-stream types use `AsyncIterable<Uint8Array>` and are compiled without ambient Node types. `pnpm test` includes typechecking (including the portable type surface) before runtime tests. Current Vitest configuration contains only the unit project; integration/e2e projects arrive with their implementations. Semantic positive/negative tests and literal enum expectations cover all eleven listed Opus mutations; `pnpm test:mutations` applies those mutations plus a canary in a disposable copy without regenerating snapshots. Generic missing/wrong-type checks and executable coverage remain useful but do not constitute comprehensive negative validation.

## 0. Scope of this plan

This plan covers the **M0 foundation**: repository, contracts, toolkit and provider registry, target intake, job/evidence persistence, crash-recoverable jobs, `phoenix doctor`, `phoenix inspect`, a minimal local API, tests, and CI on Windows/macOS/Linux.

Explicitly **out of scope** (per the M0 brief): Ghidra integration, Nebius/Nemotron model integration, investigation planning, reconstruction generation, verification engine, browser/Playwright provider, frontend design, MCP server.

> **Important:** the SOT §21 M0 backlog and the SOT M0 exit condition ("reproduce one real investigation and one testable reconstruction") are broader than this brief. This plan does **not** satisfy the SOT M0 exit condition by itself. See decision **P-1** in §9.

### 0.1 Environment inspected (2026-10-22, primary dev host)

| Item                                    | Observed                                                                                             | Consequence                                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Directory                               | Only `PHOENIX_Engineering_Source_of_Truth_v1.0.{md,docx}`                                            | Greenfield repository                                                                                                                       |
| Git                                     | Not initialized                                                                                      | WP0 initializes the repo                                                                                                                    |
| OS / CPU                                | Linux 7.2 (CachyOS) x86_64, 22 cores, 30 GiB RAM                                                     | Only Linux is available locally; Windows/macOS are validated in CI until teammates test on their own machines (SOT §17)                     |
| Node.js                                 | v26.8.1 (no LTS codename yet)                                                                        | Baseline is **Node 24 LTS**; Node 26 is also tested                                                                                         |
| pnpm                                    | 11.18.0                                                                                              | Pin via `packageManager`                                                                                                                    |
| `node:sqlite`                           | Works on Node 26: SQLite 3.53.4, `STRICT` tables, JSON1; **no transaction helper** on `DatabaseSync` | Use built-in SQLite; implement our own `BEGIN IMMEDIATE` helper                                                                             |
| TypeScript on npm                       | `latest` = 7.0.2 (native compiler); 6.0.3 is the newest 6.x                                          | **typescript-eslint 8.72 peer range is `>=4.8.4 <6.1.0`**, so pin TypeScript **6.0.x**                                                      |
| Zod / Vitest / Hono / ESLint / Prettier | 4.6.7 / 5.0.5 / 4.13.13 / 10.13.0 / 3.9.10                                                           | Versions are compatible with Node 24+ (checked engines and peer deps)                                                                       |
| Java / Python                           | OpenJDK 21.0.12 / Python 3.14.7                                                                      | Detected by `doctor` only; no M0 code uses them                                                                                             |
| Native toolchain                        | clang 22, `ld.lld`, `lld-link`, `ld64.lld`, gcc 16                                                   | **Verified:** real ELF x64, PE32+ x64, Mach-O arm64 (exe + object), and WASM fixtures can be built from our own C source on this Linux host |
| Ghidra / rizin / r2                     | Not installed                                                                                        | P1; `doctor` reports them as missing optional tools                                                                                         |
| `file(1)` / libmagic                    | Present on Linux                                                                                     | **Not used**: unavailable on Windows; PHOENIX implements its own signature detection                                                        |

---

## 1. Architecture assessment

### 1.1 Verdict on the planned stack

The stack (TypeScript/Node, pnpm monorepo, Zod, SQLite, React/Vite later, Python/Java/native helpers only behind providers) is a **sound, maintainable, cross-platform foundation**. It is ready to implement with the corrections below. None of them change the product vision.

| Choice                     | Assessment                                                                                                                                  | Required correction                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript + Node          | Correct. One language across contracts, engine, CLI, API, future UI and MCP.                                                                | Pin **TypeScript 6.0.x** (TS 7 breaks typescript-eslint). Baseline **Node ≥ 24.11** (current LTS); test 24 and 26.                                                                                                                                                                                                              |
| pnpm monorepo              | Correct. Strict `node_modules` isolation enforces declared dependencies, which helps package boundaries.                                    | Corepack is no longer bundled with current Node releases, so don't rely on it. Install pnpm explicitly in docs and CI (`pnpm/action-setup`).                                                                                                                                                                                    |
| Zod                        | Correct. Zod 4 has built-in `z.toJSONSchema()`, which gives JSON Schema for MCP tools and model I/O later without a second schema language. | Contracts are Zod-first. TS types are inferred from them. JSON Schema snapshots are committed and checked.                                                                                                                                                                                                                      |
| SQLite                     | Correct for local-first single-user state (SOT §6.4).                                                                                       | Use **built-in `node:sqlite`** instead of a native addon such as `better-sqlite3`. Native addons are the biggest cross-platform install risk (Windows build tools, prebuild gaps on new Node majors, pnpm 10+ blocking install scripts). Wrap it behind a small `Database` adapter so the driver can be swapped through an ADR. |
| React + Vite               | Correct for the later web client. **Not built in M0.**                                                                                      | M0 delivers the API contracts the UI will consume.                                                                                                                                                                                                                                                                              |
| Python/Java/native helpers | Correct as provider-owned child processes.                                                                                                  | M0 delivers the bounded process runner and executable discovery that these helpers will use.                                                                                                                                                                                                                                    |
| HTTP framework             | Not specified in SOT.                                                                                                                       | **Hono** (+ `@hono/node-server`): small, Web-standard `Request`/`Response`, built-in SSE helper, in-process testing via `app.request()`.                                                                                                                                                                                        |

### 1.2 Issues found in the SOT (implementation-level)

Each issue has a proposed resolution. Items marked **⚑** change a SOT design default and need approval (§9). The rest are clarifications that fill gaps without contradicting the SOT.

| #     | Issue                                                                                                                                                                                                                                                                                                                                                                                      | SOT ref    | Resolution                                                                                                                                                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-1 ⚑ | **SOT M0 is much larger than this brief.** It includes a browser/JS provider, a Nemotron call, tool selection, reconstruction, and held-out scenarios. Its exit condition requires a reconstruction.                                                                                                                                                                                       | §21        | Split into **M0-Foundation** (this plan) and **M0-Vertical** (the remaining SOT M0 items). The exit condition stays unchanged for M0 as a whole. Proposal P-1.                                                                                                                        |
| I-2 ⚑ | **State machine gaps.** An `investigate` job can never reach `completed` (no `investigating → completed`). `fingerprinting`, `planning`, and `verifying` cannot reach `failed`. `planning` cannot reach `partial`. "Active state" is undefined. There are no mode guards: an `investigate` job could enter `reconstructing`, which the SOT forbids ("must not silently expand scope", §8). | §7.3       | Amended transition table with mode guards (§3.6). Proposal P-2.                                                                                                                                                                                                                       |
| I-3 ⚑ | **`verify` jobs need two targets** (reference and candidate, §3 Job C, CLI `phoenix verify <reference> <reconstruction>`), but jobs carry one target. Reconstruct jobs reference a prior investigation (`phoenix reconstruct <investigation-id>`).                                                                                                                                         | §3, §7.4   | `Job` gets `candidateTargetId` (required when `mode = verify`) and optional `basedOnJobId`. Part of P-3.                                                                                                                                                                              |
| I-4 ⚑ | **`TargetManifest.hostOs` is ambiguous.** It could mean the intake host or the target's platform. SOT §4 requires storing both. `metadata: Record<string, unknown>` hides the typed facts every consumer needs. `uri` may leak local paths, conflicting with "do not expose raw filesystem paths".                                                                                         | §7.1, §7.4 | Keep all SOT fields. Define `hostOs` = OS of the host that performed intake. Add typed `classification`, `platform`, `formatDetails`, `inventory`, `compatibility`, `warnings`. `uri` never contains a local path; the local path lives in a separate `localPath` field. Part of P-3. |
| I-5 ⚑ | **`CapabilityReport` cannot express availability.** `prerequisites: string[]` doesn't say whether each is satisfied. `needsRuntime` is per provider, but it's really per operation (decompile is static, trace is runtime). `probe()` gets no host or policy context. `doctor` needs a target-independent environment check.                                                               | §7.2       | Additive: `describe()` (static descriptor) and `detect()` (environment) members; `probe(target, context)`; structured prerequisites; per-operation `requiresExecution`. All SOT members are kept with their meaning. Part of P-3.                                                     |
| I-6   | `AnalysisRequest`, `ExecutionContext`, `AnalysisResult`, envelope `status` values, and error codes are referenced but not defined.                                                                                                                                                                                                                                                         | §7.2       | Defined in §3.3–3.4.                                                                                                                                                                                                                                                                  |
| I-7   | `EvidenceRef.location` is free text. This can't be machine-resolved (byte range vs path:line vs address).                                                                                                                                                                                                                                                                                  | §7.1       | Keep `location` as a display string. Add an optional structured `locator`. Add an optional `observationId`. Part of P-3.                                                                                                                                                              |
| I-8   | ID format, timestamp format, data directory location, URI schemes, and tree-hash algorithm for directory targets are unspecified.                                                                                                                                                                                                                                                          | —          | Defined in §3.1, §3.5, §5.                                                                                                                                                                                                                                                            |
| I-9   | The API location is not in the SOT repository layout.                                                                                                                                                                                                                                                                                                                                      | §12        | Add `packages/server` as a thin HTTP transport. Part of P-4.                                                                                                                                                                                                                          |
| I-10  | Section 12 says "Every module requires a named owner", but D-014 (ownership) is OPEN.                                                                                                                                                                                                                                                                                                      | §12, §20   | Each package README states `Owner: unassigned (D-014 OPEN)`. No invented names (SOT §17).                                                                                                                                                                                             |
| I-11  | Schedule: SOT §16.4 puts the browser/JS provider, intake, and evidence persistence on Oct 22–23. Today is Oct 22.                                                                                                                                                                                                                                                                          | §16.4      | This plan is sized to fit before the browser provider starts. It includes a cut list (§9.3) that protects the vertical slice.                                                                                                                                                         |

### 1.3 Design principles applied in M0

1. **One engine, many transports.** CLI, HTTP, and later MCP/UI call the same `PhoenixEngine` methods with the same Zod-validated inputs and outputs. No business logic in transports.
2. **Static-first, read-only intake.** Intake opens target files read-only. It never executes, imports, `require()`s, or shells out on target content. It never follows symlinks or reads FIFOs or devices.
3. **Honest outputs.** Unknown stays `unknown`, each with recorded signals. Truncated inventories never get a digest. Unsupported operations return `NOT_SUPPORTED`. Provider output that fails schema validation is rejected, not passed through.
4. **Atomic state.** Every job state transition, its event, and its step completion commit in one SQLite transaction with optimistic versioning.
5. **No speculative packages.** M0 creates only packages that contain M0 code (SOT §12: "empty scaffolding is not progress").

---

## 2. Final M0 package layout

```text
phoenix/
  package.json                  # private root; scripts only; packageManager pnpm@11.18.0; engines node >=24.11.0
  pnpm-workspace.yaml           # packages: ["packages/*"]
  pnpm-lock.yaml
  tsconfig.base.json            # shared strict compiler options (§6.1)
  tsconfig.json                 # solution file: references every package (tsc -b)
  tsconfig.check.json           # noEmit typecheck of src + tests + scripts via `paths`
  vitest.config.ts              # projects: unit+integration per package, e2e
  eslint.config.js              # flat config, typescript-eslint strictTypeChecked
  .prettierrc.json  .editorconfig  .gitattributes  .gitignore  .node-version
  LICENSE                       # MIT (D-012 design default; see P-6)
  README.md                     # quickstart + SOT precedence statement
  CONTRIBUTING.md               # setup per OS, commands, PR rules, ADR workflow
  docs/
    PHOENIX_ENGINEERING_SOURCE_OF_TRUTH.md   # canonical SOT location (moved, content unchanged)
    M0_IMPLEMENTATION_PLAN.md                # this file
    adr/ADR-0001..0006 (accepted); ADR-0007 proposed; ADR-0008 accepted    # §9 proposals, filed verbatim
  packages/
    contracts/      # Zod schemas, inferred types, error codes, provider/engine interfaces, state machine table. Runtime dep: zod only.
    toolkit/        # host detection, process runner, executable discovery, safe fs reads, hashing,
                    # format signatures + header parsers, intake (classify/inventory), provider registry,
                    # dispatcher, built-in `phoenix.fileinfo` provider
    evidence/       # SQLite adapter, migrations, repositories (projects, targets, jobs, steps, events,
                    # tool invocations, observations, evidence refs, findings, relations), CAS artifact store
    core/           # PhoenixEngine composition root, services, job runner, step leases, recovery, cancellation, doctor
    cli/            # `phoenix` binary: argument parsing + text/JSON rendering only
    server/         # Hono HTTP API + SSE: routing, auth, serialization only
  tests/
    fixtures/       # committed, license-clean fixtures + fixtures.lock.json (§7.4)
    e2e/            # spawn the built CLI and server against fixtures
    support/        # synthetic binary builders, temp-dir helpers (test-only code)
  scripts/
    check-boundaries.ts   check-licenses.ts   contracts-snapshot.ts   fixtures/build-native.sh
  .github/workflows/ci.yml
```

**Not created in M0** (per SOT §12 "create packages only as functional code arrives"): `apps/web`, `apps/desktop`, `investigator`, `reconstruction`, `verification`, `model-adapters`, `providers/*`, `workers/*`, `benchmarks/*`.

**Package names:** `@phoenix/contracts`, `@phoenix/toolkit`, `@phoenix/evidence`, `@phoenix/core`, `@phoenix/cli`, `@phoenix/server`. All are `"private": true` in M0. If the packages are ever published, they need an npm scope we own (P-6).

**Each package has:** `package.json` (`"type": "module"`, a single `"."` export pointing at `dist/index.js` + `dist/index.d.ts`), `tsconfig.json` (composite, `rootDir: src`, `outDir: dist`), `src/`, `test/`, and `README.md` (purpose, public API, owner, test surface).

### 2.1 Dependency boundaries (enforced by `scripts/check-boundaries.ts`)

```text
contracts  ←─ toolkit  ←─┐
    ↑                    core ←─ cli
    └──── evidence  ←────┘   ←─ server
```

| Package   | May depend on (workspace)    | Third-party runtime deps    | Must NOT                                                                         |
| --------- | ---------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| contracts | —                            | `zod`                       | Do I/O; import `node:*` (except types)                                           |
| toolkit   | contracts                    | —                           | Import evidence/core; open the database; write outside scratch dirs it was given |
| evidence  | contracts                    | —                           | Import toolkit/core; spawn processes                                             |
| core      | contracts, toolkit, evidence | —                           | Contain HTTP or CLI parsing; print to stdout                                     |
| cli       | core, contracts              | —                           | Import toolkit/evidence directly; contain business rules                         |
| server    | core, contracts              | `hono`, `@hono/node-server` | Import toolkit/evidence directly; contain business rules                         |

`check-boundaries.ts` reads every package's `package.json` `dependencies` and fails CI on any edge outside this matrix. pnpm's strict linking makes undeclared imports fail at build time.

Dev dependencies (root only): `typescript@6.0.x`, `@types/node@24`, `vitest@5`, `@vitest/coverage-v8@5`, `vite` (Vitest peer), `eslint@10`, `typescript-eslint@8`, `prettier@3`. Pin exact versions in `package.json`. The lockfile is committed. No other dependencies without a PR justification.

---

## 3. Contracts: concrete interfaces and schema decisions

All of these live in `packages/contracts/src/`. Types are `z.infer`'d from schemas unless they describe behavior (interfaces with methods), which are plain TS interfaces. Every top-level persisted or serialized document has `schemaVersion: 1`. `CONTRACTS_VERSION = '1.0.0-m0'`.

Files: `version.ts`, `ids.ts`, `time.ts`, `host.ts`, `errors.ts`, `target.ts`, `artifact.ts`, `evidence.ts`, `provider.ts`, `operations/{index,inspect-target,inspect-assets}.ts`, `job.ts`, `job-state-machine.ts`, `events.ts`, `doctor.ts`, `engine.ts`, `index.ts`.

### 3.1 Primitives

```ts
// ids.ts — `<prefix>_<32 lowercase hex of a UUIDv7>` (time-ordered, sortable, debuggable)
export const ID_PREFIXES = {
  project: 'prj',
  target: 'tgt',
  artifact: 'art',
  job: 'job',
  step: 'stp',
  event: 'evt',
  request: 'req',
  observation: 'obs',
  evidence: 'evr',
  finding: 'fnd',
  relation: 'rel',
} as const;
export const idSchema = <B extends string>(prefix: string, _brand: B) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[0-9a-f]{32}$`))
    .brand<B>();
export const ProjectId = idSchema('prj', 'ProjectId');
export type ProjectId = z.infer<typeof ProjectId>;
export const TargetId = idSchema('tgt', 'TargetId'); // …likewise for every prefix
// newId(prefix) lives in toolkit (needs crypto); contracts stays I/O-free.

// time.ts — always UTC, millisecond precision, `Z` suffix
export const IsoTimestamp = z.iso.datetime({ offset: false, precision: 3 });

export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

// host.ts
export const HostOs = z.enum(['windows', 'macos', 'linux']); // supported host OSes (D-005)
export const CpuArch = z.enum(['x86', 'x64', 'arm', 'arm64', 'riscv64', 'wasm32', 'other', 'unknown']);
export const HostInfo = z.object({
  os: HostOs,
  arch: CpuArch,
  osRelease: z.string(),
  nodeVersion: z.string(),
  isWsl: z.boolean(), // Linux under WSL (affects later runner eligibility)
  translated: z.boolean().optional(), // macOS Rosetta / Windows-on-ARM emulation, when detectable
  phoenixVersion: z.string(),
});
```

### 3.2 Errors (`errors.ts`)

Closed set. Every error is normalized to this shape at a package boundary. Messages are sanitized: no secrets, and the home directory is collapsed to `~`.

```ts
export const ErrorCode = z.enum([
  'INVALID_REQUEST',          // schema validation failed
  'NOT_FOUND',                // project/target/job/artifact id unknown
  'TARGET_UNREADABLE',        // permission denied, vanished, not a regular file/dir
  'TARGET_CHANGED',           // digest mismatch on re-verification, or changed during read
  'NOT_SUPPORTED',            // operation not implemented for this target/provider (SOT §6.2)
  'PROVIDER_UNAVAILABLE',     // provider registered but prerequisites missing
  'HOST_INCOMPATIBLE',        // provider/operation cannot run on this host
  'POLICY_DENIED',            // operation needs execution/network not allowed by job policy
  'TIMEOUT',
  'CANCELLED',
  'OUTPUT_LIMIT_EXCEEDED',
  'PROVIDER_FAILED',          // provider threw / child process failed
  'PROVIDER_OUTPUT_INVALID',  // provider result failed its operation result schema
  'INVALID_STATE_TRANSITION',
  'CONFLICT',                 // optimistic-concurrency version mismatch
  'BUDGET_EXHAUSTED',
  'STEP_RETRIES_EXHAUSTED',
  'STORAGE_ERROR',            // SQLite / CAS failure, corrupted row failing schema
  'MIGRATION_FAILED',
  'MIGRATION_CHECKSUM_MISMATCH',
  'DB_SCHEMA_TOO_NEW',        // DB written by a newer PHOENIX; refuse to open
  'UNAUTHORIZED',             // server token missing/invalid
  'INTERNAL',
]);
export const PhoenixErrorShape = z.object({
  code: ErrorCode, message: z.string(), retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export class PhoenixError extends Error {           // no parameter properties (erasableSyntaxOnly)
  readonly code: ErrorCode; readonly retryable: boolean; readonly details?: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, opts?: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown }) { … }
  toShape(): PhoenixErrorShape { … }
}
```

| Code                                                   | HTTP | CLI exit | Retryable default |
| ------------------------------------------------------ | ---- | -------- | ----------------- |
| INVALID_REQUEST                                        | 400  | 2        | no                |
| UNAUTHORIZED                                           | 401  | 1        | no                |
| POLICY_DENIED                                          | 403  | 1        | no                |
| NOT_FOUND                                              | 404  | 1        | no                |
| CONFLICT, INVALID_STATE_TRANSITION                     | 409  | 1        | CONFLICT yes      |
| TARGET_CHANGED                                         | 409  | 1        | no                |
| NOT_SUPPORTED, HOST_INCOMPATIBLE, PROVIDER_UNAVAILABLE | 422  | 1        | no                |
| OUTPUT_LIMIT_EXCEEDED                                  | 413  | 1        | no                |
| TIMEOUT                                                | 504  | 1        | yes               |
| DB_SCHEMA_TOO_NEW, MIGRATION_*                         | 503  | 1        | no                |
| everything else                                        | 500  | 1        | per instance      |

CLI exit codes: `0` success; `1` operation failed (a `PhoenixError` was reported); `2` usage or validation error; `3` `doctor` found a failing required check; `70` unexpected internal crash.

### 3.3 Target intake schemas (`target.ts`)

```ts
// SOT §7.1, unchanged
export const TargetKind = z.enum([
  'web',
  'electron',
  'source',
  'elf',
  'pe',
  'macho',
  'android',
  'dotnet',
  'wasm',
  'unknown',
]);

export const FileFormat = z.enum([
  'elf',
  'pe',
  'macho',
  'macho-fat',
  'wasm',
  'dex',
  'apk',
  'asar',
  'zip',
  'jar',
  'java-class',
  'html',
  'text',
  'empty',
  'directory',
  'url',
  'unknown',
]);
export const ClassificationBasis = z.enum(['signature', 'structure', 'extension', 'heuristic', 'url-scheme']);
export const ClassificationSignal = z.object({
  basis: ClassificationBasis,
  description: z.string(), // e.g. "magic 7f454c46 at offset 0"
  path: z.string().optional(), // relative path for directory signals
});
export const TargetClassification = z.object({
  kind: TargetKind,
  format: FileFormat,
  signals: z.array(ClassificationSignal), // every decision is explained; never a numeric confidence (SOT §6.3)
  classifierVersion: z.string(), // bump on any rule change; part of cache keys
});

export const TargetOs = z.enum(['windows', 'macos', 'linux', 'android', 'freebsd', 'any', 'unknown']);
export const TargetPlatform = z.object({
  os: TargetOs,
  osBasis: z.enum(['header', 'assumed', 'not-applicable']), // ELF OSABI=0 ⇒ linux 'assumed'
  arches: z.array(CpuArch), // >1 for fat Mach-O
  bitness: z.union([z.literal(32), z.literal(64)]).optional(),
  endianness: z.enum(['little', 'big']).optional(),
  binaryType: z.enum(['executable', 'shared-library', 'object', 'core', 'bundle', 'unknown']).optional(),
});

// Execution compatibility is information only; it is NOT permission to run anything.
export const HostCompatibility = z.object({
  staticAnalysis: z.literal('supported'), // static inspection is host-independent
  nativeExecution: z.enum(['compatible', 'emulation-required', 'incompatible', 'not-applicable', 'unknown']),
  reason: z.string(),
});

export const FormatDetails = z.discriminatedUnion('format', [
  z.object({
    format: z.literal('elf'),
    class: z.enum(['elf32', 'elf64']),
    data: z.enum(['lsb', 'msb']),
    osabi: z.int(),
    type: z.int(),
    machine: z.int(),
    entry: z.string() /* hex */,
    interpreter: z.string().optional(),
  }),
  z.object({
    format: z.literal('pe'),
    machine: z.int(),
    magic: z.enum(['pe32', 'pe32+']),
    characteristics: z.int(),
    isDll: z.boolean(),
    subsystem: z.int(),
    sectionCount: z.int(),
    timeDateStamp: z.int(),
    hasClrHeader: z.boolean(),
  }),
  z.object({
    format: z.literal('macho'),
    cpuType: z.int(),
    cpuSubtype: z.int(),
    fileType: z.int(),
    loadCommandCount: z.int(),
    flags: z.int(),
    bits: z.union([z.literal(32), z.literal(64)]),
  }),
  z.object({
    format: z.literal('macho-fat'),
    arches: z.array(z.object({ cpuType: z.int(), cpuSubtype: z.int(), offset: z.int(), size: z.int() })),
  }),
  z.object({ format: z.literal('wasm'), version: z.int() }),
  z.object({ format: z.literal('dex'), version: z.string() }),
  z.object({
    format: z.enum(['zip', 'jar', 'apk']),
    entryCount: z.int(),
    sampledEntries: z.array(z.string()),
    truncated: z.boolean(),
    zip64: z.boolean(),
  }),
  z.object({ format: z.literal('asar'), headerSize: z.int(), fileCount: z.int(), truncated: z.boolean() }),
  z.object({ format: z.literal('java-class'), majorVersion: z.int(), minorVersion: z.int() }),
  z.object({
    format: z.literal('text'),
    encoding: z.enum(['ascii', 'utf-8', 'utf-8-bom']),
    shebang: z.string().optional(),
  }),
]);

export const InventorySummary = z.object({
  fileCount: z.int(),
  directoryCount: z.int(),
  symlinkCount: z.int(),
  otherCount: z.int(),
  totalBytes: z.int(),
  truncated: z.boolean(), // limits hit ⇒ no tree digest is produced
  excluded: z.array(z.string()), // e.g. ['.git'] — always reported, never silent
  formats: z.record(z.string(), z.int()), // histogram FileFormat → count
});

export const TargetWarning = z.object({ code: z.string(), message: z.string(), path: z.string().optional() });

export const TargetSource = z.object({
  type: z.enum(['file', 'directory', 'url']),
  displayName: z.string(), // basename or URL origin+path; safe to show remotely
});

// Result of stateless inspection (`phoenix inspect`): nothing persisted, no ids.
export const TargetDescription = z.object({
  schemaVersion: z.literal(1),
  source: TargetSource,
  localPath: z.string().optional(), // absolute path; local transports only — stripped by any remote serializer
  url: z.url().optional(),
  classification: TargetClassification,
  kind: TargetKind, // = classification.kind (kept top-level for SOT compatibility)
  platform: TargetPlatform.optional(),
  formatDetails: FormatDetails.optional(),
  digest: z.object({ algorithm: z.enum(['sha256', 'phoenix-tree-sha256-v1']), value: Sha256Hex }).optional(),
  sha256: Sha256Hex.optional(), // SOT field: = digest.value when algorithm === 'sha256'
  sizeBytes: z.int().optional(),
  inventory: InventorySummary.optional(),
  compatibility: HostCompatibility,
  warnings: z.array(TargetWarning),
  inspectedAt: IsoTimestamp,
  inspectedOn: HostInfo,
});

// Persisted, immutable. SOT §7.1 fields are all present with SOT meaning (+ clarifications).
export const TargetManifest = TargetDescription.extend({
  id: TargetId,
  projectId: ProjectId,
  uri: z.string(), // 'phoenix:artifact/<artId>' | 'phoenix:target/<tgtId>/source' | http(s) URL. Never a local path.
  hostOs: HostOs, // SOT field: OS of the host that performed intake (= inspectedOn.os)
  intakeMode: z.enum(['snapshot', 'reference']),
  artifactId: ArtifactId.optional(), // snapshot of a file target
  inventoryArtifactId: ArtifactId.optional(), // directory inventory document (JSON) in CAS
  supersedes: TargetId.optional(), // previous manifest for the same source with a different digest
  createdAt: IsoTimestamp,
  metadata: z.record(z.string(), z.unknown()), // SOT field: free-form labels/extensions; typed facts never go here
});

export const InventoryEntry = z.object({
  path: z.string(), // POSIX separators, relative, NFC-normalized for display/sort
  type: z.enum(['file', 'directory', 'symlink', 'other']),
  sizeBytes: z.int().optional(),
  sha256: Sha256Hex.optional(),
  format: FileFormat.optional(),
});
```

**Intake inputs:** `IntakeSource = { type: 'path', path: string } | { type: 'url', url: string }`. Options: `{ exclude: string[] (default ['.git']), maxEntries (default 50_000), maxTotalBytes (default 4 GiB), maxSnapshotBytes (default 2 GiB) }`.

### 3.4 Provider contracts (`provider.ts`, `operations/`)

```ts
// The SOT §6.2 minimum operation set. Declaring an id does not imply an implementation.
export const OperationId = z.enum([
  'inspect_target',
  'list_modules',
  'list_functions',
  'decompile_function',
  'get_references',
  'get_call_graph',
  'inspect_assets',
  'trace_runtime',
  'run_experiment',
  'capture_interface',
]);

// Static, target-independent descriptor (added; SOT `id`/`version` kept on the provider itself).
export const ProviderDescriptor = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/), // e.g. 'phoenix.fileinfo', 'ghidra.headless'
  version: z.string(),
  displayName: z.string(),
  operations: z.array(
    z.object({ operation: OperationId, requiresExecution: z.boolean(), requiresNetwork: z.boolean() }),
  ),
  supportedKinds: z.array(TargetKind),
  supportedHosts: z.array(HostOs),
  priority: z.int(), // deterministic selection order (lower first, then id)
});

export const Prerequisite = z.object({
  id: z.string(),
  description: z.string(),
  satisfied: z.boolean(),
  detail: z.string().optional(), // e.g. detected version, or why missing
  remediation: z.string().optional(),
});
export const ProviderAvailability = z.object({
  providerId: z.string(),
  available: z.boolean(),
  prerequisites: z.array(Prerequisite),
  checkedAt: IsoTimestamp,
});

// SOT §7.2 fields kept; prerequisites made structured; per-target availability added.
export const CapabilityReport = z.object({
  providerId: z.string(),
  providerVersion: z.string(),
  available: z.boolean(), // all prerequisites satisfied AND host supported AND kind supported
  supportedOperations: z.array(OperationId), // for THIS target on THIS host
  supportedKinds: z.array(TargetKind),
  needsRuntime: z.boolean(), // SOT field: true if any supported op requires execution
  supportedHosts: z.array(HostOs),
  prerequisites: z.array(Prerequisite),
  reasons: z.array(z.string()), // human-readable explanation when unavailable/limited
});

export const AnalysisRequest = z.object({
  requestId: RequestId,
  operation: OperationId,
  targetId: TargetId.optional(), // absent for stateless (unsaved) inspection
  providerId: z.string().optional(), // explicit selection; otherwise registry selects
  params: z.unknown(), // validated against the operation's params schema
  limits: z
    .object({
      timeoutMs: z.int().min(100).max(3_600_000).default(30_000),
      maxInlineBytes: z
        .int()
        .max(8 * 1024 * 1024)
        .default(1024 * 1024),
    })
    .default({}),
});

export const EnvelopeStatus = z.enum(['ok', 'partial', 'error']);
export const ToolWarning = z.object({ code: z.string(), message: z.string() });
export const PageInfo = z.object({ nextCursor: z.string().optional(), total: z.int().optional() });

// SOT §7.2 envelope: all required fields present.
export const ToolResponseEnvelope = z
  .object({
    schemaVersion: z.literal(1),
    requestId: RequestId,
    operation: OperationId,
    providerId: z.string().nullable(), // null when no provider could be resolved (e.g. NOT_SUPPORTED at selection)
    providerVersion: z.string().nullable(),
    targetId: TargetId.nullable(), // null for stateless inspection
    timestamp: IsoTimestamp, // completion time
    status: EnvelopeStatus,
    durationMs: z.int(),
    data: z.unknown().nullable(), // operation result (validated) or null on error
    evidenceRefs: z.array(EvidenceRef),
    artifacts: z.array(ArtifactRef), // large outputs live here, never inline (SOT §7.2)
    page: PageInfo.optional(),
    warnings: z.array(ToolWarning),
    error: PhoenixErrorShape.nullable(), // non-null iff status === 'error'
  })
  .refine((e) => (e.status === 'error') === (e.error !== null), 'error iff status=error');
```

Behavioral interfaces (TypeScript only):

```ts
export interface AnalysisProvider {
  readonly id: string; // SOT
  readonly version: string; // SOT
  describe(): ProviderDescriptor; // added: static, pure
  detect(ctx: DetectContext): Promise<ProviderAvailability>; // added: environment check (doctor); cacheable per process
  probe(target: TargetManifest | TargetDescription, ctx: ProbeContext): Promise<CapabilityReport>; // SOT + ctx
  execute(request: AnalysisRequest, context: ExecutionContext): Promise<AnalysisResult>; // SOT
  close?(): Promise<void>; // SOT
}

export interface DetectContext {
  host: HostInfo;
  signal: AbortSignal;
  tools: ToolLocator;
}
export interface ProbeContext {
  host: HostInfo;
  availability: ProviderAvailability;
  policy: ExecutionPolicy;
}

export interface ExecutionContext {
  requestId: RequestId;
  jobId?: JobId;
  host: HostInfo;
  policy: ExecutionPolicy; // { allowExecution, allowNetwork, allowCloudInference } — all false in M0
  signal: AbortSignal; // fires on timeout, job cancellation, or Ctrl+C
  deadline: number; // epoch ms
  limits: { maxInlineBytes: number };
  target: TargetAccess; // contained, read-only access to target bytes
  artifacts: ArtifactWriter; // attach large outputs to the CAS
  scratchDir: string; // per-request temp dir, deleted after the call
  logger: Logger; // sanitized structured logger
  tools: ToolLocator; // executable discovery
  process: ProcessRunner; // bounded child processes (future Java/Python/native helpers)
}

export interface TargetAccess {
  readonly description: TargetManifest | TargetDescription;
  readRange(offset: number, length: number, relPath?: string): Promise<Uint8Array>; // bounded; relPath for directory targets
  openStream(relPath?: string): Promise<NodeJS.ReadableStream>;
  listInventory(
    cursor?: string,
    limit?: number,
  ): Promise<{ entries: InventoryEntry[]; nextCursor?: string; total: number }>;
  resolveLocalPath(relPath?: string): Promise<string>; // read-only path for engines that need a file (Ghidra). Containment-checked.
}
export interface ArtifactWriter {
  putBytes(bytes: Uint8Array, mediaType: string): Promise<ArtifactRef>;
  putStream(stream: NodeJS.ReadableStream, mediaType: string, maxBytes: number): Promise<ArtifactRef>;
}

// What a provider returns; the toolkit wraps it in the envelope. Providers signal failure by throwing PhoenixError.
export interface AnalysisResult {
  status: 'ok' | 'partial';
  data: unknown; // must satisfy operationSchemas[op].result
  evidence: EvidenceDraft[]; // locator + kind; toolkit/core assign ids and artifact ids
  artifacts?: ArtifactRef[];
  page?: PageInfo;
  warnings?: ToolWarning[];
}
```

**Operation schemas implemented in M0** (`operations/index.ts` exports `operationSchemas: Partial<Record<OperationId, { params: ZodType; result: ZodType }>>`). An operation with no schema entry cannot be dispatched and always yields `NOT_SUPPORTED`. This avoids writing speculative schemas for operations no provider implements yet.

```ts
// inspect_target — deeper static header facts than the manifest
params: z.object({ maxSections: z.int().min(1).max(1024).default(256) });
result: z.object({
  formatDetails: FormatDetails.optional(),
  sections: z.array(
    z.object({
      name: z.string(),
      offset: z.int(),
      size: z.int(),
      virtualAddress: z.string().optional(),
      flags: z.array(z.string()),
    }),
  ),
  sectionsTruncated: z.boolean(),
});

// inspect_assets — paginated inventory: filesystem (directories), ZIP central directory, or ASAR header (no extraction)
params: z.object({
  cursor: z.string().optional(),
  limit: z.int().min(1).max(5000).default(500),
  pathPrefix: z.string().optional(),
});
result: z.object({
  source: z.enum(['filesystem', 'zip-central-directory', 'asar-header', 'single-file']),
  entries: z.array(InventoryEntry),
  total: z.int(),
}); // nextCursor goes in envelope.page
```

### 3.5 Artifacts and evidence (`artifact.ts`, `evidence.ts`)

```ts
export const ArtifactRef = z.object({
  id: ArtifactId,
  sha256: Sha256Hex,
  sizeBytes: z.int(),
  mediaType: z.string(),
});

export const Locator = z.discriminatedUnion('type', [
  z.object({ type: z.literal('byte-range'), offset: z.int(), length: z.int() }),
  z.object({
    type: z.literal('path'),
    path: z.string(),
    line: z.int().optional(),
    column: z.int().optional(),
  }),
  z.object({ type: z.literal('address'), address: z.string() /* hex */, space: z.string().optional() }),
  z.object({ type: z.literal('event'), sequence: z.int() }),
  z.object({ type: z.literal('region'), x: z.int(), y: z.int(), width: z.int(), height: z.int() }),
]);

// SOT §7.1 fields unchanged; locator/observationId added.
export const EvidenceRef = z.object({
  id: EvidenceRefId,
  kind: z.enum(['static', 'runtime', 'user', 'derived']),
  artifactId: ArtifactId, // the bytes the evidence is about (target snapshot, inventory doc, tool output)
  location: z.string().optional(), // SOT: human-readable, e.g. "0x0-0x40", "src/app.js:12"
  locator: Locator.optional(), // machine-resolvable form of `location`
  observationId: ObservationId.optional(), // the tool observation that interpreted those bytes
});

export const Producer = z.object({
  type: z.enum(['intake', 'provider', 'user', 'model']),
  id: z.string(),
  version: z.string(), // e.g. intake@classifier-1, phoenix.fileinfo@0.1.0
});

export const Observation = z.object({
  id: ObservationId,
  targetId: TargetId,
  jobId: JobId.optional(),
  requestId: RequestId.optional(),
  producer: Producer,
  kind: EvidenceRef.shape.kind,
  type: z.string(), // 'intake.classification' | 'job.capabilities' | 'tool.inspect_target' | …
  data: z.unknown().optional(),
  dataArtifactId: ArtifactId.optional(),
  targetDigest: Sha256Hex.optional(), // digest of the target the observation was made against (invalidation)
  createdAt: IsoTimestamp,
});

// SOT §7.1 Finding, plus revision metadata. Findings are append-only revisions (reversible updates, SOT §6.4).
export const FindingStatus = z.enum(['hypothesis', 'observed', 'corroborated', 'contradicted']);
export const Finding = z
  .object({
    id: FindingId,
    targetId: TargetId,
    statement: z.string().min(1),
    status: FindingStatus,
    evidence: z.array(EvidenceRef),
    limitations: z.array(z.string()),
    revision: z.int().min(1),
    author: Producer,
    createdAt: IsoTimestamp,
  })
  .refine(
    (f) => f.status === 'hypothesis' || f.evidence.length > 0,
    'observed/corroborated/contradicted findings must cite evidence (SOT §6.4)',
  );

export const RelationType = z.enum([
  'calls',
  'imports',
  'derived_from',
  'supports',
  'contradicts',
  'produced_by',
  'tests',
  'implements',
  'observed_in',
  'supersedes',
]); // SOT §6.4
```

M0-Foundation will produce **observations** (intake, capability snapshots, tool calls). It does **not** auto-generate findings, because findings are interpretations and belong to the investigator. WP1 implements finding schemas/tests; repositories arrive in WP4 and are not claimed complete here.

### 3.6 Jobs and state machine (`job.ts`, `job-state-machine.ts`)

```ts
export const JobMode = z.enum(['investigate', 'reconstruct', 'verify']); // SOT
export const JobState = z.enum([
  'created',
  'fingerprinting',
  'ready',
  'planning',
  'investigating',
  'reconstructing',
  'verifying',
  'completed',
  'partial',
  'failed',
  'cancelled',
]); // SOT, unchanged

export const ExecutionPolicy = z.object({
  allowExecution: z.boolean().default(false), // D-013; dispatcher enforces POLICY_DENIED
  allowNetwork: z.boolean().default(false),
  allowCloudInference: z.boolean().default(false),
});
export const JobBudget = z.object({
  // M0 enforces wall clock + tool calls; others added with their subsystems
  maxWallClockMs: z
    .int()
    .positive()
    .default(30 * 60_000),
  maxToolCalls: z.int().nonnegative().default(200),
});

export const Job = z
  .object({
    schemaVersion: z.literal(1),
    id: JobId,
    projectId: ProjectId,
    mode: JobMode,
    objective: z.string().min(1).max(4000),
    targetId: TargetId, // primary target (the reference in verify mode)
    candidateTargetId: TargetId.optional(), // required iff mode === 'verify' (I-3)
    basedOnJobId: JobId.optional(), // e.g. reconstruct from a completed investigation
    state: JobState,
    version: z.int(),
    budget: JobBudget,
    policy: ExecutionPolicy,
    host: HostInfo.optional(), // host that fingerprinted the job (SOT §4: host ≠ target format)
    error: PhoenixErrorShape.optional(),
    createdAt: IsoTimestamp,
    updatedAt: IsoTimestamp,
    finishedAt: IsoTimestamp.optional(),
  })
  .refine(
    (j) => (j.mode === 'verify') === (j.candidateTargetId !== undefined),
    'verify jobs need candidateTargetId',
  );

export const StepStatus = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
```

**Transition table (proposal P-2).** SOT edges are unmarked. Additions are marked `+`.

| From                                  | To                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------- |
| created                               | fingerprinting, `+`failed, cancelled                                       |
| fingerprinting                        | ready, `+`failed, cancelled                                                |
| ready                                 | planning, cancelled                                                        |
| planning                              | investigating, reconstructing, verifying, `+`partial, `+`failed, cancelled |
| investigating                         | planning, reconstructing, `+`completed, partial, failed, cancelled         |
| reconstructing                        | verifying, planning, partial, failed, cancelled                            |
| verifying                             | completed, reconstructing, investigating, partial, `+`failed, cancelled    |
| completed, partial, failed, cancelled | — (terminal)                                                               |

`ACTIVE_STATES` = every non-terminal state, matching SOT "any active state → cancelled".

**Mode guards** (evaluated with the table; both must pass):

| Edge                        | Allowed modes       |
| --------------------------- | ------------------- |
| `* → reconstructing`        | reconstruct         |
| `* → verifying`             | reconstruct, verify |
| `investigating → completed` | investigate         |
| `verifying → completed`     | reconstruct, verify |

```ts
export const TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = { … };   // table above
export const MODE_GUARDS: readonly { to: JobState; from?: JobState; modes: readonly JobMode[] }[] = [ … ];
export function canTransition(mode: JobMode, from: JobState, to: JobState): boolean;
export function assertTransition(mode: JobMode, from: JobState, to: JobState): void; // throws INVALID_STATE_TRANSITION
export const isTerminal = (s: JobState) => TERMINAL_STATES.includes(s);
```

**M0 runner coverage:** `created → fingerprinting → ready`, plus `failed` and `cancelled`. The rest of the table is implemented and exhaustively tested, but no M0 handler drives those edges. M0 jobs **rest in `ready`** until a planner exists. `job show` and the API state this explicitly ("planning is not available in this build").

### 3.7 Job events (`events.ts`)

Discriminated union on `type`. These are the SOT §18 names plus a few additions needed for M0 (marked `+`).

```ts
const base = { id: EventId, jobId: JobId, seq: z.int(), createdAt: IsoTimestamp };
export const JobEvent = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('job_created'),
    payload: z.object({ mode: JobMode, targetId: TargetId }),
  }), // +
  z.object({ ...base, type: z.literal('job_started'), payload: z.object({ runner: z.string() }) }),
  z.object({
    ...base,
    type: z.literal('job_state_changed'),
    payload: z.object({ from: JobState, to: JobState, reason: z.string().optional() }),
  }), // +
  z.object({
    ...base,
    type: z.literal('target_identified'),
    payload: z.object({
      targetId: TargetId,
      kind: TargetKind,
      format: FileFormat,
      digest: Sha256Hex.optional(),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('capabilities_probed'),
    payload: z.object({ available: z.array(z.string()), unavailable: z.array(z.string()) }),
  }), // +
  z.object({
    ...base,
    type: z.literal('provider_selected'),
    payload: z.object({ providerId: z.string(), operation: OperationId }),
  }),
  z.object({
    ...base,
    type: z.literal('tool_executed'),
    payload: z.object({
      requestId: RequestId,
      operation: OperationId,
      providerId: z.string().nullable(),
      status: EnvelopeStatus,
      durationMs: z.int(),
      errorCode: ErrorCode.optional(),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('evidence_saved'),
    payload: z.object({ observationIds: z.array(ObservationId) }),
  }),
  z.object({
    ...base,
    type: z.literal('step_failed'),
    payload: z.object({
      stepKey: z.string(),
      attempt: z.int(),
      error: PhoenixErrorShape,
      willRetry: z.boolean(),
    }),
  }), // +
  z.object({
    ...base,
    type: z.literal('step_recovered'),
    payload: z.object({ stepKey: z.string(), previousOwner: z.string() }),
  }), // +
  z.object({
    ...base,
    type: z.literal('budget_exhausted'),
    payload: z.object({ budget: z.string(), limit: z.number(), used: z.number() }),
  }),
  z.object({
    ...base,
    type: z.literal('job_finished'),
    payload: z.object({ state: JobState, error: PhoenixErrorShape.optional() }),
  }),
]);
```

### 3.8 Engine API — the single business-logic surface (`engine.ts`)

CLI, server, and future MCP/UI call only this interface. Each method re-validates its input with the listed schema. This is defense in depth, because server and MCP inputs are untrusted.

```ts
export interface PhoenixEngine {
  readonly version: string;
  doctor(input?: DoctorInput): Promise<DoctorReport>;
  inspect(input: InspectInput, signal?: AbortSignal): Promise<InspectReport>; // stateless; never opens the DB
  providers: { list(): Promise<ProviderStatus[]> }; // descriptor + availability
  tools: { invoke(input: ToolInvokeInput, signal?: AbortSignal): Promise<ToolResponseEnvelope> };
  projects: {
    create(i: CreateProjectInput): Promise<Project>;
    list(p?: PageInput): Promise<Page<Project>>;
    get(id: ProjectId): Promise<Project>;
  };
  targets: {
    add(i: AddTargetInput, signal?: AbortSignal): Promise<TargetManifest>;
    get(id: TargetId): Promise<TargetManifest>;
    list(i: ListTargetsInput): Promise<Page<TargetManifest>>;
  };
  jobs: {
    create(i: CreateJobInput): Promise<Job>; // persists; does not run
    run(id: JobId, signal?: AbortSignal): Promise<Job>; // drive until ready/terminal/blocked
    get(id: JobId): Promise<JobView>; // job + steps + `nextAction` explanation
    list(i: ListJobsInput): Promise<Page<Job>>;
    cancel(id: JobId, reason?: string): Promise<Job>;
    resume(id: JobId, signal?: AbortSignal): Promise<Job>; // recover + run
    events(id: JobId, afterSeq?: number, limit?: number): Promise<Page<JobEvent>>;
    recoverInterrupted(): Promise<JobId[]>;
  };
  evidence: { list(i: ListEvidenceInput): Promise<Page<EvidenceItem>> }; // observations + findings, with `stale` flag
  close(): Promise<void>;
}
// InspectReport = { schemaVersion: 1, target: TargetDescription, capabilities: CapabilityReport[], durationMs }
// ToolInvokeInput = { operation, target: { targetId } | { path }, providerId?, params?, limits? }
// Page<T> = { items: T[], nextCursor?: string }   (opaque cursor = base64url of last sort key)
// DoctorReport = { schemaVersion: 1, phoenixVersion, host: HostInfo, dataDir: { path, exists, writable, schemaVersion?, pendingMigrations? },
//                  checks: DoctorCheck[], providers: ProviderStatus[], ok: boolean }
// DoctorCheck = { id, title, category: 'required'|'optional', status: 'pass'|'warn'|'fail'|'skip', detail, remediation?, neededBy: string[] }
```

Future MCP integration maps each engine method to one MCP tool and derives its JSON Schema with `z.toJSONSchema(inputSchema)`. No engine logic is duplicated (SOT §7.4).

---

## 4. Module responsibilities

### 4.1 `@phoenix/toolkit`

```text
src/
  platform/host.ts          detectHost(): os/arch mapping (win32→windows, darwin→macos), WSL (/proc/version contains "microsoft"),
                            Rosetta (sysctl.proc_translated via `sysctl -n`, best-effort), unsupported OS ⇒ PhoenixError
  platform/paths.ts         defaultDataDir(): PHOENIX_HOME | Linux $XDG_DATA_HOME/phoenix (~/.local/share/phoenix)
                            | macOS ~/Library/Application Support/PHOENIX | Windows %LOCALAPPDATA%\PHOENIX
                            toPosixRel(), nfc(), assertContained(root, candidate) (realpath-based)
  platform/which.ts         findExecutable(name): PATH (+ PATHEXT on Windows); detects the Windows Store `python.exe` alias
                            stub under …\WindowsApps\ and reports it as "not installed"
  platform/process.ts       runProcess({ file, args, cwd, timeoutMs, maxOutputBytes, signal, env }): execFile-style, shell:false,
                            windowsHide, minimal env allowlist (PATH, SystemRoot, TEMP/TMP, HOME/USERPROFILE, LANG, JAVA_HOME …),
                            kills the process tree on timeout/abort (POSIX: detached process group + kill(-pid);
                            Windows: `taskkill /T /F /PID`), refuses .bat/.cmd in M0 (NOT_SUPPORTED, BatBadBut class of bugs)
  ids.ts                    newId(prefix): UUIDv7 via crypto.getRandomValues + Date.now()
  fs/safe-read.ts           openRegularFile(path): lstat → must be regular file (no symlink/FIFO/device/socket), open 'r',
                            fstat; readRange(); compare size+mtimeMs before/after ⇒ TARGET_CHANGED
  hash/sha256.ts            hashStream(); hashFileTo(path, sink?) — single pass: hash and optionally tee into CAS writer
  hash/tree.ts              phoenix-tree-sha256-v1 (§5.4)
  formats/signature.ts      detectSignature(head: Uint8Array, size): ordered magic table (§4.1.1)
  formats/elf.ts pe.ts macho.ts zip.ts asar.ts wasm.ts dex.ts javaclass.ts text.ts
                            bounded parsers: every read is length-checked; malformed ⇒ partial details + warning, never throw raw errors
  intake/classify-file.ts   signature + structure ⇒ TargetClassification, TargetPlatform, FormatDetails
  intake/classify-dir.ts    directory rules (§4.1.2)
  intake/inventory.ts       iterative walk (no recursion limits issues), lstat only, never follows symlinks, limits, exclusions
  intake/compatibility.ts   platform × host ⇒ HostCompatibility
  intake/describe.ts        describeTarget(source, options, host, signal): TargetDescription  ← used by inspect AND targets.add
  registry/registry.ts      ProviderRegistry: register(), list(), detectAll() (cached), probeAll(target, ctx), select(op, target, ctx)
  dispatch/dispatcher.ts    invoke(request, deps): ToolResponseEnvelope — never throws (§4.1.3)
  builtin/fileinfo/         'phoenix.fileinfo' provider: inspect_target, inspect_assets; all other operations NOT_SUPPORTED
  log/logger.ts             NDJSON logger to stderr; levels; redact(): known token patterns, Bearer/Authorization, private-key
                            blocks, home dir → '~'; text-mode terminal output escapes control characters (ANSI injection from filenames)
```

#### 4.1.1 Signature table (first match wins; the first 64 KiB is read once)

| Check                                                         | Format → Kind                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| size == 0                                                     | `empty` → unknown (warning `EMPTY_FILE`)                                                                                                                                                                                                                   |
| `7F 45 4C 46`                                                 | `elf` → elf. Android if a `.note.android.ident` section is present (os=android); AppImage if `41 49 02` at offset 8 (warning, still elf)                                                                                                                   |
| `4D 5A` and valid `e_lfanew` (bounds-checked) → `50 45 00 00` | `pe` → `dotnet` if data directory 14 (CLR) is non-zero and `NumberOfRvaAndSizes > 14`, else `pe`. `MZ` without a valid PE header → unknown + warning `DOS_STUB_ONLY`                                                                                       |
| `FE ED FA CE` / `FE ED FA CF` / `CE FA ED FE` / `CF FA ED FE` | `macho` → macho                                                                                                                                                                                                                                            |
| `CA FE BA BE` / `CA FE BA BF`                                 | `macho-fat` if the big-endian u32 at offset 4 is in 1..19, else `java-class` (Java majors ≥ 45) → macho / unknown                                                                                                                                          |
| `00 61 73 6D`                                                 | `wasm` → wasm                                                                                                                                                                                                                                              |
| `64 65 78 0A` + 3 digits + `00`                               | `dex` → android                                                                                                                                                                                                                                            |
| `50 4B 03 04` / `50 4B 05 06`                                 | ZIP: read EOCD (search the last 65 557 bytes), ZIP64 locator if needed, sample up to 10 000 central-directory names (no decompression). `AndroidManifest.xml` + `classes*.dex` → `apk`/android. `META-INF/MANIFEST.MF` → `jar`/unknown. Else `zip`/unknown |
| u32le == 4 at 0, and JSON at offset 16 starting `{"files"`    | `asar` → electron (header ≤ 32 MiB; count files)                                                                                                                                                                                                           |
| no NUL in the first 8 KiB and valid UTF-8                     | `html` (doctype/`<html` sniff) → web; shebang or known source extension → `text`/source (basis `extension`/`heuristic`); other text → `text`/unknown                                                                                                       |
| else                                                          | `unknown` → unknown                                                                                                                                                                                                                                        |

The extension is never used to override a signature (SOT §6.1). A mismatch between extension and signature is recorded as warning `EXTENSION_MISMATCH`.

#### 4.1.2 Directory classification (first match wins; signals recorded)

1. **macOS bundle:** `<x>.app/Contents/Info.plist` exists at the root or the root is the bundle. Electron if `Contents/Resources/app.asar` or `Contents/Frameworks/Electron Framework.framework` exists; otherwise macho. The platform comes from the first Mach-O under `Contents/MacOS/`.
2. **Packaged Electron:** `resources/app.asar` or `resources/app/package.json` within depth 2 → electron. The platform comes from the top-level executable's header (PE → windows, ELF → linux).
3. **Source tree:** any of `.git/`, `package.json`, `pyproject.toml`, `setup.py`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle(.kts)`, `CMakeLists.txt`, `Makefile`, `*.sln`, `*.csproj` → source. Detected ecosystems are recorded as signals. `package.json` is parsed as JSON only (≤ 1 MiB); its scripts are never run.
4. **Static site:** `index.html` at the root → web.
5. **Otherwise** unknown, with a full inventory.

URL sources: `http:`/`https:` → `web` (basis `url-scheme`). **No network request in M0.** Fetching belongs to the browser provider. Other schemes (`git@…`, `ssh:`, `file:`) → `NOT_SUPPORTED`, with the message "clone/download locally and inspect the directory".

#### 4.1.3 Dispatcher algorithm (`invoke`)

1. Validate `AnalysisRequest`. Failure → envelope `error INVALID_REQUEST`.
2. No `operationSchemas[op]` → `NOT_SUPPORTED` ("no provider implements <op> in this build").
3. Resolve the provider. Explicit id: it must exist (`NOT_FOUND`). Otherwise `registry.select(op, target, ctx)` takes the first available provider (ordered by priority, then id) whose probe lists the op. If none, return `NOT_SUPPORTED` with `details.considered[]` (provider id and reason for each).
4. Check the probe result. Prerequisites missing → `PROVIDER_UNAVAILABLE`. Host not supported → `HOST_INCOMPATIBLE`. `requiresExecution && !policy.allowExecution` → `POLICY_DENIED`. Same for network.
5. Validate params with the op schema → `INVALID_REQUEST`.
6. Create a per-request scratch dir and an `AbortController` linked to the parent signal plus a timeout. Call `execute`. On timeout, abort, wait 2 s grace, then return `TIMEOUT`. Delete the scratch dir in `finally`. On Windows, use `rm` with `maxRetries`.
7. Validate `data` with the op result schema → `PROVIDER_OUTPUT_INVALID`. Raw output is discarded and only logged at debug level, sanitized.
8. Serialized `data` larger than `maxInlineBytes` → `OUTPUT_LIMIT_EXCEEDED`.
9. Thrown `PhoenixError` → its shape. Any other throw → `PROVIDER_FAILED` with a sanitized message. The stack is logged locally only.
10. Return the envelope with `durationMs` from `performance.now()`.

Persistence of invocations and observations happens in **core**, not the toolkit. The toolkit has no DB access.

### 4.2 `@phoenix/evidence`

```text
src/
  db/database.ts        openDatabase(path, { readOnly? }): wraps node:sqlite DatabaseSync. PRAGMAs per connection:
                        journal_mode=WAL, synchronous=NORMAL, foreign_keys=ON, busy_timeout=5000; enableDefensive(true) when available.
                        transaction<T>(fn: () => T): T — BEGIN IMMEDIATE / COMMIT / ROLLBACK. fn is synchronous by type:
                        T extends PromiseLike<unknown> ? never : T. **No await inside a transaction.**
  db/migrate.ts         forward-only migrator (§5.2)
  migrations/0001_init.ts   { version: 1, name: 'init', sql } — SQL embedded as TS modules (no asset copying in builds)
  repos/projects.ts targets.ts artifacts.ts jobs.ts steps.ts events.ts invocations.ts observations.ts findings.ts relations.ts
                        every read parses JSON columns through the contract schema; parse failure ⇒ STORAGE_ERROR (fail closed)
  cas/artifact-store.ts content-addressed store (§5.3); implements ArtifactWriter and the read side
  index.ts              createEvidenceStore({ dataDir }) → { db, artifacts, repos…, close() }
```

### 4.3 `@phoenix/core`

```text
src/
  engine.ts             createEngine(config): PhoenixEngine — composition root; lazily opens the store (inspect/doctor never do)
  config.ts             EngineConfig (Zod): dataDir, logLevel, leaseMs (30_000), heartbeatMs (10_000), maxStepAttempts (3), limits
  services/doctor.ts    checks (§4.3.1)
  services/inspect.ts   describeTarget + registry.probeAll → InspectReport (no persistence)
  services/targets.ts   add(): describe + snapshot/reference + inventory artifact + manifest + 'intake.classification' observation,
                        idempotent (§5.5)
  services/tools.ts     invoke: build TargetAccess, call dispatcher, persist invocation + observation + events if targetId given
  services/jobs.ts      create / get / list / cancel / events
  runner/job-runner.ts  run(jobId, signal): loop { load job; handler = handlers[job.state]; if none ⇒ return (rest) ; execute step }
  runner/handlers.ts    StateHandler registry. M0: created (→ fingerprinting), fingerprinting (step 'fingerprint')
  runner/leases.ts      claim/heartbeat/release; owner = `${hostname}:${pid}:${processStartEpochMs}`
  runner/recovery.ts    recoverInterrupted(): expired or dead-owner leases ⇒ reclaim, emit step_recovered
  runner/fault.ts       no production crash hook; test-only fault injection lives under tests/support (implementation clarification 4).
```

**StateHandler contract.** This is the extension point the investigator, reconstruction, and verification packages will plug into later:

```ts
interface StateHandler {
  state: JobState;
  stepKey(job: Job): string; // deterministic, e.g. 'fingerprint' — idempotency key
  execute(job: Job, ctx: StepContext): Promise<StepOutcome>; // long work, outside any transaction
}
type StepOutcome =
  | {
      kind: 'advance';
      to: JobState;
      output: unknown;
      observations: ObservationDraft[];
      events: JobEventDraft[];
    }
  | { kind: 'fail'; error: PhoenixError }; // retryable errors retry up to maxAttempts, then STEP_RETRIES_EXHAUSTED → failed
```

**Fingerprint step (M0).**

1. Re-verify the target. Snapshot: re-hash the CAS blob. Reference: re-hash the file, or recompute the tree digest. Mismatch → `fail TARGET_CHANGED` (not retryable).
2. Record `job.host = detectHost()`.
3. Run `registry.probeAll(manifest, ctx)`.
4. Outcome: `advance → ready` with observation `job.capabilities` (`CapabilityReport[]`) and events `target_identified` and `capabilities_probed`.

`completeStep()` commits in **one transaction**:

- step `succeeded`
- observations
- events, plus `job_state_changed`
- `UPDATE jobs SET state=?, version=version+1 … WHERE id=? AND state=? AND version=?`

If the update changes 0 rows (cancelled or raced), the whole transaction is rolled back and the step is marked `cancelled`. This is the atomic-transition guarantee from SOT §7.3.

**Cancellation.** `cancel()` transitions any active state to `cancelled` in one transaction (+ `job_state_changed` and `job_finished`). A runner in any process sees the change on its next heartbeat (state ≠ expected), aborts its `AbortController`, and its final commit fails the version check. A second cancel → `INVALID_STATE_TRANSITION`.

**Budgets (pending ADR-0007; do not implement this creation-time proposal without resolving the ADR).** The original proposal checks `maxWallClockMs` (from `job.createdAt`) and `maxToolCalls` (count of `tool_invocations` for the job) before each step. When exceeded, it emits `budget_exhausted` and transitions to `failed` (`BUDGET_EXHAUSTED`) from early states, or `partial` once later states exist.

#### 4.3.1 Doctor checks

All probes run in parallel with a 5 s timeout each. Doctor never creates the database. It may create and delete one probe file in the data dir.

| id                 | Category              | Pass condition                                                                                                                                                   |
| ------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node.version`     | required              | ≥ 24.11.0                                                                                                                                                        |
| `host.supported`   | required              | os ∈ {windows, macos, linux}; arch ∈ {x64, arm64}                                                                                                                |
| `sqlite.builtin`   | required              | `node:sqlite` loads; in-memory DB: `sqlite_version()` ≥ 3.45, STRICT table, `json_extract`, WAL on a temp file                                                   |
| `crypto.sha256`    | required              | known-answer test (`""` and `"abc"`)                                                                                                                             |
| `datadir.writable` | required              | the data dir (or its nearest existing parent) is writable                                                                                                        |
| `datadir.schema`   | required if DB exists | opened read-only: schema version ≤ code version (pending migrations ⇒ warn)                                                                                      |
| `disk.free`        | optional              | ≥ 5 GiB free in the data dir (`fs.statfs`)                                                                                                                       |
| `tool.git`         | optional              | `git --version`; neededBy: source targets                                                                                                                        |
| `tool.java`        | optional              | `java -version` (parses stderr) ≥ 21; neededBy: "ghidra provider (P1, not yet built)"                                                                            |
| `tool.python`      | optional              | `python3`/`python`/`py -3` ≥ 3.10; Store alias detected as missing; neededBy: "future helper providers"                                                          |
| `tool.ghidra`      | optional              | `GHIDRA_INSTALL_DIR` set, `support/analyzeHeadless[.bat]` exists, `application.version` read from `Ghidra/application.properties` (file read only, no execution) |
| `provider.<id>`    | per provider          | `detect()` result for each registered provider (M0: `phoenix.fileinfo`)                                                                                          |

Optional checks never fail `doctor`. `ok = all required checks pass`.

### 4.4 `@phoenix/cli`

`node:util` `parseArgs` plus a small subcommand table. No CLI framework dependency. JSON mode writes **exactly one JSON document to stdout**. Logs always go to stderr. Ctrl+C aborts the engine signal. A second Ctrl+C forces exit 130.

```text
phoenix [--data-dir <dir>] [--log-level error|warn|info|debug] [--output text|json] <command>
phoenix --version
phoenix doctor
phoenix inspect <path|url> [--exclude <name|relpath>]... [--include-vcs] [--max-entries <n>]
phoenix tool list
phoenix tool invoke <operation> (--target <targetId> | --path <path>) [--params <json>] [--provider <id>] [--timeout <ms>]
phoenix project create <name> | project list
phoenix target add <path|url> [--project <name|id>] [--reference | --snapshot] [--exclude …] [--include-vcs]
phoenix target list [--project <name|id>] | target show <targetId>
phoenix job create --target <id> --mode investigate|reconstruct|verify --objective "<text>"
                   [--candidate <targetId>] [--based-on <jobId>] [--no-run] [--project <name|id>]
phoenix job show <id> | job list [--state <s>] | job cancel <id> [--reason <text>] | job resume <id>
phoenix job events <id> [--after <seq>] [--follow]
phoenix serve [--port <n>]            # default 4141; always binds 127.0.0.1
```

- `inspect` and `tool invoke --path` are **stateless**: they never create the data dir or DB.
- `project`, `target`, and `job` commands default to project `default`, auto-created on first use.
- `job create` runs the job inline to rest (`ready`) unless `--no-run` is given.
- Text output for `job show` on a `ready` job prints: `State: ready — planning is not implemented in this build (M0); the job will remain ready until a planner is available.`

Root script: `"phoenix": "node packages/cli/dist/main.js"`, so contributors run `pnpm phoenix doctor`. The package `bin` is `{ "phoenix": "dist/main.js" }` with a `#!/usr/bin/env node` shebang (pnpm generates `.cmd` shims on Windows).

### 4.5 `@phoenix/server`

Hono app factory `createApp(engine, { token })` plus `startServer(engine, { port })` in `@hono/node-server`. Startup steps:

1. `engine.recoverInterrupted()`, then run the recovered jobs in the background.
2. Write `<dataDir>/run/server.json` (`{ port, pid, token, startedAt }`, mode 0600) and remove it on shutdown.
3. Bind `127.0.0.1` only. M0 has no remote mode.

**Security middleware (local-server attack surface: DNS rebinding and cross-site requests from browsers):**

- The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`. Otherwise 403.
- Every route except `GET /health` requires `Authorization: Bearer <token>`. The token is 32 random bytes in base64url, compared in constant time. Otherwise 401 `UNAUTHORIZED`.
- Mutating routes require `Content-Type: application/json`. Body limit 1 MiB.
- No CORS headers in M0.

| Method & path                                                      | Engine call                               | Notes                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/health`                                                      | —                                         | `{ status: 'ok', version }` (no auth)                                                                                                                                                                                       |
| GET `/doctor`                                                      | `doctor()`                                |                                                                                                                                                                                                                             |
| GET `/providers`                                                   | `providers.list()`                        |                                                                                                                                                                                                                             |
| POST `/inspect`                                                    | `inspect()`                               | stateless                                                                                                                                                                                                                   |
| POST `/tools/invoke`                                               | `tools.invoke()`                          |                                                                                                                                                                                                                             |
| POST `/projects` · GET `/projects` · GET `/projects/:id`           | `projects.*`                              | SOT §7.4                                                                                                                                                                                                                    |
| POST `/targets` · GET `/targets/:id` · GET `/projects/:id/targets` | `targets.*`                               | SOT §7.4; `source.path` is accepted because M0 is loopback-only                                                                                                                                                             |
| POST `/jobs`                                                       | `jobs.create()` + background `run()`      | 201 + Job; SOT §7.4                                                                                                                                                                                                         |
| GET `/jobs/:id` · GET `/jobs`                                      | `jobs.get/list`                           | SOT §7.4                                                                                                                                                                                                                    |
| POST `/jobs/:id/cancel`                                            | `jobs.cancel()`                           | SOT §7.4                                                                                                                                                                                                                    |
| GET `/jobs/:id/events`                                             | `jobs.events()`                           | SSE when `Accept: text/event-stream` (`id: <seq>`, `event: <type>`, honors `Last-Event-ID`, polls the DB every 250 ms so events written by other processes appear, `: keepalive` every 15 s); otherwise JSON page `?after=` |
| GET `/jobs/:id/artifacts`                                          | `evidence.list({ jobId, artifactsOnly })` | SOT §7.4; metadata only, no byte download in M0                                                                                                                                                                             |
| GET `/projects/:id/evidence`                                       | `evidence.list()`                         | SOT §7.4                                                                                                                                                                                                                    |

Errors return `{ error: PhoenixErrorShape }` with the §3.2 status mapping. Responses are contract types serialized as-is. `localPath` is included because the M0 server is loopback-only. A remote mode later must add the stripping serializer first (tracked as a risk).

---

## 5. Database and persistence design

### 5.1 Data directory layout

```text
<PHOENIX_HOME or platform default>/
  phoenix.db  phoenix.db-wal  phoenix.db-shm
  artifacts/sha256/<2 hex>/<64 hex>        # read-only blobs
  artifacts/tmp/                            # same filesystem as blobs ⇒ atomic rename
  backups/phoenix-<UTC timestamp>-v<from>.db
  run/server.json
```

The data dir must be on a local disk. SQLite WAL is unreliable on network filesystems. `doctor` warns when it can detect this (best-effort: UNC paths on Windows).

### 5.2 Migrations

- `schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT`.
- `checksum` = sha256 of the migration SQL. On open, every applied migration's checksum must match the code. Otherwise → `MIGRATION_CHECKSUM_MISMATCH` (editing a shipped migration is forbidden; add a new one).
- DB max version > code's max version → `DB_SCHEMA_TOO_NEW`. Refuse to open (no silent downgrade).
- If there are pending migrations and the DB already holds data, first back it up with `VACUUM INTO 'backups/…'`. Then apply each migration in its own `BEGIN IMMEDIATE` transaction (SQLite DDL is transactional). A failure rolls back that migration → `MIGRATION_FAILED` and leaves the DB at the previous version.
- Migrations run automatically when the store opens (`targets add`, `job *`, `serve`). They never run on `doctor`, `inspect`, or `tool invoke --path`.

### 5.3 Content-addressed artifact store

- **Write.** Stream into `artifacts/tmp/<random>` while hashing, with a byte limit. Then `fsync` the file. If `sha256/<aa>/<hash>` exists, delete the temp file (dedupe). Otherwise rename into place: on Windows, retry `EPERM`/`EBUSY` up to 10× with backoff (antivirus and indexer locks). Then `fsync` the directory (POSIX only) and `chmod 0o444`. Finally insert the artifact row with `INSERT … ON CONFLICT(sha256) DO NOTHING` and return the existing or new id.
- **Single-pass snapshot.** For file targets, `hashFileTo(path, casWriter)` hashes and copies in **one read**. The stored bytes are therefore exactly the hashed bytes. The source's size and mtime are compared before and after the read; a change → `TARGET_CHANGED`.
- **Read.** `open(sha256)` streams the blob. Fingerprinting re-hashes it to detect store corruption (`STORAGE_ERROR`).
- **Deletion.** No deletion or GC in M0.

### 5.4 Directory digest: `phoenix-tree-sha256-v1`

The digest is the same on every OS, so CI asserts the same value on Windows, macOS, and Linux for the same fixture.

```text
hash input = UTF8(header + records.join(''))
header = JSON.stringify(["phoenix-tree-sha256-v1", sortedExcludes]) + "\n"
record = JSON.stringify(array) + "\n", with arrays:
  ["F", path, sha256(file bytes), sizeBytes]
  ["L", path, sha256(UTF8(readlink value))]
  ["D", path]
  ["O", path]
digest = sha256(hash input)
```

Use ECMAScript `JSON.stringify` with no indentation, UTF-8 without BOM, LF terminators, lowercase hashes, and decimal safe-integer sizes. `path` is the complete NFC-normalized POSIX relative path; do not normalize symlink payload bytes. Sort records by UTF-8 bytes of `path`; sort unique NFC-normalized POSIX exclusions the same way. Reject duplicate normalized paths or invalid Unicode rather than choosing an arbitrary order. JSON escapes embedded LF, CR, NUL and other controls, so each record occupies exactly one physical line and round-trips with `JSON.parse`. Symlinks are never followed. Excluded paths are omitted and recorded in `inventory.excluded`. Truncated traversal yields no digest and warning `INVENTORY_TRUNCATED`.

The full inventory (`InventoryEntry[]`, sorted) is stored as a CAS JSON artifact (`application/vnd.phoenix.inventory+json`). Its id is recorded as `inventoryArtifactId`. Evidence about a file inside a directory target references that artifact with a `path` locator.

### 5.5 Target identity and invalidation rules

- Manifests are **immutable**. `targets.add` for the same project and the same normalized local path (or URL):
  - same digest → returns the **existing** manifest (idempotent);
  - different digest → creates a new manifest with `supersedes` set to the previous one, plus a `relations` row (`supersedes`).
- An observation is **stale** when its target has a superseding manifest, or when its `targetDigest` ≠ the target's digest. `evidence.list` computes `stale` and never deletes history (SOT §6.4, §18).
- Reference-mode targets are re-verified at every job's fingerprint step → `TARGET_CHANGED`.
- Cache key for future deterministic tool results (SOT §18): `sha256(targetDigest | providerId@version | operation | canonicalJSON(params) | classifierVersion)`. It is stored on `tool_invocations.cache_key`. M0 records it. Cache reuse is enabled when a costly provider arrives (Ghidra).

### 5.6 Schema — `0001_init`

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
) STRICT;

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  media_type TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE targets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL, format TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('file','directory','url')),
  source_key TEXT NOT NULL,                 -- normalized absolute path or URL: identity for supersession
  intake_mode TEXT NOT NULL CHECK (intake_mode IN ('snapshot','reference')),
  digest_algorithm TEXT CHECK (digest_algorithm IN ('sha256','phoenix-tree-sha256-v1')),
  digest TEXT,
  artifact_id TEXT REFERENCES artifacts(id),
  inventory_artifact_id TEXT REFERENCES artifacts(id),
  supersedes_id TEXT REFERENCES targets(id),
  manifest_json TEXT NOT NULL,              -- full TargetManifest (validated on read)
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX targets_project ON targets(project_id, created_at);
CREATE INDEX targets_source ON targets(project_id, source_key, created_at);
CREATE INDEX targets_digest ON targets(digest);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  target_id TEXT NOT NULL REFERENCES targets(id),
  candidate_target_id TEXT REFERENCES targets(id),
  based_on_job_id TEXT REFERENCES jobs(id),
  mode TEXT NOT NULL CHECK (mode IN ('investigate','reconstruct','verify')),
  objective TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('created','fingerprinting','ready','planning','investigating',
                       'reconstructing','verifying','completed','partial','failed','cancelled')),
  version INTEGER NOT NULL DEFAULT 0,
  budget_json TEXT NOT NULL, policy_json TEXT NOT NULL,
  host_json TEXT, error_json TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,
  CHECK ((mode = 'verify') = (candidate_target_id IS NOT NULL))
) STRICT;
CREATE INDEX jobs_project ON jobs(project_id, created_at);
CREATE INDEX jobs_state ON jobs(state);

CREATE TABLE job_steps (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  step_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  lease_owner TEXT, lease_expires_at TEXT,
  output_json TEXT, error_json TEXT,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  UNIQUE (job_id, step_key)
) STRICT;

CREATE TABLE job_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,    -- global monotonic order; SSE id
  id TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX job_events_job ON job_events(job_id, seq);

CREATE TABLE tool_invocations (
  request_id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id), step_id TEXT REFERENCES job_steps(id),
  target_id TEXT NOT NULL REFERENCES targets(id),
  operation TEXT NOT NULL, provider_id TEXT, provider_version TEXT,
  params_json TEXT NOT NULL, cache_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok','partial','error')),
  error_code TEXT, duration_ms INTEGER NOT NULL,
  envelope_json TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX tool_invocations_job ON tool_invocations(job_id);
CREATE INDEX tool_invocations_cache ON tool_invocations(cache_key) WHERE status = 'ok';

CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES targets(id),
  job_id TEXT REFERENCES jobs(id),
  request_id TEXT REFERENCES tool_invocations(request_id),
  producer_json TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('static','runtime','user','derived')),
  type TEXT NOT NULL,
  data_json TEXT, data_artifact_id TEXT REFERENCES artifacts(id),
  target_digest TEXT, created_at TEXT NOT NULL,
  CHECK (data_json IS NOT NULL OR data_artifact_id IS NOT NULL)
) STRICT;
CREATE INDEX observations_target ON observations(target_id, created_at);
CREATE INDEX observations_job ON observations(job_id);

CREATE TABLE evidence_refs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('static','runtime','user','derived')),
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  observation_id TEXT REFERENCES observations(id),
  location TEXT, locator_json TEXT, created_at TEXT NOT NULL
) STRICT;

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES targets(id),
  job_id TEXT REFERENCES jobs(id),
  current_revision INTEGER NOT NULL CHECK (current_revision >= 1),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE finding_revisions (
  finding_id TEXT NOT NULL REFERENCES findings(id),
  revision INTEGER NOT NULL,
  statement TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('hypothesis','observed','corroborated','contradicted')),
  limitations_json TEXT NOT NULL, author_json TEXT NOT NULL, reason TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (finding_id, revision)
) STRICT;
CREATE TABLE finding_evidence (
  finding_id TEXT NOT NULL, revision INTEGER NOT NULL,
  evidence_ref_id TEXT NOT NULL REFERENCES evidence_refs(id),
  PRIMARY KEY (finding_id, revision, evidence_ref_id),
  FOREIGN KEY (finding_id, revision) REFERENCES finding_revisions(finding_id, revision)
) STRICT;

CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  from_type TEXT NOT NULL, from_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('calls','imports','derived_from','supports','contradicts',
                          'produced_by','tests','implements','observed_in','supersedes')),
  to_type TEXT NOT NULL, to_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (from_type, from_id, relation, to_type, to_id)
) STRICT;

-- Append-only enforcement for history tables
CREATE TRIGGER job_events_no_update BEFORE UPDATE ON job_events BEGIN SELECT RAISE(ABORT, 'job_events is append-only'); END;
CREATE TRIGGER job_events_no_delete BEFORE DELETE ON job_events BEGIN SELECT RAISE(ABORT, 'job_events is append-only'); END;
CREATE TRIGGER finding_revisions_no_update BEFORE UPDATE ON finding_revisions BEGIN SELECT RAISE(ABORT, 'finding_revisions is append-only'); END;
CREATE TRIGGER observations_no_update BEFORE UPDATE ON observations BEGIN SELECT RAISE(ABORT, 'observations are immutable'); END;
```

Repository rules:

- Findings with status ≠ `hypothesis` require at least one `finding_evidence` row in the same transaction.
- Polymorphic `relations` endpoints are validated in the repository (type ∈ known entity tables, row exists).
- Timestamps are produced by one `now()` helper (`new Date().toISOString()`).

### 5.7 Crash recovery and resumability

| Crash point                   | Durable state afterwards                                      | Recovery                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before the step claim commits | job `created` or `fingerprinting`, step `pending` (or absent) | `run`/`resume` claims normally                                                                                                                                                                                                                                            |
| After the claim, during work  | step `running` with a lease, attempt n                        | Lease expires (30 s), **or** the owner is on this host and its pid is not alive (`process.kill(pid, 0)` → `ESRCH`) → reclaim immediately, emit `step_recovered`, attempt n+1. CAS writes from the dead attempt are harmless (content-addressed); nothing else was written |
| During `completeStep`         | SQLite rolls back the transaction                             | Same as the previous row                                                                                                                                                                                                                                                  |
| After `completeStep`          | step `succeeded`, job `ready`                                 | Nothing to do                                                                                                                                                                                                                                                             |

Recovery entry points: `phoenix job resume <id>`, and `phoenix serve` startup (`recoverInterrupted()` scans non-terminal jobs that have a resumable handler). Attempts are capped by `max_attempts` (3). Beyond that → `STEP_RETRIES_EXHAUSTED` → `failed`.

The step key plus `UNIQUE(job_id, step_key)` is the SOT's "idempotent step identifier". Observation and event writes happen only inside the completing transaction, so a recovered step can never produce duplicates.

---

## 6. Quality standards

### 6.1 TypeScript (`tsconfig.base.json`)

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"], // set explicitly; do not rely on implicit @types inclusion
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "erasableSyntaxOnly": true, // no enums/namespaces/param properties
    "forceConsistentCasingInFileNames": true, // catches case bugs that only break on Linux
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
  },
}
```

- `tsconfig.check.json`: `noEmit`, `composite: false`, includes `packages/*/src`, `packages/*/test`, `tests/**`, `scripts/**`. `paths` maps `@phoenix/<pkg>` → `packages/<pkg>/src/index.ts`, so the whole repo (tests included) typechecks without a build.
- Relative imports use `.js` specifiers (NodeNext).
- Vitest uses `resolve.alias` with the same mapping, so unit tests run against sources. E2E tests run against `dist/`.

ESLint: `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`. Mandatory rules:

- `@typescript-eslint/no-floating-promises`
- `no-misused-promises`
- `switch-exhaustiveness-check`
- `no-explicit-any` (error)
- `no-restricted-imports`: forbid `node:child_process` outside `toolkit/src/platform/process.ts`, forbid `node:sqlite` outside `evidence/src/db/`, forbid `console` in libraries

Prettier: defaults with `printWidth: 110`, `singleQuote: true`.

### 6.2 Root scripts

```jsonc
{
  "build": "tsc -b",
  "clean": "tsc -b --clean",
  "typecheck": "tsc -p tsconfig.check.json",
  "lint": "eslint .",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "boundaries": "node scripts/check-boundaries.ts", // Node ≥24 runs erasable TS directly; fall back to tsc-built scripts if needed
  "contracts:snapshot": "node scripts/contracts-snapshot.ts",
  "contracts:check": "node scripts/contracts-snapshot.ts --check",
  "licenses:check": "node scripts/check-licenses.ts",
  "test": "vitest run --project unit --project integration",
  "test:e2e": "pnpm build && vitest run --project e2e",
  "test:coverage": "vitest run --coverage --project unit --project integration",
  "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm boundaries && pnpm contracts:check",
  "phoenix": "node packages/cli/dist/main.js",
}
```

> Verify in WP0 that `node scripts/x.ts` (type stripping) works on Node 24.11 without warnings breaking output. If it doesn't, compile `scripts/` with a tiny `tsconfig.scripts.json`. Don't add `tsx`.

### 6.3 Test framework and layers (Vitest 5)

| Layer       | Location                                                | Runs against                                       | Examples                                                                               |
| ----------- | ------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| unit        | `packages/*/test/**/*.test.ts`                          | sources                                            | schemas, state machine, parsers, tree digest, dispatcher with test-only fake providers |
| integration | `packages/{evidence,core,server}/test/**/*.int.test.ts` | sources + real SQLite in temp dirs + real fixtures | migrations, repositories, CAS, job runner, recovery, Hono `app.request()`              |
| e2e         | `tests/e2e/**/*.e2e.test.ts`                            | built `dist/` via child processes                  | CLI acceptance (§7.3), real server on port 0 with SSE                                  |

Test hygiene:

- Every test gets its own `PHOENIX_HOME` under `os.tmpdir()`.
- Cleanup closes DBs **before** deleting, and uses `fs.rm(dir, { recursive, force, maxRetries: 10 })`. Windows can't delete open files, and CAS files need a `chmod` back before removal.
- Fake providers exist only under `test/` (SOT §24.4: mocks belong only in tests).

Coverage gate: ≥ 85% lines for `contracts`, `toolkit/src/{formats,intake,dispatch,registry}`, `evidence`, and `core/src/runner`. Coverage is reported, not gated, for `cli` and `server` (covered by e2e).

### 6.4 CI (`.github/workflows/ci.yml`)

```yaml
name: ci
on: { push: { branches: [main] }, pull_request: {} }
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]     # macos-latest = arm64
        node: ['24']
        include: [{ os: ubuntu-latest, node: '26' }]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4                              # pin to the current major / SHA at implementation time
      - uses: pnpm/action-setup@v4                             # reads packageManager from package.json
      - uses: actions/setup-node@v4
        with: { node-version: '${{ matrix.node }}', cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm build
      - run: pnpm test
      - run: pnpm test:e2e
      - run: pnpm phoenix doctor --output json                # smoke on every host; artifact uploaded below
      - run: pnpm licenses:check
        if: matrix.os == 'ubuntu-latest' && matrix.node == '24'
```

Also: verify `tests/fixtures/fixtures.lock.json` hashes as the first unit test, and upload the doctor JSON and the e2e logs as workflow artifacts. Required status checks on `main` are configured by a human in GitHub settings.

---

## 7. Implementation order for Codex

Each work package (WP) is one short-lived branch and PR. Each PR must:

- state the task, subsystem, change, acceptance test, and priority (SOT §24.2);
- include the tests listed for that WP;
- pass `pnpm check && pnpm build && pnpm test` locally;
- report which tests could not run on the current host (SOT §24.7).

### WP0 — Repository bootstrap

1. `git init -b main`. Move `PHOENIX_Engineering_Source_of_Truth_v1.0.md` to `docs/PHOENIX_ENGINEERING_SOURCE_OF_TRUTH.md` with its content **unchanged**. Keep the `.docx` out of git (or wherever P-6 decides).
2. Root files from §2. Set `packageManager: "pnpm@11.18.0"` and `engines.node: ">=24.11.0"`. Add `.node-version` with the `24` line.
3. `.gitattributes`: `* text=auto eol=lf`; add binary attributes only for actual binary fixture paths in WP3 (see implementation clarification 3).
4. `README.md` (source-of-truth precedence per SOT §1, quickstart placeholder that is filled in WP9) and `CONTRIBUTING.md` (per-OS prerequisites: Node 24 LTS, pnpm 11 via the standalone installer or `npm i -g pnpm@11`, Git; Windows: enable long paths; optional: JDK 21, Python 3.10+).
5. `LICENSE` (MIT, per D-012 design default; see P-6).
6. `docs/adr/ADR-0001…0006` filed from §9 with `Status: accepted`, recording explicit project approval on 2026-10-22.
7. CI workflow running `pnpm check` on an empty workspace.
8. Verify the Node 24 behaviors flagged in §6.2 and §8 (type-stripped scripts, `node:sqlite` warnings) on the CI Node 24 job. Record the toolchain results in ADR-0005 and the results report.

**Exit:** CI is green on 3 OSes. `pnpm install --frozen-lockfile` is reproducible.

### WP1 — `@phoenix/contracts`

All of §3. `scripts/contracts-snapshot.ts` writes `packages/contracts/schemas/*.json` via `z.toJSONSchema` for each top-level schema. `--check` diffs them.

**Tests:**

- every schema accepts a valid fixture document and rejects at least 2 invalid ones;
- exhaustive state-machine test over all 11×11 state pairs × 3 modes against an independently written expected table;
- `PhoenixError` round-trip;
- envelope `error iff status=error` refinement.

**Exit:** `pnpm contracts:check` is clean. Coverage is ≥ 95%.

### WP2 — Toolkit platform layer

`platform/*`, `ids.ts`, `fs/safe-read.ts`, `hash/*`, `log/*`.

**Tests:**

- UUIDv7 ordering and uniqueness;
- `which` with a temp PATH, plus PATHEXT on Windows;
- `runProcess` with `process.execPath -e …` children: timeout kills the tree, output cap, abort, nonzero exit, env allowlist (`SystemRoot` present on Windows);
- `safe-read` rejects a symlink (created at test time; skipped with a reason on Windows without symlink privilege), a FIFO (POSIX only), and a directory;
- SHA-256 known-answer vectors;
- tree digest: order independence, NFC vs NFD names (created at runtime), normalized-path collision rejection, invalid-Unicode rejection, JSON record round-trips for newlines/CR/tabs/quotes/backslashes/control characters, excludes change the digest, truncation yields no digest;
- logger redaction.

**Implementation record:** [WP2_RESULTS.md](WP2_RESULTS.md), [WP2 hardening](WP2_HARDENING_RESULTS.md) and [toolkit API/limits](../packages/toolkit/README.md). No shared schema changes are required. The authorized toolkit runner structurally adds signal reporting, leaving shared interfaces intact. Filesystem identity checks reduce races and do not promise an atomic snapshot. Windows taskkill is initiated only for a known-running child, never after observed exit; reliable descendant tracking after parent exit requires a future Job Object provider. Unsupported explicit environment overrides are rejected, and retained output pipes have a separate drain deadline. Windows taskkill cannot guarantee post-parent-exit descendant tracking; see the recorded limitations and conditional test.

**Exit:** green on 3 OSes. Local Linux execution does not satisfy the outstanding hosted Windows/macOS gate.

### WP3 — Formats, intake, fixtures

`formats/*`, `intake/*`, `tests/fixtures/*`, `tests/support/synth.ts`.

**Fixtures (committed, §7.4)** — build with `scripts/fixtures/build-native.sh` (clang + lld; command lines verified on the dev host 2026-10-22):

```bash
clang -O1 -o native/hello-linux-x64.elf src/hello.c
clang --target=x86_64-pc-windows-msvc -fuse-ld=lld -nostdlib -Wl,/entry:main -Wl,/subsystem:console -o native/hello-windows-x64.exe src/hello.c
clang --target=arm64-apple-macos13 -fuse-ld=lld -nostdlib -Wl,-e,_main -o native/hello-macos-arm64.macho src/hello.c
clang --target=arm64-apple-macos13 -c -o native/hello-macos-arm64.o src/hello.c
clang --target=wasm32 -nostdlib -Wl,--no-entry -Wl,--export-all -o native/hello.wasm src/hello.c
```

Plus small directory fixtures (`dirs/source-node`, `dirs/static-site`, `dirs/electron-packaged` with a generated `resources/app.asar`) and misc files (`misc/sample.zip`, `misc/png-named.exe` = a PNG we generate, `misc/elf-named.png` = a copy of the ELF fixture, `misc/empty.bin`). Every file is recorded in `fixtures.lock.json` as `{ path, sha256, size, expected: { kind, format, arches } }`. Native fixtures are not rebuilt in CI (toolchain output varies); CI verifies the lock.

**Synthetic builders (test-only, generated in memory):**

- big-endian ELF32 (MIPS);
- PE32 with a CLR data directory (→ `dotnet`);
- PE with an out-of-bounds `e_lfanew`;
- fat Mach-O with 2 arches;
- Java class (`CAFEBABE`, major 65);
- DEX;
- ZIP with `AndroidManifest.xml` + `classes.dex` (→ apk);
- ZIP64 EOCD;
- ASAR with nested files;
- UTF-8 BOM text;
- shebang script.

**Tests:**

- table-driven classification of every fixture against the lock's expectations;
- **robustness:** every prefix length 0…min(size, 4096) of every fixture and synthetic must classify without throwing, plus 2 000 seeded-random buffers;
- extension spoofing → signature wins, with `EXTENSION_MISMATCH`;
- directory rules 1–5;
- URL → web with `globalThis.fetch` replaced by a throwing stub (proves no network);
- **Historical optimistic compatibility examples (superseded by ADR-0009):** ELF x64 on linux-x64 = compatible; on linux-arm64 = incompatible; Mach-O x64 on macos-arm64 = emulation-required; PE on linux = incompatible. These original examples did not establish structural validity, executable identity or target OS certainty.
- **Current owner-approved policy:** test actual parser outputs. ELF OSABI-0 and universal Mach-O remain unknown; partial/malformed structure or unestablished executable/CPU identity cannot yield compatible. Matching OS/CPU and emulation policy examples require established header evidence and supported structural validation. They never guarantee loading/execution or emulator installation.
- golden `TargetDescription` snapshots (timestamps and host normalized).

**Exit:** coverage ≥ 85% on `formats` and `intake`.

**Owner-approved review correction:** [ADR-0009](adr/ADR-0009-wp3-eligibility-and-url-identity.md), accepted by the WP3 review-corrections instruction, formalizes conservative native eligibility and public/persistent URL identity. The corrected toolkit uses local structuralStatus outcomes and unknown-by-default native policy; malformed facts may be retained but cannot be described as successful parsing. ET_DYN plus validated PT_INTERP identifies executable-capable PIE; no distinguishing evidence means unknown binaryType. Native fixture expectations include binaryType without changed bytes/hashes. File warnings are capped at 32 after all sources, and ZIP package identity requires complete, portable, unambiguous entries with supported local metadata.

TargetDescription URLs and future manifest HTTP(S) url/uri fields are credential-free **identity URLs** (origin/path only). Userinfo, all query parameters and all fragments are removed before output; URL_ACCESS_CONTEXT_REMOVED warns that removal can change retrieval semantics. Future network workflows must obtain exact access context through protected handling, never ordinary manifests or a silent fetch of the sanitized URL. No fetch, persistence or vault is implemented in WP3. See [hardening verification](WP3_HARDENING_RESULTS.md). Current schemas stay unchanged; syntax/protocol validation alone does not implement this output policy.

**Implementation record:** [WP3_RESULTS.md](WP3_RESULTS.md), [toolkit API/limits](../packages/toolkit/README.md) and [fixture provenance](../tests/fixtures/README.md). Intake composes the existing walker through an optional verified-handle inspection callback; the tree encoding and digest are unchanged. Real ELF32/64 and PE32/PE32+ fixtures supplement the original native set. Parsers are bounded metadata inspection, not complete loader/VM validators. CLR is recognized only when its directory maps to a bounded CLI header. FAT64 magic and swapped fat headers are handled explicitly. ASAR requires consistent pickle/tree/payload structure regardless of JSON property ordering. All decisions retain signals and warnings.

**Implementation clarifications:** only included inventory entries supply directory evidence, so a default-excluded Git-only directory remains unknown. Static analysis is independent of host eligibility; an assumed OS (notably ELF System V) does not establish native compatibility, even when its provisional OS name matches the host. The compatibility matrix's compatible/emulation cases use established header OS evidence. No runtime, network fetch, persistence or provider registry is introduced. These defensive clarifications require no shared-schema or architectural change; SOT stays v1.0.2.

### WP4 — `@phoenix/evidence`

`db/*`, `migrations/0001_init.ts` (§5.6), repositories, CAS (§5.3).

**Tests:**

- fresh migrate; idempotent re-open;
- checksum mismatch → `MIGRATION_CHECKSUM_MISMATCH`;
- DB with `schema_migrations.version = 999` → `DB_SCHEMA_TOO_NEW`;
- backup is created before a pending migration on a non-empty DB;
- `transaction()` rolls back on throw; the type test rejects an async callback (`// @ts-expect-error`);
- concurrent writers in **two processes** (child process inserting events while the parent inserts) → no `SQLITE_BUSY` failures within the busy timeout;
- append-only triggers reject UPDATE/DELETE;
- finding without evidence and status `observed` → rejected;
- corrupted `manifest_json` → `STORAGE_ERROR`;
- CAS: dedupe, read-only mode set, concurrent puts of the same bytes, `maxBytes` exceeded → temp file cleaned up.

**Exit:** integration suite green on 3 OSes.

### WP5 — Registry, dispatcher, `phoenix.fileinfo`

`registry/*`, `dispatch/*`, `builtin/fileinfo/*`, and a **reusable provider contract suite** `toolkit/test/provider-contract.ts`. This implements the SOT §9 provider quality gate. Future providers (browser, Ghidra) must pass it. It checks:

- `describe()` validates;
- `detect()` completes within 5 s;
- `probe()` is deterministic for the same input;
- every advertised op returns schema-valid data on a golden fixture;
- at least one known unsupported op → `NOT_SUPPORTED`;
- abort before completion → `CANCELLED` within 2 s;
- the timeout path is honored;
- output contains no absolute paths of the test host (sanitization);
- `version` is reported in the envelope.

Dispatcher tests with test-only fakes: provider throws a plain Error → `PROVIDER_FAILED` with a sanitized message; returns invalid data → `PROVIDER_OUTPUT_INVALID`; returns oversized data → `OUTPUT_LIMIT_EXCEEDED`; hangs → `TIMEOUT`; prerequisite missing → `PROVIDER_UNAVAILABLE`; `requiresExecution` with default policy → `POLICY_DENIED`; deterministic selection order.

fileinfo tests: `inspect_target` sections for the ELF/PE/Mach-O fixtures match `readelf -S`/`objdump -h` output recorded in golden files (the golden files were produced once on Linux and committed); `inspect_assets` pagination with cursors covers the full inventory exactly once; ZIP and ASAR member listings.

**Exit:** the contract suite passes for `phoenix.fileinfo`.

### WP6 — `@phoenix/core`

Engine composition, services, job runner, leases, recovery, cancellation, budgets, doctor (§4.3).

**Tests (integration):**

- `inspect` creates no data dir;
- `targets.add` snapshot of a file: CAS bytes hash equals the manifest; the source's mtime and bytes are unchanged;
- re-add same path + same digest → same id; modified file → new id + `supersedes` + old observations `stale`;
- reference directory → inventory artifact + tree digest;
- job lifecycle `created → fingerprinting → ready` with exact event sequence `job_created, job_started, job_state_changed×2, target_identified, capabilities_probed, evidence_saved`;
- verify mode without candidate → `INVALID_REQUEST`;
- simulated crash: step row `running`, lease owner = a dead pid → `resume` reclaims, attempt = 2, exactly one `job.capabilities` observation;
- expired-lease takeover from a "foreign host" owner;
- concurrent `run()` from two engines on the same job → exactly one succeeds in claiming, and the job reaches `ready` once;
- cancel during fingerprint (provider blocked on a latch) → job `cancelled`, step `cancelled`, no `ready` transition;
- reference target modified before job → `failed` with `TARGET_CHANGED`;
- budget `maxToolCalls = 0` → `BUDGET_EXHAUSTED`;
- doctor report validates, `ok` is true on CI hosts, and missing optional tools are `warn` (not `fail`).

**Exit:** coverage ≥ 85% on `core/src/runner`.

### WP7 — `@phoenix/cli`

Commands from §4.4, text renderer (control-character escaping), JSON mode.

**Tests:** argument parsing units, plus the e2e acceptance tests in §7.3 that target the CLI.

### WP8 — `@phoenix/server`

Routes and middleware from §4.5.

**Tests:**

- in-process `app.request()`: every route's success and error mapping;
- Host-header rebinding attempt (`Host: evil.example`) → 403;
- missing or invalid token → 401;
- wrong content type → 415;
- body > 1 MiB → 413.

e2e: start `phoenix serve --port 0`, read `run/server.json`, POST target, POST job, consume SSE until `job_state_changed{to: ready}`, reconnect with `Last-Event-ID` and receive no duplicates, cancel, observe `job_finished`.

### WP9 — Acceptance, docs, release gate

1. All §7.3 acceptance tests green on the CI matrix.
2. Fill in the README quickstart.
3. Write a package README for each package.
4. `docs/M0_RESULTS.md`: test run links per OS, what was not testable, known gaps.
5. Open a PR updating the SOT only for proposals that were **accepted** by then (decision register, §7 contracts, changelog entry, per SOT §20.2).

### 7.1 Parallelization

After WP1 merges, these can proceed in parallel:

- WP2 → WP3 (toolkit)
- WP4 (evidence)

WP5 needs WP2 and WP3. WP6 needs WP4 and WP5. WP7 and WP8 can proceed in parallel after WP6. Critical path: WP0 → WP1 → WP2 → WP3 → WP5 → WP6 → WP7 → WP9.

### 7.2 Commands a contributor runs

```bash
pnpm install --frozen-lockfile
pnpm check                 # format, lint, typecheck, boundaries, contract snapshots
pnpm build
pnpm test                  # unit + integration
pnpm test:e2e              # builds, then spawns the real CLI/server
pnpm phoenix doctor
pnpm phoenix inspect tests/fixtures/native/hello-linux-x64.elf --output json
pnpm phoenix target add tests/fixtures/dirs/source-node --reference
pnpm phoenix job create --target <tgt_…> --mode investigate --objective "inventory the source tree"
pnpm phoenix job show <job_…>
pnpm phoenix serve
```

### 7.3 Acceptance tests (real, scripted in `tests/e2e/`, run on all 3 OSes)

| ID    | Command / scenario                                                          | Pass criteria                                                                                                                                                                                                                                                                    |
| ----- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-01 | `phoenix doctor --output json`                                              | Exit 0. Output validates against `DoctorReport`. `host.os` matches the runner OS. All required checks pass. `phoenix.fileinfo` is listed and available                                                                                                                           |
| AT-02 | `phoenix inspect <each native fixture> --output json`                       | Validates against `InspectReport`. `kind`/`format`/`arches`/`sha256` equal `fixtures.lock.json`. PE → pe/x64; Mach-O → macho/arm64; ELF → elf/x64; WASM → wasm                                                                                                                   |
| AT-03 | `inspect` read-only guarantee                                               | `PHOENIX_HOME` does not exist afterwards. Fixture bytes and mtime unchanged. No files created next to the fixture                                                                                                                                                                |
| AT-04 | Spoofed extensions                                                          | `elf-named.png` → elf with `EXTENSION_MISMATCH`. `png-named.exe` → not pe                                                                                                                                                                                                        |
| AT-05 | Corrupt or empty inputs                                                     | Truncated PE and `empty.bin` → exit 0, `unknown` (or partial details) with warnings, no crash                                                                                                                                                                                    |
| AT-06 | `inspect tests/fixtures/dirs/source-node`                                   | kind `source`. `inventory.excluded` contains `.git` when present. **Tree digest is identical on Windows, macOS, and Linux** (asserted against a committed expected value)                                                                                                        |
| AT-07 | `inspect https://example.com/app`                                           | kind `web`, basis `url-scheme`. No network access (the e2e runs with `HTTP(S)_PROXY` pointing at a closed port, and the unit test in WP3 proves no fetch)                                                                                                                        |
| AT-08 | `tool invoke decompile_function --path <elf>`                               | Exit 1. Envelope `status=error`, `error.code=NOT_SUPPORTED`, `data=null`                                                                                                                                                                                                         |
| AT-09 | `tool invoke inspect_assets --path dirs/source-node --params '{"limit":2}'` | Paginates. Following `page.nextCursor` until absent yields every inventory entry exactly once                                                                                                                                                                                    |
| AT-10 | `target add` + `job create --mode investigate`                              | Job reaches `ready`. `job events` shows the WP6 sequence. `target show` validates against `TargetManifest`. The snapshot's CAS bytes hash equals `sha256`                                                                                                                        |
| AT-11 | Crash recovery                                                              | A dedicated test entry point injects a crash at `fingerprint.after-claim` and exits 86; production entry points ignore crash environment variables. `job show` → `fingerprinting`. `job resume` → `ready`, step attempt 2, one `step_recovered` event, no duplicate observations |
| AT-12 | Cancellation                                                                | Cancel a `ready` job → `cancelled` + `job_finished`. Cancel again → exit 1, `INVALID_STATE_TRANSITION`                                                                                                                                                                           |
| AT-13 | Tamper detection                                                            | `target add <tmp dir> --reference`, modify a file, `job create` → `failed` with `TARGET_CHANGED`                                                                                                                                                                                 |
| AT-14 | Schema safety                                                               | A DB with an injected future migration version → every DB-using command exits 1 with `DB_SCHEMA_TOO_NEW`. `inspect` still works                                                                                                                                                  |
| AT-15 | Server                                                                      | §WP8 e2e scenario passes, including the rebinding and token checks                                                                                                                                                                                                               |
| AT-16 | Paths with spaces and non-ASCII                                             | AT-02 and AT-10 repeated with `PHOENIX_HOME` and fixture copies under `…/Phoenix tést dir/`                                                                                                                                                                                      |

### 7.4 Fixture policy

- Only files we author (MIT, `tests/fixtures/native/src/hello.c`) or generate. Never third-party binaries (SOT §12).
- `tests/fixtures/README.md` records the generator commands, toolchain versions (clang 22.1.8, lld), date, and license.
- Only actual binary fixture paths are binary in `.gitattributes`; text remains LF-normalized. Symlink fixtures are created at test time, never committed (Git on Windows checks symlinks out as text files by default).

---

## 8. Cross-platform considerations

| Area                      | Rule                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Paths                     | All persisted and serialized relative paths use POSIX separators and NFC normalization. Use `path` (native) only at I/O boundaries. Never build paths by string concatenation. Containment is checked on `realpath` results. Windows long paths: `CONTRIBUTING` documents enabling long paths; tests include a 200+ char nested path where the platform allows           |
| Case sensitivity          | Never assume. `forceConsistentCasingInFileNames`. Fixtures avoid names that differ only by case and Windows reserved names (`CON`, `NUL`, …)                                                                                                                                                                                                                             |
| Line endings              | `.gitattributes` LF for text, `binary` for fixtures. Golden JSON compared after parse, not byte-for-byte                                                                                                                                                                                                                                                                 |
| Symlinks & reparse points | `lstat` everywhere. Symlinks and junctions are recorded, never followed. Symlink tests create links at runtime and skip with a reported reason on Windows without the privilege                                                                                                                                                                                          |
| Special files             | FIFOs, sockets, and devices are never opened (opening a FIFO would block forever)                                                                                                                                                                                                                                                                                        |
| File locking              | Windows cannot delete or rename open files: close handles before rename/delete, retry `EPERM`/`EBUSY`/`EACCES` with backoff in CAS and test cleanup. SQLite `-wal`/`-shm` files are removed only after `close()`                                                                                                                                                         |
| Permissions               | `chmod 0o444` on CAS blobs (sets the read-only attribute on Windows). `server.json` mode 0600 on POSIX. Windows relies on per-user `%LOCALAPPDATA%` ACLs (documented limitation)                                                                                                                                                                                         |
| Processes                 | `shell: false`. `windowsHide`. Minimal env, including `SystemRoot`. Tree kill per OS (§4.1). `.bat`/`.cmd` refused in M0; the Ghidra provider (P1) will need `analyzeHeadless.bat`, so it gets a hardened `cmd.exe /d /s /c` argument escaper with its own tests (risk R-5)                                                                                              |
| Signals                   | Ctrl+C handled via `SIGINT` on all OSes. `SIGTERM` handled on POSIX only. Lease expiry is the recovery backstop everywhere                                                                                                                                                                                                                                               |
| Executables               | PATHEXT-aware lookup. Windows Store Python alias detection. `java -version` reads stderr                                                                                                                                                                                                                                                                                 |
| Host detection            | `win32`/`darwin`/`linux` only. WSL is reported (it matters for later runners, which may execute PE through interop). Rosetta and WoA emulation are reported best-effort                                                                                                                                                                                                  |
| Data dir                  | Platform defaults (§4.1) with a `PHOENIX_HOME` override. Must be on a local disk                                                                                                                                                                                                                                                                                         |
| Node / SQLite             | Baseline Node 24 LTS on all 3 OSes in CI, plus Node 26 on Linux. The built-in SQLite removes native compilation on every OS. If Node 24 prints an `ExperimentalWarning` for `node:sqlite`, the CLI suppresses **only that warning** (filter on `warning.name === 'ExperimentalWarning' && /SQLite/.test(warning.message)`) and doctor reports the SQLite stability level |
| Static vs runtime         | Inspection is host-independent: a Mach-O inspected on Windows yields the same manifest except for `inspectedOn`/`compatibility`. AT-02 asserts this across the matrix                                                                                                                                                                                                    |
| Real-host testing         | CI covers GitHub-hosted runners only. SOT §17 still requires teammates to run `pnpm test:e2e` on their own Windows and macOS machines before M0 is declared done                                                                                                                                                                                                         |

---

## 9. Risks and decisions requiring approval

### 9.1 Original proposals (P-1–P-6 accepted; retained as decision history)

| ID      | Proposal                                                                                                                                                                                                                                                                                                                                                                                                     | Changes SOT?                        | Recommendation | Blocking?                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| **P-1** | **M0 split.** Rename this scope **M0-Foundation**. The remaining SOT §21 items become **M0-Vertical**: browser/JS provider + fixture evidence bundle, verified Nemotron model ID + genuine tool-guided request, one automatic tool-selection decision, one small reconstruction compared to a reference scenario, held-out scenarios. The SOT M0 exit condition stays unchanged and applies to M0 as a whole | Milestone structure (§21)           | Accept         | **Yes, for planning.** Implementation can start; the decision affects what "M0 done" means                |
| **P-2** | **State machine amendments** (§3.6): add `created→failed`, `fingerprinting→failed`, `planning→partial`, `planning→failed`, `investigating→completed` (investigate only), `verifying→failed`; define active = non-terminal; add mode guards                                                                                                                                                                   | §7.3 design default                 | Accept         | **Yes for WP1.** If rejected, WP1 implements the SOT table verbatim, and investigate jobs cannot complete |
| **P-3** | **Contract refinements:** typed `TargetManifest` extensions + `hostOs` = intake host + no local paths in `uri` (I-4); `CapabilityReport`/`AnalysisProvider` additive members (I-5); `EvidenceRef.locator` + `observationId` (I-7); `Job.candidateTargetId`/`basedOnJobId` (I-3); finding revisions; ID/time formats (I-8). All SOT fields are retained with their meaning                                    | §7.1–7.2 design defaults (additive) | Accept         | No. SOT §7 says schemas take effect once tests confirm them. Proceed while the ADR is under review        |
| **P-4** | **Layout:** add `packages/server`; target intake lives in `toolkit/src/intake` (no separate package); built-in `phoenix.fileinfo` provider inside toolkit; `providers/` directory created when the first external-engine provider arrives                                                                                                                                                                    | §12 design default                  | Accept         | No                                                                                                        |
| **P-5** | **Toolchain:** Node ≥ 24.11 baseline (26 also tested); built-in `node:sqlite` behind an adapter (not `better-sqlite3`); TypeScript pinned to 6.0.x until typescript-eslint supports 7; Hono for HTTP; Vitest; ESLint + Prettier; no CLI framework                                                                                                                                                            | D-009 implementation detail         | Accept         | No                                                                                                        |
| **P-6** | **Housekeeping:** commit an MIT `LICENSE` now under D-012 (final confirmation remains SOT open question 8); keep the `.docx` out of git (Markdown is canonical); `@phoenix/*` names are private placeholders, and an owned npm scope is chosen before any publish; `Owner: unassigned (D-014 OPEN)` in package READMEs                                                                                       | D-012/D-014 untouched               | Accept         | No                                                                                                        |

### 9.2 Risks

| ID  | Risk                                                                                                         | Mitigation                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| R-1 | Schedule: SOT §16.4 expects the browser/JS provider on Oct 22–23                                             | Strict WP order. Cut list §9.3. The browser provider can start once WP5 lands (it needs only contracts + toolkit) |
| R-2 | `node:sqlite` behavior differs on Node 24 vs 26 (stability warnings, missing APIs such as `enableDefensive`) | Adapter with feature detection. CI on both versions. Swap to `better-sqlite3` via ADR if blocked                  |
| R-3 | TypeScript 7 / typescript-eslint incompatibility persists                                                    | Pin 6.0.x. Revisit when typescript-eslint's peer range includes 7                                                 |
| R-4 | Only Linux is available locally                                                                              | 3-OS CI from WP0. Teammates on real Windows/macOS run e2e before M0 sign-off                                      |
| R-5 | Windows `.bat` execution (Ghidra `analyzeHeadless.bat`) is a known injection hazard                          | Refused in M0. P1 adds a dedicated escaper with tests                                                             |
| R-6 | Loopback server exposes `localPath`                                                                          | M0 binds to loopback only, with token + Host checks. Remote mode requires a stripping serializer and its own ADR  |
| R-7 | Large directory targets (e.g. `node_modules`) make intake slow                                               | `maxEntries`/`maxTotalBytes` limits, honest truncation, `--exclude`; streaming hash; benchmark in M0-Results      |
| R-8 | In-process providers are not a security boundary                                                             | Documented. M0 providers only parse bytes. Execution providers run as separate processes/runners (SOT §6.7, §13)  |
| R-9 | Ownership (D-014) and benchmark targets remain OPEN                                                          | Not needed for M0-Foundation. Needed before M0-Vertical acceptance                                                |

### 9.3 Cut list (if the schedule slips, cut in this order; never cut tests for what remains)

1. `inspect_target` section tables (keep header details only).
2. ZIP/ASAR member listing in `inspect_assets` (keep filesystem inventory).
3. Directory `--snapshot` mode (keep reference mode).
4. SSE streaming (keep the JSON `?after=` polling endpoint).
5. `relations` table usage beyond `supersedes`.

Not cuttable:

- atomic transitions;
- crash recovery;
- read-only intake;
- `NOT_SUPPORTED` semantics;
- 3-OS CI;
- schema validation of provider output.

---

## 10. Definition of Done — M0-Foundation

M0-Foundation is done when **all** of the following hold, verified on a clean checkout:

1. **Repository:** git repo with the SOT at its canonical path (content unchanged), README with SOT precedence, CONTRIBUTING with per-OS setup, MIT LICENSE, ADR-0001…0006 filed as `proposed` (or with their recorded outcome), lockfile committed.
2. **Build:** `pnpm install --frozen-lockfile && pnpm check && pnpm build && pnpm test && pnpm test:e2e` passes on `ubuntu-latest`, `windows-latest`, `macos-latest` (Node 24) and `ubuntu-latest` (Node 26) in CI.
3. **Contracts:** every §3 schema is implemented in `@phoenix/contracts`, JSON Schema snapshots are committed and checked, and the state-machine test covers all 11 × 11 × 3 combinations.
4. **Boundaries:** `pnpm boundaries` passes. CLI and server contain no business logic (review checklist item). The only third-party runtime dependencies are `zod`, `hono`, and `@hono/node-server`.
5. **Doctor:** `phoenix doctor` (text and JSON) reports host, required checks, optional tools with `neededBy`, data-dir/schema state, and provider availability. Exit codes are 0/3 as specified.
6. **Inspect:** `phoenix inspect` correctly classifies all committed fixtures (ELF, PE, Mach-O, WASM, ZIP, ASAR, directories, URL) by signature, reports SHA-256 or the tree digest, platform, and host compatibility, writes nothing anywhere, and produces the same tree digest on all three OSes.
7. **Toolkit:** provider registry, dispatcher, and the `phoenix.fileinfo` provider pass the reusable provider contract suite. Unsupported operations return `NOT_SUPPORTED`. All §4.1.3 error paths are tested.
8. **Persistence:** migrations with checksum, downgrade protection, and pre-migration backup. CAS with single-pass hashed snapshots. Append-only history enforced by triggers. Findings without evidence rejected unless `hypothesis`.
9. **Jobs:** `target add` + `job create` drive a job `created → fingerprinting → ready` with atomic, versioned transitions and the specified event sequence. Cancellation, tamper detection (`TARGET_CHANGED`), budgets, and **crash recovery via a real killed process (AT-11)** pass.
10. **API:** `phoenix serve` exposes the §4.5 routes over loopback with token and Host protection. SSE delivers job events with resume. Every route is backed by the same `PhoenixEngine` used by the CLI.
11. **Acceptance:** AT-01…AT-16 pass in CI. `docs/M0_RESULTS.md` records per-OS results, including anything not testable on hosted runners, and at least one teammate run on a real Windows or macOS machine (or states explicitly that none was available).
12. **Honesty:** no mock, simulated, or placeholder data in any non-test code path. Every `unknown`/`partial` result carries signals or warnings explaining why.
13. **SOT reconciliation:** a PR updates the SOT decision register, §7 contracts, §21, and changelog for every proposal **accepted** by then, per SOT §20.2. Rejected proposals are reflected in the code before sign-off.

**Explicitly not part of this DoD** (SOT M0 items deferred to M0-Vertical if P-1 is accepted): browser/JS provider, Nebius Nemotron request, automatic tool selection, reconstruction, held-out scenarios, and the SOT M0 exit condition.
