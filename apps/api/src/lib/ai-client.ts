import fs from 'fs';
import https from 'https';

const aiBaseUrl = (process.env.DRAPIXAI_AI_URL || 'http://localhost:8080').replace(/\/+$/, '');
const aiOrigin = new URL(aiBaseUrl).origin;
let mtlsAgent: https.Agent | undefined;

const mtlsEnabled = () => process.env.DRAPIXAI_AI_MTLS_ENABLED === '1';

const assertAiEndpoint = (input: string | URL): URL => {
  const url = new URL(input.toString());
  if (url.origin !== aiOrigin || url.username || url.password || url.hash) throw new Error('AI_ENDPOINT_ORIGIN_DENIED');
  return url;
};

export const getAiTransportLimits = () => {
  const integer = (name: string, fallback: number, maximum: number) => {
    const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error('AI_TRANSPORT_CONFIG_INVALID');
    return value;
  };
  return {
    // Standard's configured HTTP wait is 300 seconds; preserve it with a
    // further minute for transport/serialization. This is not a GPU job timeout.
    timeoutMs: integer('DRAPIXAI_AI_REQUEST_TIMEOUT_MS', 360_000, 3_600_000),
    maxResponseBytes: integer('DRAPIXAI_AI_MAX_RESPONSE_BYTES', 64 * 1024 * 1024, 128 * 1024 * 1024),
  };
};

const bufferedResponse = (bytes: Buffer, status: number, statusText: string, headers: Headers) =>
  new Response([204, 205, 304].includes(status) ? null : bytes, { status, statusText, headers });

export const aiTransportFailure = (error: unknown) => {
  const code = error instanceof Error ? error.message : '';
  if (code === 'TRYON_ADMISSION_LEASE_LOST') return { status: 503, body: { error: code, message: 'Try-on capacity could not be reserved. No generation request was started.', retryable: true } };
  if (code === 'TRYON_QUOTA_RECONCILIATION_REQUIRED') return { status: 503, body: { error: code, message: 'Try-on quota needs reconciliation before another attempt. Please contact support.', retryable: false } };
  if (['AI_REQUEST_TIMEOUT', 'AI_REQUEST_ABORTED', 'AI_RESPONSE_TOO_LARGE', 'AI_RESPONSE_INCOMPLETE', 'AI_RESPONSE_INVALID', 'AI_UPSTREAM_CONNECTION_FAILED', 'AI_WORK_OUTCOME_UNCONFIRMED'].includes(code)) {
    return { status: code === 'AI_REQUEST_TIMEOUT' ? 504 : 502, body: { error: 'TRYON_OUTCOME_UNCONFIRMED', message: 'We could not confirm whether this try-on finished. Please wait and contact support before trying again.', retryable: false } };
  }
  return null;
};

const getMtlsAgent = (): https.Agent => {
  if (mtlsAgent) return mtlsAgent;
  const certPath = (process.env.DRAPIXAI_AI_MTLS_CERT_FILE || '').trim();
  const keyPath = (process.env.DRAPIXAI_AI_MTLS_KEY_FILE || '').trim();
  const caPath = (process.env.NODE_EXTRA_CA_CERTS || '').trim();
  if (!certPath || !keyPath || !caPath) throw new Error('AI_MTLS_CLIENT_CERTIFICATE_MISSING');
  try {
    mtlsAgent = new https.Agent({
      ca: fs.readFileSync(caPath),
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
      keepAlive: true,
      maxSockets: 8,
      rejectUnauthorized: true,
    });
  } catch {
    throw new Error('AI_MTLS_CLIENT_CERTIFICATE_UNREADABLE');
  }
  return mtlsAgent;
};

const requestBody = (body: RequestInit['body']): Buffer | undefined => {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  throw new Error('AI_FETCH_BODY_UNSUPPORTED');
};

