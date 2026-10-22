# ADR-0001: Split M0 without weakening its exit

Status: accepted
Date: 2026-10-22
Owner: unassigned (D-014 OPEN)
Approval: explicit project instruction accepting P-1, 2026-10-22

## Problem and constraints

The original M0 exit includes a real reconstruction while the foundation scope does not.

## Decision

Deliver M0-Foundation (WP0–WP9 in the plan), then M0-Vertical. Preserve every original M0 backlog item and the full investigation plus testable reconstruction exit.

## Alternatives considered

Keep one ambiguous milestone; reduce the exit condition (rejected).

## Consequences and risks

More milestones to track; the foundation is never reported as complete M0.

## Contracts / tests / migration affected

SOT §21; WP0/WP1 checks now, end-to-end and held-out tests later. Original v1.0.0 is preserved in docs/history; canonical SOT v1.0.1 and M0 plan change together.

## Revisit trigger

Revisit with evidence of incompatible contracts, toolchain support, distribution requirements or a changed milestone; preserve product commitments via SOT §20.
