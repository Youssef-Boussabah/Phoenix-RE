import path from 'node:path';
import { decodeUtf8, FormatFault, FORMAT_LIMITS, warning } from './reader.js';
import type { FormatInspection } from './reader.js';

const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
  '.cs',
  '.sh',
  '.rb',
  '.swift',
  '.kt',
  '.php',
  '.css',
  '.scss',
  '.vue',
  '.svelte',
]);
function isHtml(text: string): boolean {
  let offset = 0;
  while (offset < text.length) {
    while (/\s/.test(text.charAt(offset))) offset++;
    if (!text.startsWith('<!--', offset)) break;
    const end = text.indexOf('-->', offset + 4);
    if (end < 0) return false;
    offset = end + 3;
  }
  return /^(?:<!doctype\s+html\b|<(?:html|head)\b)/i.test(text.slice(offset));
}
export function parseText(head: Buffer, size: number, name: string, result: FormatInspection): void {
  const sample = head.subarray(0, FORMAT_LIMITS.textBytes);
  if (sample.includes(0)) return;
  let text: string;
  try {
    text = decodeUtf8(sample, { stream: sample.length < size });
  } catch (error) {
    if (!(error instanceof FormatFault)) throw error;
    return;
  }
  // Reject binary controls, while retaining normal source whitespace and Unicode.
  if (/[\x01-\x08\x0b\x0e-\x1f\x7f]/.test(text)) return;
  const bom = sample.subarray(0, 3).equals(Buffer.from([239, 187, 191]));
  const shebang = text.startsWith('#!') ? text.split(/[\r\n]/, 1)[0]?.slice(0, 1024) : undefined;
  result.format = isHtml(text) ? 'html' : 'text';
  result.kind =
    result.format === 'html'
      ? 'web'
      : shebang !== undefined || SOURCE_EXTENSIONS.has(path.extname(name).toLowerCase())
        ? 'source'
        : 'unknown';
  result.details = {
    format: 'text',
    encoding: bom ? 'utf-8-bom' : sample.every((b) => b < 128) ? 'ascii' : 'utf-8',
    ...(shebang === undefined ? {} : { shebang }),
  };
  if (size > sample.length) warning(result, 'TEXT_SAMPLE', 'Text recognition covers the first 8 KiB only');
}
