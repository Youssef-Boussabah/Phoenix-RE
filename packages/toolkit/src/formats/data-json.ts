import { FormatFault, requireFormat } from './reader.js';

/** Callers bound raw text size first. Scan depth without recursion before JSON.parse. */
export function parseDataJson(text: string, maxDepth = 64): unknown {
  let quoted = false,
    escaped = false,
    depth = 0;
  for (const ch of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '{' || ch === '[')
      requireFormat(++depth <= maxDepth, 'JSON nesting exceeds limit', 'FORMAT_LIMIT');
    else if (ch === '}' || ch === ']') depth--;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new FormatFault('MALFORMED_FORMAT', 'Invalid JSON structure');
    throw error;
  }
}