/** Routes API-to-AI calls through the configured private origin with production mTLS. */
export const aiFetch = async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
  const url = assertAiEndpoint(input);
  const limits = getAiTransportLimits();
  if (!mtlsEnabled()) {
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('AI_REQUEST_ABORTED'));
    if (init.signal?.aborted) abort(); else init.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('AI_REQUEST_TIMEOUT')), limits.timeoutMs);
    timer.unref();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
      const declared = Number(response.headers.get('content-length'));
      if (declared > limits.maxResponseBytes) throw new Error('AI_RESPONSE_TOO_LARGE');
      reader = response.body?.getReader();
      const chunks: Buffer[] = []; let length = 0;
      while (reader) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > limits.maxResponseBytes) throw new Error('AI_RESPONSE_TOO_LARGE');
        chunks.push(Buffer.from(value));
      }
      return bufferedResponse(Buffer.concat(chunks, length), response.status, response.statusText, response.headers);
    } catch (error) {
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      const code = controller.signal.reason?.message;
      if (code === 'AI_REQUEST_TIMEOUT' || code === 'AI_REQUEST_ABORTED') throw new Error(code);
      if (error instanceof Error && error.message === 'AI_RESPONSE_TOO_LARGE') throw error;
      throw new Error('AI_UPSTREAM_CONNECTION_FAILED');
    } finally {
      clearTimeout(timer); init.signal?.removeEventListener('abort', abort);
    }
  }
  if (url.protocol !== 'https:') throw new Error('AI_MTLS_REQUIRES_HTTPS');

  const body = requestBody(init.body);
  const headers = new Headers(init.headers);
  if (body && !headers.has('content-length')) headers.set('content-length', String(body.byteLength));
  const agent = getMtlsAgent();

  return new Promise<Response>((resolve, reject) => {
    let request: ReturnType<typeof https.request> | undefined;
    let incoming: import('node:http').IncomingMessage | undefined;
    let settled = false; const chunks: Buffer[] = []; let length = 0;
    const finish = (error?: string, response?: Response) => {
      if (settled) return; settled = true;
      clearTimeout(timer); init.signal?.removeEventListener('abort', abort);
      chunks.length = 0;
      if (error) { incoming?.destroy(); request?.destroy(); reject(new Error(error)); }
      else resolve(response!);
    };
    const abort = () => finish('AI_REQUEST_ABORTED');
    const timer = setTimeout(() => finish('AI_REQUEST_TIMEOUT'), limits.timeoutMs); timer.unref();
    if (init.signal?.aborted) { abort(); return; }
    init.signal?.addEventListener('abort', abort, { once: true });
    try { request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: init.method || 'GET',
      headers: Object.fromEntries(headers.entries()),
      agent,
      rejectUnauthorized: true,
    }, (response) => {
      incoming = response;
      if (Number(response.headers['content-length']) > limits.maxResponseBytes) { finish('AI_RESPONSE_TOO_LARGE'); return; }
      response.on('data', (chunk: Buffer) => {
        if (settled) return;
        length += chunk.byteLength;
        if (length > limits.maxResponseBytes) { finish('AI_RESPONSE_TOO_LARGE'); return; }
        chunks.push(Buffer.from(chunk));
      });
      response.on('error', () => finish('AI_RESPONSE_INCOMPLETE'));
      response.on('aborted', () => finish('AI_RESPONSE_INCOMPLETE'));
      response.on('close', () => { if (!response.complete) finish('AI_RESPONSE_INCOMPLETE'); });
      response.on('end', () => {
        if (settled) return;
        if (!response.complete) { finish('AI_RESPONSE_INCOMPLETE'); return; }
        try {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        finish(undefined, bufferedResponse(Buffer.concat(chunks, length), response.statusCode || 502, response.statusMessage || '', responseHeaders));
        } catch { finish('AI_RESPONSE_INVALID'); }
      });
    });
    request.on('error', () => finish('AI_UPSTREAM_CONNECTION_FAILED'));
    request.on('close', () => { if (!incoming) finish('AI_UPSTREAM_CONNECTION_FAILED'); });
    if (body) request.write(body);
    request.end();
    } catch { finish('AI_UPSTREAM_CONNECTION_FAILED'); }
  });
};

export const assertAiMtlsConfiguration = (): void => {
  getAiTransportLimits();
  if (process.env.NODE_ENV !== 'production') return;
  if (!mtlsEnabled()) throw new Error('DRAPIXAI_AI_MTLS_ENABLED must equal 1 in production');
  if (new URL(aiBaseUrl).protocol !== 'https:') throw new Error('DRAPIXAI_AI_URL must use HTTPS for mTLS');
  getMtlsAgent();
};
export const closeAiTransportForTests = () => {
  if (process.env.NODE_ENV !== 'test') throw new Error('TEST_ONLY_OPERATION');
  mtlsAgent?.destroy(); mtlsAgent = undefined;
};
