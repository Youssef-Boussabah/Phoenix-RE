import type {
  ClassificationSignal,
  InventoryEntry,
  TargetClassification,
  TargetKind,
  TargetPlatform,
} from '@phoenix/contracts';
import type { InventoryFile } from './inventory.js';
import { CLASSIFIER_VERSION } from './classify-file.js';
import { comparePaths } from '../platform/paths.js';
import type { StructuralStatus } from '../formats/reader.js';

const ECOSYSTEMS: Readonly<Record<string, string>> = {
  'package.json': 'Node.js',
  'pyproject.toml': 'Python',
  'setup.py': 'Python',
  'Cargo.toml': 'Rust',
  'go.mod': 'Go',
  'pom.xml': 'Java',
  'build.gradle': 'Java/JVM',
  'build.gradle.kts': 'Java/JVM',
  'CMakeLists.txt': 'C/C++',
  Makefile: 'C/C++ or make project',
};
export function classifyDirectory(
  entries: readonly InventoryEntry[],
  files: ReadonlyMap<string, InventoryFile>,
  packages: ReadonlySet<string>,
): { classification: TargetClassification; platform?: TargetPlatform; structuralStatus: StructuralStatus } {
  const paths = new Set(
    entries.filter((e) => e.type === 'file' || e.type === 'directory').map((e) => e.path),
  );
  const signals: ClassificationSignal[] = [];
  const result = (kind: TargetKind, file?: InventoryFile) => ({
    classification: { kind, format: 'directory' as const, signals, classifierVersion: CLASSIFIER_VERSION },
    ...(file?.platform === undefined ? {} : { platform: file.platform }),
    structuralStatus: file?.structuralStatus ?? ('incomplete' as const),
  });
  const native = (prefix: string): InventoryFile | undefined =>
    [...files]
      .sort(
        ([a, fa], [b, fb]) =>
          Number(fb.platform?.binaryType === 'executable') -
            Number(fa.platform?.binaryType === 'executable') || comparePaths(a, b),
      )
      .find(
        ([p, f]) =>
          p.startsWith(prefix) &&
          !p.slice(prefix.length).includes('/') &&
          ['elf', 'pe', 'macho', 'macho-fat'].includes(f.format),
      )?.[1];
  const info = entries.find(
    (e) => e.type === 'file' && /^(?:[^/]+\.app\/)?Contents\/Info\.plist$/.test(e.path),
  );
  if (info !== undefined) {
    const prefix = info.path.slice(0, -'Contents/Info.plist'.length);
    signals.push({
      basis: 'structure',
      path: info.path,
      description: 'macOS application bundle layout; plist not executed',
    });
    const electron =
      files.get(prefix + 'Contents/Resources/app.asar')?.format === 'asar' ||
      paths.has(prefix + 'Contents/Frameworks/Electron Framework.framework');
    const platform = native(prefix + 'Contents/MacOS/');
    return result(electron ? 'electron' : 'macho', platform);
  }
  const electron = [...files.keys()]
    .sort(comparePaths)
    .find(
      (p) =>
        (/^(?:[^/]+\/)?resources\/app\.asar$/.test(p) && files.get(p)?.format === 'asar') ||
        (/^(?:[^/]+\/)?resources\/app\/package\.json$/.test(p) && packages.has(p)),
    );
  if (electron !== undefined) {
    signals.push({
      basis: 'structure',
      path: electron,
      description: 'Electron resources contain a validated ASAR or package manifest',
    });
    const prefix = electron.slice(0, electron.indexOf('resources/'));
    return result('electron', native(prefix));
  }
  for (const entry of entries) {
    if (entry.path.includes('/')) continue;
    const ecosystem =
      entry.type === 'file'
        ? (ECOSYSTEMS[entry.path] ?? (/\.(?:sln|csproj)$/.test(entry.path) ? '.NET source' : undefined))
        : entry.type === 'directory' && entry.path === '.git'
          ? 'Git source repository'
          : undefined;
    if (ecosystem !== undefined)
      signals.push({
        basis: 'structure',
        path: entry.path,
        description: `${ecosystem} project marker; configuration treated as data`,
      });
  }
  if (signals.length > 0) return result('source');
  if (files.get('index.html')?.format === 'html') {
    signals.push({
      basis: 'structure',
      path: 'index.html',
      description: 'Root HTML document identifies a static website',
    });
    return result('web');
  }
  signals.push({
    basis: 'heuristic',
    description: 'No supported application or source layout found in the included inventory',
  });
  return result('unknown');
}
