import { homedir } from 'node:os';
import { stripVTControlCharacters } from 'node:util';
import { copyBoundedJson, normalizeError, sanitizeErrorMessage, PhoenixErrorShape } from '@phoenix/contracts';
import type { Logger } from '@phoenix/contracts';
import { safeInteger } from '../internal.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const levels: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const hidden = /[\x00-\x1f\x7f-\x9f\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
const invisible =
  /[\x00-\x1f\x7f-\x9f\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
const secretNames =
  /token|password|passwd|secret|authorization|cookie|api[_-]?key|payload|private[_-]?key|credentials?|passphrase/i;
const shortSecretNames = /(?:^|[_\s-])(?:auth|pwd)(?:$|[_\s-])/i;
const extraCredentials =
  /(\b(?:credentials?|passphrase|auth|pwd)\b["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi;
const omitted = '[omitted: invalid or excessive log field]';
const escapeControl = (char: string): string => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
function neutralize(value: string): string {
  return stripVTControlCharacters(value).replace(hidden, '');
}
function secretKey(key: string): boolean {
  const plain = neutralize(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  return secretNames.test(plain) || shortSecretNames.test(plain);
}
/** Compile once per logger; controls are removed for matching, then represented as bounded trailing markers. */
function createTextRedactor(privatePaths: readonly string[] = []): (value: string) => string {
  const patterns = [...new Set([homedir(), ...privatePaths.slice(0, 32)])]
    .filter((value) => value.length >= 2 && value.length <= 4096)
    .map(neutralize)
    .filter((value) => value.length >= 2)
    .sort((a, b) => b.length - a.length)
    .map((value) => {
      const windows = /^(?:[a-z]:|\\\\)/i.test(value);
      const escape = (part: string): string => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escaped = windows ? value.split(/[\\/]/).map(escape).join('[\\\\/]') : escape(value);
      return new RegExp(escaped + '(?=[\\\\/]|$|[\\s"\'<>])', windows ? 'gi' : 'g');
    });
  return (value) => {
    if (value.length > 16_384) return omitted;
    const bounded = value;
    const controls: string[] = [];
    const visible = stripVTControlCharacters(bounded);
    // Mask credentials before joining controls too (e.g. Bearer followed by a newline).
    const credentialSafe = sanitizeErrorMessage(visible).replace(extraCredentials, '$1[REDACTED]');
    const plain = credentialSafe.replace(hidden, (char) => {
      if (controls.length < 16) controls.push(escapeControl(char));
      return '';
    });
    const masked = plain
      .split(/(\bhttps?:\/\/[^\s<>"']+)/gi)
      .map((part, index) => {
        if (index % 2 === 1) return part;
        for (const pattern of patterns) part = part.replace(pattern, '~');
        return part;
      })
      .join('')
      .replace(extraCredentials, '$1[REDACTED]');
    const redacted = sanitizeErrorMessage(masked);
    if (credentialSafe === visible && redacted === plain)
      return visible.replace(invisible, escapeControl).slice(0, 8192);
    const text = redacted.replace(invisible, escapeControl);
    return (text + (controls.length ? ' [controls: ' + controls.join(' ') + ']' : '')).slice(0, 8192);
  };
}
let defaultRedactor: ((value: string) => string) | undefined;
export function sanitizeLogText(value: string, privatePaths?: readonly string[]): string {
  if (privatePaths !== undefined) return createTextRedactor(privatePaths)(value);
  defaultRedactor ??= createTextRedactor();
  return defaultRedactor(value);
}
export interface LoggerOptions {
  level?: LogLevel;
  write?: (line: string) => void;
  now?: () => Date;
  maxLineBytes?: number;
  privatePaths?: readonly string[];
}
/** Salvage independent diagnostic fields without evaluating accessors or recursively visiting input. */
function sanitizeFields(
  fields: Record<string, unknown>,
  redact: (value: string) => string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let count = 0;
  const put = (key: string, value: unknown): void => {
    let unique = key;
    for (let suffix = 2; Object.hasOwn(result, unique); suffix++) unique = `${key} [${String(suffix)}]`;
    Object.defineProperty(result, unique, { value, enumerable: true });
  };
  try {
    const prototype: unknown = Object.getPrototypeOf(fields);
    if (prototype !== null && prototype !== Object.prototype)
      return { omitted: 'Log fields must be a plain object' };
    for (const key in fields) {
      if (!Object.hasOwn(fields, key)) continue;
      if (++count > 32) {
        put('omitted', 'Additional log fields exceeded the 32-field limit');
        break;
      }
      const outputKey = key.length <= 256 ? redact(key) : `[omitted key ${String(count)}]`;
      if (key.length > 256) {
        put(outputKey, omitted);
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(fields, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        put(outputKey, omitted);
        continue;
      }
      if (secretKey(key)) {
        put(outputKey, '[REDACTED]');
        continue;
      }
      let nodes = 0,
        characters = 0;
      const copy = copyBoundedJson(descriptor.value, {
        string: (value) => {
          characters += value.length;
          if (characters > 8192) throw new Error('Log field character limit');
          return redact(value);
        },
        secretKey: (name) => {
          if (++nodes > 256) throw new Error('Log field node limit');
          return secretKey(name);
        },
      });
      put(outputKey, copy.ok && Buffer.byteLength(JSON.stringify(copy.value)) <= 4096 ? copy.value : omitted);
    }
  } catch {
    put('omitted', 'Unreadable log fields');
  }
  return result;
}
export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = levels[options.level ?? 'info'];
  const maxLineBytes = options.maxLineBytes ?? 16_384;
  safeInteger(maxLineBytes, 'log line bytes', 256, 1_048_576);
  const redact = createTextRedactor(options.privatePaths);
  const write =
    options.write ??
    ((line: string): void => {
      process.stderr.write(line);
    });
  const log = (level: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (levels[level] < threshold) return;
    const record = {
      timestamp: (options.now ?? (() => new Date()))().toISOString(),
      level,
      message: redact(message),
      fields: sanitizeFields(fields ?? {}, redact),
    };
    let line = JSON.stringify(record) + '\n';
    if (Buffer.byteLength(line) > maxLineBytes)
      line =
        JSON.stringify({
          timestamp: record.timestamp,
          level,
          message: '[log event exceeded output limit]',
          truncated: true,
        }) + '\n';
    write(line);
  };
  return {
    debug: (m, f) => {
      log('debug', m, f);
    },
    info: (m, f) => {
      log('info', m, f);
    },
    warn: (m, f) => {
      log('warn', m, f);
    },
    error: (m, f) => {
      log('error', m, f);
    },
  };
}
export function serializeLogError(error: unknown): ReturnType<ReturnType<typeof normalizeError>['toShape']> {
  const shape = normalizeError(error).toShape();
  const details =
    shape.details === undefined
      ? undefined
      : copyBoundedJson(shape.details, { string: sanitizeLogText, secretKey });
  return PhoenixErrorShape.parse({
    ...shape,
    message: sanitizeLogText(shape.message),
    ...(details === undefined
      ? {}
      : { details: details.ok ? details.value : { omitted: 'Excessive error details' } }),
  });
}
