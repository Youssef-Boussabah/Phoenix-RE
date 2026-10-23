import { it, expect } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describeTarget } from '@phoenix/toolkit';
import { TargetManifest, type TargetDescription } from '@phoenix/contracts';
import { createEvidenceStore } from '@phoenix/evidence';
import { fixture, cleanup, id, time } from './helpers.js';
type Fixture = Awaited<ReturnType<typeof fixture>>;
function manifest(f: Fixture, description: TargetDescription) {
  const targetId = id('tgt');
  return TargetManifest.parse({
    ...description,
    id: targetId,
    projectId: f.project.id,
    uri: `phoenix:target/${targetId}/source`,
    hostOs: description.inspectedOn.os,
    intakeMode: 'reference',
    createdAt: time,
    metadata: {},
  });
}
async function roundTrip(f: Fixture, value: unknown) {
  const saved = f.store.repos.targets.add(value);
  expect(TargetManifest.safeParse(saved).success).toBe(true);
  await f.store.close();
  const bytes = await readFile(join(f.directory, 'phoenix.db'));
  const reopened = await createEvidenceStore({ dataDir: f.directory });
  try {
    const reloaded = reopened.repos.targets.get(saved.id);
    expect(TargetManifest.safeParse(reloaded).success).toBe(true);
    expect(reloaded).toEqual(saved);
    return { saved, reloaded, bytes };
  } finally {
    await reopened.close();
  }
}
it('persists the exact warning path from real WP3 intake of an invalid nested package.json', async () => {
  const f = await fixture();
  try {
    // Windows cannot create a colon-bearing filename; its real intake fixture uses
    // a native name. The contract-path test below also covers http:x on Windows.
    const relative = process.platform === 'win32' ? 'http-x' : 'http:x';
    const root = join(f.directory, 'input');
    await mkdir(join(root, relative), { recursive: true });
    await writeFile(join(root, relative, 'package.json'), '{ invalid JSON');
    const description = await describeTarget({ type: 'path', path: root }, {}, f.t.inspectedOn);
    const path = relative + '/package.json';
    expect(description.warnings.find((w) => w.code === 'INVALID_CONFIG')?.path).toBe(path);
    const { saved, reloaded } = await roundTrip(f, manifest(f, description));
    for (const record of [saved, reloaded]) {
      expect(record.warnings.find((w) => w.code === 'INVALID_CONFIG')?.path).toBe(path);
      expect(record.warnings.map((w) => w.path)).toEqual(description.warnings.map((w) => w.path));
      expect(record.localPath).toBe(description.localPath);
      expect(record.digest).toEqual(description.digest);
    }
  } finally {
    await cleanup(f.directory, f.store);
  }
});
it('preserves literal URL-looking exclusions from real WP3 intake and after reopening', async () => {
  const f = await fixture();
  try {
    const root = join(f.directory, 'input');
    await mkdir(root);
    await writeFile(join(root, 'keep.txt'), 'keep');
    if (process.platform !== 'win32') {
      await mkdir(join(root, 'http:cache'));
      await writeFile(join(root, 'http:cache', 'cached.txt'), 'excluded');
    }
    const exclude = ['HTTP:Cache/École', 'http:cache'];
    const description = await describeTarget({ type: 'path', path: root }, { exclude }, f.t.inspectedOn);
    expect(description.inventory?.excluded).toEqual(exclude);
    const { saved, reloaded } = await roundTrip(f, manifest(f, description));
    expect(saved.inventory?.excluded).toEqual(exclude);
    expect(reloaded.inventory?.excluded).toEqual(exclude);
  } finally {
    await cleanup(f.directory, f.store);
  }
});
it('preserves only known relative-path positions with array alignment and optional fields', async () => {
  const f = await fixture();
  try {
    const path = join(f.directory, 'source.txt');
    await writeFile(path, 'source');
    const description = await describeTarget({ type: 'path', path }, {}, f.t.inspectedOn);
    const paths = [undefined, 'http:x/package.json', undefined, 'HTTP:École/Package.JSON'];
    const url = 'https://CANARY_USER:CANARY_PASSWORD@example.com/app?token=CANARY_TOKEN#CANARY_FRAGMENT';
    const value = manifest(f, description);
    value.warnings = paths.map((relative, i) => ({
      code: 'INPUT_' + String(i),
      message: 'Source ' + url,
      ...(relative === undefined ? {} : { path: relative }),
    }));
    value.classification.signals = paths.map((relative) => ({
      basis: 'heuristic' as const,
      description: 'Source ' + url,
      ...(relative === undefined ? {} : { path: relative }),
    }));
    const { saved, reloaded, bytes } = await roundTrip(f, value);
    for (const record of [saved, reloaded]) {
      expect(record.warnings.slice(0, paths.length).map((w) => w.path)).toEqual(paths);
      expect(record.classification.signals.map((s) => s.path)).toEqual(paths);
      expect(Object.hasOwn(record.warnings[0] ?? {}, 'path')).toBe(false);
      expect(Object.hasOwn(record.classification.signals[2] ?? {}, 'path')).toBe(false);
      expect(record.inventory).toBeUndefined();
      expect(Object.hasOwn(record, 'inventory')).toBe(false);
      expect(record.localPath).toBe(path);
      expect(JSON.stringify(record)).not.toContain('CANARY_');
    }
    expect(bytes.includes(Buffer.from('CANARY_'))).toBe(false);
  } finally {
    await cleanup(f.directory, f.store);
  }
});
it('does not exempt metadata.path or nested caller-controlled path properties from URL privacy', async () => {
  const f = await fixture();
  try {
    const path = join(f.directory, 'source.txt');
    await writeFile(path, 'source');
    const description = await describeTarget({ type: 'path', path }, {}, f.t.inspectedOn);
    const value = manifest(f, description);
    value.metadata = {
      path: 'https://alice:secret@example.com/app?token=CANARY_METADATA',
      nested: { path: "https://alice:secret@example.com/app?name=o'brien&sig=CANARY_NESTED" },
    };
    const { saved, reloaded, bytes } = await roundTrip(f, value);
    expect(saved.metadata['path']).toBe('https://example.com/app');
    expect(reloaded.metadata).toEqual(saved.metadata);
    for (const canary of ['alice', 'secret', 'CANARY_METADATA', 'CANARY_NESTED']) {
      expect(JSON.stringify(saved)).not.toContain(canary);
      expect(JSON.stringify(reloaded)).not.toContain(canary);
      expect(bytes.includes(Buffer.from(canary))).toBe(false);
    }
  } finally {
    await cleanup(f.directory, f.store);
  }
});
