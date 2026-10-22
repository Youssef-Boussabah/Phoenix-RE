---
title: 'PHOENIX'
subtitle: 'Engineering Source of Truth | Architecture, Implementation, and Evolution'
date: '21 October 2026'
---

> **Document ID:** PHX-SOT-001  
> **Version:** 1.0.2 — reviewed WP0/WP1 contract hardening  
> **Status:** Approved product direction; P-1 through P-6 accepted (ADRs below); implementation verified separately  
> **Canonical repository location:** `docs/PHOENIX_ENGINEERING_SOURCE_OF_TRUTH.md`  
> **Steward:** Project technical lead (assignment pending)  
> **Updated:** 2026-10-22  
> **Rule:** This file is the authoritative written specification. Running code, tests, and recorded architectural decisions must be reconciled with it whenever behavior changes.

## Contents

- [1. Purpose and document governance](#1-purpose-and-document-governance)
- [2. Product charter — the immutable center](#2-product-charter-the-immutable-center)
- [3. Users, target scenarios, and outcomes](#3-users-target-scenarios-and-outcomes)
- [4. Supported target and host matrix](#4-supported-target-and-host-matrix)
- [5. Top-level architecture](#5-top-level-architecture)
- [6. System components and responsibilities](#6-system-components-and-responsibilities)
- [7. Interfaces, schemas, and state machine](#7-interfaces-schemas-and-state-machine)
- [8. End-to-end workflow contract](#8-end-to-end-workflow-contract)
- [9. Tool integrations and implementation rules](#9-tool-integrations-and-implementation-rules)
- [10. AI model strategy — Nebius and NVIDIA](#10-ai-model-strategy-nebius-and-nvidia)
- [11. User interface / interaction design](#11-user-interface-interaction-design)
- [12. Repository and build architecture](#12-repository-and-build-architecture)
- [13. Security, execution, privacy, and licensing](#13-security-execution-privacy-and-licensing)
- [14. Quality standards and engineering workflow](#14-quality-standards-and-engineering-workflow)
- [15. Benchmark design and proof of value](#15-benchmark-design-and-proof-of-value)
- [16. Release plan and prioritization](#16-release-plan-and-prioritization)
- [17. Team ownership and decision making](#17-team-ownership-and-decision-making)
- [18. Operational concerns and observability](#18-operational-concerns-and-observability)
- [19. Main risks and countermeasures](#19-main-risks-and-countermeasures)
- [20. Decision log and architecture change protocol](#20-decision-log-and-architecture-change-protocol)
- [21. Immediate implementation backlog](#21-immediate-implementation-backlog)
- [22. Open questions requiring a decision](#22-open-questions-requiring-a-decision)
- [23. Verified references (checked 2026-10-21)](#23-verified-references-checked-2026-10-21)
- [24. Coding-agent and new-contributor handoff contract](#24-coding-agent-and-new-contributor-handoff-contract)
- [25. Changelog](#25-changelog)

---

# 1. Purpose and document governance

This document is the **long-lived engineering reference for PHOENIX**. It defines what the product is, what has already been decided, what remains a proposal, how components interact, the delivery plan, and how decisions may change. A teammate or coding agent should be able to join the project using this document without reinventing the product direction.

The document is **not** a marketing pitch, prompt dump, collection of speculative features, or a claim that described components are already implemented. It must be updated when a material decision or verified implementation changes the plan.

**Authority order** when there is a conflict:

1. Applicable laws, distribution licenses, and upstream tool terms.
2. Explicit, current team decisions captured in the decision log (Section 20).
3. This current version of the source-of-truth document.
4. Validated API schemas, automated tests, and actual system behavior; a discrepancy is a documentation or implementation issue to resolve, not permission to silently change the vision.
5. Issues, exploratory documents, chat discussions, and external examples.

**Status language:** **COMMITTED** = established product requirement; **DESIGN DEFAULT** = recommended implementation that may change through an architectural decision record (ADR); **OPTIONAL** = supported later or only when available; **NOT BUILT** = no implementation is asserted; **OPEN** = unresolved question, not an approval.

**Edit discipline:** preserve rationale. When changing an architectural decision, write the new decision, why it wins, tradeoffs, migration plan, affected interfaces/tests, and a changelog entry. Do not silently delete old decisions.

# 2. Product charter — the immutable center

## 2.1 Identity and mission

**Name:** PHOENIX  
**Category:** Free, open-source, general-purpose AI reverse-engineering and software-reconstruction platform.  
**Primary mission:** Help developers investigate unfamiliar software, recover its actual structure and behavior, and independently reconstruct selected functionality—or progressively broader applications—with verifiable evidence.

A user supplies a software target and an objective. PHOENIX inspects code or artifacts, conducts controlled experiments when useful, builds an evidence-backed model, generates editable reconstruction code upon request, and measures its equivalence to the reference.

**One sentence:** PHOENIX investigates how software works, recreates what the user chooses, and tests whether the recreation behaves like the original.

## 2.2 Product commitments (COMMITTED)

- **Reverse engineering is the core product.** It includes static inspection, dynamic observation, interpretation, hypothesis testing, and traceable findings. It is not primarily software repair or preservation.
- **Reconstruction/cloning is a first-class capability**, not merely pseudocode generation. The long-term vision includes realistic application interfaces, logic, state, and user-visible behavior; the first release can honestly support narrower scopes.
- **Verification is integral:** PHOENIX reports what was tested, what passed, what diverged, and what remains unknown. A visual likeness alone is never treated as proof of functional equivalence.
- **Build an independent REA-like toolkit.** PHOENIX works without REA installed; use REA as an architecture/reference and optional comparison target, not a runtime dependency.
- **Reuse proven analysis engines** (Ghidra, Playwright, Frida, source parsers, debuggers) rather than build a new machine-code decompiler from scratch.
- **Cross-platform experience:** Windows, macOS, and Linux teammates use the same product concepts and workspace, with OS-specific execution providers as required. Cross-platform UI does not imply every foreign binary can execute on every host.
- **Free and open source, general-purpose.** Do not impose arbitrary bans on software categories. Host safety controls, disclosure of cloud data sharing, permissions, and compliance with applicable rights/licenses remain necessary.
- **Actual engineering over demo-only appearance.** Reproducible execution, maintainable code, documented limitations, and measured outcomes are requirements.
- **Nebius × NVIDIA integration must be real** for the hackathon: an NVIDIA open model makes runtime inference calls through Nebius Token Factory or runs on Nebius AI Cloud, in the actual investigation/reconstruction workflow.

## 2.3 Explicit non-goals for the first public release

- Guaranteed one-click cloning of Spotify, Photoshop, commercial applications, or every conceivable program.
- Recovering exact original source code, original variable names, or source-level intent from arbitrary compiled binaries.
- Recreating private server infrastructures, restricted content libraries, licenses, third-party assets, or remote services not available for independent implementation.
- Writing a replacement for Ghidra, Frida, Playwright, LLDB, or other mature core engines.
- Launching every optional provider on every job; tool choice is target-dependent.
- Distributed microservices, a graph database, multi-agent swarms, or custom CUDA kernels unless evidence shows they solve an actual bottleneck.
- Pretending every advanced capability already exists because it appears in the architecture diagram.

# 3. Users, target scenarios, and outcomes

**Primary users:** developers, reverse engineers, interoperability engineers, technical learners, security researchers, maintainers, and teams studying software whose implementation is unfamiliar.

**Job A — Investigate:** “Analyze this executable or application and explain its file parser, execution paths, data flow, and supporting evidence.” Output: investigation workspace, recovered functions/modules, code excerpts, trace links, hypotheses, test results, limitations.

**Job B — Reconstruct:** “Recreate the selected file-processing feature / UI workflow / local interaction without the original source.” Output: independent, editable project, executable tests, build instructions, behavioral correspondence report.

**Job C — Verify:** “Compare these two implementations and tell me exactly how they differ.” Output: reusable test corpus, mismatches with repro steps, screenshots/diffs where relevant, regression history, concrete recommendations.

**Illustrative complete example:** user imports an unfamiliar Electron app and asks PHOENIX to recreate a note-search workflow. PHOENIX inventories files/modules, observes UI transitions and IPC where accessible, identifies search behavior and state persistence, creates its own implementation, runs the same test scenarios against both systems, and reports matched/unmatched behaviors. The goal is a functioning feature, not a screenshot-only clone.

# 4. Supported target and host matrix

Support is **capability-based**, not a claim that every feature works everywhere.

| Target class                     | Static inspection                                                | Runtime evidence                                         | Reconstruction/verification           | Target priority |
| -------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------- | --------------- |
| Website / browser app            | DOM, JS bundles, scripts, routes, assets, network metadata       | Playwright + Chrome DevTools Protocol (CDP)              | UI + functional browser comparisons   | P0              |
| Electron / packaged JavaScript   | ASAR/files, modules, imports, sources/maps if present, IPC clues | Host-compatible runtime capture, browser/desktop adapter | App workflows and local state         | P0/P1           |
| Source repository                | AST, imports, symbols, references, dependency analysis           | Unit/integration tests, local execution                  | Algorithm or component reconstruction | P0              |
| Native Linux ELF                 | Ghidra/other decompiler, headers, symbols, references            | Linux execution worker + debugger/Frida                  | Selected native behavior              | P1 initial      |
| Native Windows PE                | Cross-host static analysis when supported                        | Windows execution worker                                 | Selected native behavior              | P1/P2           |
| Native macOS Mach-O              | Cross-host static analysis when supported                        | macOS execution worker                                   | Selected native behavior              | P1/P2           |
| Android / .NET / WASM / firmware | Dedicated optional providers                                     | Specialized runtimes                                     | Later, scoped by tests                | P2+             |

**Definitions:** P0 = required first complete workflow; P1 = early expansion; P2+ = future. A host platform and a target format are distinct properties. UI availability on macOS is not evidence that a Windows `.exe` can be run there. Store both in job metadata.

# 5. Top-level architecture

```text
  User: web/desktop workspace, CLI, MCP client
                     |
                 PHOENIX API
                     |
       Project + Job Orchestrator (state machine)
                     |
     +---------------+----------------+
     |               |                |
  Investigator   Evidence Store   Reconstructor
     |               ^                |
     +--- Tool Layer-+                |
             |                        v
     Provider Registry            Build Runner
   (Ghidra / JS / CDP /               |
    Frida / Debuggers / ...)     Verification Engine
             |                        |
       OS/Target Runners <------------+
              |
          Target software

  Nebius/Nemotron Model Adapter <--> Investigator/Reconstructor
  Local model adapters (future) <--> same model contract
```

**Architectural rule:** the UI, AI agent, provider adapters, and verification engine communicate through versioned contracts. No subsystem is permitted to assume raw vendor tool output is a stable public API.

**Data flow:** target intake → fingerprint/capabilities → scoped investigation plan → static and/or dynamic observations → evidence/hypotheses → reconstruction specification → implementation → executable comparison → feedback → export.

**Deployment default:** local-first monorepo and process-oriented workers. The shared UI can be reached from Windows/macOS/Linux; actual runtime probes execute on appropriate worker hosts. Remote/cloud workers are opt-in and do not receive target files by default.

# 6. System components and responsibilities

## 6.1 Target Intake and Capability Detection

**Own:** target identity, format detection, cryptographic hashes, file inventories, runtime eligibility, provider suitability, and intake warnings. **Do not:** execute imported software while simply identifying it.

**Inputs:** path/upload, URL, repository reference, user objective, chosen execution policy.  
**Outputs:** `TargetManifest`, capability report, tool proposals, immutable artifact references.

Detect actual file signatures instead of trusting extensions. Preserve original artifacts read-only where feasible. Allow website capture, extracted Electron bundle, source folder, and native binaries through the same job model.

## 6.2 Independent PHOENIX Toolkit (REA-like)

**Own:** provider discovery, normalization, tool dispatch, schemas, bounded execution, standard error codes, evidence attachments, and tool-independent CLI/MCP operations.  
**Must work without REA installed.** The toolkit can export normalized evidence and optionally consume REA results for comparison if a compatibility adapter is later approved.

Minimum operations: `inspect_target`, `list_modules`, `list_functions`, `decompile_function`, `get_references`, `get_call_graph`, `inspect_assets`, `trace_runtime`, `run_experiment`, and `capture_interface` when provider capabilities allow. Unsupported operations return explicit `NOT_SUPPORTED`, not placeholder data.

Core design: _capability advertisement → validated request → executable provider command → normalized observation → evidence record_. Provider availability and host restrictions are resolved before tool execution.

## 6.3 Autonomous Investigation Engine

**Own:** goal decomposition, frontier selection, hypothesis lifecycle, next-action planning, evidence reconciliation, budgets, resumability, and useful stop conditions.

Investigation loop:

1. Parse user objective into observable questions and acceptance criteria.
2. Build initial candidate set from dependency traversals, UI/action traces, and available metadata.
3. Form **hypotheses** as explicit claims with alternative explanations and evidence references.
4. Select the next action using relevance, expected information gain, cost, and risk.
5. Run the tool; update evidence, dependencies, hypotheses and progress.
6. Decide: continue, ask user for a necessary environment capability, initiate reconstruction, or stop with documented unknowns.

**Initial scheduler:** deterministic and auditable heuristics before ambitious learning-based scheduling. Example priority function for an action `a`:

```text
score(a) = w1 * relevance(a)
         + w2 * estimated_information_gain(a)
         + w3 * uncovered_requirement(a)
         - w4 * estimated_cost(a)
         - w5 * execution_risk(a)
```

Weights are **experimental parameters**, not mathematically validated probabilities. Never display uncalibrated numeric values as “confidence 98%.” Prefer status labels such as `hypothesis`, `observed`, `corroborated`, and `contradicted`, with evidence links. A later calibrated evidence model can replace the heuristic.

**Fallback:** if planning repeatedly fails, use bounded deterministic traversal of referenced functions/modules. If analysis is inconclusive, report why rather than inventing a result.

## 6.4 Evidence and Knowledge Engine

**Own:** persistence, provenance, hypotheses, relationships, experiments, artifact hashes, and reversible updates. Starting default: SQLite + content-addressed local artifact store, not mandatory Neo4j.

Entity types: `Target`, `Artifact`, `Module`, `Function`, `UIState`, `Action`, `Observation`, `Trace`, `Claim`, `Hypothesis`, `Experiment`, `Requirement`, `Reconstruction`, `Comparison`, `Job`.

Relationships: `calls`, `imports`, `derived_from`, `supports`, `contradicts`, `produced_by`, `tests`, `implements`, `observed_in`, `supersedes`. Every meaningful AI claim must be tied to observable evidence or clearly marked as an unverified interpretation.

Store byte hashes and provenance so previous conclusions can be invalidated when the target or source artifact changes. Never conflate a decompiler's guessed function name with a verified original symbol.

## 6.5 Reconstruction Engine

**Own:** converting an evidence-backed objective into a reconstruction specification; generating normal editable source; building, running, and revising it.

Reconstruction artifact bundle:

- `specification.md` — target scope, supported behaviors, assumptions, known unknowns.
- `src/` — independently authored implementation and project configuration.
- `tests/` — generated and manually curated tests.
- `coverage.json` — behaviors attempted and verification status.
- `provenance.json` — observation and source links that support design claims.
- `README.md` — local build/run instructions and known gaps.

**Rule:** choose a suitable output stack for the objective; a cloned web workflow may use React/TypeScript while a data parser may use Python or C++. Do not force every reconstruction into one language or a PHOENIX-specific execution environment.

## 6.6 Verification Engine

**Own:** reproducible comparison scenarios, normalization rules, mismatch classification, regression tracking, and repair feedback.

Comparisons include: same-input outputs, persisted state, UI transitions, visual differences, runtime errors, edge-case handling, and artifacts. Compare normalized representations where reasonable: e.g., canonical JSON versus brittle byte-for-byte serialization, or semantic UI behavior alongside screenshot differences.

A mismatch is a first-class object containing scenario, expected observation, actual observation, environment, artifacts, replay instructions, severity, and likely cause category. Verification must preserve failed cases as regression tests. Stop correction loops on iteration/time/cost limits and report the remaining failures.

## 6.7 Execution and Resource Manager

**Own:** bounded processes, runner selection, execution policy, job queues, CPU/memory/time limits, network policy, workspace cleanup, structured logs, and cancellation. Static probes run without launching a target. Dynamic probes require a compatible runner and explicit workflow approval. Never treat a container alone as a perfect security boundary for hostile native binaries.

## 6.8 Client and Interoperability

**Own:** project dashboard, target import, objective capture, evidence/code viewer, progress feed, diff results, export, CLI and MCP bridge. Graphs are navigational aids **not the product**.

# 7. Interfaces, schemas, and state machine

The original 1.0.0 examples below are retained as historical design context. **Accepted v1.0.2 contracts** are defined in `packages/contracts/src/`, with concrete fields in [M0 plan §3](M0_IMPLEMENTATION_PLAN.md#3-contracts-concrete-interfaces-and-schema-decisions) and ADR-0003. Additive changes retain all original SOT field meanings. Top-level documents carry `schemaVersion: 1`; IDs are branded prefixed 32-character hex values; UTC timestamps have millisecond precision. `hostOs` means intake host, separate from target platform; `uri` never contains a raw local path. Verification requires reference and candidate IDs; findings have revisions, and non-hypotheses cite evidence. Provider capabilities have structured prerequisites, host/policy context and explicit availability. Target digests and classification fields are consistent, enforced by runtime validation. The following initial schemas were **DESIGN DEFAULTS**. Store them in a shared package, version them, and use runtime validation (e.g. Zod). The real code contracts take effect after tests confirm them.

[ADR-0008](adr/ADR-0008-contract-input-hardening.md) accepts the review hardening details: iterative bounded JSON validation (depth 64, 50,000 value nodes, 1 MiB serialized UTF-8 per arbitrary field/object); HTTP(S)-only target URLs; consistent source/digest/URI/provider identities; validated relative paths and literal exclusions; terminal timestamps and lifecycle errors; recognized budget events; safe bounded error normalization/redaction; and portable async byte streams. Runtime-only constraints remain annotated in generated JSON Schemas. Explicit observation JSON null is stored as TEXT `"null"`, distinct from absent data/SQL NULL. Tests include the eleven independently identified semantic mutations; executable coverage is not proof of semantic completeness.

## 7.1 Core concepts

```typescript
export type TargetKind =
  'web' | 'electron' | 'source' | 'elf' | 'pe' | 'macho' | 'android' | 'dotnet' | 'wasm' | 'unknown';

export type JobMode = 'investigate' | 'reconstruct' | 'verify';

export type JobState =
  | 'created'
  | 'fingerprinting'
  | 'ready'
  | 'planning'
  | 'investigating'
  | 'reconstructing'
  | 'verifying'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export interface TargetManifest {
  id: string;
  kind: TargetKind;
  uri: string; // local artifact URI or user-supplied URL
  sha256?: string; // set for immutable file-based targets
  hostOs?: 'windows' | 'macos' | 'linux';
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface EvidenceRef {
  id: string;
  kind: 'static' | 'runtime' | 'user' | 'derived';
  artifactId: string;
  location?: string; // address, path, line, event, screenshot
}

export interface Finding {
  id: string;
  targetId: string;
  statement: string;
  status: 'hypothesis' | 'observed' | 'corroborated' | 'contradicted';
  evidence: EvidenceRef[];
  limitations: string[];
}
```

## 7.2 Provider interface

```typescript
export interface AnalysisProvider {
  id: string;
  version: string;
  probe(target: TargetManifest): Promise<CapabilityReport>;
  execute(request: AnalysisRequest, context: ExecutionContext): Promise<AnalysisResult>;
  close?(): Promise<void>;
}

export interface CapabilityReport {
  supportedOperations: string[];
  supportedKinds: TargetKind[];
  needsRuntime: boolean;
  supportedHosts: ('windows' | 'macos' | 'linux')[];
  prerequisites: string[];
}
```

**Tool response envelope** must include `requestId`, `providerId`, `providerVersion`, `targetId`, `timestamp`, `status`, `durationMs`, `data`, `evidenceRefs`, `warnings`, and normalized error information. Limit output size and paginate high-cardinality results; attach large binaries/screenshots as artifact references rather than model text.

## 7.3 Job state transitions

```text
created -> fingerprinting | failed | cancelled
fingerprinting -> ready | failed | cancelled
ready -> planning | cancelled
planning -> investigating | reconstructing | verifying | partial | failed | cancelled
investigating -> planning | reconstructing | completed | partial | failed | cancelled
reconstructing -> verifying | planning | partial | failed | cancelled
verifying -> completed | reconstructing | investigating | partial | failed | cancelled
completed | partial | failed | cancelled -> (terminal)
```

Accepted by [ADR-0002](adr/ADR-0002-state-transitions.md). Entering `reconstructing` requires reconstruct mode; entering `verifying` requires reconstruct or verify mode. `investigating → completed` requires investigate mode, and `verifying → completed` requires reconstruct or verify mode. Every nonterminal state is active. WP1 supplies validation only; no job runner is asserted. This supersedes the incomplete v1.0.0 edge table (retained in `docs/history/`). Zero tool-call budgets are valid and immediately exhausted before work; consumption at the configured limit is exhausted.

[ADR-0007](adr/ADR-0007-ready-failure-and-execution-time.md) is **proposed**, covering a possible `ready → failed` edge and active execution-time accounting that excludes idle waits. It requires approval before WP6. The accepted table and current elapsed-duration predicate remain unchanged.

Transitions must be validated and saved atomically. Jobs are resumable after a crash with idempotent step identifiers. A completed investigation does not imply a successfully reconstructed application.

## 7.4 Initial application API and CLI

API (suggested): `POST /projects`, `POST /targets`, `POST /jobs`, `GET /jobs/:id`, `GET /jobs/:id/events`, `GET /projects/:id/evidence`, `POST /jobs/:id/cancel`, `GET /jobs/:id/artifacts`. Use an event stream for progress; do not expose raw filesystem paths to remote clients.

CLI (suggested):

```text
phoenix doctor
phoenix inspect ./target.bin --output json
phoenix investigate ./app --objective "trace file import"
phoenix reconstruct <investigation-id> --feature "import"
phoenix verify <reference> <reconstruction> --suite tests/
phoenix export <project-id> --destination ./out
```

CLI commands must map to the same core services as the UI and MCP. MCP is another transport layer, not a second implementation of the engine.

# 8. End-to-end workflow contract

**Example: reconstruct a file import feature from an authorized application.**

1. Intake: compute target hash, identify kind, record user objective and chosen execution policy.
2. Probe: list available static/runtime capabilities; flag unavailable adapters.
3. Scope: define observable input/output behavior, user-visible flows, exclusions, and a finite budget.
4. Static analysis: inspect modules, strings, call relationships, and candidate processing functions.
5. Runtime observation: if approved/possible, perform input trials and record deterministic outputs.
6. Hypothesis management: represent competing explanations and select discriminating experiments.
7. Specification: lock current behaviors and unknowns in a reconstruction spec.
8. Generation: create a clean project and initial implementation.
9. Build/test: run compiler, linter, smoke tests, and behavioral comparison.
10. Repair: link each failing scenario to its evidence and relevant code; update implementation/spec.
11. Completion: stop on acceptance, user cancellation, exhausted budget, or explicit blocker.
12. Export: source, tests, evidence report, instructions, coverage, and limitations.

The system must support **partial success** and human review at any checkpoint. It must not rewrite the source target or silently expand reconstruction scope.

# 9. Tool integrations and implementation rules

| Provider                                | P0/P1 action         | Important integration note                                                                                   |
| --------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| Ghidra                                  | P1                   | Headless import and scripted function/pseudocode extraction; preserve project/version metadata               |
| Playwright                              | P0                   | Browser state/action traces, screenshots, UI tests; keep selectors and timeouts robust                       |
| Chrome DevTools Protocol                | P0                   | Browser scripts, network/DOM/runtime metadata; scope sensitive captures                                      |
| Tree-sitter / language-specific parsers | P0                   | AST, symbol/import relationships; use language-specific parsers where stronger                               |
| Electron/JavaScript analysis            | P0                   | ASAR/archive inventory, source maps, package boundaries, IPC clues; do not assume original source is present |
| Frida                                   | P1                   | Explicit per-platform instrumentation provider; target-specific support required                             |
| GDB / LLDB                              | P1                   | Host-specific runtime debugging; scripts must be isolated and bounded                                        |
| Rizin / objdump                         | P2                   | Alternative disassembly/headers and fallback capability                                                      |
| IDA / Hopper                            | P2 optional          | Commercial installs and licenses provided by user; never assume entitlement                                  |
| Android / .NET / WASM                   | P2+                  | Separate format-specific adapters with targeted fixtures                                                     |
| REA                                     | Reference / optional | Study architecture and compare baseline; no mandatory production dependency                                  |

**Provider quality gate:** capability probe, timeout/cancel support, sanitized logs, golden-fixture test, version reporting, deterministic normalized responses, and at least one known unsupported/error case. Add a tool only after passing this gate; no integration gets a “working” label for merely launching.

# 10. AI model strategy — Nebius and NVIDIA

**COMMITTED for hackathon:** a NVIDIA open model on Nebius participates in genuine runtime investigation, code reasoning, planning, or reconstruction. Do not make a ceremonial unrelated API request to satisfy the requirement.

**DESIGN DEFAULT:** one model adapter with configurable providers and roles:

- High-volume classification and extraction: a faster/cheaper supported Nemotron model.
- Investigation planning and evidence reconciliation: a strong Nemotron reasoning model.
- Difficult reconstruction/code repair: escalate to a stronger available model only if needed.
- Static parsing, hashing, diffing, code execution, schema validation, and test assertions: **deterministic tools**, not LLM calls.

Candidate model families include Nemotron 3.5 Lightning, Nemotron 3 Super, and Nemotron 3 Ultra; **exact names, API endpoints, availability, prices, context size, and tool-calling support must be verified in the live Nebius catalog before coding configuration**. Never hardcode speculative billing rates. Store endpoint and model ID in configuration; keys in environment variables/secrets, never logs or repository.

Model requests should use bounded evidence packets with citations/artifact IDs, expected JSON schemas, retry policies, timeouts, and explicit cost accounting. A model's reasoning is a proposal until corroborated by a tool result or labeled appropriately. Record model/provider/version where provided for reproducibility.

**Spending discipline (DESIGN DEFAULT):** target discretionary development spending of approximately **C$100**, with **C$150 as the ceiling unless the team explicitly approves more**. Sponsorship credits and free tiers should be used where available, but do not assume credits exist until verified. Enable per-job and per-day provider spending limits and surface incurred versus estimated costs.

**Privacy behavior:** file content, recovered code, network observations, or screenshots may be sensitive. Default to local inspection; provide visible disclosure and user control before sending selected context to cloud inference. Retain only necessary excerpts in prompts, redact credentials by default, and do not imply that Nebius processing is the same as local inference.

# 11. User interface / interaction design

**Primary layout:** project and target selector; Investigation / Reconstruct / Verify task tabs; main evidence/code canvas; right-side findings/hypotheses; bottom job events and test results. A relationship graph is one selectable view, not the homepage's central promise.

**Investigation mode:** code browser, decompiled pseudocode and assembly links, function relationships, experiments, claims and contradictions, user-guided follow-up questions.

**Reconstruction mode:** feature objective and scope; generated project tree; implementation progress; build/test console; differences and patch history; export.

**Verification mode:** baseline and reconstruction selectors; scenario runner; visual/behavioral diffs; filtered pass/fail results; replay actions; acceptance summary.

UX expectations: honest progress and errors, no fake “analysis complete” badges, explicit distinction between observed facts and interpretations, no dependence on a giant chat transcript, accessible color contrast and keyboard navigation. The UI must remain usable if some provider is unavailable.

# 12. Repository and build architecture

**DESIGN DEFAULT:** TypeScript/pnpm monorepo, React/Vite web client, Node.js local engine, SQLite, Zod schemas, native/Python/Java helpers only where providers require them. A future Tauri desktop shell packages the same web UI. Use modular packages rather than early microservices.

```text
phoenix/
  apps/
    web/                    # React investigation workspace
    desktop/                # optional later packaging
  packages/
    contracts/              # schemas, errors, capability types
    core/                   # jobs, budgets, state machine
    toolkit/                # provider registry and normalized APIs
    investigator/           # hypotheses and action selection
    evidence/               # persistence and provenance
    reconstruction/         # specs, generation and builds
    verification/           # runners and comparisons
    model-adapters/         # Nebius/other providers
    cli/                    # automation and developer use
    server/                 # thin local HTTP/SSE transport (ADR-0004)
  providers/
    browser/  javascript/  source/  ghidra/  frida/  debugger/
  workers/
    common/  linux/  windows/  macos/
  benchmarks/
    targets/  scenarios/  results/
  docs/
    PHOENIX_ENGINEERING_SOURCE_OF_TRUTH.md
    adr/
  tests/
  .github/workflows/
```

Target intake is consolidated in `toolkit/src/intake`; the built-in fileinfo provider lives in toolkit, and external providers get directories only when implemented (ADR-0004).

Create packages only as functional code arrives; empty scaffolding is not progress. Keep all vendor coupling inside adapters. Every module requires a named owner, test surface, and contract.

**Build reproducibility:** lockfiles; pinned tool versions in reproducible environments; documented installed JDK/toolchain prerequisites; CI matrix for supported hosts; fixtures checked for hashes; deterministic seeds when possible. Never commit target software or copyrighted proprietary assets that cannot be redistributed.

# 13. Security, execution, privacy, and licensing

PHOENIX is intended as a broad, generally available research and reconstruction tool; it does **not** impose arbitrary bans on classes of target applications. This product stance is compatible with engineered safeguards:

- **Static-first:** importing a binary must not execute it. Runtime execution requires a user-selected runner and approval for the workflow.
- **Least privilege:** separate working directories; isolated processes/VMs where appropriate; CPU/memory/time quotas; per-job network controls; read-only target snapshots.
- **Isolation realism:** untrusted native binaries can evade weak sandboxes; recommend VMs or disposable isolated hosts for higher-risk targets. Never promise universal containment.
- **Secrets:** detect and mask credentials, keys, tokens, cookies, and private file paths in logs and cloud-bound evidence. Restrict captures and retention.
- **Original versus reconstruction:** do not modify original software by default. Track provenance and produce new source in a separate workspace.
- **User agency:** disclose which artifacts go to remote models/runners; require explicit consent for external transmission and side-effectful execution.
- **No misleading legal guarantees:** reverse engineering, copyrighted code, trademarks, licensed assets, access controls, and service use are distinct issues. Users are responsible for applicable rights and lawful use; provider/tool distribution must also respect licenses.

**REA-specific provenance:** the user reports REA community/author permission to use REA as inspiration/reference without credit. Independently written ideas/architecture generally do not require a REA notice solely for being inspired. **Actual REA code reuse** must follow applicable rights and the MIT notice requirement for copies/substantial portions unless a valid permission specifically waives the relevant copyright owner's obligation; other contributors and third-party licenses may still apply. Store any permission evidence privately and track copied code and notices in the repository. Do not treat “only a small amount copied” as an automatic exemption.

**PHOENIX license:** MIT is the accepted intended license for PHOENIX-owned code (ADR-0006); contributor provenance and dependency-license review remain required before public distribution. This updates the original D-012 design default without asserting rights over third-party material. Commercial optional tools are not bundled or licensed by PHOENIX.

# 14. Quality standards and engineering workflow

**Branching:** `main` stays releasable; short-lived feature branches; reviewed PRs; architectural changes require ADR before irreversible refactoring.

**Required CI checks:** formatting, lint, TypeScript typecheck, unit tests, schema-contract tests, integration fixtures, dependency/license checks, and platform-specific smoke tests as supported. Add security scanning and reproducibility checks as the code matures.

**Test pyramid:** pure unit tests for parsers/planners → adapter contract tests with fixtures → end-to-end investigation/reconstruction targets → cross-platform smoke suites → longer benchmarking runs. Every bugfix includes a reproducing test when feasible.

**Review standards:** no mock outputs shipped as real evidence, no fabricated benchmark numbers, no silent handling of provider errors, no undocumented irreversible migrations, no mixed data ownership across components. Use ordinary developer-readable names and comments explaining intent rather than repetitive comments restating syntax.

**Definition of Done for a feature:** implemented, covered by relevant tests, documented, produces evidence/error information, works through the shared API/CLI as appropriate, tested in a realistic scenario, and merged after review.

# 15. Benchmark design and proof of value

**Research question:** Does PHOENIX's investigation and verification policy measurably improve the ability to reconstruct unfamiliar functionality compared with a strong agent using ordinary tools or REA?

**Baselines:** (A) conventional coding agent with available files/browser tools, (B) same class of agent with REA, (C) PHOENIX with equivalent model/tool/resource budgets. When a baseline supports a different provider set, disclose it; never label an unfair comparison as architectural superiority.

**Blind test targets:** at least one web/UI app, one Electron/JavaScript app, and one native processing tool over time. The first release may include one genuine end-to-end target plus independent negative and edge-case fixtures. Withhold implementation/source from the evaluated agent; maintain a private answer key for test construction. Use authorized/redistributable test artifacts.

**Metrics:** feature coverage, behavioral pass rate on held-out inputs, visual/layout agreement where applicable, unsupported claims per investigation, reproducibility, human interventions, number of tool calls, latency, cloud model tokens/cost, and failure/cancellation rate. Record both successes and failures; publish test environment and versions.

**Experiment controls:** repeat trials across different seeds/targets where feasible; report variance; use equal time/token budgets; freeze scenario corpus during a comparison; separately assess static-only versus runtime-assisted investigations and planner-on versus deterministic traversal. Avoid presenting a single favorable replay as proof of general performance.

**Initial success criteria:**

- A user can import a real supported target and obtain genuine analysis data through the independent PHOENIX toolkit.
- A model-driven investigation cites recovered evidence and handles at least one meaningful unknown or competing hypothesis.
- PHOENIX exports a runnable reconstruction of a scoped feature.
- A reusable test suite compares actual behavior and records failures honestly.
- Another teammate can reproduce the demonstrated workflow from the README on a supported host or provided runner.

Numeric pass-rate/speed/cost thresholds are **OPEN** until the benchmark targets and baseline runs establish defensible values.

# 16. Release plan and prioritization

**Hackathon submission deadline:** 2026-10-30, 10:00 a.m. PDT / 1:00 p.m. EDT, according to official rules checked 2026-10-21. Aim to submit on 2026-10-29; reserve the deadline morning for contingencies.

## 16.1 P0: complete vertical slice (must work)

1. Target intake and manifest, with real artifact hashes and capability probing.
2. Independent tool adapter for browser/JavaScript or source analysis (first practical target).
3. Persistent evidence records and resumable investigation jobs.
4. Nebius-hosted NVIDIA model doing real investigation/reconstruction work.
5. A bounded planner that actually selects tool actions from an objective.
6. Code generation into a normal, buildable project.
7. Executable behavioral comparison, mismatch logging, and at least one correction cycle.
8. Usable local web interface and CLI, setup documentation, and tests.

**The P0 acceptance test** is the full loop: **unseen target → evidence → hypothesis/testing → working selected-feature reconstruction → held-out behavioral comparisons → export**, not a slideshow or hardcoded demo response.

## 16.2 P1: early supported breadth

- Ghidra native static analysis, function and call-graph retrieval, one validated ELF/PE/Mach-O workflow.
- Limited Frida/LLDB/GDB dynamic trace path on a supported runner.
- Electron packaging/application-state support.
- Independent Windows/macOS/Linux smoke tests and contributor setup docs.
- Baseline comparisons with an REA-equipped coding agent.

## 16.3 P2+: production expansion

- More decompilers and mobile/managed/WASM/firmware formats.
- Long-running investigations, team collaboration and richer evidence provenance.
- Local inference and selective privacy-preserving model routing.
- More complete application reconstruction and cross-platform remote workers.
- Provider/plugin SDK and a stable public API.

## 16.4 Time-boxed schedule (targets, not completion claims)

| Window         | Implementation target                                           | Exit evidence                                 |
| -------------- | --------------------------------------------------------------- | --------------------------------------------- |
| Oct 21         | Ratify source of truth, repo, contracts, CI, owners             | PR with architecture and running skeleton     |
| Oct 22–23      | Browser/JS provider, intake, evidence persistence; start Ghidra | Real captured findings + fixture tests        |
| Oct 24–25      | Nemotron agent, bounded planner, artifact flow                  | Autonomous investigation trace                |
| Oct 26–27      | Reconstruction, runner, verifier, correction loop               | Runnable exported implementation + mismatches |
| Oct 28         | Integrate, debug, test supported host matrix                    | Release candidate + reproducible benchmark    |
| Oct 29         | Documentation, recording, publish and submit                    | Public release/submission artifacts           |
| Oct 30 morning | Contingency only                                                | Verified submission before cutoff             |

If the schedule slips: protect the end-to-end vertical slice; defer extra format integrations, fancy graph UI, Tauri packaging, and experimental agent algorithms before compromising correctness.

# 17. Team ownership and decision making

**Actual names/assignments:** **OPEN**. Do not invent teammates or ownership commitments. Suggested workstreams for a small team:

- **Technical integration lead:** architecture, schemas, CI, state machine, merge consistency and acceptance gates.
- **Analysis/tooling engineer:** target intake, providers, Ghidra/JS tooling, host-specific integrations.
- **Agent/reconstruction engineer:** Nebius model routing, planner, project generation, repair loops.
- **Verification/product engineer:** scenario runner, behavioral/visual diffs, UI, benchmark harness.

One accountable DRI per package; PR reviewers from an adjacent area. Define weekly/short daily integration checkpoints during the hackathon. Cross-platform teammates test workflows on actual host machines; do not assume “builds on Linux” means “works on Mac and Windows.”

# 18. Operational concerns and observability

Every job must emit structured events: `job_started`, `target_identified`, `provider_selected`, `tool_executed`, `evidence_saved`, `hypothesis_updated`, `build_completed`, `comparison_completed`, `budget_exhausted`, `job_finished` (and error variants).

Minimum telemetry: job ID, correlation ID, provider/version, elapsed time, tool command family, bytes processed, token usage and cost estimate, runner OS, test scenario, sanitized failure reason. Do not log source or secret-bearing payloads by default.

**Resource controls:** per-step execution timeouts, total job duration, model call limits, output token/byte budgets, disk artifact quotas, and cancellable subtasks. Retry only idempotent operations with bounded backoff; record retries and failure causes. Cache deterministic analysis results keyed by target hash, provider version, and analysis parameters.

**Recovery:** restart from saved job checkpoint; invalidate evidence after changed target hash; safely terminate orphan worker processes; preserve partially completed exports with clear partial status. Provide `phoenix doctor` to check dependencies and host capabilities.

# 19. Main risks and countermeasures

| Risk                                 | Consequence                         | Response                                                                 |
| ------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------ |
| General-purpose scope exceeds time   | Many unfinished integrations        | Prioritize P0 vertical slice; capability flags for everything else       |
| REA already offers overlapping tools | No measurable distinction           | Independent toolkit + rigorous planner and REA-agent baseline comparison |
| Decompilation ambiguity              | Incorrect code claims               | Track evidence, alternative hypotheses, and explicit unknowns            |
| Agent hallucination or loop          | Wrong implementation / cost blowout | Tool-grounded findings, test-driven repair, stop budgets                 |
| Visual clone but broken features     | Misleading product                  | Functional acceptance tests required                                     |
| OS-specific execution                | Team integration failure            | Standard runner contract and per-host smoke tests                        |
| Unsafe imported executable           | Host compromise                     | Static-first, approvals, isolated/disposable runners                     |
| Cloud data exposure                  | Privacy breach                      | Local-first inspection and explicit outbound-data controls               |
| Licensing/IP mistakes                | Legal and distribution issues       | Dependency notice inventory, copied-code provenance, reviewed exports    |
| Model/provider availability          | Late release blocker                | Configurable model adapter and early real API integration                |
| Unfair benchmark                     | Invalid performance claim           | Equalized budgets, held-out tests, disclosed environment                 |

# 20. Decision log and architecture change protocol

## 20.1 Decision register

| ID    | Status         | Decision                                                            | Rationale / rule                                             |
| ----- | -------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| D-001 | COMMITTED      | Name PHOENIX                                                        | Established project identity                                 |
| D-002 | COMMITTED      | Reverse engineering + reconstruction + verification                 | The product is not just a graph viewer or legacy repair tool |
| D-003 | COMMITTED      | Build own REA-like toolkit; REA nonmandatory                        | Product independence and architectural ownership             |
| D-004 | COMMITTED      | Reuse mature underlying engines                                     | Focus engineering on higher-level intelligence               |
| D-005 | COMMITTED      | Windows/macOS/Linux user experience                                 | Mixed-OS team; execution is host-specific                    |
| D-006 | COMMITTED      | Free, open-source, general-purpose                                  | Broad capability with no arbitrary category bans             |
| D-007 | COMMITTED      | Real NVIDIA/Nebius integration                                      | Hackathon eligibility and technical relevance                |
| D-008 | COMMITTED      | Long-term usable product over demo-only simulation                  | Engineering quality and extensibility                        |
| D-009 | DESIGN DEFAULT | TypeScript monorepo; React + Node + SQLite                          | Shared contracts and rapid cross-platform iteration          |
| D-010 | DESIGN DEFAULT | Web/JS reconstruction as first vertical slice                       | Broad team accessibility and measurable UI behavior          |
| D-011 | DESIGN DEFAULT | Ghidra P1 native path; Frida/debuggers as selected                  | Broad foundations without overcommitting runtime hosts       |
| D-012 | DESIGN DEFAULT | MIT for PHOENIX source                                              | Simple permissive open-source option; verify dependencies    |
| D-013 | DESIGN DEFAULT | Local-first, controlled outbound data and isolated execution        | Safety, reproducibility, and user trust                      |
| D-014 | OPEN           | Team ownership, approved benchmark targets, exact release threshold | Must be agreed before implementation progresses far          |

The original D-001…D-014 entries are retained for historical context. The accepted records below refine the design defaults without changing product commitments.

| ID    | Status   | Decision                                                                | Record                                        |
| ----- | -------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| D-015 | ACCEPTED | Split M0-Foundation / M0-Vertical; preserve whole M0 exit               | [ADR-0001](adr/ADR-0001-m0-split.md)          |
| D-016 | ACCEPTED | Repair state transitions and add job-mode guards                        | [ADR-0002](adr/ADR-0002-state-transitions.md) |
| D-017 | ACCEPTED | Versioned, Zod-first shared contracts and clarified identities          | [ADR-0003](adr/ADR-0003-shared-contracts.md)  |
| D-018 | ACCEPTED | Server transport package; toolkit owns target intake                    | [ADR-0004](adr/ADR-0004-package-layout.md)    |
| D-019 | ACCEPTED | Node 24 baseline / 26 compatibility, TS 6, SQLite adapter, Hono, Vitest | [ADR-0005](adr/ADR-0005-toolchain.md)         |
| D-020 | ACCEPTED | MIT intent, private packages, Markdown canonical, DOCX local            | [ADR-0006](adr/ADR-0006-housekeeping.md)      |

| ID    | Status   | Decision                                                                             | Record                                                       |
| ----- | -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| D-021 | PROPOSED | Ready failure transition and execution-time accounting; approval required before WP6 | [ADR-0007](adr/ADR-0007-ready-failure-and-execution-time.md) |
| D-022 | ACCEPTED | Harden unpublished contracts and independently test semantic requirements            | [ADR-0008](adr/ADR-0008-contract-input-hardening.md)         |

## 20.2 Mandatory change workflow

1. Create `docs/adr/ADR-XXXX-short-title.md` with **Problem / Decision / Alternatives / Tradeoffs / Migration / Test impact**.
2. Mark proposal `proposed`, review with the relevant owners, and record outcome `accepted`, `rejected`, or `superseded`.
3. Update the decision table above, relevant architecture/contracts, milestones, and risks in the **same PR**.
4. Add a concise changelog entry with date, reason, and PR/ADR link.
5. Update implementation and tests, or leave a clearly assigned migration task with an owner and deadline.

**Never silently drift:** a model/coding agent may suggest improvements, but cannot rewrite the product mission, REA-dependency rule, cross-platform approach, or release gates without an explicit recorded decision. Technical implementation details can evolve through ADRs when evidence supports them.

## 20.3 ADR starter template

```markdown
# ADR-XXXX: Short title

Status: proposed | accepted | rejected | superseded
Date: YYYY-MM-DD
Owner: <name>

## Problem and constraints

## Decision

## Alternatives considered

## Consequences and risks

## Contracts / tests / migration affected

## Revisit trigger
```

# 21. Immediate implementation backlog

**Milestone M0 — establish the foundation and complete a vertical workflow**

[ADR-0001](adr/ADR-0001-m0-split.md) splits delivery into **M0-Foundation** (repository, contracts, toolkit/intake, evidence/job persistence, recovery, doctor/inspect, local API, cross-platform tests) and **M0-Vertical** (real browser/JS evidence, verified Nemotron request, automatic tool selection, generated feature, reference and held-out comparisons). The original backlog below remains the complete M0 commitment. WP0/WP1 alone do not complete either milestone; source documents and a future CI workflow are not proof that CI has run.

- [ ] Create public/private repository, issue labels, branch rules, team roles and CI.
- [ ] Commit this canonical file and add ADR directory; document source-of-truth precedence in README.
- [ ] Install/run Node/pnpm, model credentials, browser dependencies and required host tools; write `phoenix doctor`.
- [ ] Create `contracts` package with `TargetManifest`, tool result envelope, evidence objects, job states and runtime validation.
- [ ] Implement target intake, format probe, hash, job creation and local artifact storage.
- [ ] Implement a real browser/JS provider and capture a fixture evidence bundle.
- [ ] Integrate a verified Nebius Nemotron model ID and execute a genuine structured tool-guided investigation request.
- [ ] Save evidence/hypotheses and make one automatic tool-selection decision; persist/resume the job.
- [ ] Generate and run one small reconstructed feature; compare it with a reference test scenario.
- [ ] Define independent held-out scenarios and publish truthful acceptance results.

**M0 exit condition:** a new contributor follows documented commands and reproduces one real investigation and one testable reconstruction on a supported host.

# 22. Open questions requiring a decision

1. What are the actual team members, owners, and host machines available for integration testing?
2. Which **authorized, redistributable** applications become the first blind benchmark targets? Who maintains private expected outputs?
3. Which concrete Nebius model and endpoint pass our tool-call/schema tests; what credits and budgets are available?
4. Will Tauri packaging be worthwhile before broader release, or should the web+CLI interface remain primary?
5. Which Ghidra scripting integration is simplest and reliably cross-platform for our first native fixture?
6. What are defensible acceptance thresholds after initial benchmark runs, rather than arbitrary numerical promises?
7. Which external providers may be bundled; which must be discovered as separately installed tools?
8. Complete contributor, dependency and copied-code notice review before public distribution under the intended MIT license (ADR-0006).

Open questions are intentionally visible. Do not bury uncertainty by making guesses look like requirements.

# 23. Verified references (checked 2026-10-21)

**Project / REA**

- REA website: https://rea.tools/
- REA official repository and README: https://github.com/morluto/rea
- REA license: https://github.com/morluto/rea/blob/main/LICENSE

**Underlying engines**

- Ghidra headless analyzer documentation: https://github.com/NationalSecurityAgency/ghidra/blob/master/Ghidra/RuntimeScripts/support/analyzeHeadlessREADME.md
- Playwright official documentation: https://playwright.dev/docs/intro
- Frida official website and docs: https://frida.re/docs/home/

**Hackathon and model platform**

- Official hackathon rules, including deadline and working application requirements: https://nebiusglobalaihackathon.devpost.com/rules
- Nemotron on Nebius Token Factory: https://nebius.com/services/token-factory/nemotron
- Nebius NVIDIA models/inference details: https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference

**Source policy:** External pages change. Their URLs are supporting references, **not** dynamic instructions. Before an implementation depends on a specific model identifier, OS feature, commercial tool entitlement, or hackathon rule, verify the current authoritative documentation and record the observed version/date in the relevant ADR or issue.

# 24. Coding-agent and new-contributor handoff contract

Before performing substantive PHOENIX work, an incoming teammate or coding agent must:

1. **Read Sections 1–8, 12–16, and 20** of this document. Read the latest accepted ADRs and the actual repository state before proposing new architecture.
2. **State the task, affected subsystem, intended change, and acceptance test** in the PR or work item. Identify whether the work is P0, P1, or P2+.
3. **Implement against shared contracts**, not ad hoc direct vendor calls from UI or reconstruction code. If contracts must change, update schemas, tests, and docs together.
4. **Use real providers and real evidence** in completed features. Mocks belong only in tests or clearly labeled development views, not production findings or demos.
5. **Preserve the product charter**: reverse engineering first, reconstruction and verification first-class, independent toolkit, general-purpose, open-source, and cross-platform client experience.
6. **Treat security and legal concerns precisely**: no arbitrary target-class bans; do not silently launch imported binaries or upload content. Observe licenses and user-selected execution boundaries.
7. **Run the impacted tests and document results**. Distinguish tests executed from those not available on the current host.
8. **Update this document** if behavior, implementation architecture, accepted milestones, external provider requirements, or product decisions materially changed.

The preferred answer from a future project assistant is not “we could add X.” It is a concrete plan or implementation referencing existing modules, applicable decisions, evidence, tests, tradeoffs, and next action—without quietly redefining PHOENIX.

# 25. Changelog

| Date       | Version | Change                                                                                                                 | Reason                                                                                                                      |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-22 | 1.0.2   | Accept input/lifecycle/path/provider hardening via ADR-0008; record ADR-0007 as proposed                               | Address independent review reproductions and eleven surviving semantic mutations; preserve state decisions pending approval |
| 2026-10-22 | 1.0.1   | Accept P-1–P-6 via ADR-0001–0006; clarify budgets, safe tree encoding, binary attributes and test-only crash injection | Approved architecture review; preserve charter and complete M0 exit                                                         |
| 2026-10-21 | 1.0.0   | Initial canonical product and engineering specification                                                                | Consolidate project vision, architecture, acceptance gates, REA decision, and build sequence into one editable reference    |

---

**Foundational rule to future contributors and coding agents:** Build PHOENIX as an **independent, evidence-driven reverse-engineering and reconstruction system**. Inspect the real target, ground explanations in actual observations, generate editable implementations, and prove the result through repeatable tests. Prefer completed, reliable workflows over exaggerated claims of universal support. Change important decisions deliberately, with an ADR and matching documentation update.
