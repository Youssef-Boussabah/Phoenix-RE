import {
  ToolResponseEnvelope,
  AnalysisRequest,
  JobId,
  StepId,
  Sha256Hex,
  PhoenixError,
} from '@phoenix/contracts';
import { type Database, storage } from '../db/database.js';
import { input, jobIncludesTarget, parseJson, json, pagination } from './shared.js';
export interface Invocation {
  request: AnalysisRequest;
  envelope: ToolResponseEnvelope;
  jobId?: JobId;
  stepId?: StepId;
  cacheKey?: string;
}
export class Invocations {
  readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  append(value: Invocation): Invocation {
    const request = input(AnalysisRequest, value.request),
      envelope = input(ToolResponseEnvelope, value.envelope);
    if (
      request.requestId !== envelope.requestId ||
      request.operation !== envelope.operation ||
      !request.targetId ||
      request.targetId !== envelope.targetId ||
      (request.providerId && request.providerId !== envelope.providerId)
    )
      throw new PhoenixError('INVALID_REQUEST', 'Invocation request and result disagree');
    if (value.jobId) input(JobId, value.jobId);
    if (value.stepId) input(StepId, value.stepId);
    if (value.cacheKey) input(Sha256Hex, value.cacheKey);
    return this.db.transaction(() => {
      if (value.jobId && !jobIncludesTarget(this.db, value.jobId, request.targetId ?? ''))
        throw new PhoenixError('INVALID_REQUEST', 'Invocation job target disagrees');
      if (
        value.stepId &&
        this.db.get('SELECT job_id FROM job_steps WHERE id=?', value.stepId)?.['job_id'] !== value.jobId
      )
        throw new PhoenixError('INVALID_REQUEST', 'Invocation step job disagrees');
      // Limits are part of the request contract; params_json preserves the entire validated request.
      this.db.run(
        'INSERT INTO tool_invocations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        request.requestId,
        value.jobId ?? null,
        value.stepId ?? null,
        request.targetId ?? null,
        request.operation,
        envelope.providerId,
        envelope.providerVersion,
        json(request),
        value.cacheKey ?? null,
        envelope.status,
        envelope.error?.code ?? null,
        envelope.durationMs,
        json(envelope),
        envelope.timestamp,
      );
      return this.get(request.requestId);
    });
  }
  get(id: string): Invocation {
    const r = this.db.get('SELECT * FROM tool_invocations WHERE request_id=?', id);
    if (!r) throw new PhoenixError('NOT_FOUND', 'Invocation does not exist');
    return storage(() => {
      const request = AnalysisRequest.parse(parseJson(r['params_json'])),
        envelope = ToolResponseEnvelope.parse(parseJson(r['envelope_json']));
      const expected = [
        request.requestId,
        envelope.targetId,
        envelope.operation,
        envelope.providerId,
        envelope.providerVersion,
        envelope.status,
        envelope.error?.code ?? null,
        envelope.durationMs,
        envelope.timestamp,
      ];
      const keys = [
        'request_id',
        'target_id',
        'operation',
        'provider_id',
        'provider_version',
        'status',
        'error_code',
        'duration_ms',
        'created_at',
      ];
      if (
        keys.some((k, i) => r[k] !== expected[i]) ||
        request.requestId !== envelope.requestId ||
        request.operation !== envelope.operation ||
        request.targetId !== envelope.targetId
      )
        throw new Error('Invocation columns disagree');
      return {
        request,
        envelope,
        ...(r['job_id'] === null ? {} : { jobId: JobId.parse(r['job_id']) }),
        ...(r['step_id'] === null ? {} : { stepId: StepId.parse(r['step_id']) }),
        ...(r['cache_key'] === null ? {} : { cacheKey: Sha256Hex.parse(r['cache_key']) }),
      };
    });
  }
  list(page: unknown = {}): Invocation[] {
    const p = pagination(page);
    return this.db
      .all(
        'SELECT request_id FROM tool_invocations WHERE request_id>? ORDER BY request_id LIMIT ?',
        p.cursor,
        p.limit,
      )
      .map((r) => this.get(String(r['request_id'])));
  }
}
