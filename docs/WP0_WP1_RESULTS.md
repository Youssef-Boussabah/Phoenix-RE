# WP0 / WP1 implementation results

Date: 2026-10-22. Priority: P0. Scope: repository bootstrap and shared contracts only.

**Historical baseline:** The results below describe the original implementation before independent-review hardening. They are superseded by [WP0/WP1 hardening results](WP0_WP1_HARDENING_RESULTS.md) and ADR-0008. The original 100% executable coverage and generic negative checks did not demonstrate semantic completeness: Opus identified eleven surviving semantic mutations. Preserve these baseline observations as history, not current completion claims.

**Original result:** WP0 implementation and WP1 pass local validation on Linux with Node 26.8.1 and an isolated Node 24.11.0 baseline. A fresh source copy with no node_modules or build output also passes on Node 24.11.0. The WP0 three-OS CI exit is **pending**, not complete. Neither M0-Foundation nor the full M0 milestone is complete. No WP2 or later functionality was implemented.

## 1. Repository and files

Git was initialized with `git init -b main`. `git branch --show-current` returns `main`; no remotes exist, no remote settings were modified, and nothing was pushed or published. Changes are local and uncommitted; the repository has no initial commit yet.

```text
.editorconfig  .gitattributes  .gitignore  .node-version
.prettierignore  .prettierrc.json
package.json  pnpm-workspace.yaml  pnpm-lock.yaml
tsconfig.base.json  tsconfig.json  tsconfig.check.json
eslint.config.js  vitest.config.ts
LICENSE  README.md  CONTRIBUTING.md
.github/workflows/ci.yml
 docs/
   PHOENIX_ENGINEERING_SOURCE_OF_TRUTH.md
   M0_IMPLEMENTATION_PLAN.md
   WP0_WP1_RESULTS.md
   history/README.md
   history/PHOENIX_Engineering_Source_of_Truth_v1.0.md
   adr/ADR-0001-m0-split.md
   adr/ADR-0002-state-transitions.md
   adr/ADR-0003-shared-contracts.md
   adr/ADR-0004-package-layout.md
   adr/ADR-0005-toolchain.md
   adr/ADR-0006-housekeeping.md
 packages/contracts/
   package.json  tsconfig.json  README.md
   src/
     version.ts  ids.ts  time.ts  host.ts  errors.ts
     target.ts  artifact.ts  evidence.ts  provider.ts
     provider-interfaces.ts  job.ts  job-state-machine.ts
     events.ts  doctor.ts  engine.ts  schema-registry.ts  index.ts
     operations/index.ts  operations/inspect-target.ts  operations/inspect-assets.ts
   schemas/  (89 generated *.schema.json snapshots)
   test/
     fixtures.ts  schemas.test.ts  state-machine.test.ts
     errors.test.ts  events.test.ts  types.test.ts
 scripts/
   check-boundaries.ts  check-licenses.ts  contracts-snapshot.ts
 tests/
   boundaries.test.ts  tree-record-format.test.ts  tree-hash-vectors.json
```

The original DOCX remains at the original project-root path, ignored by `*.docx` and not tracked. The original Markdown was moved verbatim into a labeled historical directory; it is excluded from formatting. The current canonical document is exclusively `docs/PHOENIX_ENGINEERING_SOURCE_OF_TRUTH.md`.

Preserved input SHA-256 values:

- Historical v1.0.0 Markdown: `b1f09b421a9959b59fc36c255c936de13edafab5681a01b33ddc40c435f5edf4`.
- Local original DOCX: `e90d0132061f8a97f50ec2065aefcf4791535677a81c2fc24f94e76c8fb845ae`.

Text Git attributes are `text=auto eol=lf`. There are no binary fixtures in WP0/WP1, so there is no blanket binary rule. WP3 must add explicit attributes for the binary fixtures it creates. The tree-record JSON vectors remain text.

## 2. Decisions and source-of-truth changes

ADRs 0001–0006 are **accepted**, recording the explicit project approval dated 2026-10-22. They cover P-1 milestone split, P-2 state repair and mode guards, P-3 shared contracts, P-4 package layout, P-5 toolchain, and P-6 housekeeping/MIT intent. Each records the problem, decision, alternatives, tradeoffs, migration/test impact and revisit trigger. Ownership stays unassigned (D-014 OPEN).

Canonical PHX-SOT-001 is **v1.0.1**, with the original product commitments and D-001–D-014 history retained, accepted D-015–D-020 added, state rules repaired, package layout clarified, milestone split recorded, and §25 changelog updated. M0 still requires a real investigation and a testable reconstruction. Original design examples are labeled historical where concrete contracts supersede them.

