import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from '@/app/lib/admin-session';
import { DASHBOARD_SESSION_COOKIE, verifyDashboardSessionToken } from '@/app/lib/dashboard-session';

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
  const frameSources = ["'self'", 'https://www.youtube.com', 'https://youtube.com', 'https://player.vimeo.com'];
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
  if (pathname.startsWith('/admin')) {
    const adminSession = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    if (!(await verifyAdminSessionToken(adminSession))) {
      const url = req.nextUrl.clone();
      url.pathname = '/admin-access';
      return withCsp(NextResponse.redirect(url), policy);
    }
  }

  if (pathname.startsWith('/dashboard') || pathname.startsWith('/settings') || pathname.startsWith('/subscription') || pathname.startsWith('/sdk-install')) {
    const dashboardSession = req.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;
    const hasDashboardSession = await verifyDashboardSessionToken(dashboardSession);
    if (!hasDashboardSession) {
      const url = req.nextUrl.clone();
      url.pathname = '/auth/login';
      url.searchParams.set('next', pathname);
      return withCsp(NextResponse.redirect(url), policy);
    }
  }

  return withCsp(NextResponse.next({ request: { headers: requestHeaders } }), policy);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)'],
};
