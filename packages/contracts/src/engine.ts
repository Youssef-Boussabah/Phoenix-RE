import { z } from 'zod';
import { BoundedJsonValue } from './json.js';
import { ProjectId, TargetId, JobId, StepId } from './ids.js';
import { IsoTimestamp } from './time.js';
import { TargetManifest, TargetDescription, IntakeSource, IntakeOptions } from './target.js';
import { Job, JobMode, JobState, StepStatus, JobBudget, ExecutionPolicy } from './job.js';
import { PhoenixErrorShape } from './errors.js';
import {
  AnalysisRequest,
  OperationId,
  ProviderStatus,
  ProviderId,
  CapabilityReport,
  ToolResponseEnvelope,
} from './provider.js';
import { Observation, Finding } from './evidence.js';
import { ArtifactRef } from './artifact.js';
import { JobEvent } from './events.js';
import { DoctorInput, DoctorReport } from './doctor.js';

export const PageInput = z.strictObject({
  cursor: z.string().optional(),
  limit: z.int().min(1).max(5000).default(100),
});
export const pageSchema = <S extends z.ZodType>(item: S) =>
  z.strictObject({ schemaVersion: z.literal(1), items: z.array(item), nextCursor: z.string().optional() });
export interface Page<T> {
  schemaVersion: 1;
  items: T[];
  nextCursor?: string;
}
export const Project = z.strictObject({
  schemaVersion: z.literal(1),
  id: ProjectId,
  name: z.string().min(1).max(200),
  createdAt: IsoTimestamp,
});
export const CreateProjectInput = z.strictObject({ name: Project.shape.name });
export const InspectInput = z.strictObject({ source: IntakeSource, options: IntakeOptions.prefault({}) });
export const InspectReport = z.strictObject({
  schemaVersion: z.literal(1),
  target: TargetDescription,
  capabilities: z.array(CapabilityReport),
  durationMs: z.int().nonnegative(),
});
export const ToolInvokeInput = z.strictObject({
  operation: OperationId,
  target: z.union([z.strictObject({ targetId: TargetId }), z.strictObject({ path: z.string().min(1) })]),
  providerId: ProviderId.optional(),
  params: BoundedJsonValue.default({}),
  limits: AnalysisRequest.shape.limits,
});
export const AddTargetInput = z.strictObject({
  projectId: ProjectId,
  source: IntakeSource,
  intakeMode: z.enum(['snapshot', 'reference']).default('snapshot'),
  options: IntakeOptions.prefault({}),
});
export const ListTargetsInput = PageInput.extend({ projectId: ProjectId });
export const CreateJobInput = z
  .strictObject({
    projectId: ProjectId,
    mode: JobMode,
    objective: Job.shape.objective,
    targetId: TargetId,
    candidateTargetId: TargetId.optional(),
    basedOnJobId: JobId.optional(),
    budget: JobBudget.prefault({}),
    policy: ExecutionPolicy.prefault({}),
  })
  .refine(
    (j) => (j.mode === 'verify') === (j.candidateTargetId !== undefined),
    'verify jobs need candidateTargetId',
  );