The plan records all four requested corrections: zero tool-call budgets exhaust immediately; directory records use JSON arrays and LF with explicit UTF-8 ordering/normalization rules; only actual binary fixtures receive binary attributes; deliberate process crashes must use a dedicated test entry point and never an environment-triggered production hook. No crash hook exists in WP0/WP1.

Additional correctness fixes, documented in the plan and covered by tests: nested defaults must actually parse; negative/unsafe sizes and counters are rejected; wire JSON cannot be undefined/bigint/functions/NaN; kind/hash/host equalities are enforced; error envelopes require null data and paired provider identity/version; observations need data or an artifact. The three SOT event names omitted from the proposed union are retained. ID brands are checked at compile time. Snapshot tooling has a root development-only workspace dependency so typechecking works before the first build.

## 3. Actual dependency graph

```text
phoenix root (private development/check tooling)
  ├─ @phoenix/contracts (workspace development dependency)
  ├─ TypeScript 6.0.3 / @types/node 24.10.1
  ├─ ESLint 10.13.0 / typescript-eslint 8.72.0 / Prettier 3.9.10
  └─ Vitest 5.0.5 / coverage-v8 5.0.5 / Vite 8.0.3

@phoenix/contracts (private package)
  └─ zod 4.6.7 (only runtime dependency)
```

No toolkit, database, framework, provider, frontend or engine package is scaffolded. Manifest and TypeScript AST import checks enforce the approved future dependency matrix and reject undeclared dependencies, package escapes, forbidden reexports/dynamic imports and runtime Node imports in contracts. Node streams are type-only references.

## 4. Shared contracts

Implemented 89 exported runtime schemas and inferred types, plus behavioral interfaces: contract/schema versions, all branded IDs, UTC millisecond timestamps, host/target platforms, classification and manifests, inventory, intake inputs, artifacts, evidence locators/references/drafts, producers, observations, findings and relation types, standardized PhoenixError serialization/normalization/status mappings, capabilities/prerequisites/provider availability/descriptors, analysis requests and result envelopes, two M0 operation schema pairs, budgets/policies/jobs/steps, all job events, doctor/report/project/pagination/input schemas, and PhoenixEngine/AnalysisProvider/injected service interfaces.

The corrected transition rules cover every state and mode. Runtime validation enforces verification target pairs, evidence for non-hypotheses, target consistency and response envelope invariants. `exhaustedBudget` is a pure predicate, including immediate zero-budget and equality behavior; no runner is implemented.

JSON Schema draft 2020-12 snapshots describe input shapes. Custom refinements, including nested refinements, still require runtime Zod validation; snapshots explicitly document this limitation. Checks compare generated bytes and reject missing, changed or stale snapshots.

## 5. Commands actually executed

The implementation used `rg`, `find`, `sed`, `cat`, `ls`, `wc`, Python file-generation/edit commands, and the following substantive commands (including retries where required by the sandbox):

```sh
git init -b main
node --version
npm --version
pnpm --version
pnpm install
pnpm install --offline
pnpm install --frozen-lockfile
pnpm licenses list --json
pnpm format
pnpm exec prettier --write <changed files>
pnpm contracts:snapshot
pnpm clean
pnpm typecheck
pnpm check
pnpm build
pnpm test
pnpm test:coverage
pnpm lint
pnpm boundaries
git branch --show-current
git status --short --branch
git remote -v
git check-ignore PHOENIX_Engineering_Source_of_Truth_v1.0.docx
git check-attr text eol diff -- tests/tree-hash-vectors.json docs/M0_IMPLEMENTATION_PLAN.md
sha256sum docs/history/PHOENIX_Engineering_Source_of_Truth_v1.0.md PHOENIX_Engineering_Source_of_Truth_v1.0.docx
```

The initial `npm view zod@4.6.7 version` was blocked by sandbox DNS. Project-local installation succeeded with the approved network/store access; no system packages were installed or downgraded.

For Node 24, `npm exec --yes --cache /tmp/phoenix-npm-cache --package=node@24.11.0 -- node --version` selected system Node 26 and was **not** counted as baseline verification. Instead:

```sh
npm install --prefix /tmp/phoenix-node24 --cache /tmp/phoenix-npm-cache --ignore-scripts node-linux-x64@24.11.0
/tmp/phoenix-node24/node_modules/node-linux-x64/bin/node --version
/tmp/phoenix-node24/node_modules/node-linux-x64/bin/node scripts/check-boundaries.ts
```

