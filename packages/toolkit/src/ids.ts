import { randomBytes } from 'node:crypto';
import {
  ProjectId,
  TargetId,
  ArtifactId,
  JobId,
  StepId,
  EventId,
  RequestId,
  ObservationId,
  EvidenceRefId,
  FindingId,
  RelationId,
  PhoenixError,
} from '@phoenix/contracts';

const schemas = {
  prj: ProjectId,
  tgt: TargetId,
  art: ArtifactId,
  job: JobId,
  stp: StepId,
  evt: EventId,
  req: RequestId,
  obs: ObservationId,
  evr: EvidenceRefId,
  fnd: FindingId,
  rel: RelationId,
};
export type IdPrefix = keyof typeof schemas;
type IdFor<P extends IdPrefix> = ReturnType<(typeof schemas)[P]['parse']>;
/** Monotonic within this process, including same-millisecond calls and clock rollback. */
export function createIdGenerator(now: () => number = Date.now): <P extends IdPrefix>(prefix: P) => IdFor<P> {
  let last = -1;
  let sequence = 0;
  return <P extends IdPrefix>(prefix: P): IdFor<P> => {
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0 || time > 0xffffffffffff || !Object.hasOwn(schemas, prefix))
      throw new PhoenixError('INVALID_REQUEST', 'Invalid UUIDv7 timestamp or ID prefix');
    if (time > last) {
      last = time;
      sequence = randomBytes(2).readUInt16BE() & 0x7ff;
    } else if (++sequence > 0xfff) {
      last++;
      sequence = 0;
    }
    if (last > 0xffffffffffff) throw new PhoenixError('INTERNAL', 'UUIDv7 timestamp exhausted');
    const bytes = randomBytes(16);
    bytes.writeUIntBE(last, 0, 6);
    bytes[6] = 0x70 | (sequence >> 8);
    bytes[7] = sequence & 0xff;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    // The prefix selects the same schema used to construct the branded return type.
    return schemas[prefix].parse(`${prefix}_${bytes.toString('hex')}`) as IdFor<P>;
  };
}
export const newId = createIdGenerator();
