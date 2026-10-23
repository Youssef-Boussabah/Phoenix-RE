import { checkAbort } from '../internal.js';
import { detectSignature } from './signature.js';
import { FORMAT_LIMITS, FormatFault, FormatReader, warning } from './reader.js';
import type { FormatInspection, FormatSource } from './reader.js';
import { parseElf } from './elf.js';
import { parsePe } from './pe.js';
import { parseMachO, parseFatMachO } from './macho.js';
import { parseWasm } from './wasm.js';
import { parseDex } from './dex.js';
import { parseJavaClass } from './javaclass.js';
import { parseZip } from './zip.js';
import { parseAsar } from './asar.js';
import { parseText } from './text.js';

/** Format faults become explicit partial results; I/O, mutation and cancellation errors propagate. */
export async function inspectFormat(
  source: FormatSource,
  name = '',
  signal?: AbortSignal,
): Promise<FormatInspection> {
  const reader = new FormatReader(source, signal),
    head = await reader.initialize();
  const signature = detectSignature(head, reader.size);
  const result: FormatInspection = {
    structuralStatus: 'incomplete',
    format: signature === 'dos' || signature === 'asar' ? 'unknown' : signature,
    kind:
      signature === 'elf' || signature === 'macho' || signature === 'wasm'
        ? signature
        : signature === 'macho-fat'
          ? 'macho'
          : signature === 'dex'
            ? 'android'
            : 'unknown',
    header: {},
    sections: [],
    warnings: [],
  };
  try {
    switch (signature) {
      case 'empty':
        warning(result, 'EMPTY_FILE', 'Empty file');
        break;
      case 'elf':
        await parseElf(reader, result);
        break;
      case 'dos':
        await parsePe(reader, result);
        break;
      case 'macho':
        await parseMachO(reader, result);
        break;
      case 'macho-fat':
        await parseFatMachO(reader, result);
        break;
      case 'wasm':
        await parseWasm(reader, result);
        break;
      case 'dex':
        await parseDex(reader, result);
        break;
      case 'java-class':
        await parseJavaClass(reader, result);
        break;
      case 'zip':
        await parseZip(reader, result);
        break;
      case 'asar':
        await parseAsar(reader, result);
        break;
      case 'unknown':
        parseText(head, reader.size, name, result);
        break;
    }
    if (
      result.format !== 'unknown' &&
      result.format !== 'macho-fat' &&
      !result.warnings.some((w) => ['FORMAT_LIMIT', 'UNSUPPORTED_VARIANT'].includes(w.code))
    )
      result.structuralStatus = 'validated';
  } catch (error) {
    if (!(error instanceof FormatFault)) throw error;
    result.structuralStatus =
      error.code === 'MALFORMED_FORMAT' || error.code === 'DOS_STUB_ONLY' ? 'invalid' : 'incomplete';
    // A full warning buffer must never hide the structural failure.
    result.warnings = [{ code: error.code, message: error.message }, ...result.warnings].slice(
      0,
      FORMAT_LIMITS.warnings,
    );
  }
  if (result.format === 'unknown' && result.warnings.length === 0)
    warning(result, 'UNKNOWN_FORMAT', 'No supported signature or text structure');
  checkAbort(signal);
  return result;
}
export function inspectBytes(bytes: Uint8Array, name = '', signal?: AbortSignal): Promise<FormatInspection> {
  return inspectFormat(
    {
      sizeBytes: bytes.byteLength,
      readRange: (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)),
    },
    name,
    signal,
  );
}
