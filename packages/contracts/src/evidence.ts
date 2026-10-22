import { z } from 'zod';
import { RelativePath } from './paths.js';
import { BoundedJsonValue } from './json.js';
import { ArtifactId, EvidenceRefId, ObservationId, TargetId, JobId, RequestId, FindingId } from './ids.js';
import { IsoTimestamp, Sha256Hex } from './time.js';
export const Locator = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('byte-range'),
    offset: z.int().nonnegative(),
    length: z.int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('path'),
    path: RelativePath,
    line: z.int().nonnegative().optional(),
    column: z.int().nonnegative().optional(),
  }),
  z.strictObject({ type: z.literal('address'), address: z.string() /* hex */, space: z.string().optional() }),
  z.strictObject({ type: z.literal('event'), sequence: z.int().nonnegative() }),
  z.strictObject({
    type: z.literal('region'),
    x: z.int().nonnegative(),
    y: z.int().nonnegative(),
    width: z.int().nonnegative(),
    height: z.int().nonnegative(),
  }),
]);

// SOT §7.1 fields unchanged; locator/observationId added.
export const EvidenceRef = z.strictObject({
  id: EvidenceRefId,
  kind: z.enum(['static', 'runtime', 'user', 'derived']),
  artifactId: ArtifactId, // the bytes the evidence is about (target snapshot, inventory doc, tool output)
  location: z.string().optional(), // SOT: human-readable, e.g. "0x0-0x40", "src/app.js:12"
  locator: Locator.optional(), // machine-resolvable form of `location`
  observationId: ObservationId.optional(), // the tool observation that interpreted those bytes
});

export const Producer = z.strictObject({
  type: z.enum(['intake', 'provider', 'user', 'model']),
  id: z.string(),
  version: z.string(), // e.g. intake@classifier-1, phoenix.fileinfo@0.1.0
});

export const Observation = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: ObservationId,
    targetId: TargetId,
    jobId: JobId.optional(),
    requestId: RequestId.optional(),
    producer: Producer,
    kind: EvidenceRef.shape.kind,
    type: z.string(), // 'intake.classification' | 'job.capabilities' | 'tool.inspect_target' | …
    data: BoundedJsonValue.optional(),
    dataArtifactId: ArtifactId.optional(),
    targetDigest: Sha256Hex.optional(), // digest of the target the observation was made against (invalidation)
    createdAt: IsoTimestamp,
  })
  .refine(
    (o) => o.data !== undefined || o.dataArtifactId !== undefined,
    'observation requires data or an artifact',
  );

// SOT §7.1 Finding, plus revision metadata. Findings are append-only revisions (reversible updates, SOT §6.4).
export const FindingStatus = z.enum(['hypothesis', 'observed', 'corroborated', 'contradicted']);
export const Finding = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: FindingId,
    targetId: TargetId,
    statement: z.string().min(1),
    status: FindingStatus,
    evidence: z.array(EvidenceRef),
    limitations: z.array(z.string()),
    revision: z.int().nonnegative().min(1),
    author: Producer,
    createdAt: IsoTimestamp,
  })
  .refine(
    (f) => f.status === 'hypothesis' || f.evidence.length > 0,
    'observed/corroborated/contradicted findings must cite evidence (SOT §6.4)',
  );

export const RelationType = z.enum([
  'calls',
  'imports',
  'derived_from',
  'supports',
  'contradicts',
  'produced_by',
  'tests',
  'implements',
  'observed_in',
  'supersedes',
]); // SOT §6.4

export const EvidenceDraft = z.strictObject({
  kind: EvidenceRef.shape.kind,
  artifactId: ArtifactId.optional(),
  location: z.string().optional(),
  locator: Locator.optional(),
});

export type Locator = z.infer<typeof Locator>;

export type EvidenceRef = z.infer<typeof EvidenceRef>;

export type Producer = z.infer<typeof Producer>;

export type Observation = z.infer<typeof Observation>;

export type FindingStatus = z.infer<typeof FindingStatus>;

export type Finding = z.infer<typeof Finding>;

export type RelationType = z.infer<typeof RelationType>;

export type EvidenceDraft = z.infer<typeof EvidenceDraft>;
