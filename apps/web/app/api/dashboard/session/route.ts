import { retryPendingRevocation, finishLogout } from '@/app/lib/logout';
import { cookies } from 'next/headers';
import {
  createDashboardSessionToken,
  DASHBOARD_SESSION_COOKIE,
  dashboardRevocation,
  LEGACY_DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
  readDashboardSessionToken,
} from '@/app/lib/dashboard-session';
import { SERVER_API_BASE_URL } from '@/app/lib/server-env';
import { noStoreJson, readSessionBody, rejectCrossOriginRequest } from '@/app/lib/request-guard';
import { sessionCookie, retireLegacySessionCookie, clearSessionCookies } from '@/app/lib/session-cookie';

const dashboardProxyToken = (process.env.DRAPIXAI_DASHBOARD_PROXY_TOKEN || '').trim();

const getDashboardValidationHeaders = (apiKey: string) => {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${apiKey}`);
  if (dashboardProxyToken) headers.set('x-drapixai-dashboard-proxy-token', dashboardProxyToken);
  return headers;
};

const persistDashboardCookie = async (apiKey: string) => {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookie(DASHBOARD_SESSION_COOKIE, await createDashboardSessionToken(apiKey), DASHBOARD_SESSION_MAX_AGE_SECONDS));
  retireLegacySessionCookie(cookieStore, LEGACY_DASHBOARD_SESSION_COOKIE);
};

const validateApiKey = async (apiKey: string) => {
  if (!dashboardProxyToken && process.env.NODE_ENV === 'production') {
    return 503;
  }

  const response = await fetch(`${SERVER_API_BASE_URL}/analytics/summary`, {
    headers: getDashboardValidationHeaders(apiKey),
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  }).catch(() => null);

  if (response?.ok) return 200;
  return response?.status === 401 || response?.status === 403 ? 401 : 503;
};

export async function GET(request: Request) {
  const csrfRejection = rejectCrossOriginRequest(request);
  if (csrfRejection) return csrfRejection;

  const cookieStore = await cookies();
  const session = await readDashboardSessionToken(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value);

  if (!session) {
    return noStoreJson({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  return noStoreJson({ ok: true });
}

export async function POST(request: Request) {
  const csrfRejection = rejectCrossOriginRequest(request);
  if (csrfRejection) return csrfRejection;

  const pending = await retryPendingRevocation(await cookies(), dashboardRevocation);
  if (pending) return pending;
  const { body, rejection } = await readSessionBody(request);
  if (rejection || !body) return rejection || noStoreJson({ error: 'INVALID_SESSION_REQUEST' }, { status: 400 });
  if (body.apiKey !== undefined && typeof body.apiKey !== 'string') {
    return noStoreJson({ error: 'INVALID_API_KEY_FORMAT' }, { status: 400 });
  }
  const directApiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

  if (directApiKey) {
    const status = await validateApiKey(directApiKey);
    if (status === 503) return noStoreJson({ error: 'SESSION_VALIDATION_UNAVAILABLE' }, { status, headers: { 'Retry-After': '1' } });
    if (status === 401) {
      return noStoreJson({ error: 'INVALID_API_KEY' }, { status: 401 });
    }
    await persistDashboardCookie(directApiKey);
    return noStoreJson({ ok: true });
  }

  if (typeof body.mode !== 'string' || !['login', 'register'].includes(body.mode)) {
    return noStoreJson({ error: 'INVALID_MODE' }, { status: 400 });
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
          termsAcceptance: body.termsAcceptance,
        }
      : {
          email: body.email,
          password: body.password,
          issueNewKey: true,
        };

  const authResponse = await fetch(`${SERVER_API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!authResponse) return noStoreJson({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }, {
    status: 503, headers: { 'Retry-After': '1' },
  });

  const authPayload = (await authResponse.json().catch(() => null)) as { apiKey?: string; error?: string; termsRequired?: boolean } | null;
  if (!authResponse.ok) {
    if (authResponse.status === 503) return noStoreJson({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' }, {
      status: 503, headers: { 'Retry-After': '1' },
    });
    return noStoreJson({ error: authPayload?.error || 'AUTH_FAILED' }, { status: authResponse.status });
  }

  const apiKey = authPayload?.apiKey?.trim();
  if (!apiKey) {
    return noStoreJson({ error: 'API_KEY_NOT_ISSUED' }, { status: 500 });
  }

  await persistDashboardCookie(apiKey);
  return noStoreJson({ ok: true, termsRequired: authPayload?.termsRequired === true });
}

export async function DELETE(request: Request) {
  const csrfRejection = rejectCrossOriginRequest(request);
  if (csrfRejection) return csrfRejection;

  const cookieStore = await cookies();
  const session = await readDashboardSessionToken(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value);
  clearSessionCookies(cookieStore, DASHBOARD_SESSION_COOKIE, LEGACY_DASHBOARD_SESSION_COOKIE);
  return finishLogout(cookieStore, dashboardRevocation, session?.apiKey);
}
