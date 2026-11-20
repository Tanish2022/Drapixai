import type { cookies } from 'next/headers';
import { noStoreJson } from './request-guard';
import { SERVER_API_BASE_URL } from './server-env';
import { sessionCookie } from './session-cookie';

type CookieStore = Awaited<ReturnType<typeof cookies>>;
type Revocation = {
  name: string;
  maxAge: number;
  seal: (key: string) => Promise<string>;
  open: (token: string | undefined) => Promise<{ apiKey: string } | null>;
};

const revoke = async (key: string) => {
  const response = await fetch(`${SERVER_API_BASE_URL}/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  return response?.ok || response?.status === 401;
};

const pendingResponse = () => noStoreJson({
  error: 'Local session cleared. Server sign-out is pending. Please retry.',
}, { status: 503, headers: { 'Retry-After': '1' } });

export async function retryPendingRevocation(store: CookieStore, retry: Revocation) {
  const token = store.get(retry.name)?.value;
  if (!token) return null;
  const pending = await retry.open(token);
  if (pending && !await revoke(pending.apiKey)) return pendingResponse();
  store.set(sessionCookie(retry.name, '', 0));
  return null;
}

export async function finishLogout(store: CookieStore, retry: Revocation, key?: string) {
  const pending = await retryPendingRevocation(store, retry);
  if (pending) return pending;
  if (key && !await revoke(key)) {
    // A separate authenticated-encryption purpose makes this cookie unusable
    // for dashboard/admin access. Retry on logout or the next sign-in.
    store.set(sessionCookie(retry.name, await retry.seal(key), retry.maxAge));
    return pendingResponse();
  }
  return noStoreJson({ ok: true });
}
