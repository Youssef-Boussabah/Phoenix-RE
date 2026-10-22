# PHOENIX

PHOENIX is an independent, evidence-driven reverse-engineering, reconstruction and verification platform. This repository implements the repository foundation, hardened shared contracts (WP0/WP1), and toolkit platform services (WP2). Format parsing, target classification, providers, CLI, server, investigation, model integration, reconstruction and verification engines remain future work.

The [engineering source of truth](docs/PHOENIX_ENGINEERING_SOURCE_OF_TRUTH.md) is canonical. Its §1 authority order applies: applicable laws/licenses and upstream terms, explicit current decisions, current specification, validated contracts/tests/behavior, then exploratory material. A discrepancy must be reconciled rather than silently changing product requirements. The [original Markdown](docs/history/PHOENIX_Engineering_Source_of_Truth_v1.0.md) is historical input; the original DOCX is local and ignored by Git.

Use Node **24.11.0 or later** (Node 24 baseline; Node 26 compatible), pnpm **11.18.0**, and Git. No system-wide tool changes are required; use an existing pnpm or install it in a user-managed environment. Corepack is not assumed to be bundled.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
pnpm test:coverage
```

`pnpm check` runs formatting, strict typed linting, typechecking, manifest/import boundaries, JSON Schema snapshot checks and installed dependency-license metadata checks. Snapshot commands build contracts before running plain Node TypeScript scripts. Coverage requires at least 95% lines, statements, branches and functions for contracts and 85% for toolkit; it does not establish semantic completeness. `pnpm test` also typechecks the contracts and their portable public types. `pnpm test:mutations` independently exercises the eleven reported Opus mutations in an isolated copy.

```text
packages/contracts/  Zod-first schemas, inferred types, pure state rules and interfaces
packages/toolkit/    host/path/filesystem/hash/process/logging services
scripts/             boundary, snapshot and license checks
tests/              repository checks and approved tree-hash encoding vectors
docs/               canonical specification, plan, accepted ADRs, historical input and results
.github/workflows/   Node 24 Windows/macOS/Linux plus Node 26 Linux CI
```

The runtime dependency graph is `@phoenix/toolkit → @phoenix/contracts → zod`. Byte-stream interfaces use portable async iterables and are checked without Node types. Provider and engine interfaces are contracts, with no working provider or engine claimed. See [contracts](packages/contracts/README.md), [toolkit](packages/toolkit/README.md), [WP2 results](docs/WP2_RESULTS.md), [contributing](CONTRIBUTING.md), the [implementation plan](docs/M0_IMPLEMENTATION_PLAN.md), and [verified hardening results](docs/WP0_WP1_HARDENING_RESULTS.md).

MIT is intended for PHOENIX-owned code. Contributor provenance and dependency-license review remain required before public distribution; dependencies retain their own licenses. All packages are private. No CI platform is considered validated until it has actually run successfully.
