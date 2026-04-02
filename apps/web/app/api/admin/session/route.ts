import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createAdminSessionToken,
} from '@/app/lib/admin-session';
import { PUBLIC_API_BASE_URL } from '@/app/lib/public-env';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password?.trim();

  if (!email || !password) {
    return NextResponse.json({ error: 'EMAIL_AND_PASSWORD_REQUIRED' }, { status: 400 });
  }

  const loginResponse = await fetch(`${PUBLIC_API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, issueNewKey: true }),
    cache: 'no-store',
  });

  if (!loginResponse.ok) {
    return NextResponse.json({ error: 'ADMIN_ACCESS_DENIED' }, { status: 403 });
  }

  const loginPayload = (await loginResponse.json().catch(() => null)) as { apiKey?: string } | null;
  const apiKey = loginPayload?.apiKey?.trim();

  if (!apiKey) {
    return NextResponse.json({ error: 'ADMIN_API_KEY_NOT_ISSUED' }, { status: 500 });
  }

  const verifyResponse = await fetch(`${PUBLIC_API_BASE_URL}/admin/verify`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
  });

  if (!verifyResponse.ok) {
    return NextResponse.json({ error: 'ADMIN_ACCESS_DENIED' }, { status: 403 });
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: ADMIN_SESSION_COOKIE,
    value: await createAdminSessionToken(),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });

  return NextResponse.json({ ok: true, apiKey });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.set({
    name: ADMIN_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });

  return NextResponse.json({ ok: true });
}
