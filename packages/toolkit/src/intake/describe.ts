import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { HostInfo, IntakeOptions, IntakeSource, PhoenixError, TargetDescription } from '@phoenix/contracts';
import { classifyFile } from './classify-file.js';
import { inspectInventory } from './inventory.js';
import { classifyDirectory } from './classify-dir.js';
import { hostCompatibility } from './compatibility.js';
import { CLASSIFIER_VERSION } from './classify-file.js';
import { checkAbort, unreadable } from '../internal.js';
import { nfc } from '../platform/paths.js';
import { targetIdentityUrl } from './url.js';

// Input defaults differ from the parsed IntakeOptions type, so callers may pass {}.
type IntakeOptionsInput = Partial<IntakeOptions>;
function isUrlSource(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'url';
}
export async function describeTarget(
  source: IntakeSource,
  options: IntakeOptionsInput,
  host: HostInfo,
  signal?: AbortSignal,
): Promise<TargetDescription> {
  checkAbort(signal);
  const parsedSource = IntakeSource.safeParse(source),
    parsedOptions = IntakeOptions.safeParse(options),
    parsedHost = HostInfo.safeParse(host);
  if (!parsedSource.success && isUrlSource(source))
    throw new PhoenixError(
      'NOT_SUPPORTED',
      'Use an HTTP(S) URL, or clone/download locally and inspect the directory',
    );
  if (!parsedSource.success || !parsedOptions.success || !parsedHost.success)
    throw new PhoenixError('INVALID_REQUEST', 'Invalid intake source, options or host');
  const common = {
    schemaVersion: 1 as const,
    inspectedAt: new Date().toISOString(),
    inspectedOn: parsedHost.data,
  };
  if (parsedSource.data.type === 'url') {
    const identity = targetIdentityUrl(parsedSource.data.url);
    return TargetDescription.parse({
      ...common,
      source: { type: 'url', displayName: identity.url },
      url: identity.url,
      classification: {
        kind: 'web',
        format: 'url',
        signals: [{ basis: 'url-scheme', description: 'HTTP(S) URL recognized without a network request' }],
        classifierVersion: CLASSIFIER_VERSION,
      },
      kind: 'web',
      compatibility: hostCompatibility(undefined, host, 'web'),
      warnings: [
        { code: 'URL_NOT_FETCHED', message: 'URL content not fetched or inspected' },
        ...(identity.removedAccessContext
          ? [
              {
                code: 'URL_ACCESS_CONTEXT_REMOVED',
                message:
                  'Identity URL only: userinfo, query and fragment removed. It is not an equivalent retrievable source; any future fetch must obtain protected access context separately.',
              },
            ]
          : []),
      ],
    });
  }
  try {
    nfc(parsedSource.data.path); // Node must not substitute a lone surrogate with U+FFFD.
    const localPath = path.resolve(parsedSource.data.path),
      stat = await lstat(localPath);
    if (stat.isSymbolicLink())
      throw new PhoenixError('TARGET_UNREADABLE', 'Target symlink or junction is not followed');
    if (stat.isFile()) {
      const file = await classifyFile(localPath, signal);
      return TargetDescription.parse({
        ...common,
        source: { type: 'file', displayName: path.basename(localPath) },
        localPath,
        classification: file.classification,
        kind: file.kind,
        ...(file.platform === undefined ? {} : { platform: file.platform }),
        ...(file.details === undefined ? {} : { formatDetails: file.details }),
        digest: { algorithm: 'sha256', value: file.sha256 },
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        compatibility: hostCompatibility(file.platform, host, file.kind, file.structuralStatus),
        warnings: file.warnings,
      });
    }
    if (!stat.isDirectory())
      throw new PhoenixError('TARGET_UNREADABLE', 'Target must be a regular file or directory');
    const { tree, files, packages, warnings } = await inspectInventory(localPath, parsedOptions.data, signal);
    const classified = classifyDirectory(tree.entries, files, packages);
    const formats: Record<string, number> = {};
    for (const f of files.values()) formats[f.format] = (formats[f.format] ?? 0) + 1;
    return TargetDescription.parse({
      ...common,
      source: { type: 'directory', displayName: path.basename(localPath) || localPath },
      localPath,
      classification: classified.classification,
      ...(classified.platform === undefined ? {} : { platform: classified.platform }),
      kind: classified.classification.kind,
      ...(tree.digest === undefined ? {} : { digest: { algorithm: tree.algorithm, value: tree.digest } }),
      sizeBytes: tree.totalBytes,
      inventory: {
        fileCount: tree.entries.filter((e) => e.type === 'file').length,
        directoryCount: tree.entries.filter((e) => e.type === 'directory').length,
        symlinkCount: tree.entries.filter((e) => e.type === 'symlink').length,
        otherCount: tree.entries.filter((e) => e.type === 'other').length,
        totalBytes: tree.totalBytes,
        truncated: tree.truncated,
        excluded: tree.excluded,
        formats,
      },
      compatibility: hostCompatibility(
        classified.platform,
        host,
        classified.classification.kind,
        tree.truncated ? 'incomplete' : classified.structuralStatus,
      ),
      warnings: [...tree.warnings, ...warnings],
    });
  } catch (error) {
    throw unreadable(error);
  }
}
