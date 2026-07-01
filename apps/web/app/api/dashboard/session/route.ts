import { cookies } from 'next/headers';
import {
  createDashboardSessionToken,
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
  readDashboardSessionToken,
} from '@/app/lib/dashboard-session';
import { SERVER_API_BASE_URL } from '@/app/lib/server-env';
import { noStoreJson, rejectCrossOriginRequest } from '@/app/lib/request-guard';

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

const dashboardProxyToken = (process.env.DRAPIXAI_DASHBOARD_PROXY_TOKEN || '').trim();

const getDashboardValidationHeaders = (apiKey: string) => {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${apiKey}`);
  if (dashboardProxyToken) headers.set('x-drapixai-dashboard-proxy-token', dashboardProxyToken);
  return headers;
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

const validateApiKey = async (apiKey: string) => {
  if (!dashboardProxyToken && process.env.NODE_ENV === 'production') {
    return false;
  }

  const response = await fetch(`${SERVER_API_BASE_URL}/analytics/summary`, {
    headers: getDashboardValidationHeaders(apiKey),
    cache: 'no-store',
  }).catch(() => null);

  return Boolean(response?.ok);
};

export async function GET(request: Request) {
  const csrfRejection = rejectCrossOriginRequest(request);
  if (csrfRejection) return csrfRejection;

  const cookieStore = await cookies();
  const session = await readDashboardSessionToken(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value);

  if (!session) {
    return noStoreJson({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  return noStoreJson({ ok: true, apiKey: session.apiKey });
}

export async function POST(request: Request) {
  const csrfRejection = rejectCrossOriginRequest(request);
  if (csrfRejection) return csrfRejection;

  const body = (await request.json().catch(() => null)) as DashboardSessionRequestBody | null;
  const directApiKey = body?.apiKey?.trim();

  if (directApiKey) {
    if (!(await validateApiKey(directApiKey))) {
      return noStoreJson({ error: 'INVALID_API_KEY' }, { status: 401 });
    }
    await persistDashboardCookie(directApiKey);
    return noStoreJson({ ok: true, apiKey: directApiKey });
  }

  if (!body?.mode || !['login', 'register'].includes(body.mode)) {
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
  });

  const authPayload = (await authResponse.json().catch(() => null)) as { apiKey?: string; error?: string } | null;
  if (!authResponse.ok) {
    return noStoreJson({ error: authPayload?.error || 'AUTH_FAILED' }, { status: authResponse.status });
  }

  const apiKey = authPayload?.apiKey?.trim();
  if (!apiKey) {
    return noStoreJson({ error: 'API_KEY_NOT_ISSUED' }, { status: 500 });
  }

  await persistDashboardCookie(apiKey);
  return noStoreJson({ ok: true, apiKey });
}

export async function DELETE(request: Request) {
  const csrfRejection = rejectCrossOriginRequest(request);
  if (csrfRejection) return csrfRejection;

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

  return noStoreJson({ ok: true });
}
