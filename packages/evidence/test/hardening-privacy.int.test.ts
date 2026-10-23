import { it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describeTarget } from '@phoenix/toolkit';
import { TargetManifest } from '@phoenix/contracts';
import { createEvidenceStore } from '@phoenix/evidence';
import { zip } from '../../../tests/support/synth.ts';
import { fixture, cleanup, target, id, time } from './helpers.js';

it.each([
  ['python.py', Buffer.from('#!/usr/bin/env python3 # https://\nprint(1)\n')],
  ['shell.sh', Buffer.from('#!/bin/sh\t# https://\t documentation\necho ok\n')],
  ['hostile.zip', zip(['docs/http:[x]'])],
] as const)('persists real WP3 intake of %s with hostile-looking source content', async (name, bytes) => {
  const f = await fixture();
  let reopened;
  try {
    const path = join(f.directory, name);
    await writeFile(path, bytes);
    const description = await describeTarget({ type: 'path', path }, {}, f.t.inspectedOn);
    expect(JSON.stringify(description)).toMatch(/https?:/);
    const targetId = id('tgt');
    const saved = f.store.repos.targets.add(
      TargetManifest.parse({
        ...description,
        id: targetId,
        projectId: f.project.id,
        uri: `phoenix:target/${targetId}/source`,
        hostOs: description.inspectedOn.os,
        intakeMode: 'reference',
        createdAt: time,
        metadata: { requirement: 'https: is required' },
      }),
    );
    expect(saved.digest).toEqual(description.digest);
    expect(saved.localPath).toBe(path);
    expect(JSON.stringify(saved)).toContain('[URL_REDACTED]');
    await f.store.close();
    reopened = await createEvidenceStore({ dataDir: f.directory });
    expect(reopened.repos.targets.get(saved.id)).toEqual(saved);
  } finally {
    await cleanup(f.directory, f.store, ...(reopened ? [reopened] : []));
  }
});
it.each([
  "o'brien&sig=CANARY_APOSTROPHE",
  'one"two&sig=CANARY_QUOTE',
  'one<two&sig=CANARY_ANGLE',
  'one\u00a0&sig=CANARY_NBSP',
  'one\u2003&sig=CANARY_EMSPACE',
  'one\u2028&sig=CANARY_LINE_SEPARATOR',
  'one\t&sig=CANARY_TAB',
  'one\n&sig=CANARY_NEWLINE',
  'one &sig=CANARY_ASCII_SPACE',
])('removes the entire ambiguous URL suffix from stored metadata: %s', async (query) => {
  const f = await fixture();
  let reopened;
  const canary = /CANARY_[A-Z_]+/.exec(query)?.[0];
  if (!canary) throw new Error();
  try {
    const url = 'https://user:CANARY_PASSWORD@example.com/app?name=' + query;
    const t = f.store.repos.targets.add(
      target(f.project.id, {
        localPath: join(f.directory, 'source'),
        metadata: { note: 'documentation ' + url, [url]: 'value', nested: [url] },
        warnings: [{ code: 'SOURCE_TEXT', message: 'source ' + url }],
      }),
    );
    expect(JSON.stringify(t)).not.toContain(canary);
    expect(JSON.stringify(t)).not.toContain('CANARY_PASSWORD');
    await f.store.close();
    const bytes = await readFile(join(f.directory, 'phoenix.db'));
    expect(bytes.includes(Buffer.from(canary))).toBe(false);
    expect(bytes.includes(Buffer.from('CANARY_PASSWORD'))).toBe(false);
    reopened = await createEvidenceStore({ dataDir: f.directory });
    expect(JSON.stringify(reopened.repos.targets.get(t.id))).not.toContain(canary);
  } finally {
    await cleanup(f.directory, f.store, ...(reopened ? [reopened] : []));
  }
});
it('keeps strict authoritative URL validation, sanitized identities and separate intakes', async () => {
  const f = await fixture();
  let reopened;
  try {
    const url =
      "https://user:CANARY_PASSWORD@example.com/a/../app?name=o'brien\u00a0&sig=CANARY_SIGNED#CANARY_FRAGMENT";
    const make = () =>
      target(f.project.id, {
        source: { type: 'url', displayName: url },
        url,
        uri: url,
        localPath: undefined,
        digest: undefined,
        sha256: undefined,
      });
    const first = f.store.repos.targets.add(make()),
      second = f.store.repos.targets.add(make());
    expect(first.url).toBe('https://example.com/app');
    expect(first.uri).toBe(first.url);
    expect(first.id).not.toBe(second.id);
    expect(second.supersedes).toBeUndefined();
    expect(() => f.store.repos.targets.add({ ...make(), url: url + '\t', uri: url + '\t' })).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    let invoked = false;
    const accessor = Object.defineProperty({ ...make() }, 'url', {
      get() {
        invoked = true;
        throw new Error('CANARY_ACCESSOR_SECRET');
      },
    });
    expect(() => f.store.repos.targets.add(accessor)).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    expect(invoked).toBe(false);
    await f.store.close();
    expect((await readFile(join(f.directory, 'phoenix.db'))).includes(Buffer.from('CANARY_'))).toBe(false);
    reopened = await createEvidenceStore({ dataDir: f.directory });
    expect(reopened.repos.targets.get(first.id)).toEqual(first);
  } finally {
    await cleanup(f.directory, f.store, ...(reopened ? [reopened] : []));
  }
});
it('preserves safe text and handles redacted key collisions without rejecting source content', async () => {
  const f = await fixture();
  try {
    const safe = 'Read https://example.com/docs then https://example.org/help now';
    const t = f.store.repos.targets.add(
      target(f.project.id, {
        localPath: join(f.directory, 'safe'),
        metadata: { plain: 'ordinary source text', safe, 'https: is required': 1, 'https: invalid': 2 },
      }),
    );
    expect(t.metadata['plain']).toBe('ordinary source text');
    expect(t.metadata['safe']).toBe(safe);
    expect(t.metadata['[URL_REDACTED]']).toBe(1);
    expect(t.metadata['[URL_REDACTED][2]']).toBe(2);
    expect(f.store.repos.targets.get(t.id)).toEqual(t);
  } finally {
    await cleanup(f.directory, f.store);
  }
});
it('redacts repeated source URL text iteratively while retaining ordinary safe content', async () => {
  const f = await fixture();
  try {
    const text = 'see https://example.com/docs '.repeat(12000);
    const saved = f.store.repos.targets.add(
      target(f.project.id, { localPath: join(f.directory, 'repeated'), metadata: { text } }),
    );
    expect(saved.metadata['text']).toBe(text);
    expect(f.store.repos.targets.get(saved.id).metadata['text']).toBe(text);
  } finally {
    await cleanup(f.directory, f.store);
  }
});
