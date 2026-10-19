import { cookies } from 'next/headers';
import { getToken } from 'next-auth/jwt';
import { NextRequest } from 'next/server';
import { ADMIN_SESSION_COOKIE, readAdminSessionToken } from '@/app/lib/admin-session';
import { createDashboardSessionToken, DASHBOARD_SESSION_COOKIE, LEGACY_DASHBOARD_SESSION_COOKIE, DASHBOARD_SESSION_MAX_AGE_SECONDS, readDashboardSessionToken } from '@/app/lib/dashboard-session';
import { accountTermsHeaders, readAccountTermsState } from '@/app/lib/account-terms-server';
import { noStoreJson, readLimitedProxyBody, rejectCrossOriginRequest } from '@/app/lib/request-guard';
import { SERVER_API_BASE_URL } from '@/app/lib/server-env';
import { sessionCookie, retireLegacySessionCookie } from '@/app/lib/session-cookie';

const resolveSession = async (request: NextRequest) => {
  const store = await cookies();
  const operator = request.nextUrl.searchParams.get('scope') === 'admin';
  if (operator) return { operator, apiKey: (await readAdminSessionToken(store.get(ADMIN_SESSION_COOKIE)?.value))?.apiKey || '' };
  const session = await readDashboardSessionToken(store.get(DASHBOARD_SESSION_COOKIE)?.value);
  if (session) return { operator, apiKey: session.apiKey };
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  return { operator, apiKey: typeof token?.apiKey === 'string' ? token.apiKey.trim() : '' };
};

export async function GET(request: NextRequest) {
  const rejection = rejectCrossOriginRequest(request);
  if (rejection) return rejection;
  const { apiKey } = await resolveSession(request);
  if (!apiKey) return noStoreJson({ error: 'ACCOUNT_SESSION_REQUIRED' }, { status: 401 });
  const result = await readAccountTermsState(apiKey);
  return noStoreJson(result.state || { error: result.status === 401 ? 'ACCOUNT_SESSION_REQUIRED' : 'TERMS_STATUS_UNAVAILABLE' }, { status: result.status });
}

export async function POST(request: NextRequest) {
  const rejection = rejectCrossOriginRequest(request);
  if (rejection) return rejection;
  const { apiKey, operator } = await resolveSession(request);
  if (!apiKey) return noStoreJson({ error: 'ACCOUNT_SESSION_REQUIRED' }, { status: 401 });
  const limited = await readLimitedProxyBody(request, 2048);
  if (limited.rejection) return limited.rejection;
  const headers = accountTermsHeaders(apiKey);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(`${SERVER_API_BASE_URL}/auth/terms`, {
    method: 'POST', headers, body: limited.body, cache: 'no-store', signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!response) return noStoreJson({ error: 'TERMS_ACCEPTANCE_UNAVAILABLE' }, { status: 503 });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const allowed = ['TERMS_ACCEPTANCE_REQUIRED', 'INVALID_TERMS_ACCEPTANCE', 'TERMS_VERSION_CHANGED', 'ACCOUNT_SESSION_REQUIRED'];
    const error = allowed.includes(payload?.error) ? payload.error : 'TERMS_ACCEPTANCE_UNAVAILABLE';
    return noStoreJson({ error }, { status: [400, 401, 429].includes(response.status) ? response.status : 503 });
  }
  if (!operator) {
    const store = await cookies();
    store.set(sessionCookie(DASHBOARD_SESSION_COOKIE, await createDashboardSessionToken(apiKey), DASHBOARD_SESSION_MAX_AGE_SECONDS));
    retireLegacySessionCookie(store, LEGACY_DASHBOARD_SESSION_COOKIE);
  }
  return noStoreJson({ ok: true });
}
