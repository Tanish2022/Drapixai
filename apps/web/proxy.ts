import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ADMIN_SESSION_COOKIE, readAdminSessionToken } from '@/app/lib/admin-session';
import { DASHBOARD_SESSION_COOKIE, readDashboardSessionToken } from '@/app/lib/dashboard-session';
import { getToken } from 'next-auth/jwt';
import { readAccountTermsState } from '@/app/lib/account-terms-server';
import archivedTerms from '../api/src/legal/terms-2026-10-19.json';

const parseAllowedOrigins = (value: string) => value
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter((origin) => /^https:\/\//i.test(origin) || (process.env.NODE_ENV !== 'production' && /^http:\/\//i.test(origin)));

const buildContentSecurityPolicy = (nonce: string) => {
  const connectSources = [
    "'self'",
    process.env.NEXT_PUBLIC_WEB_BASE_URL || '',
    process.env.NEXT_PUBLIC_API_BASE_URL || '',
    ...parseAllowedOrigins(process.env.DRAPIXAI_WEB_CSP_CONNECT_SRC || process.env.NEXT_PUBLIC_CSP_CONNECT_SRC || ''),
  ].filter(Boolean);
  const demoVideoUrl = String(process.env.NEXT_PUBLIC_DEMO_VIDEO_URL || '').trim();
  const frameSources = ["'self'", 'https://www.youtube.com', 'https://youtube.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'];
  const mediaSources = ["'self'", 'blob:', 'data:', 'https:'];
  try {
    if (demoVideoUrl) {
      frameSources.push(new URL(demoVideoUrl).origin);
      mediaSources.push(new URL(demoVideoUrl).origin);
    }
  } catch {
    // Optional malformed media URLs are ignored by the policy builder.
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'none'",
    "img-src 'self' data: blob: https:",
    `connect-src ${[...new Set(connectSources)].join(' ')}`,
    `media-src ${[...new Set(mediaSources)].join(' ')}`,
    `frame-src ${[...new Set(frameSources)].join(' ')}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
};

const withCsp = (response: NextResponse, policy: string) => {
  response.headers.set('Content-Security-Policy', policy);
  return response;
};

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const nonce = btoa(crypto.randomUUID());
  const policy = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);
  // Reject unknown versions before rendering starts. A streamed notFound()
  // response can otherwise keep HTTP 200 even though its body is an error page.
  if (pathname.startsWith('/terms/') && pathname.slice('/terms/'.length).replace(/\/$/, '') !== archivedTerms.version) {
    return withCsp(new NextResponse('Terms version not found. Visit /terms for the current version.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' },
    }), policy);
  }
  const isProtectedAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');
  const isProtectedMerchantRoute = ['/onboarding', '/dashboard', '/settings', '/subscription', '/sdk-install']
    .some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
  let accountKey = '';
  if (isProtectedAdminRoute) {
    accountKey = (await readAdminSessionToken(req.cookies.get(ADMIN_SESSION_COOKIE)?.value))?.apiKey || '';
  }
  if (isProtectedMerchantRoute) {
    accountKey = (await readDashboardSessionToken(req.cookies.get(DASHBOARD_SESSION_COOKIE)?.value))?.apiKey || '';
    if (!accountKey) {
      const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
      accountKey = typeof token?.apiKey === 'string' ? token.apiKey.trim() : '';
    }
  }
  if (isProtectedAdminRoute || isProtectedMerchantRoute) {
    const terms = accountKey ? await readAccountTermsState(accountKey) : null;
    if (!accountKey || terms?.status === 401) {
      const url = req.nextUrl.clone();
      url.pathname = isProtectedAdminRoute ? '/admin-access' : '/auth/login';
      url.search = '';
      url.searchParams.set('next', `${pathname}${req.nextUrl.search}`);
      return withCsp(NextResponse.redirect(url), policy);
    }
    if (!terms?.state) return withCsp(new NextResponse('Account access is temporarily unavailable. Please try again shortly.', {
      status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5', 'Content-Type': 'text/plain; charset=utf-8' },
    }), policy);
    if (!terms.state.accepted) {
      const url = req.nextUrl.clone();
      url.pathname = '/auth/terms'; url.search = '';
      if (isProtectedAdminRoute) url.searchParams.set('scope', 'admin');
      url.searchParams.set('next', `${pathname}${req.nextUrl.search}`);
      return withCsp(NextResponse.redirect(url), policy);
    }
  }

  return withCsp(NextResponse.next({ request: { headers: requestHeaders } }), policy);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)'],
};
