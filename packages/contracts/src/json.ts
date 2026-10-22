import { z } from 'zod';

/** Per arbitrary JSON field/object; transport bodies have a separate aggregate 1 MiB limit. */
export const JSON_LIMITS = Object.freeze({ maxDepth: 64, maxNodes: 50_000, maxSerializedBytes: 1_048_576 });
type JsonValue = z.infer<ReturnType<typeof z.json>>;
type JsonContainer = Record<string, JsonValue> | JsonValue[];
interface Sanitizer {
  string(value: string): string;
  secretKey(key: string): boolean;
}
interface Visit {
  value: unknown;
  depth: number;
  parent: JsonContainer;
  key: string;
}
type Task = Visit | { leave: object };
export type JsonCopyResult = { ok: true; value: JsonValue } | { ok: false; reason: string };

/** Iterative validation + detached copy: no recursive visitor, getters or toJSON calls. */
export function copyBoundedJson(input: unknown, sanitizer?: Sanitizer): JsonCopyResult {
  const holder: Record<string, JsonValue> = {};
  const tasks: Task[] = [{ value: input, depth: 0, parent: holder, key: 'value' }];
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  let scheduledNodes = 1;
  let bytes = 0;
  const stringBytes = (value: string): number =>
    value.length > JSON_LIMITS.maxSerializedBytes
      ? JSON_LIMITS.maxSerializedBytes + 1
      : new TextEncoder().encode(JSON.stringify(value)).length;
  const put = (parent: JsonContainer, key: string, value: JsonValue): void => {
    Object.defineProperty(parent, key, { value, enumerable: true, writable: true, configurable: true });
  };
  try {
    while (tasks.length) {
      const task = tasks.pop();
      if (task === undefined) break;
      if ('leave' in task) {
        ancestors.delete(task.leave);
        continue;
      }
      const { depth, parent, key } = task;
      let value = task.value;
      nodes++;
      if (nodes > JSON_LIMITS.maxNodes || depth > JSON_LIMITS.maxDepth)
        return { ok: false, reason: 'JSON depth or node limit exceeded' };
      if (sanitizer !== undefined) {
        if (typeof value === 'string') value = sanitizer.string(value);
        else if (typeof value === 'object' && value !== null && ancestors.has(value)) value = '[circular]';
        else if (
          typeof value !== 'object' &&
          typeof value !== 'boolean' &&
          !(typeof value === 'number' && Number.isFinite(value))
        )
          value = '[unserializable]';
      }
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      ) {
        bytes += typeof value === 'string' ? stringBytes(value) : String(value).length;
        put(parent, key, value);
      } else if (typeof value === 'object') {
        if (ancestors.has(value)) return { ok: false, reason: 'Cyclic JSON' };
        const array = Array.isArray(value);
        const length = Array.isArray(value) ? value.length : 0;
        const prototype: unknown = Object.getPrototypeOf(value);
        if (!array && prototype !== null && prototype !== Object.prototype)
          return { ok: false, reason: 'JSON objects must be plain objects' };
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = Reflect.ownKeys(descriptors).filter((k) => !array || k !== 'length');
        if (keys.length + scheduledNodes > JSON_LIMITS.maxNodes)
          return { ok: false, reason: 'JSON node limit exceeded' };
        scheduledNodes += keys.length;
        if (array && keys.length !== length)
          return { ok: false, reason: 'Sparse arrays are not JSON values' };
        const output: JsonContainer = array ? [] : {};
        bytes += 2 + Math.max(0, keys.length - 1);
        put(parent, key, output);
        ancestors.add(value);
        tasks.push({ leave: value });
        const usedKeys = new Set<string>();
        for (let index = keys.length - 1; index >= 0; index--) {
          const childKey = keys[index];
          if (typeof childKey !== 'string') return { ok: false, reason: 'Symbol keys are not JSON' };
          const property = descriptors[childKey];
          if (property === undefined || !('value' in property) || !property.enumerable)
            return { ok: false, reason: 'JSON properties must be enumerable data properties' };
          if (array && (!/^(0|[1-9][0-9]*)$/.test(childKey) || Number(childKey) >= length))
            return { ok: false, reason: 'Invalid array property' };
          const baseKey = sanitizer?.string(childKey) ?? childKey;
          let outputKey = baseKey;
          for (let suffix = 2; usedKeys.has(outputKey); suffix++)
            outputKey = `${baseKey} [${String(suffix)}]`;
          usedKeys.add(outputKey);
          if (!array) bytes += stringBytes(outputKey) + 1;
          const child: unknown = sanitizer?.secretKey(childKey) === true ? '[REDACTED]' : property.value;
          tasks.push({ value: child, depth: depth + 1, parent: output, key: outputKey });
        }
      } else return { ok: false, reason: 'Value is not JSON' };
      if (bytes > JSON_LIMITS.maxSerializedBytes)
        return { ok: false, reason: 'JSON serialized-size limit exceeded' };
    }
    return { ok: true, value: holder['value'] ?? null };
  } catch {
    return { ok: false, reason: 'JSON input could not be inspected safely' };
  }
}

const metadata = {
  'x-phoenix-json-limits': JSON_LIMITS,
  description:
    'Bounded JSON; runtime validation enforces depth, node count, UTF-8 serialized size and acyclic plain data.',
};
// The iterative copy is the validator; no recursive runtime JSON schema runs before or after it.
export const BoundedJsonValue = z
  .unknown()
  .transform((value, ctx): JsonValue => {
    const result = copyBoundedJson(value);
    if (result.ok) return result.value;
    ctx.addIssue({ code: 'custom', message: result.reason });
    return z.NEVER;
  })
  .meta(metadata);
export const BoundedJsonObject = BoundedJsonValue.pipe(
  z.custom<Record<string, JsonValue>>(
    (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
    'Expected a JSON object',
  ),
).meta({ ...metadata, type: 'object' });
export type BoundedJsonValue = z.infer<typeof BoundedJsonValue>;
export type BoundedJsonObject = z.infer<typeof BoundedJsonObject>;
