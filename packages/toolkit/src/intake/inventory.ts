import type {
  FileFormat,
  IntakeOptions,
  TargetKind,
  TargetPlatform,
  TargetWarning,
} from '@phoenix/contracts';
import { hashDirectory } from '../hash/tree.js';
import { classifyFileSource } from './classify-file.js';
import { parseDataJson } from '../formats/data-json.js';
import { decodeUtf8, FormatFault, requireFormat } from '../formats/reader.js';
import type { StructuralStatus } from '../formats/reader.js';
import { comparePaths } from '../platform/paths.js';

export interface InventoryFile {
  structuralStatus: StructuralStatus;
  kind: TargetKind;
  format: FileFormat;
  platform?: TargetPlatform;
}
/** Composition over the WP2 walker: parsing and hashing share its verified read-only handle. */
export async function inspectInventory(root: string, options: IntakeOptions, signal?: AbortSignal) {
  const files = new Map<string, InventoryFile>();
  const packages = new Set<string>();
  const warnings: TargetWarning[] = [];
  let omitted = 0;
  const compareWarnings = (a: TargetWarning, b: TargetWarning): number =>
    comparePaths(a.path ?? '', b.path ?? '') ||
    comparePaths(a.code, b.code) ||
    comparePaths(a.message, b.message);
  const addWarning = (w: TargetWarning): void => {
    // Retain the same bounded subset regardless of filesystem enumeration order.
    if (warnings.length === 127) omitted++;
    let low = 0,
      high = warnings.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const existing = warnings[mid];
      if (existing !== undefined && compareWarnings(existing, w) <= 0) low = mid + 1;
      else high = mid;
    }
    if (low < 127) warnings.splice(low, 0, w);
    if (warnings.length > 127) warnings.pop();
  };
  const tree = await hashDirectory(root, {
    exclude: options.exclude,
    maxEntries: options.maxEntries,
    maxTotalBytes: options.maxTotalBytes,
    ...(signal === undefined ? {} : { signal }),
    inspectFile: async (file, relative) => {
      const parsed = await classifyFileSource(file, relative, signal);
      files.set(relative, {
        structuralStatus: parsed.structuralStatus,
        kind: parsed.kind,
        format: parsed.format,
        ...(parsed.platform === undefined ? {} : { platform: parsed.platform }),
      });
      for (const w of parsed.warnings) addWarning({ ...w, path: relative });
      if (relative === 'package.json' || relative.endsWith('/package.json')) {
        try {
          if (file.sizeBytes > 1_048_576) {
            addWarning({
              code: 'CONFIG_LIMIT',
              message: 'package.json exceeds 1 MiB; not parsed',
              path: relative,
            });
            return;
          }
          const value = parseDataJson(decodeUtf8(await file.readRange(0, file.sizeBytes, signal)));
          requireFormat(
            typeof value === 'object' && value !== null && !Array.isArray(value),
            'Package config requires a JSON object',
          );
          packages.add(relative);
        } catch (error) {
          // I/O/mutation/cancellation errors must retain their meaning.
          if (!(error instanceof FormatFault)) throw error;
          addWarning({
            code: 'INVALID_CONFIG',
            message: 'package.json is not a bounded JSON object; scripts were not evaluated',
            path: relative,
          });
        }
      }
    },
  });
  for (const entry of tree.entries) {
    const format = files.get(entry.path)?.format;
    if (entry.type === 'file' && format !== undefined) entry.format = format;
  }
  if (omitted > 0)
    warnings.push({
      code: 'WARNINGS_TRUNCATED',
      message: `${String(omitted)} further file warnings omitted`,
    });
  return { tree, files, packages, warnings };
}
