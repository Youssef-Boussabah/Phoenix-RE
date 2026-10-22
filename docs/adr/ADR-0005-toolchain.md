# ADR-0005: Pin the supported development toolchain

Status: accepted
Date: 2026-10-22
Owner: unassigned (D-014 OPEN)
Approval: explicit project instruction accepting P-5, 2026-10-22

## Problem and constraints

Reproducible cross-platform tooling must support local Node 26 and the Node 24 baseline.

## Decision

Node >=24.11 baseline, Node 26 compatibility; pnpm 11.18.0; exact TypeScript 6.0.x, Zod 4, Vitest 5, ESLint 10, typescript-eslint 8, Prettier 3. Use built-in SQLite behind a future adapter, Hono later, no CLI framework. No system-wide installs. Crash injection is exclusively a test entry point, never environment-activated production code.

## Alternatives considered

TypeScript 7 before lint support; native SQLite dependency; production crash switch.

## Consequences and risks

Lockfile and actual runtime checks required. CI on three OSes remains pending until hosted execution.

## Contracts / tests / migration affected

WP0 verifies direct TS scripts on Node 24 and 26; SQLite observations recorded in milestone results. Despite original WP0 wording, toolchain results belong here (ADR-0005), not layout ADR-0004. Original v1.0.0 is preserved in docs/history; canonical SOT v1.0.1 and M0 plan change together.

## Revisit trigger

Revisit with evidence of incompatible contracts, toolchain support, distribution requirements or a changed milestone; preserve product commitments via SOT §20.
