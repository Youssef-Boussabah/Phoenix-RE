import { TargetManifest, PhoenixError } from '@phoenix/contracts';
import { input } from './shared.js';
const REDACTED = '[URL_REDACTED]';
function identity(text: string): string {
  try {
    // These fields assert an HTTP(S) identity, unlike source-derived free text.
    if (/[\u0000-\u0020\u007f]/.test(text)) throw new Error();
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
    return url.origin + url.pathname;
  } catch {
    throw new PhoenixError('INVALID_REQUEST', 'Invalid target URL identity');
  }
}
function redactText(text: string): string {
  const pieces: string[] = [],
    schemes = /https?:/gi;
  let cursor = 0,
    lastUnsafe = -1;
  for (const match of text.matchAll(/["'<>\u0000-\u001f\u007f]|[^\S ]/gu)) lastUnsafe = match.index;
  const lastAccess = Math.max(text.lastIndexOf('?'), text.lastIndexOf('#'), text.lastIndexOf('@'));
  for (;;) {
    const match = schemes.exec(text);
    if (!match) {
      pieces.push(text.slice(cursor));
      return pieces.join('');
    }
    const start = match.index;
    pieces.push(text.slice(cursor, start));
    // Scan delimiter ambiguity once for the whole field, not once per URL.
    if (lastUnsafe >= start) {
      pieces.push(REDACTED);
      return pieces.join('');
    }
    const space = text.indexOf(' ', start),
      end = space < 0 ? text.length : space;
    try {
      const url = new URL(text.slice(start, end));
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
      pieces.push(url.origin + url.pathname);
      // Access syntax makes the *entire* remaining suffix access context.
      if (lastAccess >= start || space < 0) return pieces.join('');
      cursor = end;
      schemes.lastIndex = end;
    } catch {
      pieces.push(REDACTED);
      return pieces.join('');
    }
  }
}
function sanitize(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value !== null && typeof value === 'object') {
    const entries: [string, unknown][] = [],
      keys = new Set<string>();
    for (const [key, v] of Object.entries(value)) {
      const base = redactText(key);
      let safeKey = base,
        suffix = 2;
      while (keys.has(safeKey)) safeKey = `${base}[${String(suffix++)}]`;
      keys.add(safeKey);
      entries.push([safeKey, sanitize(v)]);
    }
    return Object.fromEntries(entries);
  }
  return value;
}
export function privateManifest(value: unknown): TargetManifest {
  // Zod's URL parser may normalize away tabs/newlines. Validate raw authoritative
  // strings first so schema normalization cannot conceal an invalid access URL.
  try {
    if (value !== null && typeof value === 'object') {
      for (const key of ['url', 'uri'] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined) continue;
        if (!('value' in descriptor)) throw new Error();
        const raw: unknown = descriptor.value;
        if (typeof raw === 'string' && (key === 'url' || /^https?:/i.test(raw))) identity(raw);
      }
    }
  } catch {
    throw new PhoenixError('INVALID_REQUEST', 'Invalid target URL identity');
  }
  const original = input(TargetManifest, value);
  // Filesystem paths are source identity, not access URLs or sampled source text.
  const { url, uri, localPath, ...content } = original;
  const sanitized = sanitize(content) as typeof content;
  // Restore only contract-defined filesystem paths before validating the result.
  // Arbitrary metadata.path and sibling messages/descriptions stay sanitized.
  for (const [source, redacted] of [
    [original.warnings, sanitized.warnings],
    [original.classification.signals, sanitized.classification.signals],
  ] as const) {
    for (const [index, item] of redacted.entries()) {
      const path = source[index]?.path;
      if (path !== undefined) item.path = path;
    }
  }
  if (sanitized.inventory !== undefined && original.inventory !== undefined)
    sanitized.inventory.excluded = [...original.inventory.excluded];
  const safe = input(TargetManifest, {
    ...sanitized,
    ...(url === undefined ? {} : { url: identity(url) }),
    uri: /^https?:/i.test(uri) ? identity(uri) : uri,
    ...(localPath === undefined ? {} : { localPath }),
  });
  if (safe.source.type === 'url') {
    safe.source.displayName = safe.url ?? '';
    if (safe.localPath !== undefined || safe.supersedes !== undefined)
      throw new PhoenixError(
        'INVALID_REQUEST',
        'URL targets cannot carry local source identity or supersession',
      );
  }
  if (JSON.stringify(original) !== JSON.stringify(safe))
    safe.warnings.push({
      code: 'URL_ACCESS_CONTEXT_REMOVED',
      message:
        'URL identities retain only origin and path; ambiguous source text is redacted. This is not an equivalent retrievable source.',
    });
  return safe;
}
