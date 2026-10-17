import { cookies } from 'next/headers';
import { getToken } from 'next-auth/jwt';
import { NextRequest } from 'next/server';
import {
  createDashboardSessionToken,
  DASHBOARD_SESSION_COOKIE,
  LEGACY_DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
} from '@/app/lib/dashboard-session';
import { noStoreJson, rejectCrossOriginRequest } from '@/app/lib/request-guard';
import { sessionCookie, retireLegacySessionCookie } from '@/app/lib/session-cookie';

export async function POST(request: NextRequest) {
  const csrfRejection = rejectCrossOriginRequest(request);
  if (csrfRejection) return csrfRejection;

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const apiKey = typeof token?.apiKey === 'string' ? token.apiKey.trim() : '';
  if (!apiKey) {
    return noStoreJson({ error: 'OAUTH_DASHBOARD_SESSION_REQUIRED' }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set(sessionCookie(DASHBOARD_SESSION_COOKIE, await createDashboardSessionToken(apiKey), DASHBOARD_SESSION_MAX_AGE_SECONDS));
  retireLegacySessionCookie(cookieStore, LEGACY_DASHBOARD_SESSION_COOKIE);

  return noStoreJson({ ok: true });
}
