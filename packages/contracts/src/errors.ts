import { z } from 'zod';
import { BoundedJsonObject, copyBoundedJson } from './json.js';
export const ErrorCode = z.enum([
  'INVALID_REQUEST', // schema validation failed
  'NOT_FOUND', // project/target/job/artifact id unknown
  'TARGET_UNREADABLE', // permission denied, vanished, not a regular file/dir
  'TARGET_CHANGED', // digest mismatch on re-verification, or changed during read
  'NOT_SUPPORTED', // operation not implemented for this target/provider (SOT §6.2)
  'PROVIDER_UNAVAILABLE', // provider registered but prerequisites missing
  'HOST_INCOMPATIBLE', // provider/operation cannot run on this host
  'POLICY_DENIED', // operation needs execution/network not allowed by job policy
  'TIMEOUT',
  'CANCELLED',
  'OUTPUT_LIMIT_EXCEEDED',
  'PROVIDER_FAILED', // provider threw / child process failed
  'PROVIDER_OUTPUT_INVALID', // provider result failed its operation result schema
  'INVALID_STATE_TRANSITION',
  'CONFLICT', // optimistic-concurrency version mismatch
  'BUDGET_EXHAUSTED',
  'STEP_RETRIES_EXHAUSTED',
  'STORAGE_ERROR', // SQLite / CAS failure, corrupted row failing schema
  'MIGRATION_FAILED',
  'MIGRATION_CHECKSUM_MISMATCH',
  'DB_SCHEMA_TOO_NEW', // DB written by a newer PHOENIX; refuse to open
  'UNAUTHORIZED', // server token missing/invalid
  'INTERNAL',
]);
export const PhoenixErrorShape = z.strictObject({
  code: ErrorCode,
  message: z.string().max(8192),
  retryable: z.boolean(),
  details: BoundedJsonObject.optional(),
});

export type ErrorCode = z.infer<typeof ErrorCode>;

export type PhoenixErrorShape = z.infer<typeof PhoenixErrorShape>;

export interface ErrorOptions {
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}

/** Pure, bounded fallback redaction; no host environment or filesystem reads. */
export function sanitizeErrorMessage(message: string): string {
  const bounded = message.length > 8192 ? message.slice(0, 8178) + '[truncated]' : message;
  const credentials = (text: string): string =>
    text
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[REDACTED]')
      .replace(/\b((?:Bearer|Basic)\s+)[^\s"'<>;,]+/gi, '$1[REDACTED]')
      .replace(
        /(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|client[_-]?secret|authorization|proxy-authorization)\b["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
        '$1[REDACTED]',
      )
      .replace(/\b(?:sk|hf|ghp)[_-][A-Za-z0-9_-]{8,}/g, '[REDACTED]');
  // Keep URI paths intact; redact userinfo and credential query values without reserializing the URL.
  return bounded
    .split(/(\bhttps?:\/\/[^\s<>"']+)/gi)
    .map((part, index) =>
      index % 2 === 1
        ? part
            .replace(/(https?:\/\/)[^/@]+@/gi, '$1[REDACTED]@')
            .replace(
              /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|client[_-]?secret)=)[^&#]*/gi,
              '$1[REDACTED]',
            )
        : credentials(part)
            .replace(/\/root(?=\/|$)/g, '~')
            .replace(/\\\\\?\\UNC\\/gi, '\\\\')
            .replace(/\\\\\?\\(?=[A-Za-z]:)/g, '')
            .replace(
              /(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]|\/(?:home|Users)\/)[^\\/\r\n"'<>]+/gi,
              '~',
            )
            .replace(
              /(?:\\\\|\/\/)[^\\/\r\n"'<>]+[\\/][^\\/\r\n"'<>]+(?:[\\/](?:Users|home)[\\/][^\\/\r\n"'<>]+)?/gi,
              '~',
            ),
    )
    .join('')
    .slice(0, 8192);
}

function sanitizeDetails(value: unknown): BoundedJsonObject {
  const copied = copyBoundedJson(value, {
    string: sanitizeErrorMessage,
    secretKey: (key) => /token|password|passwd|secret|authorization|api[_-]?key/i.test(key),
  });
  if (copied.ok) {
    const parsed = BoundedJsonObject.safeParse(copied.value);
    if (parsed.success) return parsed.data;
  }
  return { omitted: 'Error details were invalid or exceeded JSON limits' };
}

export class PhoenixError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options: ErrorOptions = {}) {
    super(sanitizeErrorMessage(message), { cause: options.cause });
    this.name = 'PhoenixError';
    this.code = ErrorCode.parse(code);
    this.retryable = options.retryable ?? (code === 'CONFLICT' || code === 'TIMEOUT');
    if (options.details !== undefined) {
      this.details = sanitizeDetails(options.details);
    }
  }

  toShape(): PhoenixErrorShape {
    return PhoenixErrorShape.parse({
      code: this.code,
      message: sanitizeErrorMessage(this.message),
      retryable: this.retryable,
      ...(this.details === undefined ? {} : { details: sanitizeDetails(this.details) }),
    });
  }

  toJSON(): PhoenixErrorShape {
    return this.toShape();
  }

  static fromShape(shape: PhoenixErrorShape): PhoenixError {
    const parsed = PhoenixErrorShape.parse(shape);
    return new PhoenixError(parsed.code, parsed.message, {
      retryable: parsed.retryable,
      ...(parsed.details === undefined ? {} : { details: parsed.details }),
    });
  }
}

export function normalizeError(error: unknown, fallback: ErrorCode = 'INTERNAL'): PhoenixError {
  try {
    if (error instanceof PhoenixError) return error;
    const parsed = PhoenixErrorShape.safeParse(error);
    if (parsed.success) return PhoenixError.fromShape(parsed.data);
    if (error instanceof Error && typeof error.message === 'string')
      return new PhoenixError(fallback, error.message, { cause: error });
  } catch {
    /* Error reporting must survive unreadable in-memory exceptions. */
  }
  return new PhoenixError(fallback, 'Unexpected error', { cause: error });
}

export function errorHttpStatus(code: ErrorCode): number {
  switch (code) {
    case 'INVALID_REQUEST':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'POLICY_DENIED':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
    case 'INVALID_STATE_TRANSITION':
    case 'TARGET_CHANGED':
      return 409;
    case 'NOT_SUPPORTED':
    case 'HOST_INCOMPATIBLE':
    case 'PROVIDER_UNAVAILABLE':
      return 422;
    case 'OUTPUT_LIMIT_EXCEEDED':
      return 413;
    case 'TIMEOUT':
      return 504;
    case 'DB_SCHEMA_TOO_NEW':
    case 'MIGRATION_FAILED':
    case 'MIGRATION_CHECKSUM_MISMATCH':
      return 503;
    case 'TARGET_UNREADABLE':
    case 'CANCELLED':
    case 'PROVIDER_FAILED':
    case 'PROVIDER_OUTPUT_INVALID':
    case 'BUDGET_EXHAUSTED':
    case 'STEP_RETRIES_EXHAUSTED':
    case 'STORAGE_ERROR':
    case 'INTERNAL':
      return 500;
  }
}

export function errorCliExitCode(code: ErrorCode): 1 | 2 {
  return code === 'INVALID_REQUEST' ? 2 : 1;
}
