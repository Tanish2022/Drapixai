import { retryPendingRevocation, finishLogout } from '@/app/lib/logout';
import { cookies } from 'next/headers';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_REVOCATION_COOKIE,
  LEGACY_ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createAdminSessionToken,
  readAdminSessionToken,
} from '@/app/lib/admin-session';
import { SERVER_API_BASE_URL } from '@/app/lib/server-env';
import { noStoreJson, readSessionBody, rejectCrossOriginRequest } from '@/app/lib/request-guard';
import { sessionCookie, retireLegacySessionCookie, clearSessionCookies } from '@/app/lib/session-cookie';

const revocation = {
  name: ADMIN_REVOCATION_COOKIE,
  maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  seal: (key: string) => createAdminSessionToken(key, 'revocation'),
  open: (token: string | undefined) => readAdminSessionToken(token, 'revocation'),
};

export async function POST(request: Request) {
  const csrfRejection = rejectCrossOriginRequest(request);
  if (csrfRejection) return csrfRejection;

  const pending = await retryPendingRevocation(await cookies(), revocation);
  if (pending) return pending;
  const { body, rejection } = await readSessionBody(request);
  if (rejection) return rejection;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    return noStoreJson({ error: 'EMAIL_AND_PASSWORD_REQUIRED' }, { status: 400 });
  }

  const loginResponse = await fetch(`${SERVER_API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, mfaCode: body?.mfaCode, issueNewKey: true, sessionPurpose: 'admin' }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!loginResponse) return noStoreJson({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }, {
    status: 503, headers: { 'Retry-After': '1' },
  });

  if (!loginResponse.ok) {
    if (loginResponse.status === 429) return noStoreJson({ error: 'RATE_LIMITED' }, { status: 429 });
    if (loginResponse.status >= 500) return noStoreJson({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }, {
      status: 503, headers: { 'Retry-After': '1' },
    });
    return noStoreJson({ error: 'ADMIN_ACCESS_DENIED' }, { status: 403 });
  }

  const loginPayload = (await loginResponse.json().catch(() => null)) as { apiKey?: string; adminAuthorized?: boolean } | null;
  const apiKey = typeof loginPayload?.apiKey === 'string' ? loginPayload.apiKey.trim() : '';

  if (!apiKey) {
    return noStoreJson({ error: 'ADMIN_API_KEY_NOT_ISSUED' }, { status: 500 });
  }

  if (loginPayload?.adminAuthorized !== true) {
    const cleanup = await finishLogout(await cookies(), revocation, apiKey);
    if (!cleanup.ok) return cleanup;
    return noStoreJson({ error: 'ADMIN_ACCESS_DENIED' }, { status: 403 });
  }

  const cookieStore = await cookies();
  const session = await readAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
  if (session?.apiKey) {
    await fetch(`${SERVER_API_BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.apiKey}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
  }
  cookieStore.set(sessionCookie(ADMIN_SESSION_COOKIE, await createAdminSessionToken(apiKey), ADMIN_SESSION_MAX_AGE_SECONDS));
  retireLegacySessionCookie(cookieStore, LEGACY_ADMIN_SESSION_COOKIE);

  return noStoreJson({ ok: true });
}

export async function DELETE(request: Request) {
  const csrfRejection = rejectCrossOriginRequest(request);
  if (csrfRejection) return csrfRejection;

  const cookieStore = await cookies();
  const session = await readAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
  clearSessionCookies(cookieStore, ADMIN_SESSION_COOKIE, LEGACY_ADMIN_SESSION_COOKIE);
  return finishLogout(cookieStore, revocation, session?.apiKey);
}
