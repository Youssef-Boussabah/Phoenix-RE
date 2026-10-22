# ADR-0006: Canonical Markdown and MIT intent

Status: accepted
Date: 2026-10-22
Owner: unassigned (D-014 OPEN)
Approval: explicit project instruction accepting P-6, 2026-10-22

## Problem and constraints

The project needs one governing specification, provenance preservation and clear package/distribution status.

## Decision

Canonical SOT is docs/PHOENIX_ENGINEERING_SOURCE_OF_TRUTH.md. Archive original Markdown verbatim in docs/history. Keep original DOCX locally ignored. MIT intended for PHOENIX-owned code, subject to contributor/dependency review before public distribution. Packages private; select an owned scope before publishing. Owner unassigned (D-014 OPEN). Binary attributes apply only to actual binary fixtures when they arrive.

## Alternatives considered

Multiple current source documents; tracking DOCX; blanket binary fixture attributes.

## Consequences and risks

Dependency license inventory does not replace legal or contributor review. No remote configuration or publication.

## Contracts / tests / migration affected

Git ignore/attributes checks; license inventory; README and CONTRIBUTING; document preservation check. Original v1.0.0 is preserved in docs/history; canonical SOT v1.0.1 and M0 plan change together.

## Revisit trigger

Revisit with evidence of incompatible contracts, toolchain support, distribution requirements or a changed milestone; preserve product commitments via SOT §20.
