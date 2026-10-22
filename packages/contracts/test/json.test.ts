import { expect, it } from 'vitest';
import * as c from '../src/index.js';
import { fixtures, envelope, observation, manifest } from './fixtures.js';

const nested = (depth: number, array = false): unknown => {
  let value: unknown = null;
  for (let i = 0; i < depth; i++) value = array ? [value] : { child: value };
  return value;
};
it('rejects 20,000-level trees and cycles in every arbitrary JSON field without throwing', () => {
  const cycle: Record<string, unknown> = {};
  cycle['self'] = cycle;
  const wrappers = [
    (data: unknown) =>
      c.ToolInvokeInput.safeParse({ ...(fixtures['ToolInvokeInput'] as object), params: data }),
    (data: unknown) =>
      c.AnalysisRequest.safeParse({ ...(fixtures['AnalysisRequest'] as object), params: data }),
    (data: unknown) => c.ToolResponseEnvelope.safeParse({ ...envelope, data }),
    (data: unknown) => c.Observation.safeParse({ ...observation, data }),
    (data: unknown) => c.TargetManifest.safeParse({ ...manifest, metadata: data }),
    (data: unknown) =>
      c.PhoenixErrorShape.safeParse({ code: 'INTERNAL', message: 'error', retryable: false, details: data }),
    (data: unknown) => c.JobStep.safeParse({ ...(fixtures['JobStep'] as object), output: data }),
  ];
  for (const data of [nested(20_000), nested(20_000, true), cycle])
    for (const validate of wrappers) {
      let success = true;
      expect(() => {
        success = validate(data).success;
      }).not.toThrow();
      expect(success).toBe(false);
    }
});
it('bounds depth and total value nodes at the documented exact limits', () => {
  expect(c.BoundedJsonValue.safeParse(nested(c.JSON_LIMITS.maxDepth)).success).toBe(true);
  expect(c.BoundedJsonValue.safeParse(nested(c.JSON_LIMITS.maxDepth + 1)).success).toBe(false);
  expect(
    c.BoundedJsonValue.safeParse(Array.from({ length: c.JSON_LIMITS.maxNodes - 1 }, () => 0)).success,
  ).toBe(true);
  expect(c.BoundedJsonValue.safeParse(Array.from({ length: c.JSON_LIMITS.maxNodes }, () => 0)).success).toBe(
    false,
  );
  // Parent exit frames do not count as extra JSON nodes.
  expect(
    c.BoundedJsonValue.safeParse({ children: Array.from({ length: c.JSON_LIMITS.maxNodes - 2 }, () => 0) })
      .success,
  ).toBe(true);
});
it('bounds exact UTF-8 JSON byte size, including escapes, keys and punctuation', () => {
  const limit = c.JSON_LIMITS.maxSerializedBytes;
  for (const unit of ['a', '\0', 'é', '😀']) {
    const width = new TextEncoder().encode(JSON.stringify(unit)).length - 2;
    const count = Math.floor((limit - 2) / width);
    const value = unit.repeat(count) + 'a'.repeat(limit - 2 - count * width);
    expect(new TextEncoder().encode(JSON.stringify(value)).length).toBe(limit);
    expect(c.BoundedJsonValue.safeParse(value).success).toBe(true);
    expect(c.BoundedJsonValue.safeParse(value + 'a').success).toBe(false);
  }
  expect(c.BoundedJsonValue.safeParse('a'.repeat(limit + 1)).success).toBe(false);
  expect(c.BoundedJsonValue.safeParse({ ['a'.repeat(limit)]: 0 }).success).toBe(false);
  const maxObject = { a: 'x'.repeat(limit - 8) };
  expect(JSON.stringify(maxObject).length).toBe(limit);
  expect(c.BoundedJsonObject.safeParse(maxObject).success).toBe(true);
  expect(c.BoundedJsonObject.safeParse({ ...maxObject, b: 0 }).success).toBe(false);
});
it('rejects non-JSON in-memory values and unreadable objects without invoking getters', () => {
  const sparse = new Array<unknown>(1);
  const named: unknown[] = [];
  Object.defineProperty(named, 'named', { value: 1, enumerable: true });
  const accessor = Object.defineProperty({}, 'getter', {
    get: () => {
      throw new Error('must not execute');
    },
    enumerable: true,
  });
  const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const value of [
    undefined,
    1n,
    NaN,
    Infinity,
    () => 0,
    Symbol('s'),
    new Date(),
    new Map(),
    sparse,
    named,
    accessor,
    hidden,
    { [Symbol('s')]: 1 },
    revoked.proxy,
  ]) {
    let success = true;
    expect(() => {
      success = c.BoundedJsonValue.safeParse(value).success;
    }).not.toThrow();
    expect(success).toBe(false);
  }
});
it('copies shared acyclic values without dropping __proto__ or alias data', () => {
  const shared = { a: 1 };
  const value = { left: shared, right: shared };
  const parsed = c.BoundedJsonObject.parse(value);
  expect(parsed).toEqual(value);
  shared.a = 2;
  expect(parsed['left']).toEqual({ a: 1 });
  const dangerous: unknown = JSON.parse('{"__proto__":{"polluted":true},"normal":1}');
  expect(JSON.stringify(c.BoundedJsonValue.parse(dangerous))).toBe(JSON.stringify(dangerous));
  expect(Object.prototype).not.toHaveProperty('polluted');
  expect(
    c.BoundedJsonObject.parse(Object.assign(Object.create(null) as Record<string, unknown>, { a: null })),
  ).toEqual({ a: null });
  for (const value of [null, false, 0, '', [1, null]]) expect(c.BoundedJsonValue.parse(value)).toEqual(value);
  for (const value of [null, [], true, 1, 'a'])
    expect(c.BoundedJsonObject.safeParse(value).success).toBe(false);
});
it('keeps error construction, normalization and serialization bounded on adversarial details', () => {
  for (const details of [nested(20_000), { many: new Array(50_001).fill(0) }, { bad: new Date() }]) {
    const error = new c.PhoenixError('INTERNAL', 'failure', { details: details as Record<string, unknown> });
    expect(error.toShape().details).toEqual({
      omitted: 'Error details were invalid or exceeded JSON limits',
    });
    expect(() => JSON.stringify(error)).not.toThrow();
    expect(() =>
      c.normalizeError({ code: 'INTERNAL', message: 'bad', retryable: false, details }),
    ).not.toThrow();
  }
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  expect(c.normalizeError(revoked.proxy).code).toBe('INTERNAL');
  const hostile = new Error();
  Object.defineProperty(hostile, 'message', {
    get: () => {
      throw new Error('unreadable');
    },
  });
  expect(c.normalizeError(hostile).message).toBe('Unexpected error');
});
