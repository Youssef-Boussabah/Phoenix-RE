# Contributing

Read the [canonical specification](docs/PHOENIX_ENGINEERING_SOURCE_OF_TRUTH.md), accepted [ADRs](docs/adr/), and [M0 implementation plan](docs/M0_IMPLEMENTATION_PLAN.md) before substantive work. Ownership remains unassigned (D-014 OPEN); do not invent team assignments.

Use Git, Node >=24.11.0 and pnpm 11.18.0 on Windows, macOS or Linux. Prefer a user-managed Node installation; keep the system toolchain intact. Install pnpm explicitly using its standalone installer or a user-managed npm installation (`npm install --global pnpm@11.18.0`), as Corepack is not assumed to be bundled. The `packageManager` field and lockfile pin the workspace. Node 26 is additionally tested. TypeScript remains pinned to 6.0.x until the lint toolchain supports a later major.

On Windows, use PowerShell or a normal developer shell, enable Git long paths in your own environment (`git config --global core.longpaths true`), and use a short checkout path if the OS long-path policy is unavailable. Text files use LF; only actual binary fixtures get binary attributes. Symlink tests in later work packages must explicitly report missing privileges. macOS and Linux need no platform toolchain for WP0/WP1. JDK 21 and Python >=3.10 are optional prerequisites for future providers, not these packages.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
pnpm test:coverage
```

For contract changes, edit Zod schemas and explicit fixtures together, then run `pnpm contracts:snapshot` and review the generated JSON changes. Generated snapshots are checked byte-for-byte and excluded from Prettier; the original archived source is also excluded to preserve its exact bytes. The JSON Schemas describe input validation; custom refinements and nested refinements require the runtime Zod validators. `z.input<typeof Schema>` describes caller input with omitted defaults; inferred exported types describe parsed values.

Keep `main` releasable, use short-lived branches and reviewed PRs. Describe the task, priority, subsystem, resulting behavior and actual acceptance checks. State every OS/runtime tested and any missing validation. Do not claim the full M0 milestone is complete after the foundation; the original real-investigation and testable-reconstruction gate remains in force. Do not include proprietary targets, credentials, generated build output, databases or the original DOCX in Git.

Keep contracts free of I/O and vendor tools; the runtime dependency is Zod only. Workspace dependencies and imports must follow the matrix in the plan. Future toolkit owns intake, evidence owns SQLite, and core composes services; CLI/server remain thin. Create packages when functional code arrives, rather than empty directories.

Architecture changes need an ADR with Problem, Decision, Alternatives, Tradeoffs, Migration and Test impact, with status and approval recorded. Update the canonical specification and changelog in the same change (SOT §20). Genuine correctness fixes include a regression test.

The local dependency-license check inventories installed package metadata, including development dependencies. CI checks platform-specific optional packages on each host. This does not establish contributor rights or finish the pre-distribution license review. Mocks and fault injection belong only in tests; production entry points must ignore fault environment variables.

WP1 review hardening adds `pnpm test:mutations`: eleven semantic source mutations and a canary run in a disposable copy, independent of snapshot regeneration. `pnpm test` performs normal and portable typechecking before runtime tests. Use semantic boundary cases and literal product enum lists; generic null/missing-value tests and high line coverage alone do not establish contract correctness. Do not accept ADR-0007's ready-state or execution-time proposal as part of unrelated implementation work; approval is required before WP6. The simple boundary checker covers direct imports, built-in lookup and fetch patterns, including `.mts`/`.cts`; review dynamic aliases, eval and environment access manually. It is not a security sandbox.
