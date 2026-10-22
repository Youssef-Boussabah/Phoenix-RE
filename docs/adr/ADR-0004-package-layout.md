# ADR-0004: Keep intake in toolkit and add a server transport

Status: accepted
Date: 2026-10-22
Owner: unassigned (D-014 OPEN)
Approval: explicit project instruction accepting P-4, 2026-10-22

## Problem and constraints

Target intake and HTTP ownership need clear package boundaries.

## Decision

Toolkit owns intake and built-in fileinfo. Add server when it contains working transport code. Core composes toolkit and evidence; CLI/server depend only on core and contracts. Create only contracts in WP1.

## Alternatives considered

Separate intake package; HTTP in core; empty future packages.

## Consequences and risks

Boundary checker reserves future dependency rules without creating packages.

## Contracts / tests / migration affected

Manifest and source-import boundary tests; package graph. No relocation of implemented runtime code yet. Original v1.0.0 is preserved in docs/history; canonical SOT v1.0.1 and M0 plan change together.

## Revisit trigger

Revisit with evidence of incompatible contracts, toolchain support, distribution requirements or a changed milestone; preserve product commitments via SOT §20.
