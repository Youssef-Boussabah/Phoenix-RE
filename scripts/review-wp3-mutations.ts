/** Focused semantic mutations in a disposable copy; never edits the working tree or regenerates snapshots. */
import { cp, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const once = (text: string, before: string, after: string): string => {
  if (!text.includes(before)) throw Error('Mutation anchor missing: ' + before);
  return text.replace(before, after);
};
const mutations = [
  {
    name: 'PIE misclassified',
    file: 'formats/elf.ts',
    change: (s: string) =>
      once(
        s,
        "if (type === 3) result.platform.binaryType = 'executable';",
        "if (type === 3) result.platform.binaryType = 'unknown';",
      ),
  },
  {
    name: 'structural compatibility guard removed',
    file: 'intake/compatibility.ts',
    change: (s: string) => once(s, "if (structuralStatus !== 'validated')", 'if (false)'),
  },
  {
    name: 'assumed OS guard removed',
    file: 'intake/compatibility.ts',
    change: (s: string) => once(s, "if (platform.osBasis === 'assumed')", 'if (false)'),
  },
  {
    name: 'false structural success signal',
    file: 'intake/classify-file.ts',
    change: (s: string) =>
      once(
        s,
        "parsed.details === undefined || parsed.structuralStatus !== 'validated'",
        'parsed.details === undefined',
      ),
  },
  {
    name: 'ZIP sentinel validation bypass',
    file: 'formats/zip.ts',
    change: (s: string) => {
      const begin = s.indexOf('if (sentinelCount > 0) {'),
        end = s.indexOf('} else {', begin);
      if (begin < 0 || end < begin) throw Error('ZIP sentinel anchor missing');
      return s.slice(0, begin) + 'if (sentinelCount > 0) {\n    ' + s.slice(end);
    },
  },
  {
    name: 'ambiguous ZIP entries trusted',
    file: 'formats/zip.ts',
    change: (s: string) => {
      if (!s.includes('identityEligible &&')) throw Error('ZIP identity anchor missing');
      return s.replaceAll('identityEligible &&', '');
    },
  },
  {
    name: 'URL access context retained',
    file: 'intake/url.ts',
    change: (s: string) =>
      once(s, 'const identity = value.origin + value.pathname;', 'const identity = value.href;'),
  },
  {
    name: 'warning cap off by one',
    file: 'intake/classify-file.ts',
    change: (s: string) =>
      once(s, '.slice(0, FORMAT_LIMITS.warnings)', '.slice(0, FORMAT_LIMITS.warnings + 1)'),
  },
];
const root = process.cwd(),
  scratch = await mkdtemp(join(tmpdir(), 'phoenix-wp3-mutations-'));
const cli = await realpath(join(root, 'node_modules/vitest/vitest.mjs'));
const results: { name: string; failedTests: number; status: string }[] = [];
interface Summary {
  numPassedTests: number;
  numFailedTests: number;
}
try {
  for (const file of [
    'packages/contracts/src',
    'packages/toolkit/src',
    'packages/toolkit/test/wp3-hardening.test.ts',
    'packages/toolkit/test/support.ts',
    'tests/support/synth.ts',
    'tests/fixtures',
    'package.json',
    'tsconfig.base.json',
    'tsconfig.check.json',
    'vitest.config.ts',
  ])
    await cp(join(root, file), join(scratch, file), { recursive: true });
  await symlink(join(root, 'node_modules'), join(scratch, 'node_modules'), 'junction');
  await mkdir(join(scratch, 'packages/contracts/node_modules'), { recursive: true });
  await symlink(
    await realpath(join(root, 'packages/contracts/node_modules/zod')),
    join(scratch, 'packages/contracts/node_modules/zod'),
    'junction',
  );
  const run = async (): Promise<{ code: number | null; summary: Summary }> => {
    const output = join(scratch, 'results.json');
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'run',
        '--project',
        'unit',
        'packages/toolkit/test/wp3-hardening.test.ts',
        '--reporter=json',
        '--outputFile=' + output,
      ],
      { cwd: scratch, encoding: 'utf8', timeout: 60_000 },
    );
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0 && result.status !== 1)
      throw Error('Invalid mutation test exit: ' + String(result.status));
    return { code: result.status, summary: JSON.parse(await readFile(output, 'utf8')) as Summary };
  };
  const baseline = await run();
  const count = baseline.summary.numPassedTests;
  if (baseline.code !== 0 || baseline.summary.numFailedTests !== 0 || count < 150)
    throw Error('Mutation baseline is not green');
  const apply = async (name: string, file: string, change: (s: string) => string): Promise<void> => {
    const target = join(scratch, 'packages/toolkit/src', file),
      original = await readFile(target, 'utf8');
    try {
      const modified = change(original);
      if (modified === original) throw Error('Mutation made no change: ' + name);
      await writeFile(target, modified);
      const result = await run();
      if (result.summary.numPassedTests + result.summary.numFailedTests !== count)
        throw Error('Mutation did not execute the complete regression suite: ' + name);
      const detected = result.code === 1 && result.summary.numFailedTests > 0;
      results.push({
        name,
        status: detected ? 'detected' : 'SURVIVED',
        failedTests: result.summary.numFailedTests,
      });
      console.log(
        name +
          ': ' +
          (detected ? 'detected' : 'SURVIVED') +
          ' (' +
          String(result.summary.numFailedTests) +
          ' failing tests)',
      );
    } finally {
      await writeFile(target, original);
    }
  };
  console.log('Baseline: ' + String(count) + ' tests on ' + process.version);
  await apply('canary', 'intake/url.ts', (s) =>
    once(s, 'const identity = value.origin + value.pathname;', "const identity = 'https://canary.invalid/';"),
  );
  if (results[0]?.status !== 'detected') throw Error('Canary survived');
  for (const m of mutations) await apply(m.name, m.file, m.change);
  const output = resolve(process.argv[2] ?? join(tmpdir(), 'phoenix-wp3-mutations.json'));
  await writeFile(
    output,
    JSON.stringify({ node: process.version, baselineTests: count, results }, null, 2) + '\n',
  );
  console.log('Results: ' + output);
  if (results.some((r) => r.status !== 'detected')) process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true, maxRetries: 10 });
}
