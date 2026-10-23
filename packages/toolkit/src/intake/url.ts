import { HttpUrl, PhoenixError } from '@phoenix/contracts';

/** Public/persistent identity only. Removed access parameters must never be reconstructed from metadata. */
export function targetIdentityUrl(input: string): { url: string; removedAccessContext: boolean } {
  const parsed = HttpUrl.safeParse(input);
  if (!parsed.success) throw new PhoenixError('INVALID_REQUEST', 'Expected an HTTP(S) target URL');
  const value = new URL(parsed.data);
  const identity = value.origin + value.pathname;
  return { url: identity, removedAccessContext: value.href !== identity };
}
