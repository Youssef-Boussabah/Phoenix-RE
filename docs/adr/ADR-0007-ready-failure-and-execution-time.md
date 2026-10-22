# ADR-0007: Ready failures and execution-time accounting

Status: proposed
Date: 2026-10-22
Owner: unassigned (D-014 OPEN)
Approval: pending; must be resolved before WP6

## Problem and constraints

ADR-0002 permits `ready → planning | cancelled` only. The plan's runner budget text measures elapsed time from `job.createdAt`, although M0 jobs deliberately rest in `ready` until a planner is implemented. A resumable idle job can therefore appear exhausted with no legal failure edge. This is a design gap, not authorization to change accepted transitions.

## Proposed decision

Permit `ready → failed` for an unrecoverable failure, retaining the current cancellation semantics. Measure the execution duration charged to `maxWallClockMs` separately from end-to-end job age. Charge bounded intervals while a runner owns and performs active work, using a monotonic clock for each live interval and durable accumulated duration/checkpoints across restarts. Exclude queued, paused, capability-waiting and idle `ready` intervals. Do not reconstruct active time by subtracting `createdAt` from the current wall clock.

WP6 must define interval checkpointing and crash/recovery accounting so neither repeated resumes nor crashed leases reset consumed execution time. A job that has actually exhausted its charged execution time must terminate through an allowed failure/partial edge before more work. Idle time alone must not exhaust an execution budget. An optional future end-to-end age limit would require a distinct documented budget; it must not silently overload `maxWallClockMs`.

## Alternatives considered

Retain creation-time accounting (unfair to queued/resumable jobs); add only the missing failure edge (does not fix idle exhaustion); leave `ready` to an artificial state purely to fail (misleading lifecycle).

## Consequences and risks

Active-time accounting requires persisted counters and explicit crash semantics. The field name `maxWallClockMs` can be misunderstood; decide whether to retain it with documented execution-duration meaning or version/rename it when accepting this ADR. No schema fields, database tables, runner or transition edges are added now.

## Contracts / tests / migration affected

On approval: update ADR-0002/SOT §7.3, the plan §3.6 and §4.3, transition fixtures and snapshot annotations; define persistence/accounting fields in WP6. Test `ready → failed`, queued and idle waits, multiple resumes, active-time exhaustion at equality, cancellation and crash/recovery accounting. The current pure `exhaustedBudget` helper compares a supplied elapsed duration only; its caller time source remains unresolved. Current tests continue rejecting `ready → failed`.

## Revisit trigger

Approval is mandatory before WP6. This proposal does not block WP2 and is not accepted by the input-hardening decision.
