import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from '@/app/lib/admin-session';
import { DASHBOARD_SESSION_COOKIE, verifyDashboardSessionToken } from '@/app/lib/dashboard-session';

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/admin')) {
    const adminSession = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    if (!(await verifyAdminSessionToken(adminSession))) {
      const url = req.nextUrl.clone();
      url.pathname = '/admin-access';
      return NextResponse.redirect(url);
    }
  }

  if (pathname.startsWith('/dashboard') || pathname.startsWith('/settings') || pathname.startsWith('/subscription')) {
    const dashboardSession = req.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;
    const hasDashboardSession = await verifyDashboardSessionToken(dashboardSession);
    if (!hasDashboardSession) {
      const url = req.nextUrl.clone();
      url.pathname = '/auth/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/dashboard/:path*', '/settings/:path*', '/subscription/:path*'],
};