export const ListJobsInput = PageInput.extend({
  projectId: ProjectId.optional(),
  state: JobState.optional(),
});
export const JobStep = z.strictObject({
  schemaVersion: z.literal(1),
  id: StepId,
  jobId: JobId,
  stepKey: z.string().min(1),
  status: StepStatus,
  attempt: z.int().nonnegative(),
  maxAttempts: z.int().positive(),
  leaseOwner: z.string().optional(),
  leaseExpiresAt: IsoTimestamp.optional(),
  output: BoundedJsonValue.optional(),
  error: PhoenixErrorShape.optional(),
  createdAt: IsoTimestamp,
  startedAt: IsoTimestamp.optional(),
  finishedAt: IsoTimestamp.optional(),
});
export const JobView = z.strictObject({
  schemaVersion: z.literal(1),
  job: Job,
  steps: z.array(JobStep),
  nextAction: z.string().min(1),
});
export const EvidenceItem = z.discriminatedUnion('type', [
  z.strictObject({
    schemaVersion: z.literal(1),
    type: z.literal('observation'),
    observation: Observation,
    stale: z.boolean(),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    type: z.literal('finding'),
    finding: Finding,
    stale: z.boolean(),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    type: z.literal('artifact'),
    artifact: ArtifactRef,
    stale: z.boolean(),
  }),
]);
export const ListEvidenceInput = PageInput.extend({
  projectId: ProjectId.optional(),
  targetId: TargetId.optional(),
  jobId: JobId.optional(),
  artifactsOnly: z.boolean().default(false),
});
export const ProjectPage = pageSchema(Project);
export const TargetPage = pageSchema(TargetManifest);
export const JobPage = pageSchema(Job);
export const JobEventPage = pageSchema(JobEvent);
export const EvidencePage = pageSchema(EvidenceItem);

export interface PhoenixEngine {
  readonly version: string;
  doctor(input?: z.input<typeof DoctorInput>): Promise<DoctorReport>;
  inspect(input: z.input<typeof InspectInput>, signal?: AbortSignal): Promise<InspectReport>;
  providers: { list(): Promise<ProviderStatus[]> };
  tools: {
    invoke(input: z.input<typeof ToolInvokeInput>, signal?: AbortSignal): Promise<ToolResponseEnvelope>;
  };
  projects: {
    create(input: CreateProjectInput): Promise<Project>;
    list(input?: z.input<typeof PageInput>): Promise<Page<Project>>;
    get(id: ProjectId): Promise<Project>;
  };
  targets: {
    add(input: z.input<typeof AddTargetInput>, signal?: AbortSignal): Promise<TargetManifest>;
    get(id: TargetId): Promise<TargetManifest>;
    list(input: z.input<typeof ListTargetsInput>): Promise<Page<TargetManifest>>;
  };
  jobs: {
    create(input: z.input<typeof CreateJobInput>): Promise<Job>;
    run(id: JobId, signal?: AbortSignal): Promise<Job>;
    get(id: JobId): Promise<JobView>;
    list(input: z.input<typeof ListJobsInput>): Promise<Page<Job>>;
    cancel(id: JobId, reason?: string): Promise<Job>;
    resume(id: JobId, signal?: AbortSignal): Promise<Job>;
    events(id: JobId, afterSeq?: number, limit?: number): Promise<Page<JobEvent>>;
    recoverInterrupted(): Promise<JobId[]>;
  };
  evidence: { list(input: z.input<typeof ListEvidenceInput>): Promise<Page<EvidenceItem>> };
  close(): Promise<void>;
}

export type PageInput = z.infer<typeof PageInput>;

export type Project = z.infer<typeof Project>;

export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export type InspectInput = z.infer<typeof InspectInput>;

export type InspectReport = z.infer<typeof InspectReport>;

export type ToolInvokeInput = z.infer<typeof ToolInvokeInput>;

export type AddTargetInput = z.infer<typeof AddTargetInput>;

export type ListTargetsInput = z.infer<typeof ListTargetsInput>;

export type CreateJobInput = z.infer<typeof CreateJobInput>;

export type ListJobsInput = z.infer<typeof ListJobsInput>;

export type JobStep = z.infer<typeof JobStep>;

export type JobView = z.infer<typeof JobView>;

export type EvidenceItem = z.infer<typeof EvidenceItem>;

export type ListEvidenceInput = z.infer<typeof ListEvidenceInput>;

export type ProjectPage = z.infer<typeof ProjectPage>;

export type TargetPage = z.infer<typeof TargetPage>;

export type JobPage = z.infer<typeof JobPage>;

export type JobEventPage = z.infer<typeof JobEventPage>;

export type EvidencePage = z.infer<typeof EvidencePage>;
