import { cp, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

interface Mutation {
  name: string;
  file: string;
  change(source: string): string;
}
const once = (source: string, before: string, after: string): string => {
  if (!source.includes(before)) throw new Error(`Mutation anchor missing: ${before}`);
  return source.replace(before, after);
};
const removeMember = (source: string, name: string, member: string): string => {
  const start = source.indexOf(`export const ${name} = z.enum([`);
  const end = source.indexOf(']);', start) + 3;
  if (start < 0 || end < 3) throw new Error(`Enum mutation anchor missing: ${name}`);
  const part = source.slice(start, end);
  return (
    source.slice(0, start) +
    (part.includes(`'${member}',`) ? once(part, `'${member}',`, '') : once(part, `, '${member}'`, '')) +
    source.slice(end)
  );
};
const mutations: Mutation[] = [
  {
    name: '1 descriptor ID format',
    file: 'provider.ts',
    change: (s) =>
      once(
        s,
        'export const ProviderId = z.string().regex(/^[a-z][a-z0-9-]*(\\.[a-z0-9-]+)+$/);',
        'export const ProviderId = z.string();',
      ),
  },
  {
    name: '2 intake URL protocols',
    file: 'target.ts',
    change: (s) =>
      once(
        s,
        "z.strictObject({ type: z.literal('url'), url: HttpUrl })",
        "z.strictObject({ type: z.literal('url'), url: z.url() })",
      ),
  },
  {
    name: '3 job objective bounds',
    file: 'job.ts',
    change: (s) => once(s, 'objective: z.string().min(1).max(4000)', 'objective: z.string()'),
  },
  {
    name: '4 page limit bounds',
    file: 'engine.ts',
    change: (s) => once(s, 'limit: z.int().min(1).max(5000).default(100)', 'limit: z.int().default(100)'),
  },
  {
    name: '5 arbitrary tool target objects',
    file: 'engine.ts',
    change: (s) =>
      once(
        s,
        'target: z.union([z.strictObject({ targetId: TargetId }), z.strictObject({ path: z.string().min(1) })])',
        'target: z.object({}).passthrough()',
      ),
  },
  {
    name: '6 loose locator objects',
    file: 'evidence.ts',
    change: (s) => {
      const end = s.indexOf('// SOT §7.1');
      return s.slice(0, end).replaceAll('z.strictObject(', 'z.object(') + s.slice(end);
    },
  },
  {
    name: '7 remove cancelled step status',
    file: 'job.ts',
    change: (s) => removeMember(s, 'StepStatus', 'cancelled'),
  },
  {
    name: '8 remove android target kind',
    file: 'target.ts',
    change: (s) => removeMember(s, 'TargetKind', 'android'),
  },
  {
    name: '9 remove storage error code',
    file: 'errors.ts',
    change: (s) => removeMember(s, 'ErrorCode', 'STORAGE_ERROR'),
  },
  {
    name: '10 optional WSL flag',
    file: 'host.ts',
    change: (s) => once(s, 'isWsl: z.boolean()', 'isWsl: z.boolean().optional()'),
  },
  {
    name: '11 nonpositive step attempts',
    file: 'events.ts',
    change: (s) => once(s, 'attempt: z.int().positive()', 'attempt: z.int()'),
  },
];
const root = process.cwd();
const scratch = await mkdtemp(join(tmpdir(), 'phoenix-review-mutations-'));
const cli = await realpath(join(root, 'node_modules/vitest/vitest.mjs'));
const results: { name: string; status: string; failedTests: number }[] = [];
try {
  for (const path of [
    'packages/contracts/src',
    'packages/contracts/test',
    'package.json',
    'tsconfig.base.json',
    'tsconfig.check.json',
    'vitest.config.ts',
  ])
    await cp(join(root, path), join(scratch, path), { recursive: true });
  await symlink(join(root, 'node_modules'), join(scratch, 'node_modules'), 'junction');
  await mkdir(join(scratch, 'packages/contracts/node_modules'), { recursive: true });
  await symlink(
    await realpath(join(root, 'packages/contracts/node_modules/zod')),
    join(scratch, 'packages/contracts/node_modules/zod'),
    'junction',
  );
  const run = (label: string): { failedTests: number; code: number | null } => {
    const output = join(scratch, 'vitest-result.json');
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'run',
        '--project',
        'unit',
        'packages/contracts/test/review-mutations.test.ts',
        '--reporter=json',
        `--outputFile=${output}`,
      ],
      { cwd: scratch, encoding: 'utf8', timeout: 60_000 },
    );
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0 && result.status !== 1)
      throw new Error(`${label}: invalid test exit ${String(result.status)} ${result.stderr}`);
    return { failedTests: 0, code: result.status };
  };
  const summary = async (): Promise<{
    numFailedTests: number;
    numPassedTests: number;
    numFailedTestSuites: number;
  }> =>
    JSON.parse(await readFile(join(scratch, 'vitest-result.json'), 'utf8')) as {
      numFailedTests: number;
      numPassedTests: number;
      numFailedTestSuites: number;
    };
  run('baseline');
  const baseline = await summary();
  if (baseline.numFailedTests !== 0 || baseline.numPassedTests !== 12)
    throw new Error(`Mutation baseline is not green: ${JSON.stringify(baseline)}`);
  console.log(`Baseline: ${String(baseline.numPassedTests)} semantic tests passed on ${process.version}`);
  // A simple canary confirms the scratch tests execute the scratch source.
  const versionFile = join(scratch, 'packages/contracts/src/host.ts');
  const versionOriginal = await readFile(versionFile, 'utf8');
  await writeFile(versionFile, once(versionOriginal, 'isWsl: z.boolean()', 'isWsl: z.literal(false)'));
  run('canary');
  const canary = await summary();
  await writeFile(versionFile, versionOriginal);
  if (canary.numFailedTests === 0) throw new Error('Canary survived: scratch source is not under test');
  console.log('Canary detected.');
  for (const mutation of mutations) {
    const path = join(scratch, 'packages/contracts/src', mutation.file);
    const original = await readFile(path, 'utf8');
    try {
      const changed = mutation.change(original);
      if (changed === original) throw new Error(`Mutation made no change: ${mutation.name}`);
      await writeFile(path, changed);
      const runResult = run(mutation.name);
      const tested = await summary();
      if (tested.numPassedTests + tested.numFailedTests !== 12)
        throw new Error(`Mutation did not execute 12 semantic tests: ${mutation.name}`);
      const killed = runResult.code === 1 && tested.numFailedTests > 0;
      results.push({
        name: mutation.name,
        status: killed ? 'detected' : 'SURVIVED',
        failedTests: tested.numFailedTests,
      });
      console.log(
        `${mutation.name}: ${killed ? 'detected' : 'SURVIVED'} (${String(tested.numFailedTests)} failed assertions/tests)`,
      );
    } finally {
      await writeFile(path, original);
    }
  }
  const output = resolve(process.argv[2] ?? join(tmpdir(), 'phoenix-hardening-mutations.json'));
  await writeFile(
    output,
    JSON.stringify(
      { node: process.version, baselineTests: baseline.numPassedTests, canary: 'detected', results },
      null,
      2,
    ) + '\n',
  );
  console.log(`Results: ${output}`);
  if (results.some((r) => r.status !== 'detected')) process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true, maxRetries: 10 });
}
