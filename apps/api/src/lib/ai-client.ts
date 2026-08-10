import fs from 'fs';
import https from 'https';

const aiBaseUrl = (process.env.DRAPIXAI_AI_URL || 'http://localhost:8080').replace(/\/+$/, '');
const aiOrigin = new URL(aiBaseUrl).origin;
let mtlsAgent: https.Agent | undefined;

const mtlsEnabled = () => process.env.DRAPIXAI_AI_MTLS_ENABLED === '1';

const assertAiEndpoint = (input: string | URL): URL => {
  const url = new URL(input.toString());
  if (url.origin !== aiOrigin) throw new Error('AI_ENDPOINT_ORIGIN_DENIED');
  return url;
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
  if (!mtlsEnabled()) return fetch(url, init);
  if (url.protocol !== 'https:') throw new Error('AI_MTLS_REQUIRES_HTTPS');

  const body = requestBody(init.body);
  const headers = new Headers(init.headers);
  if (body && !headers.has('content-length')) headers.set('content-length', String(body.byteLength));
  const agent = getMtlsAgent();

  return new Promise<Response>((resolve, reject) => {
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: init.method || 'GET',
      headers: Object.fromEntries(headers.entries()),
      agent,
      rejectUnauthorized: true,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on('error', reject);
      response.on('end', () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode || 502,
          statusText: response.statusMessage || '',
          headers: responseHeaders,
        }));
      });
    });
    const abort = () => request.destroy(init.signal?.reason instanceof Error ? init.signal.reason : new Error('AI_REQUEST_ABORTED'));
    if (init.signal) {
      if (init.signal.aborted) abort();
      else {
        init.signal.addEventListener('abort', abort, { once: true });
        request.once('close', () => init.signal?.removeEventListener('abort', abort));
      }
    }
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
};

export const assertAiMtlsConfiguration = (): void => {
  if (process.env.NODE_ENV !== 'production') return;
  if (!mtlsEnabled()) throw new Error('DRAPIXAI_AI_MTLS_ENABLED must equal 1 in production');
  if (new URL(aiBaseUrl).protocol !== 'https:') throw new Error('DRAPIXAI_AI_URL must use HTTPS for mTLS');
  getMtlsAgent();
};
