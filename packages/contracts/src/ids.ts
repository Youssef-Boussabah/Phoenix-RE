import { z } from 'zod';
export const ID_PREFIXES = {
  project: 'prj',
  target: 'tgt',
  artifact: 'art',
  job: 'job',
  step: 'stp',
  event: 'evt',
  request: 'req',
  observation: 'obs',
  evidence: 'evr',
  finding: 'fnd',
  relation: 'rel',
} as const;
export const idSchema = <B extends string>(prefix: string, brand: B) => {
  if (!/^[a-z]+$/.test(prefix)) throw new TypeError('Invalid ID prefix');
  return z
    .string()
    .regex(new RegExp(`^${prefix}_[0-9a-f]{32}$`))
    .describe(brand)
    .brand<B>();
};
export const ProjectId = idSchema('prj', 'ProjectId');
export type ProjectId = z.infer<typeof ProjectId>;
export const TargetId = idSchema('tgt', 'TargetId');
export type TargetId = z.infer<typeof TargetId>;
export const ArtifactId = idSchema('art', 'ArtifactId');
export type ArtifactId = z.infer<typeof ArtifactId>;
export const JobId = idSchema('job', 'JobId');
export type JobId = z.infer<typeof JobId>;
export const StepId = idSchema('stp', 'StepId');
export type StepId = z.infer<typeof StepId>;
export const EventId = idSchema('evt', 'EventId');
export type EventId = z.infer<typeof EventId>;
export const RequestId = idSchema('req', 'RequestId');
export type RequestId = z.infer<typeof RequestId>;
export const ObservationId = idSchema('obs', 'ObservationId');
export type ObservationId = z.infer<typeof ObservationId>;
export const EvidenceRefId = idSchema('evr', 'EvidenceRefId');
export type EvidenceRefId = z.infer<typeof EvidenceRefId>;
export const FindingId = idSchema('fnd', 'FindingId');
export type FindingId = z.infer<typeof FindingId>;
export const RelationId = idSchema('rel', 'RelationId');
export type RelationId = z.infer<typeof RelationId>;
