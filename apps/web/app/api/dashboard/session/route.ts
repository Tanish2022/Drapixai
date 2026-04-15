import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  createDashboardSessionToken,
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
  readDashboardSessionToken,
} from '@/app/lib/dashboard-session';

const API_BASE_URL = process.env.DRAPIXAI_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

type DashboardSessionRequestBody = {
  mode?: 'login' | 'register';
  email?: string;
  password?: string;
  companyName?: string;
  selectedPlan?: string | null;
  mobileNumber?: string | null;
  otp?: string;
  apiKey?: string;
};

const persistDashboardCookie = async (apiKey: string) => {
  const cookieStore = await cookies();
  cookieStore.set({
    name: DASHBOARD_SESSION_COOKIE,
    value: await createDashboardSessionToken(apiKey),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DASHBOARD_SESSION_MAX_AGE_SECONDS,
  });
};

export async function GET() {
  const cookieStore = await cookies();
  const session = await readDashboardSessionToken(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value);

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  return NextResponse.json({ ok: true, apiKey: session.apiKey });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as DashboardSessionRequestBody | null;
  const directApiKey = body?.apiKey?.trim();

  if (directApiKey) {
    await persistDashboardCookie(directApiKey);
    return NextResponse.json({ ok: true, apiKey: directApiKey });
  }

  if (!body?.mode || !['login', 'register'].includes(body.mode)) {
    return NextResponse.json({ error: 'INVALID_MODE' }, { status: 400 });
  }

  const endpoint = body.mode === 'register' ? '/auth/register' : '/auth/login';
  const payload =
    body.mode === 'register'
      ? {
          email: body.email,
          password: body.password,
          companyName: body.companyName,
          selectedPlan: body.selectedPlan,
          mobileNumber: body.mobileNumber,
          otp: body.otp,
        }
      : {
          email: body.email,
          password: body.password,
          issueNewKey: true,
        };

  const authResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  const authPayload = (await authResponse.json().catch(() => null)) as { apiKey?: string; error?: string } | null;
  if (!authResponse.ok) {
    return NextResponse.json({ error: authPayload?.error || 'AUTH_FAILED' }, { status: authResponse.status });
  }

  const apiKey = authPayload?.apiKey?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'API_KEY_NOT_ISSUED' }, { status: 500 });
  }

  await persistDashboardCookie(apiKey);
  return NextResponse.json({ ok: true, apiKey });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.set({
    name: DASHBOARD_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });

  return NextResponse.json({ ok: true });
}
