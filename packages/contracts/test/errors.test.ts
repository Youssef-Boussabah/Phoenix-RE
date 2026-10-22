import { expect, it } from 'vitest';
import {
  ErrorCode,
  PhoenixError,
  PhoenixErrorShape,
  normalizeError,
  sanitizeErrorMessage,
  errorHttpStatus,
  errorCliExitCode,
} from '../src/index.js';

it('serializes and restores every error code without stack or cause', () => {
  for (const code of ErrorCode.options) {
    const error = new PhoenixError(code, 'failure', { cause: new Error('private'), details: { count: 1 } });
    const shape = JSON.parse(JSON.stringify(error)) as unknown;
    expect(PhoenixErrorShape.parse(shape)).toEqual(error.toShape());
    expect(PhoenixError.fromShape(error.toShape()).toShape()).toEqual(error.toShape());
    expect(shape).not.toHaveProperty('stack');
    expect(shape).not.toHaveProperty('cause');
    expect(error.retryable).toBe(code === 'TIMEOUT' || code === 'CONFLICT');
    expect(errorCliExitCode(code)).toBe(code === 'INVALID_REQUEST' ? 2 : 1);
    expect(errorHttpStatus(code)).toBe(expectedStatus[code] ?? 500);
  }
});
const expectedStatus: Partial<Record<ErrorCode, number>> = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  POLICY_DENIED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409,
  TARGET_CHANGED: 409,
  NOT_SUPPORTED: 422,
  HOST_INCOMPATIBLE: 422,
  PROVIDER_UNAVAILABLE: 422,
  OUTPUT_LIMIT_EXCEEDED: 413,
  TIMEOUT: 504,
  DB_SCHEMA_TOO_NEW: 503,
  MIGRATION_FAILED: 503,
  MIGRATION_CHECKSUM_MISMATCH: 503,
};
it('normalizes typed errors, serialized errors and unknown throws', () => {
  const error = new PhoenixError('TIMEOUT', 'time', { retryable: false });
  expect(normalizeError(error)).toBe(error);
  expect(normalizeError(error.toShape()).toShape()).toEqual(error.toShape());
  expect(normalizeError(new Error('problem')).toShape()).toEqual({
    code: 'INTERNAL',
    message: 'problem',
    retryable: false,
  });
  expect(normalizeError('secret raw throw', 'PROVIDER_FAILED').toShape()).toEqual({
    code: 'PROVIDER_FAILED',
    message: 'Unexpected error',
    retryable: false,
  });
  expect(PhoenixError.fromShape(error.toShape()).details).toBeUndefined();
  expect(() =>
    PhoenixError.fromShape({ ...error.toShape(), code: 'BAD' } as unknown as PhoenixErrorShape),
  ).toThrow();
});
it('sanitizes credentials and common home paths without I/O', () => {
  const message =
    '/home/alice/private /Users/bob/target C:\\Users\\Carol\\file Bearer abc123 token=secret password:abc sk_abcdefghij';
  const clean = sanitizeErrorMessage(message);
  expect(clean).not.toMatch(/alice|bob|Carol|abc123|secret|abcdefghij/);
  expect(clean).toContain('~/private');
  expect(clean).toContain('~\\file');
  expect(sanitizeErrorMessage('-----BEGIN RSA PRIVATE KEY-----\nsecret\n-----END RSA PRIVATE KEY-----')).toBe(
    '[REDACTED]',
  );
  const cyclic: Record<string, unknown> = {
    count: 1,
    enabled: true,
    none: null,
    path: '/home/alice/file',
    token: 'hidden',
    nan: NaN,
    bigint: 1n,
    missing: undefined,
    array: ['text', false],
  };
  cyclic['self'] = cyclic;
  const error = new PhoenixError('INTERNAL', message, { details: cyclic });
  expect(error.toShape().details).toMatchObject({
    token: '[REDACTED]',
    path: '~/file',
    self: '[circular]',
    nan: '[unserializable]',
    bigint: '[unserializable]',
    missing: '[unserializable]',
    count: 1,
    enabled: true,
    none: null,
    array: ['text', false],
  });
  expect(JSON.stringify(error)).not.toContain('hidden');
});

it('redacts quoted credentials, spaced home names, root and UNC paths while preserving HTTP URLs', () => {
  for (const text of [
    '/home/Alice Smith/private',
    '/Users/Alice Smith/private',
    '/root/private',
    'C:\\Users\\Alice Smith\\private',
    'C:/Users/Alice Smith/private',
    '\\\\server\\share\\Users\\Alice Smith\\private',
    '//server/share/Users/Alice Smith/private',
    '\\\\?\\C:\\Users\\Alice Smith\\private',
    '\\\\?\\UNC\\server\\share\\Users\\Alice Smith\\private',
  ]) {
    const clean = sanitizeErrorMessage(text);
    expect(clean).not.toMatch(/Alice|Smith|server|share|root/);
    expect(clean).toContain('~');
  }
  for (const text of [
    'Authorization: Basic dXNlcjpwYXNz',
    'Authorization: Bearer super-secret',
    '{"token":"two words"}',
    '{"api_key": "sensitive"}',
    "password='two words'",
    'access_token=sensitive',
  ]) {
    const clean = sanitizeErrorMessage(text);
    expect(clean).toContain('[REDACTED]');
    expect(clean).not.toMatch(/dXNlcjpwYXNz|super-secret|two words|sensitive/);
  }
  for (const url of [
    'https://example.com/home/page',
    'http://localhost/Users/Alice/page?view=normal',
    'https://example.com/a%20b#anchor',
  ])
    expect(sanitizeErrorMessage(url)).toBe(url);
  expect(sanitizeErrorMessage('https://user:pass@example.com/home/page?token=sensitive&view=ok')).toBe(
    'https://[REDACTED]@example.com/home/page?token=[REDACTED]&view=ok',
  );
  expect(sanitizeErrorMessage('x'.repeat(20_000)).length).toBeLessThanOrEqual(8192);
  expect(sanitizeErrorMessage('-----BEGIN PRIVATE KEY-----\nsecret without end')).toBe('[REDACTED]');
});
it('retains every details value when redacted keys collide', () => {
  const error = new PhoenixError('INTERNAL', 'error', {
    details: { '/home/alice/file': 1, '/home/bob/file': 2, '~/file [2]': 3 },
  });
  const details = error.toShape().details ?? {};
  expect(Object.values(details).sort()).toEqual([1, 2, 3]);
  expect(Object.keys(details).join(' ')).not.toMatch(/alice|bob/);
});
it('keeps messages bounded even when redaction expands many short values', () => {
  const error = new PhoenixError('INTERNAL', 'token=a '.repeat(2000));
  expect(error.toShape().message.length).toBeLessThanOrEqual(8192);
  expect(() => JSON.stringify(error)).not.toThrow();
});
