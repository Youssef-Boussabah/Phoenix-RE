import { PhoenixError } from '@phoenix/contracts';

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new PhoenixError('CANCELLED', 'Operation cancelled');
}
export function safeInteger(value: number, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new PhoenixError('INVALID_REQUEST', `Invalid ${name}`);
}
export function unreadable(error: unknown): PhoenixError {
  return error instanceof PhoenixError
    ? error
    : new PhoenixError('TARGET_UNREADABLE', 'Cannot safely read target', { cause: error });
}
