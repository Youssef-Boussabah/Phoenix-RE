import { z } from 'zod';
import { BoundedJsonValue } from './json.js';
import { RequestId, TargetId } from './ids.js';
import { IsoTimestamp } from './time.js';
import { TargetKind } from './target.js';
import { HostOs } from './host.js';
import { EvidenceRef } from './evidence.js';
import { ArtifactRef } from './artifact.js';
import { PhoenixErrorShape } from './errors.js';
export const ProviderId = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/);
export type ProviderId = z.infer<typeof ProviderId>;
// The SOT §6.2 minimum operation set. Declaring an id does not imply an implementation.
export const OperationId = z.enum([
  'inspect_target',
  'list_modules',
  'list_functions',
  'decompile_function',
  'get_references',
  'get_call_graph',
  'inspect_assets',
  'trace_runtime',
  'run_experiment',
  'capture_interface',
]);

// Static, target-independent descriptor (added; SOT `id`/`version` kept on the provider itself).
export const ProviderDescriptor = z.strictObject({
  id: ProviderId, // e.g. 'phoenix.fileinfo', 'ghidra.headless'
  version: z.string().min(1),
  displayName: z.string(),
  operations: z.array(
    z.strictObject({ operation: OperationId, requiresExecution: z.boolean(), requiresNetwork: z.boolean() }),
  ),
  supportedKinds: z.array(TargetKind),
  supportedHosts: z.array(HostOs),
  priority: z.int(), // deterministic selection order (lower first, then id)
});

export const Prerequisite = z.strictObject({
  id: z.string(),
  description: z.string(),
  satisfied: z.boolean(),
  detail: z.string().optional(), // e.g. detected version, or why missing
  remediation: z.string().optional(),
});
export const ProviderAvailability = z.strictObject({
  providerId: ProviderId,
  available: z.boolean(),
  prerequisites: z.array(Prerequisite),
  checkedAt: IsoTimestamp,
});

// SOT §7.2 fields kept; prerequisites made structured; per-target availability added.
export const CapabilityReport = z.strictObject({
  providerId: ProviderId,
  providerVersion: z.string().min(1),
  available: z.boolean(), // all prerequisites satisfied AND host supported AND kind supported
  supportedOperations: z.array(OperationId), // for THIS target on THIS host
  supportedKinds: z.array(TargetKind),
  needsRuntime: z.boolean(), // SOT field: true if any supported op requires execution
  supportedHosts: z.array(HostOs),
  prerequisites: z.array(Prerequisite),
  reasons: z.array(z.string()), // human-readable explanation when unavailable/limited
});

export const AnalysisRequest = z.strictObject({
  requestId: RequestId,
  operation: OperationId,
  targetId: TargetId.optional(), // absent for stateless (unsaved) inspection
  providerId: ProviderId.optional(), // explicit selection; otherwise registry selects
  params: BoundedJsonValue, // validated against the operation's params schema
  limits: z
    .strictObject({
      timeoutMs: z.int().min(100).max(3_600_000).default(30_000),
      maxInlineBytes: z
        .int()
        .nonnegative()
        .max(8 * 1024 * 1024)
        .default(1024 * 1024),
    })
    .prefault({}),
});

export const EnvelopeStatus = z.enum(['ok', 'partial', 'error']);
export const ToolWarning = z.strictObject({ code: z.string(), message: z.string() });
export const PageInfo = z.strictObject({
  nextCursor: z.string().optional(),
  total: z.int().nonnegative().optional(),
});

// SOT §7.2 envelope: all required fields present.
export const ToolResponseEnvelope = z
  .strictObject({
    schemaVersion: z.literal(1),
    requestId: RequestId,
    operation: OperationId,
    providerId: ProviderId.nullable(), // null when no provider could be resolved (e.g. NOT_SUPPORTED at selection)
    providerVersion: z.string().min(1).nullable(),
    targetId: TargetId.nullable(), // null for stateless inspection
    timestamp: IsoTimestamp, // completion time
    status: EnvelopeStatus,
    durationMs: z.int().nonnegative(),
    data: BoundedJsonValue.nullable(), // operation result (validated) or null on error
    evidenceRefs: z.array(EvidenceRef),
    artifacts: z.array(ArtifactRef), // large outputs live here, never inline (SOT §7.2)
    page: PageInfo.optional(),
    warnings: z.array(ToolWarning),
    error: PhoenixErrorShape.nullable(), // non-null iff status === 'error'
  })
  .refine((e) => (e.status === 'error') === (e.error !== null), 'error iff status=error')
  .refine((e) => e.status !== 'error' || e.data === null, 'error data must be null')
  .refine(
    (e) => (e.providerId === null) === (e.providerVersion === null),
    'provider identity and version must be paired',
  )
  .refine(
    (e) => e.status === 'error' || e.providerId !== null,
    'successful and partial tool responses require a provider',
  );

export const ProviderStatus = z
  .strictObject({
    schemaVersion: z.literal(1),
    descriptor: ProviderDescriptor,
    availability: ProviderAvailability,
  })
  .refine((s) => s.descriptor.id === s.availability.providerId, 'provider status identities must agree');

export type OperationId = z.infer<typeof OperationId>;

export type ProviderDescriptor = z.infer<typeof ProviderDescriptor>;

export type Prerequisite = z.infer<typeof Prerequisite>;

export type ProviderAvailability = z.infer<typeof ProviderAvailability>;

export type CapabilityReport = z.infer<typeof CapabilityReport>;

export type AnalysisRequest = z.infer<typeof AnalysisRequest>;

export type EnvelopeStatus = z.infer<typeof EnvelopeStatus>;

export type ToolWarning = z.infer<typeof ToolWarning>;

export type PageInfo = z.infer<typeof PageInfo>;

export type ToolResponseEnvelope = z.infer<typeof ToolResponseEnvelope>;

export type ProviderStatus = z.infer<typeof ProviderStatus>;
