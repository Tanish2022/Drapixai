import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { DASHBOARD_SESSION_COOKIE, readDashboardSessionToken } from '@/app/lib/dashboard-session';
import { SERVER_API_BASE_URL } from '@/app/lib/server-env';
import { noStoreJson, readLimitedProxyBody, rejectCrossOriginMutation } from '@/app/lib/request-guard';

type DashboardProxyContext = {
  params: Promise<{ path?: string[] }>;
};

const allowedSdkRoots = new Set(['garments', 'catalog', 'matches', 'result']);
const dashboardProxyToken = (process.env.DRAPIXAI_DASHBOARD_PROXY_TOKEN || '').trim();

const isSafePath = (segments: string[]) =>
  segments.length > 0 &&
  segments.every((segment) => segment && segment !== '.' && segment !== '..' && !segment.includes('/'));

const isAllowedDashboardPath = (segments: string[]) => {
  const [root, second] = segments;
  if (root === 'analytics') return true;
  if (root === 'account') return true;
  if (root === 'sdk' && second && allowedSdkRoots.has(second)) return true;
  return false;
};

const buildApiUrl = (request: NextRequest, segments: string[]) => {
  const url = new URL(`${SERVER_API_BASE_URL}/${segments.map(encodeURIComponent).join('/')}`);
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });
  return url;
};

const proxyDashboardRequest = async (request: NextRequest, context: DashboardProxyContext) => {
  const { path = [] } = await context.params;
  if (!isSafePath(path) || !isAllowedDashboardPath(path)) {
    return noStoreJson({ error: 'INVALID_DASHBOARD_PROXY_PATH' }, { status: 400 });
  }

  const csrfRejection = rejectCrossOriginMutation(request);
  if (csrfRejection) return csrfRejection;

  const cookieStore = await cookies();
  const session = await readDashboardSessionToken(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value);
  if (!session) {
    return noStoreJson({ error: 'DASHBOARD_SESSION_REQUIRED' }, { status: 401 });
  }

  if (!dashboardProxyToken && process.env.NODE_ENV === 'production') {
    return noStoreJson({ error: 'DASHBOARD_PROXY_TOKEN_NOT_CONFIGURED' }, { status: 500 });
  }

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${session.apiKey}`);
  if (dashboardProxyToken) headers.set('x-drapixai-dashboard-proxy-token', dashboardProxyToken);
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);

  const bodyResult = await readLimitedProxyBody(request);
  if (bodyResult.rejection) return bodyResult.rejection;

  const upstream = await fetch(buildApiUrl(request, path), {
    method: request.method,
    headers,
    body: bodyResult.body,
    cache: 'no-store',
  });

  const responseHeaders = new Headers();
  responseHeaders.set('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
  responseHeaders.set('Pragma', 'no-cache');
  const upstreamContentType = upstream.headers.get('content-type');
  if (upstreamContentType) responseHeaders.set('Content-Type', upstreamContentType);

  return new NextResponse(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
};

export const GET = proxyDashboardRequest;
export const POST = proxyDashboardRequest;
export const DELETE = proxyDashboardRequest;