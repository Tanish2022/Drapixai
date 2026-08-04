import { cookies } from 'next/headers';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createAdminSessionToken,
  readAdminSessionToken,
} from '@/app/lib/admin-session';
import { SERVER_API_BASE_URL } from '@/app/lib/server-env';
import { noStoreJson, rejectCrossOriginRequest } from '@/app/lib/request-guard';

export async function POST(request: Request) {
  const csrfRejection = rejectCrossOriginRequest(request);
  if (csrfRejection) return csrfRejection;

  const body = (await request.json().catch(() => null)) as { email?: string; password?: string; mfaCode?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password?.trim();

  if (!email || !password) {
    return noStoreJson({ error: 'EMAIL_AND_PASSWORD_REQUIRED' }, { status: 400 });
  }

  const loginResponse = await fetch(`${SERVER_API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, mfaCode: body?.mfaCode, issueNewKey: true }),
    cache: 'no-store',
  });

  if (!loginResponse.ok) {
    return noStoreJson({ error: 'ADMIN_ACCESS_DENIED' }, { status: 403 });
  }

  const loginPayload = (await loginResponse.json().catch(() => null)) as { apiKey?: string } | null;
  const apiKey = loginPayload?.apiKey?.trim();

  if (!apiKey) {
    return noStoreJson({ error: 'ADMIN_API_KEY_NOT_ISSUED' }, { status: 500 });
  }

  const verifyResponse = await fetch(`${SERVER_API_BASE_URL}/admin/verify`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
  });

  if (!verifyResponse.ok) {
    return noStoreJson({ error: 'ADMIN_ACCESS_DENIED' }, { status: 403 });
  }

  const cookieStore = await cookies();
  const session = await readAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
  if (session?.apiKey) {
    await fetch(`${SERVER_API_BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.apiKey}` },
      cache: 'no-store',
    }).catch(() => null);
  }
  cookieStore.set({
    name: ADMIN_SESSION_COOKIE,
    value: await createAdminSessionToken(apiKey),
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });

  return noStoreJson({ ok: true });
}

export async function DELETE(request: Request) {
  const csrfRejection = rejectCrossOriginRequest(request);
  if (csrfRejection) return csrfRejection;

  const cookieStore = await cookies();
  const session = await readAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
  if (session?.apiKey) {
    await fetch(`${SERVER_API_BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.apiKey}` },
      cache: 'no-store',
    }).catch(() => null);
  }
  cookieStore.set({
    name: ADMIN_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });

  return noStoreJson({ ok: true });
}
