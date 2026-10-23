# ADR-0009: Conservative native eligibility and public URL identity

Status: accepted
Date: 2026-10-22
Owner: unassigned (D-014 OPEN)
Approval: explicit owner approval in WP3 Independent Review Corrections section 4 (M3), and mandatory URL privacy correction section 6, 2026-10-22

## Problem and constraints

Header format/CPU observations do not establish structural validity, standalone executable identity or an intended OS. The historical optimistic compatibility examples obscured this distinction. Malformed ELF/PE could retain header metadata and receive compatible results. Universal Mach-O currently lacks complete per-slice executable/platform analysis. URL descriptions retained passwords and query/fragment credentials that could later leak into manifests.

Preserve current schemas, package boundaries, static-first behavior and product commitments. Correct the unpublished WP3 implementation without building a loader, universal slice analyzer, database, network workflow or credential vault.

## Decision

Native eligibility is conservative. `compatible` requires successful supported structural checks, explicit executable identity, established matching OS and known matching CPU. Missing, failed or incomplete checks yield `unknown` for possible native executables. An assumed target OS never establishes compatibility. ELF OSABI-0 remains provisional Linux with `unknown` eligibility; universal Mach-O remains `unknown` until slice executable/platform evidence is parsed. Matching labels `other`/`unknown` are not identified CPUs. These statements never guarantee loading, dependencies, emulation availability, successful execution or authorization.

ELF ET_EXEC keeps executable identity. ET_DYN with one bounded, syntactically valid PT_INTERP loader path is executable-capable PIE evidence. ET_DYN without conclusive evidence remains binaryType `unknown`; absence of PT_INTERP alone does not prove shared-library identity (static PIE also exists). A malformed interpreter or later table failure cannot confer eligibility.

Toolkit-local `structuralStatus` distinguishes `validated` supported metadata checks from `incomplete` and `invalid`. It is propagated through directory/application classification, independently of bounded warning lists. It is not a full loader verdict or a new shared contract field. Serialized descriptions retain explicit failure warnings and conservative compatibility; successful structural parsing signals are omitted after failure. Callers of `hostCompatibility` must supply the supported validation outcome to obtain native eligibility; omitted outcomes default to incomplete.

All ordinary public/persistent target URL fields, including future manifest `url` and HTTP(S) `uri`, represent an **identity URL** consisting only of normalized HTTP(S) origin and path. Remove **all userinfo, query parameters and fragments**, including ostensibly public queries. `targetIdentityUrl` is the shared toolkit helper for this output policy. URL input remains HTTP(S)-only. When access context is removed, emit `URL_ACCESS_CONTEXT_REMOVED` and explicitly state that the result is **not an equivalent retrievable source**.

Future network/persistence workflows must acquire any necessary exact access context through a separately protected mechanism. They must not copy original credential-bearing inputs into manifests, ordinary metadata, logs or artifacts, and must not automatically fetch the sanitized identity as a substitute. A sanitized identity is not a complete source/cache key: distinct query-dependent resources can share it. No vault or fetch behavior is introduced in WP3.

## Alternatives considered

- Optimistically infer Linux from System V ABI, treat fat slice CPU lists as executable evidence, or ignore parser failures: rejected because observations do not support certainty.
- Build a complete ELF loader/universal analyzer now: unnecessary for these corrections; stronger evidence can refine eligibility later.
- Redact only logs or only named query keys: rejected because manifests would still leak userinfo, signed URLs or unknown credential names.
- Persist raw URLs as reversible redacted strings, or silently fetch a query-stripped URL: rejected because secrets and retrieval semantics are not preserved safely.

## Consequences and risks

Some legitimate targets remain unknown. Necessary supported metadata checks are not sufficient for successful OS loading. Unsupported Mach-O platform commands and fat slice contents need later evidence; ELF inference can improve without weakening this default.

URL identities lose query-dependent distinctions and access information deliberately. Origin/path may themselves be sensitive target identifiers; this is not a universal detector for secrets embedded in arbitrary path segments. Existing privacy/disclosure rules still apply. Future persistence boundaries must use sanitized intake outputs/helper and test both `url` and `uri`; Zod shape/protocol validation alone does not sanitize arbitrary caller-supplied manifests.

## Contracts / tests / migration affected

No shared schema, 97 JSON Schema snapshots, package graph, tree hash algorithm or existing accepted ADR changes. Keep SOT v1.0.2: this records the owner-approved WP3 implementation policy and privacy correction, not a product architecture/version migration. Increment the classifier rule version to `1.0.1-wp3` for cache provenance.

Add real compiled PIE expectations, actual-parser compatibility cases, 103 realistic section-offset mutations, invalid Electron-main propagation, URL serialization/golden tests, ZIP identity regressions and bounded warning tests. Fixture lock adds binaryType expectations without byte/hash changes. Existing golden descriptions intentionally change classifier version and add a credential-bearing input whose output contains only safe identity/access-context warning.

WP4 must enforce this URL policy at manifest persistence boundaries and retain invalid/incomplete outcomes; WP5 must not infer runtime authorization or compatibility from formats/extensions alone. No persisted records exist yet, so no database migration or secret cleanup is claimed. ADR-0007 remains proposed/unapproved before WP6.

## Revisit trigger

Validated universal slice/ELF platform evidence, implementing source fetching or manifest persistence, protected credential handling, or evidence that a documented limit blocks legitimate metadata. Preserve privacy and conservative eligibility while making any refinement explicit and tested.
