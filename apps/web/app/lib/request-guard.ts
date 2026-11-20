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

  const originHeader = request.headers.get('origin');
  if (originHeader !== null) return parseOrigin(originHeader) === expected;

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
  headers.set('Cache-Control', 'no-store, private, no-cache, max-age=0, must-revalidate');
  headers.set('Pragma', 'no-cache');
  return NextResponse.json(body, { ...init, headers });
};

const DEFAULT_PROXY_BODY_LIMIT_BYTES = 12 * 1024 * 1024;

const getProxyBodyLimitBytes = () => {
  const configured = Number(process.env.DRAPIXAI_WEB_PROXY_MAX_BODY_BYTES || DEFAULT_PROXY_BODY_LIMIT_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PROXY_BODY_LIMIT_BYTES;
};

export const readLimitedProxyBody = async (request: Request, explicitMaxBytes?: number) => {
  if (['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    return { body: undefined as ArrayBuffer | undefined, rejection: null as NextResponse | null };
  }

  const maxBytes = explicitMaxBytes ?? getProxyBodyLimitBytes();
  try {
    return { body: await readBoundedBody(request, maxBytes), rejection: null };
  } catch (error) {
    return { body: undefined, rejection: error instanceof RangeError
      ? noStoreJson({ error: 'PROXY_REQUEST_TOO_LARGE' }, { status: 413 })
      : noStoreJson({ error: 'INCOMPLETE_REQUEST_BODY' }, { status: 400 }) };
  }
};

const readBoundedBody = async (message: Response | Request, maxBytes: number) => {
  const rawContentLength = message.headers.get('content-length');
  const contentLength = rawContentLength ? Number(rawContentLength) : 0;
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await message.body?.cancel().catch(() => undefined);
    throw new RangeError('BODY_LIMIT');
  }

  if (!message.body) return undefined;
  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RangeError('BODY_LIMIT');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body.buffer;
};

export const readSessionBody = async (request: Request) => {
  const limited = await readLimitedProxyBody(request, 8192);
  if (limited.rejection) return { body: null, rejection: limited.rejection };
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(limited.body));
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return { body: body as Record<string, unknown>, rejection: null };
    }
  } catch {
    // Invalid or empty JSON receives the same client-facing error.
  }
  return { body: null, rejection: noStoreJson({ error: 'INVALID_SESSION_REQUEST' }, { status: 400 }) };
};

export async function fetchProxyResponse(url: URL, init: RequestInit, request: Request) {
  const timeout = AbortSignal.timeout(120000);
  try {
    const upstream = await fetch(url, {
      ...init, redirect: 'error', signal: AbortSignal.any([request.signal, timeout]),
    });
    const body = await readBoundedBody(upstream, 64 * 1024 * 1024);
    const headers = new Headers({ 'Cache-Control': 'no-store, private', Pragma: 'no-cache' });
    const type = upstream.headers.get('Content-Type');
    if (type) headers.set('Content-Type', type);
    return new NextResponse(body, { status: upstream.status, headers });
  } catch {
    return timeout.aborted
      ? noStoreJson({ error: 'UPSTREAM_TIMEOUT' }, { status: 504 })
      : noStoreJson({ error: 'UPSTREAM_RESPONSE_UNAVAILABLE' }, { status: 502 });
  }
}
