import { expect, it, vi } from 'vitest';
import { PhoenixError, PhoenixErrorShape } from '@phoenix/contracts';
import { createLogger, sanitizeLogText, serializeLogError } from '../src/log/logger.js';
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => '/srv/unusual person',
}));
function capture(options: Parameters<typeof createLogger>[0] = {}) {
  const lines: string[] = [];
  return {
    lines,
    logger: createLogger({
      ...options,
      write: (line) => {
        lines.push(line);
      },
    }),
  };
}
it('neutralizes terminal sequences before matching private paths and credentials', () => {
  for (const separator of ['\x1b[31m', '\x1b]0;title\x07', '\u200b', '\u2066', '\x00', '\n', '\t', '\r']) {
    const text = sanitizeLogText(
      '/tmp/private' + separator + ' workspace/data token' + separator + '=value',
      ['/tmp/private workspace'],
    );
    expect(text).not.toContain('/tmp/private');
    expect(text).not.toContain('value');
    expect(text).toContain('~/data');
  }
});
it('always masks the home directory alongside custom private paths', () => {
  const { lines, logger } = capture({ privatePaths: ['/tmp/workspace'] });
  logger.info('/srv/unusual person/source', {
    home: '/srv/unusual person/source',
    custom: '/tmp/workspace/private',
  });
  expect(lines[0]).not.toContain('unusual person');
  expect(lines[0]).not.toContain('/tmp/workspace');
  expect(lines[0]).toContain('~/source');
});
it('recognizes sensitive keys without masking authorship metadata', () => {
  const { lines, logger } = capture();
  logger.info('passphrase="message-secret"', {
    credentials: { user: 'x', password: 'field-secret' },
    passphrase: 'field-secret',
    auth: 'field-secret',
    pwd: 'field-secret',
    httpAuth: 'field-secret',
    auth_header: 'field-secret',
    author: 'visible author',
    requestId: 'req-123',
    nested: { ['creden\u200btials']: 'field-secret' },
  });
  expect(lines[0]).not.toContain('field-secret');
  expect(lines[0]).not.toContain('message-secret');
  expect(lines[0]).toContain('visible author');
  expect(lines[0]).toContain('req-123');
});
it('retains good metadata when a sibling field is invalid, cyclic, huge or unreadable', () => {
  const { lines, logger } = capture();
  const cycle: Record<string, unknown> = {};
  cycle['self'] = cycle;
  let getterCalls = 0;
  const fields = { requestId: 'req-123', huge: 'x'.repeat(100000), bad: 1n, cycle };
  // Add the accessor without evaluating it through object spread.
  Object.defineProperty(fields, 'accessor', {
    enumerable: true,
    get: () => {
      getterCalls++;
      throw Error('not called');
    },
  });
  logger.error('diagnostic', fields);
  expect(getterCalls).toBe(0);
  const event = JSON.parse(lines[0] ?? '') as { fields: Record<string, unknown> };
  expect(event.fields['requestId']).toBe('req-123');
  expect(event.fields['huge']).toContain('omitted');
  expect(event.fields['bad']).toBe('[unserializable]');
  expect(event.fields['accessor']).toContain('omitted');
  expect(Buffer.byteLength(lines[0] ?? '')).toBeLessThan(16384);
});
it('bounds field fanout, node counts and control expansion while escaping invisible characters', () => {
  const { lines, logger } = capture();
  logger.info('invisible\u200b\u2060\u200e\u034f', {
    requestId: 'req',
    fanout: Array.from({ length: 1000 }, () => ({ x: 'x' })),
  });
  expect(lines[0]).not.toMatch(/[\u200b\u2060\u200e\u034f]/);
  expect(lines[0]).toContain('\\\\u200b');
  expect(lines[0]).toContain('omitted');
  expect(lines[0]).toContain('req');
  logger.info('many', Object.fromEntries(Array.from({ length: 1000 }, (_, i) => ['field' + String(i), i])));
  expect(Object.keys((JSON.parse(lines[1] ?? '') as { fields: object }).fields)).toHaveLength(33);
});

it('redacts sensitive error details and preserves the error contract', () => {
  const error = serializeLogError(
    new PhoenixError('PROVIDER_FAILED', 'failure', {
      details: {
        credentials: 'secret-value',
        auth: 'secret-value',
        pwd: 'secret-value',
        passphrase: 'secret-value',
        requestId: 'req',
        path: '/srv/unusual person/private',
        control: 'a\u202eb',
      },
    }),
  );
  expect(PhoenixErrorShape.safeParse(error).success).toBe(true);
  expect(JSON.stringify(error)).not.toContain('secret-value');
  expect(JSON.stringify(error)).not.toContain('unusual person');
  expect(JSON.stringify(error)).not.toContain('\u202e');
  expect(error.details?.['requestId']).toBe('req');
});
it('compiles private path regexes once per logger rather than per event or field', () => {
  const spy = vi.spyOn(globalThis, 'RegExp');
  try {
    const { logger } = capture({ privatePaths: ['/tmp/private'] });
    const compiled = spy.mock.calls.length;
    expect(compiled).toBeGreaterThan(0);
    logger.info('a', { x: 'value', y: 'value' });
    logger.info('b', { x: 'value' });
    expect(spy).toHaveBeenCalledTimes(compiled);
  } finally {
    spy.mockRestore();
  }
});

it('does not reveal whitespace-delimited credentials when controls are joined for path matching', () => {
  for (const value of ['Bearer\nsecret-value', 'Basic\tsecret-value', 'pwd="secret-value"'])
    expect(sanitizeLogText(value)).not.toContain('secret-value');
});
