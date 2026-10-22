import { z } from 'zod';
import { JobId, ProjectId, TargetId } from './ids.js';
import { HostInfo } from './host.js';
import { IsoTimestamp } from './time.js';
import { PhoenixErrorShape, PhoenixError } from './errors.js';
export const JobMode = z.enum(['investigate', 'reconstruct', 'verify']); // SOT
export const JobState = z.enum([
  'created',
  'fingerprinting',
  'ready',
  'planning',
  'investigating',
  'reconstructing',
  'verifying',
  'completed',
  'partial',
  'failed',
  'cancelled',
]); // SOT, unchanged

export const TerminalJobState = z.enum(['completed', 'partial', 'failed', 'cancelled']);
export type TerminalJobState = z.infer<typeof TerminalJobState>;
export const BudgetName = z.enum(['maxWallClockMs', 'maxToolCalls']);
export type BudgetName = z.infer<typeof BudgetName>;

/** Final job errors belong to failure/partial/cancellation, not active work or completion. */
export function validLifecycleError(state: JobState, error: PhoenixErrorShape | undefined): boolean {
  if (error === undefined) return true;
  if (state === 'cancelled') return error.code === 'CANCELLED';
  return (state === 'failed' || state === 'partial') && error.code !== 'CANCELLED';
}

export const ExecutionPolicy = z.strictObject({
  allowExecution: z.boolean().default(false), // D-013; dispatcher enforces POLICY_DENIED
  allowNetwork: z.boolean().default(false),
  allowCloudInference: z.boolean().default(false),
});
export const JobBudget = z.strictObject({
  // M0 enforces wall clock + tool calls; others added with their subsystems
  maxWallClockMs: z
    .int()
    .positive()
    .default(30 * 60_000),
  maxToolCalls: z.int().nonnegative().default(200),
});

export const Job = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: JobId,
    projectId: ProjectId,
    mode: JobMode,
    objective: z.string().min(1).max(4000),
    targetId: TargetId, // primary target (the reference in verify mode)
    candidateTargetId: TargetId.optional(), // required iff mode === 'verify' (I-3)
    basedOnJobId: JobId.optional(), // e.g. reconstruct from a completed investigation
    state: JobState,
    version: z.int().nonnegative(),
    budget: JobBudget,
    policy: ExecutionPolicy,
    host: HostInfo.optional(), // host that fingerprinted the job (SOT §4: host ≠ target format)
    error: PhoenixErrorShape.optional(),
    createdAt: IsoTimestamp,
    updatedAt: IsoTimestamp,
    finishedAt: IsoTimestamp.optional(),
  })
  .refine(
    (j) => (j.mode === 'verify') === (j.candidateTargetId !== undefined),
    'verify jobs need candidateTargetId',
  )
  .refine(
    (j) => TerminalJobState.safeParse(j.state).success === (j.finishedAt !== undefined),
    'finishedAt is required exactly for terminal jobs',
  )
  .refine((j) => validLifecycleError(j.state, j.error), 'job error contradicts its lifecycle state')
  .refine(
    (j) =>
      (j.state !== 'reconstructing' || j.mode === 'reconstruct') &&
      (j.state !== 'verifying' || j.mode !== 'investigate'),
    'job mode does not permit its current state',
  );

export const StepStatus = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);

export type JobState = z.infer<typeof JobState>;

export type ExecutionPolicy = z.infer<typeof ExecutionPolicy>;

export type JobBudget = z.infer<typeof JobBudget>;

export type Job = z.infer<typeof Job>;

export type StepStatus = z.infer<typeof StepStatus>;

// A zero tool-call budget is exhausted before any step or dispatch.
export function exhaustedBudget(
  budget: unknown,
  usage: { elapsedMs: number; toolCalls: number },
): 'maxWallClockMs' | 'maxToolCalls' | undefined {
  const parsedBudget = JobBudget.safeParse(budget);
  if (!parsedBudget.success) throw new PhoenixError('INVALID_REQUEST', 'Invalid job budget');
  const parsedUsage = z
    .strictObject({ elapsedMs: z.int().nonnegative(), toolCalls: z.int().nonnegative() })
    .safeParse(usage);
  if (!parsedUsage.success) throw new RangeError('Budget usage must be nonnegative safe integers');
  if (parsedUsage.data.elapsedMs >= parsedBudget.data.maxWallClockMs) return 'maxWallClockMs';
  if (parsedUsage.data.toolCalls >= parsedBudget.data.maxToolCalls) return 'maxToolCalls';
  return undefined;
}

export type JobMode = z.infer<typeof JobMode>;
