# ADR-0002: Repair transitions and enforce job modes

Status: accepted
Date: 2026-10-22
Owner: unassigned (D-014 OPEN)
Approval: explicit project instruction accepting P-2, 2026-10-22

## Problem and constraints

Investigations cannot complete; several failure edges and mode restrictions were missing.

## Decision

Adopt plan §3.6 verbatim: six added edges, nonterminal active states, terminal immutability, and all four mode guards. Zero tool-call budgets are immediately exhausted before work; do not add unrelated edges.

## Alternatives considered

Original table; permit all modes (both incorrect).

## Consequences and risks

Contracts validate legality; later persistence must commit state, step and events atomically.

## Contracts / tests / migration affected

Exhaustive 11×11×3 test; mode tests; budget boundary tests. No runner in WP1. Original v1.0.0 is preserved in docs/history; canonical SOT v1.0.1 and M0 plan change together.

## Revisit trigger

Revisit with evidence of incompatible contracts, toolchain support, distribution requirements or a changed milestone; preserve product commitments via SOT §20.