A clean source copy was made at `/tmp/phoenix-wp01-node24-validation`, excluding `.git`, dependencies, output, environment folders and DOCX. `pnpm install --offline --frozen-lockfile` there failed because the separate cache lacked a tarball; `pnpm install --frozen-lockfile` with download access succeeded. With `PATH=/tmp/phoenix-node24/node_modules/node-linux-x64/bin:$PATH`, the following all passed in that fresh copy:

```sh
node --version  # v24.11.0
pnpm typecheck  # before any build output existed
pnpm check
pnpm build
pnpm test
pnpm test:coverage
```

One-off `node --input-type=module -e ...` probes checked Node 24/26 SQLite versions, STRICT/JSON1 support on Node 24, and `enableDefensive` availability. These are compatibility observations, not an implemented database adapter.

## 6. Actual test results

| Check                                                   | Linux Node 26.8.1, working tree                                      | Linux Node 24.11.0, fresh source copy |
| ------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------- |
| Frozen install                                          | Passed                                                               | Passed with downloads                 |
| Typecheck before build                                  | Passed after `pnpm clean`                                            | Passed                                |
| Formatting / typed lint / typecheck                     | Passed                                                               | Passed                                |
| Manifest and source boundaries                          | Passed                                                               | Passed                                |
| Build                                                   | Passed                                                               | Passed                                |
| JSON Schema snapshots                                   | 89 verified                                                          | 89 verified                           |
| Unit/contract tests                                     | 482 passed, 7 files                                                  | 482 passed, 7 files                   |
| State/mode combinations                                 | All 363                                                              | All 363                               |
| Contracts line / statement / function / branch coverage | 100% / 100% / 100% / 100%                                            | 100% / 100% / 100% / 100%             |
| Dependency-license metadata                             | Passed, 145 installed entries including residual development entries | Passed, 142 clean-install entries     |

No final tests fail or are skipped. During implementation, lint/typecheck caught unused values, strict lint issues and an ID-brand inference defect; these were corrected before the passing runs. Snapshot verification also caught a namespace edit changing the schema ID version; IDs now derive from the contract version constant and have an explicit regression assertion. Lockfile validation correctly rejected a stale importer after the root workspace dependency was added; the lockfile was refreshed and frozen installation subsequently passed. The offline-cache failure is environmental, not a claim of offline reproducibility.

Coverage measures executable contracts code; type-only interfaces have no runtime coverage. The >=95% gates apply to all four coverage metrics. Tests include explicit valid and invalid schema fixtures, discriminated union variants, branded-type checks, error round-trips/redaction, transition rejection, budget edge cases, JSON Schema determinism, package boundaries and adversarial tree-record encoding vectors. Filesystem tree hashing is deliberately not implemented or claimed as tested yet.

## 7. Platform and CI status

- **Linux Node 24.11.0 and Node 26.8.1:** actually executed successfully.
- **Windows/macOS:** not available locally; not executed. No validation claim.
- **GitHub Actions:** workflow created, **not run**; no run links exist because nothing was pushed. It covers Node 24 on Ubuntu/Windows/macOS, Node 26 Ubuntu and an exact Node 24.11.0 Ubuntu job, with checks/build/tests/coverage and coverage artifact upload.
- **Real teammate hosts:** no Windows/macOS run available.
- **Later integration/e2e/doctor/provider/SQLite recovery tests:** not executed; those implementations are WP2–WP9 and outside this task. No empty test projects or fake passing commands were added.

Action majors were checked against the official [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node), [pnpm setup](https://github.com/pnpm/action-setup), and [artifact upload](https://github.com/actions/upload-artifact) documentation. JSON Schema generation follows [Zod documentation](https://zod.dev/json-schema); typed lint configuration follows [typescript-eslint documentation](https://typescript-eslint.io/troubleshooting/typed-linting/).

Node 24.11.0 has SQLite 3.50.4, emits an ExperimentalWarning and lacks `enableDefensive`. Node 26.8.1 has SQLite 3.53.4 and exposes `enableDefensive`. The later evidence adapter must feature-detect APIs; this task adds no warning suppression or persistence code. The original system Node remains 26.8.1.

## 8. Remaining engineering issues

Hosted three-OS CI and contributor-host smoke results are pending. The local changes need review and an initial commit; no remote actions were requested. Contributor ownership and benchmark choices remain open per D-014. Contributor provenance and dependency/distribution review remain required before public release, including the MPL-2.0 development tooling dependencies. The license metadata inventory is not that final review.

## 9. Readiness for WP2

**WP2 can begin against these locally verified contracts.** It must implement the documented tree-hash byte format, containment and Unicode/collision handling, UUID generation, process execution and platform utilities with real tests. Formal WP0 three-OS acceptance remains open until CI runs. The full M0 exit condition remains unchanged. No WP2 code was added.
