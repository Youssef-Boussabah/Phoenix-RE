import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { contractSchemas, jsonSchemaFor } from '@phoenix/contracts';

export async function syncSnapshots(
  directory: URL,
  check: boolean,
  schemas = contractSchemas,
): Promise<{ count: number; issues: string[] }> {
  await mkdir(directory, { recursive: true });
  const expectedNames = new Set<string>();
  const issues: string[] = [];
  for (const [name, schema] of Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const filename = `${name}.schema.json`;
    expectedNames.add(filename);
    const text = JSON.stringify(jsonSchemaFor(name, schema), null, 2) + '\n';
    const path = new URL(filename, directory);
    if (check) {
      let actual: string | undefined;
      try {
        actual = await readFile(path, 'utf8');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      if (actual !== text) issues.push(`Schema snapshot differs: ${filename}`);
    } else await writeFile(path, text);
  }
  for (const filename of await readdir(directory))
    if (filename.endsWith('.schema.json') && !expectedNames.has(filename))
      issues.push(`Stale snapshot, remove deliberately: ${filename}`);
  return { count: expectedNames.size, issues };
}
if (import.meta.main) {
  const check = process.argv.includes('--check');
  const result = await syncSnapshots(new URL('../packages/contracts/schemas/', import.meta.url), check);
  if (result.issues.length) {
    console.error(result.issues.join('\n'));
    process.exitCode = 1;
  } else console.log(`${String(result.count)} JSON Schema snapshots ${check ? 'verified' : 'written'}.`);
}
