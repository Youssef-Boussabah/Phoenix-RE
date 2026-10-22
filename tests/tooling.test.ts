import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { TargetId } from '@phoenix/contracts';
import { inspectLicenses } from '../scripts/check-licenses.ts';
import { syncSnapshots } from '../scripts/contracts-snapshot.ts';

it('snapshot verification rejects missing, changed and stale files without accepting regeneration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'phoenix-snapshot-test-'));
  try {
    const url = pathToFileURL(dir + '/');
    const schemas = { TargetId };
    expect((await syncSnapshots(url, true, schemas)).issues).toHaveLength(1);
    await expect(readFile(join(dir, 'TargetId.schema.json'))).rejects.toThrow();
    expect((await syncSnapshots(url, false, schemas)).issues).toEqual([]);
    expect((await syncSnapshots(url, true, schemas)).issues).toEqual([]);
    await writeFile(join(dir, 'TargetId.schema.json'), '{}\n');
    expect((await syncSnapshots(url, true, schemas)).issues).toHaveLength(1);
    await writeFile(join(dir, 'Stale.schema.json'), '{}\n');
    expect((await syncSnapshots(url, true, schemas)).issues).toHaveLength(2);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
it('license inventory rejects unknown and missing licenses and malformed package metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'phoenix-license-test-'));
  try {
    const manifestPath = join(dir, 'test@1', 'node_modules', 'test', 'package.json');
    await mkdir(join(dir, 'test@1', 'node_modules', 'test'), { recursive: true });
    const write = async (license?: string) =>
      writeFile(
        manifestPath,
        JSON.stringify({ name: 'test', version: '1.0.0', ...(license === undefined ? {} : { license }) }),
      );
    await write('MIT');
    expect((await inspectLicenses(dir)).issues).toEqual([]);
    await write('UNREVIEWED');
    expect((await inspectLicenses(dir)).issues[0]).toContain('UNREVIEWED');
    await write();
    expect((await inspectLicenses(dir)).issues[0]).toContain('UNKNOWN');
    await writeFile(manifestPath, '{bad json');
    await expect(inspectLicenses(dir)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
