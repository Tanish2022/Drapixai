import { NextResponse } from 'next/server';

const parseOrigin = (value: string | null | undefined) => {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const expectedWebOrigin = () => {
  return parseOrigin(process.env.NEXT_PUBLIC_WEB_BASE_URL)
    || parseOrigin(process.env.NEXTAUTH_URL)
    || (process.env.NODE_ENV === 'production' ? null : 'http://localhost:3000');
};

export const isSameOriginRequest = (request: Request) => {
  const expected = expectedWebOrigin();
  if (!expected) return false;

  const origin = parseOrigin(request.headers.get('origin'));
  if (origin) return origin === expected;

  const referer = parseOrigin(request.headers.get('referer'));
  if (referer) return referer === expected;

  return process.env.NODE_ENV !== 'production';
};

export const rejectCrossOriginRequest = (request: Request) => {
  if (isSameOriginRequest(request)) return null;
  return NextResponse.json({ error: 'CSRF_ORIGIN_MISMATCH' }, { status: 403 });
};

export const rejectCrossOriginMutation = (request: Request) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return null;
  return rejectCrossOriginRequest(request);
};

export const noStoreJson = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
  headers.set('Pragma', 'no-cache');
  return NextResponse.json(body, { ...init, headers });
};
