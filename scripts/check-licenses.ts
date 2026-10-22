import { readdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

export interface LicenseManifest {
  name: string;
  version: string;
  license?: string;
}
// This inventory is an engineering gate, not a completed distribution/provenance review.
const accepted = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'MPL-2.0',
  'Python-2.0',
  '(MIT OR CC0-1.0)',
  '(MIT AND BSD-3-Clause)',
]);
export async function inspectLicenses(
  store = 'node_modules/.pnpm',
): Promise<{ count: number; counts: Record<string, number>; issues: string[] }> {
  const manifests = new Map<string, LicenseManifest>();
  const seen = new Set<string>();
  async function inspect(directory: string): Promise<void> {
    const resolved = await realpath(directory);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    const manifest = JSON.parse(await readFile(join(resolved, 'package.json'), 'utf8')) as LicenseManifest;
    manifests.set(`${manifest.name}@${manifest.version}`, manifest);
  }
  for (const slot of await readdir(store, { withFileTypes: true })) {
    if (!slot.isDirectory() || slot.name === 'node_modules') continue;
    const directory = join(store, slot.name, 'node_modules');
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.name.startsWith('@'))
        for (const scoped of await readdir(path)) await inspect(join(path, scoped));
      else await inspect(path);
    }
  }
  const counts: Record<string, number> = {};
  const issues: string[] = [];
  for (const [name, manifest] of manifests) {
    const license = manifest.license ?? 'UNKNOWN';
    counts[license] = (counts[license] ?? 0) + 1;
    if (!accepted.has(license)) {
      issues.push(`License review required: ${name}: ${license}`);
    }
  }

  return { count: manifests.size, counts, issues };
}
if (import.meta.main) {
  const result = await inspectLicenses();
  if (result.issues.length) {
    console.error(result.issues.join('\n'));
    process.exitCode = 1;
  }
  console.log(
    `Installed dependency metadata checked (${String(result.count)} packages): ${JSON.stringify(result.counts)}`,
  );
  console.log(
    'Platform-specific optional dependencies are checked on their CI host. Contributor and distribution review remains open (ADR-0006).',
  );
}
