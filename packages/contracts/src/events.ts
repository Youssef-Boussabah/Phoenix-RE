import { z } from 'zod';
import { EventId, JobId, TargetId, RequestId, ObservationId, FindingId, ArtifactId } from './ids.js';
import { IsoTimestamp, Sha256Hex } from './time.js';
import { JobMode, JobState, TerminalJobState, BudgetName, validLifecycleError } from './job.js';
import { TargetKind, FileFormat } from './target.js';
import { OperationId, EnvelopeStatus, ProviderId } from './provider.js';
import { ErrorCode, PhoenixErrorShape } from './errors.js';
const base = {
  schemaVersion: z.literal(1),
  id: EventId,
  jobId: JobId,
  seq: z.int().nonnegative(),
  createdAt: IsoTimestamp,
};
export const JobEvent = z.discriminatedUnion('type', [
  z.strictObject({
    ...base,
    type: z.literal('job_created'),
    payload: z.strictObject({ mode: JobMode, targetId: TargetId }),
  }), // +
  z.strictObject({
    ...base,
    type: z.literal('job_started'),
    payload: z.strictObject({ runner: z.string() }),
  }),
  z.strictObject({
    ...base,
    type: z.literal('job_state_changed'),
    payload: z.strictObject({ from: JobState, to: JobState, reason: z.string().optional() }),
  }), // +
  z.strictObject({
    ...base,
    type: z.literal('target_identified'),
    payload: z.strictObject({
      targetId: TargetId,
      kind: TargetKind,
      format: FileFormat,
      digest: Sha256Hex.optional(),
    }),
  }),
  z.strictObject({
    ...base,
    type: z.literal('capabilities_probed'),
    payload: z.strictObject({ available: z.array(z.string()), unavailable: z.array(z.string()) }),
  }), // +
  z.strictObject({
    ...base,
    type: z.literal('provider_selected'),
    payload: z.strictObject({ providerId: ProviderId, operation: OperationId }),
  }),
  z.strictObject({
    ...base,
    type: z.literal('tool_executed'),
    payload: z.strictObject({
      requestId: RequestId,
      operation: OperationId,
      providerId: ProviderId.nullable(),
      status: EnvelopeStatus,
      durationMs: z.int().nonnegative(),
      errorCode: ErrorCode.optional(),
    }),
  }),
  z.strictObject({
    ...base,
    type: z.literal('evidence_saved'),
    payload: z.strictObject({ observationIds: z.array(ObservationId) }),
  }),
  z.strictObject({
    ...base,
    type: z.literal('step_failed'),
    payload: z.strictObject({
      stepKey: z.string(),
      attempt: z.int().positive(),
      error: PhoenixErrorShape,
      willRetry: z.boolean(),
    }),
  }), // +
  z.strictObject({
    ...base,
    type: z.literal('step_recovered'),
    payload: z.strictObject({ stepKey: z.string(), previousOwner: z.string() }),
  }), // +
  z.strictObject({
    ...base,
    type: z.literal('budget_exhausted'),
    payload: z
      .strictObject({ budget: BudgetName, limit: z.int().nonnegative(), used: z.int().nonnegative() })
      .refine((p) => p.used >= p.limit, 'exhausted budget must have reached its limit'),
  }),
  z.strictObject({
    ...base,
    type: z.literal('hypothesis_updated'),
    payload: z.strictObject({ findingId: FindingId, revision: z.int().positive() }),
  }),
  z.strictObject({
    ...base,
    type: z.literal('build_completed'),
    payload: z.strictObject({ artifactIds: z.array(ArtifactId), succeeded: z.boolean() }),
  }),
  z.strictObject({
    ...base,
    type: z.literal('comparison_completed'),
    payload: z.strictObject({
      reportArtifactId: ArtifactId,
      passed: z.int().nonnegative(),
      failed: z.int().nonnegative(),
    }),
  }),
  z.strictObject({
    ...base,
    type: z.literal('job_finished'),
    payload: z
      .strictObject({ state: TerminalJobState, error: PhoenixErrorShape.optional() })
      .refine((p) => validLifecycleError(p.state, p.error), 'job error contradicts its lifecycle state'),
  }),
]);

export type JobEvent = z.infer<typeof JobEvent>;
