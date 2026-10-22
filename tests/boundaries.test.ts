import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { checkBoundaries, checkManifest, checkSource } from '../scripts/check-boundaries.ts';

it('checks actual package manifests and imports', async () => {
  expect(await checkBoundaries()).toEqual([]);
});
it('rejects invalid workspace edges and third-party coupling', () => {
  expect(checkManifest('contracts', { name: '@phoenix/contracts', dependencies: { zod: '4.6.7' } })).toEqual(
    [],
  );
  for (const manifest of [
    { name: '@phoenix/contracts', dependencies: { '@phoenix/core': 'workspace:*' } },
    { name: '@phoenix/contracts', dependencies: { hono: '4' } },
    { name: 'wrong', optionalDependencies: { sqlite3: '1' } },
    { name: '@phoenix/contracts', devDependencies: { '@phoenix/core': 'workspace:*' } },
  ])
    expect(checkManifest('contracts', manifest).length).toBeGreaterThan(0);
  expect(
    checkManifest('cli', { name: '@phoenix/cli', dependencies: { '@phoenix/core': '1' } }).length,
  ).toBeGreaterThan(0);
  expect(checkManifest('new', { name: '@phoenix/new' }).length).toBeGreaterThan(0);
});
it('rejects forbidden imports, reexports, dynamic imports, require, undeclared deps and package escapes', () => {
  const file = 'packages/contracts/src/index.ts';
  for (const source of [
    "import fs from 'node:fs';",
    "import fs from 'fs';",
    "export * from '@phoenix/core';",
    "const fs = await import('node:fs');",
    "const fs = require('node:fs');",
    "import x from '../../core/src/index.js';",
    'const x = import(variable);',
    "const fs = process.getBuiltinModule('node:fs');",
    "const fs = globalThis.process.getBuiltinModule('node:fs');",
    'process.getBuiltinModule(variable);',
    "fetch('https://example.com');",
    "globalThis.fetch('https://example.com');",
    "import x from 'hono';",
  ])
    expect(checkSource('contracts', file, source, { zod: '4.6.7' }).length).toBeGreaterThan(0);
  expect(
    checkSource('contracts', file, "import type { Readable } from 'node:stream'; import { z } from 'zod';", {
      zod: '4.6.7',
    }),
  ).toEqual([]);
  expect(
    checkSource('cli', 'packages/cli/src/main.ts', "import x from '@phoenix/evidence';", {
      '@phoenix/evidence': 'workspace:*',
    }).length,
  ).toBeGreaterThan(0);
  expect(
    checkSource('cli', 'packages/cli/src/main.ts', "import x from '@phoenix/core/internal';", {
      '@phoenix/core': 'workspace:*',
    }).length,
  ).toBeGreaterThan(0);
  expect(
    checkSource(
      'core',
      'packages/core/src/index.ts',
      "import { spawn } from 'node:child_process'; import { DatabaseSync } from 'node:sqlite';",
    ).length,
  ).toBeGreaterThan(0);
});

it('checks built-in process acquisition in core and TypeScript module extensions', () => {
  expect(
    checkSource('core', 'packages/core/src/index.ts', "process.getBuiltinModule('node:child_process');")
      .length,
  ).toBeGreaterThan(0);
  for (const extension of ['ts', 'mts', 'cts'])
    expect(
      checkSource(
        'contracts',
        `packages/contracts/src/bad.${extension}`,
        "process.getBuiltinModule('node:fs');",
      ).length,
    ).toBeGreaterThan(0);
});
it('scans actual .mts and .cts source files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phoenix-boundaries-'));
  try {
    await mkdir(join(root, 'packages/contracts/src'), { recursive: true });
    await writeFile(
      join(root, 'packages/contracts/package.json'),
      JSON.stringify({ name: '@phoenix/contracts' }),
    );
    for (const ext of ['mts', 'cts'])
      await writeFile(
        join(root, `packages/contracts/src/bad.${ext}`),
        "process.getBuiltinModule('node:fs');",
      );
    const errors = await checkBoundaries(root);
    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toContain('bad.mts');
    expect(errors.join('\n')).toContain('bad.cts');
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  }
});
