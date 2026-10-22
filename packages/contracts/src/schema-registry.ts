import { z } from 'zod';
import * as json from './json.js';
import * as paths from './paths.js';
import { CONTRACTS_VERSION } from './version.js';
import * as versions from './version.js';
import * as ids from './ids.js';
import * as time from './time.js';
import * as hosts from './host.js';
import * as errors from './errors.js';
import * as targets from './target.js';
import * as artifacts from './artifact.js';
import * as evidence from './evidence.js';
import * as providers from './provider.js';
import * as jobs from './job.js';
import * as events from './events.js';
import * as doctor from './doctor.js';
import * as engine from './engine.js';
import * as operations from './operations/index.js';

const schemaExports: Record<string, unknown> = {
  ...versions,
  ...json,
  ...paths,
  ...ids,
  ...time,
  ...hosts,
  ...errors,
  ...targets,
  ...artifacts,
  ...evidence,
  ...providers,
  ...jobs,
  ...events,
  ...doctor,
  ...engine,
  ...operations,
};
export const contractSchemas: Readonly<Record<string, z.ZodType>> = Object.freeze(
  Object.fromEntries(
    Object.entries(schemaExports).filter(
      (entry): entry is [string, z.ZodType] => entry[1] instanceof z.ZodType,
    ),
  ),
);

const runtimeConstraints: Readonly<Record<string, string>> = {
  TargetDescription:
    'HTTP/HTTPS target URLs only; kind equals classification.kind; sha256 exactly matches SHA-256 digest; truncated inventories have no digest; source type agrees with URL presence and digest algorithm',
  TargetManifest:
    'TargetDescription constraints; hostOs equals inspectedOn.os; HTTP(S) URL or internal artifact/target URI matching associated identifiers',
  ToolResponseEnvelope:
    'error iff status=error; error data=null; provider identity/version paired; non-error responses require a provider',
  Observation:
    'data or dataArtifactId required; explicit JSON null is inline data, stored as TEXT null rather than SQL NULL',
  Finding: 'non-hypotheses require evidence',
  Job: 'candidateTargetId present iff mode=verify; finishedAt iff terminal; active/completed jobs have no final error; cancellation errors use CANCELLED; failed/partial errors do not; current state obeys mode guards',
  CreateJobInput: 'candidateTargetId present iff mode=verify',
  JobEvent:
    'job_finished uses terminal states and coherent failure/partial/cancellation/completion error reasons; budget_exhausted uses recognized budgets and nonnegative safe integer counters with used >= limit',
  ProviderStatus: 'descriptor and availability provider IDs must agree',
  HttpUrl: 'HTTP and HTTPS only; generic URI syntax grants no permission for other protocols',
  IntakeSource: 'URL sources allow only HTTP and HTTPS',
  DoctorReport: 'ok equals every required check passing',
};
export function jsonSchemaFor(name: string, schema: z.ZodType): Record<string, unknown> {
  return {
    ...z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }),
    $id: `https://phoenix.invalid/contracts/${CONTRACTS_VERSION}/${name}.schema.json`,
    ...(runtimeConstraints[name] === undefined
      ? {}
      : { 'x-phoenix-runtime-constraints': runtimeConstraints[name] }),
    $comment:
      'Generated from Zod. Custom refinements, including nested refinements, require runtime Zod validation.',
  };
}
