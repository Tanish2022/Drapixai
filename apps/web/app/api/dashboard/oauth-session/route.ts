import { cookies } from 'next/headers';
import { getToken } from 'next-auth/jwt';
import { NextRequest } from 'next/server';
import {
  createDashboardSessionToken,
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
} from '@/app/lib/dashboard-session';
import { noStoreJson, rejectCrossOriginRequest } from '@/app/lib/request-guard';

export async function POST(request: NextRequest) {
  const csrfRejection = rejectCrossOriginRequest(request);
  if (csrfRejection) return csrfRejection;

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const apiKey = typeof token?.apiKey === 'string' ? token.apiKey.trim() : '';
  if (!apiKey) {
    return noStoreJson({ error: 'OAUTH_DASHBOARD_SESSION_REQUIRED' }, { status: 401 });
  }

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

  return noStoreJson({ ok: true });
}
