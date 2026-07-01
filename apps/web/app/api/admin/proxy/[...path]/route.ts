import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE, readAdminSessionToken } from '@/app/lib/admin-session';
import { SERVER_API_BASE_URL } from '@/app/lib/server-env';
import { rejectCrossOriginMutation } from '@/app/lib/request-guard';

type AdminProxyContext = {
  params: Promise<{ path?: string[] }>;
};

const isSafePath = (segments: string[]) =>
  segments.length > 0 &&
  segments.every((segment) => segment && segment !== '.' && segment !== '..' && !segment.includes('/'));

const buildAdminUrl = (request: NextRequest, segments: string[]) => {
  const url = new URL(`${SERVER_API_BASE_URL}/admin/${segments.map(encodeURIComponent).join('/')}`);
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });
  return url;
};

const proxyAdminRequest = async (request: NextRequest, context: AdminProxyContext) => {
  const { path = [] } = await context.params;
  if (!isSafePath(path)) {
    return NextResponse.json({ error: 'INVALID_ADMIN_PROXY_PATH' }, { status: 400 });
  }

  const csrfRejection = rejectCrossOriginMutation(request);
  if (csrfRejection) return csrfRejection;

  const cookieStore = await cookies();
  const session = await readAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: 'ADMIN_SESSION_REQUIRED' }, { status: 401 });
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${session.apiKey}`,
  };

  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  const upstream = await fetch(buildAdminUrl(request, path), {
    method: request.method,
    headers,
    body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
    cache: 'no-store',
  });

  const responseHeaders = new Headers();
  responseHeaders.set('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
  responseHeaders.set('Pragma', 'no-cache');
  const upstreamContentType = upstream.headers.get('content-type');
  if (upstreamContentType) {
    responseHeaders.set('Content-Type', upstreamContentType);
  }

  return new NextResponse(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
};

export const GET = proxyAdminRequest;
export const POST = proxyAdminRequest;
