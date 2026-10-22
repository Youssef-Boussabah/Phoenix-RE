# ADR-0003: Adopt Zod-first versioned contracts

Status: accepted
Date: 2026-10-22
Owner: unassigned (D-014 OPEN)
Approval: explicit project instruction accepting P-3, 2026-10-22

## Problem and constraints

SOT examples omit normalized schemas, provenance, verification target pairs and concrete provider context.

## Decision

Adopt plan §3 extensions and the implementation clarifications. Preserve original field meanings. Version serialized documents; brand IDs; use UTC millisecond timestamps; validate target consistency, findings, jobs and envelopes. Encode directory hash records as JSON arrays plus LF; reject normalized-path collisions.

## Alternatives considered

Ad hoc per-package types; raw tool output; newline-delimited unescaped paths (rejected).

## Consequences and risks

Custom Zod refinements are runtime-only and documented in generated JSON Schema; consumers must validate with Zod. Strict objects catch misspelled fields.

## Contracts / tests / migration affected

Schema fixtures and negative cases; JSON Schema snapshots; error round-trips; adversarial tree-record vectors. Filesystem hashing stays WP2. Original v1.0.0 is preserved in docs/history; canonical SOT v1.0.1 and M0 plan change together.

## Revisit trigger

Revisit with evidence of incompatible contracts, toolchain support, distribution requirements or a changed milestone; preserve product commitments via SOT §20.
