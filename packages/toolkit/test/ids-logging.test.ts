import { expect, it } from 'vitest';
import { ID_PREFIXES, ProjectId, PhoenixError, PhoenixErrorShape } from '@phoenix/contracts';
import { createIdGenerator, newId, createLogger, sanitizeLogText, serializeLogError } from '../src/index.js';

it('generates correctly branded prefixed UUIDv7 IDs with RFC variant and unique order', () => {
  const generate = createIdGenerator(() => 0x123456789abc),
    ids = Array.from({ length: 10000 }, () => generate('prj'));
  expect(new Set(ids).size).toBe(10000);
  expect([...ids].sort()).toEqual(ids);
  for (const id of ids) {
    expect(ProjectId.safeParse(id).success).toBe(true);
    expect(id[16]).toBe('7');
    expect(id[20]).toMatch(/[89ab]/);
  }
  expect(ids[0]?.slice(4, 16)).toBe('123456789abc');
  for (const prefix of Object.values(ID_PREFIXES))
    expect(newId(prefix)).toMatch(new RegExp(`^${prefix}_[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$`));
  let time = 100;
  const rollback = createIdGenerator(() => time);
  const first = rollback('job');
  time = 50;
  expect(rollback('job') > first).toBe(true);
  expect(() => createIdGenerator(() => -1)('job')).toThrow();
  expect(() => createIdGenerator(() => 2 ** 48)('job')).toThrow();
});
it('writes structured bounded NDJSON at typed levels with no terminal control injection', () => {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    write: (line) => {
      lines.push(line);
    },
    now: () => new Date('2026-10-22T00:00:00.000Z'),
  });
  logger.debug('debug');
  logger.info('file\n\x1b[31mred\x1b[0m\r\u202e', {
    token: 'secret',
    path: '/home/Alice Smith/private',
    payload: 'raw code',
    url: 'https://example.com/home/page',
    nested: { password: 'secret', value: '\x1b]0;evil\x07text' },
  });
  logger.warn('warning');
  logger.error('failure', {
    error: serializeLogError(
      new PhoenixError('TIMEOUT', 'Authorization: Basic abcdef /home/Alice Smith/private'),
    ),
  });
  expect(lines).toHaveLength(4);
  for (const line of lines) {
    expect(line.endsWith('\n')).toBe(true);
    expect(line.split('\n')).toHaveLength(2);
    expect(() => JSON.parse(line) as unknown).not.toThrow();
    expect(line.slice(0, -1)).not.toMatch(/[\x00-\x1f]/);
  }
  const event = JSON.parse(lines[1] ?? '') as {
    message: string;
    fields: { token: string; path: string; payload: string; url: string };
  };
  expect(event.fields.token).toBe('[REDACTED]');
  expect(event.fields.payload).toBe('[REDACTED]');
  expect(event.fields.path).toBe('~/private');
  expect(event.fields.url).toBe('https://example.com/home/page');
  expect(event.message).not.toContain('\x1b');
  expect(event.message).toContain('\\u000a');
  expect(event.message).toContain('\\u202e');
  expect(lines.join('')).not.toContain('abcdef');
});
it('redacts credential forms, private key blocks, Windows/UNC homes, and bounds fields', () => {
  for (const input of [
    'token="secretvalue"',
    'Bearer secretvalue',
    'Authorization: Basic secretvalue',
    '-----BEGIN PRIVATE KEY-----\nsecretvalue\n-----END PRIVATE KEY-----',
    'https://user:secretvalue@example.com/?token=secretvalue',
  ])
    expect(sanitizeLogText(input)).not.toContain('secretvalue');
  for (const input of ['C:\\Users\\Alice Smith\\private', '\\\\server\\share\\Users\\Alice Smith\\private'])
    expect(sanitizeLogText(input)).not.toContain('Alice');
  const lines: string[] = [];
  const logger = createLogger({
    maxLineBytes: 256,
    write: (line) => {
      lines.push(line);
    },
  });
  logger.debug('filtered');
  logger.info('😀'.repeat(1000), { x: 'big' });
  expect(lines).toHaveLength(1);
  expect(Buffer.byteLength(lines[0] ?? '')).toBeLessThanOrEqual(256);
  expect(JSON.parse(lines[0] ?? '')).toMatchObject({ truncated: true });
  const deep: Record<string, unknown> = {};
  let current = deep;
  for (let i = 0; i < 20000; i++) {
    const next = {};
    current['x'] = next;
    current = next;
  }
  const safe: string[] = [];
  const bounded = createLogger({
    write: (line) => {
      safe.push(line);
    },
  });
  expect(() => {
    bounded.info('deep', deep);
  }).not.toThrow();
  expect(safe[0]).toContain('omitted');
  expect(() => createLogger({ maxLineBytes: 10 })).toThrow();
  expect(serializeLogError(Error('bad\x1b[2J'))).toMatchObject({ code: 'INTERNAL', message: 'bad' });
});
it('redacts configured private workspace paths without corrupting URLs or sibling names', () => {
  const lines: string[] = [];
  const logger = createLogger({
    privatePaths: ['/tmp/private workspace', 'D:\\private workspace'],
    write: (line) => {
      lines.push(line);
    },
  });
  logger.info('/tmp/private workspace/data D:\\private workspace\\data', {
    path: '/tmp/private workspace/data',
    url: 'https://example.com/tmp/private/page',
    sibling: '/tmp/private workspace-other/data',
  });
  expect(lines[0]).not.toContain('workspace/data');
  expect(lines[0]).toContain('workspace-other');
  expect(lines[0]).toContain('https://example.com/tmp/private/page');
  expect(lines[0]).not.toContain('D:');
});

it('keeps serialized errors contract-valid after control escaping expands their message', () => {
  const error = serializeLogError(new PhoenixError('INTERNAL', '\x01'.repeat(8192)));
  expect(error.message).toHaveLength(8192);
  expect(error.message).not.toContain('\x01');
  expect(PhoenixErrorShape.safeParse(error).success).toBe(true);
});
