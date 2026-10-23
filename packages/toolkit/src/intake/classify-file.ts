import path from 'node:path';
import { TargetClassification } from '@phoenix/contracts';
import type { FileFormat } from '@phoenix/contracts';
import type { FormatInspection, FormatSource } from '../formats/reader.js';
import { inspectFormat } from '../formats/inspect.js';
import { FORMAT_LIMITS } from '../formats/reader.js';
import { openRegularFile } from '../fs/safe-read.js';
import { hashStream } from '../hash/sha256.js';
import { nfc } from '../platform/paths.js';

export const CLASSIFIER_VERSION = '1.0.1-wp3';
export interface FileClassification extends FormatInspection {
  classification: TargetClassification;
}
const EXTENSIONS: Readonly<Record<string, readonly FileFormat[]>> = {
  '.elf': ['elf'],
  '.exe': ['pe'],
  '.dll': ['pe'],
  '.so': ['elf'],
  '.dylib': ['macho', 'macho-fat'],
  '.macho': ['macho', 'macho-fat'],
  '.o': ['elf', 'macho'],
  '.wasm': ['wasm'],
  '.dex': ['dex'],
  '.class': ['java-class'],
  '.zip': ['zip', 'jar', 'apk'],
  '.jar': ['jar'],
  '.apk': ['apk'],
  '.asar': ['asar'],
  '.html': ['html'],
  '.htm': ['html'],
  '.png': ['unknown'],
  '.jpg': ['unknown'],
  '.pdf': ['unknown'],
};
export async function classifyFileSource(
  source: FormatSource,
  name: string,
  signal?: AbortSignal,
): Promise<FileClassification> {
  const parsed = await inspectFormat(source, name, signal);
  const extension = path.extname(name).toLowerCase(),
    expected = EXTENSIONS[extension];
  const extensionWarnings =
    expected !== undefined && !expected.includes(parsed.format)
      ? [
          {
            code: 'EXTENSION_MISMATCH',
            message: `Extension ${extension} disagrees with byte/structure classification ${parsed.format}`,
          },
        ]
      : [];
  // Fatal diagnostics and extension mismatch survive a full parser warning buffer.
  const priority = (code: string): number =>
    ['MALFORMED_FORMAT', 'DOS_STUB_ONLY', 'FORMAT_LIMIT', 'UNSUPPORTED_VARIANT'].includes(code)
      ? 0
      : code === 'EXTENSION_MISMATCH'
        ? 1
        : 2;
  parsed.warnings = [...parsed.warnings, ...extensionWarnings]
    .sort((a, b) => priority(a.code) - priority(b.code))
    .slice(0, FORMAT_LIMITS.warnings);
  const text = parsed.format === 'text' || parsed.format === 'html';
  const classification = TargetClassification.parse({
    kind: parsed.kind,
    format: parsed.format,
    classifierVersion: CLASSIFIER_VERSION,
    signals: [
      {
        basis: text || parsed.format === 'unknown' || parsed.format === 'empty' ? 'heuristic' : 'signature',
        description: text
          ? 'UTF-8 prefix and text structure inspected'
          : parsed.format === 'unknown'
            ? 'No supported byte signature or text structure'
            : parsed.format === 'empty'
              ? 'Zero-byte file'
              : `Byte signature identifies ${parsed.format}`,
      },
      ...(parsed.details === undefined || parsed.structuralStatus !== 'validated'
        ? []
        : [
            {
              basis: 'structure',
              description: `${parsed.details.format} metadata parsed within bounded reads`,
            },
          ]),
      ...(parsed.format === 'text' && parsed.kind === 'source'
        ? [
            {
              basis:
                parsed.details?.format === 'text' && parsed.details.shebang !== undefined
                  ? 'heuristic'
                  : 'extension',
              description: 'Text has a shebang or recognized source extension',
            },
          ]
        : []),
    ],
  });
  return { ...parsed, classification };
}
export async function classifyFile(
  file: string,
  signal?: AbortSignal,
): Promise<FileClassification & { sha256: string; sizeBytes: number }> {
  nfc(file); // Validate Unicode without rewriting a native NFD filename.
  const opened = await openRegularFile(file);
  try {
    const parsed = await classifyFileSource(opened, path.basename(file), signal);
    const hash = await hashStream(opened.stream(signal), signal === undefined ? {} : { signal });
    return { ...parsed, ...hash };
  } finally {
    await opened.close();
  }
}
