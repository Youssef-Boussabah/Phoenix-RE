# ADR-0008: Harden unpublished WP1 input contracts

Status: accepted
Date: 2026-10-22
Owner: unassigned (D-014 OPEN)
Approval: explicit project instruction to fix the Opus review findings before the initial commit, 2026-10-22

## Problem and constraints

The reviewed implementation followed the approved architecture but recursive JSON validation/error sanitization could overflow. URL, lifecycle, provider and path validators admitted contradictory or unsafe records. Generic negative tests and high executable-code coverage did not detect eleven semantic mutations. The public stream types also referenced undeclared Node types.

## Decision

Use an iterative bounded validator and detached copy for arbitrary JSON fields. Limit root-at-depth-zero trees to depth 64, 50,000 value-node occurrences and 1,048,576 serialized UTF-8 bytes per field/object. Count keys and punctuation in byte size. Validate whole metadata/error objects, not separate unconstrained entries. Reject cycles, nonfinite numbers, accessors, sparse arrays, nonplain objects and non-JSON values; allow shared acyclic references and explicit JSON null. Never invoke getters or toJSON. Error sanitization uses the same bounded traversal, replaces cycles/non-JSON primitives with markers, omits details that exceed limits, preserves colliding redacted keys with suffixes and caps messages at 8192 characters.

Use HTTP(S)-only target URLs, consistent source/digest and manifest URI identities, literal NFC POSIX relative paths/exclusions, nonempty shared provider identities, and coherent terminal job/event invariants. Active/completed jobs carry no final error; cancellation errors, when present, use CANCELLED; failure/partial errors do not. Terminal timestamps are required exactly for terminal jobs. Budget events name the two defined budgets and use nonnegative safe integer counters at or beyond the limit. Preserve all accepted state edges and mode guards.

Exclusions are literal names or relative paths, matching the existing CLI name/relpath specification; glob semantics are not introduced. Serialized relative paths reject backslashes, NUL, empty/dot/traversal segments, absolute/drive paths, lone surrogates and non-NFC strings. Newlines/tabs and other valid filename characters remain representable. Future filesystem intake must report unsupported names and refrain from producing a misleading complete digest; it must not silently rename or omit entries. These syntactic validators do not replace WP2 realpath containment or collision checks.

Explicit observation data `null` is a recorded JSON value. Future persistence must use `JSON.stringify(null)` (TEXT `"null"`), not SQL NULL; absent inline data maps to SQL NULL and requires an artifact. Preserve the planned database CHECK without implementing persistence here.

Expose byte streams as `AsyncIterable<Uint8Array>`; Node Readable can implement this interface without leaking Node type dependencies into browser consumers. Compile all production contracts with ES2023 + DOM and no ambient Node types; also verify their public type surface with skipLibCheck false. Retain Zod as the sole runtime dependency.

## Alternatives considered

Catch recursive stack overflows after traversal (still unsafe); impose body-size limits alone (tiny nested input still overflows); let JSON Schema snapshots stand in for semantic tests; treat null as absence; introduce glob matching or filesystem code in contracts; modify ready-state semantics without approval.

## Consequences and risks

The 1 MiB JSON field limit is an additional contract cap; the planned server must separately enforce the aggregate 1 MiB request-body limit before decoding, and inline responses must also honor the lower of contract and request limits. Larger outputs use artifacts. This validator accepts in-memory JSON values, not raw unbounded JSON text; future transports still need bounded decoding. Runtime constraints are annotated in JSON Schemas; schema format URI does not authorize arbitrary URL protocols. Redaction is bounded pattern matching, not a universal secret detector. The boundary checker covers direct imports, built-in acquisition and fetch patterns; it is not a sandbox or arbitrary alias/eval analyzer.

## Contracts / tests / migration affected

Update runtime schemas, inferred types, JSON Schema snapshots, explicit semantic tests for all eleven reported mutations and literal committed enums. Add adversarial 20,000-level inputs, cycle/resource limits, lifecycle/path/provider/URL/null/Mach-O tests, tooling negative tests and portable-type compilation. No persisted data or published API exists yet; keep schemaVersion 1 and the unpublished contracts prerelease version. Canonical SOT advances to 1.0.2 and retains previous decisions/history. ADR-0007 remains proposed and must be approved before WP6; no ready-state or time-accounting change is made here.

## Revisit trigger

Evidence that valid provider results require a different JSON cap or exclusion grammar, publishing the API, implementing bounded transport decoding, or accepting ADR-0007. Change resource limits deliberately with semantic boundary tests.
