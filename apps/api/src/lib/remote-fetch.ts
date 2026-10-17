import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';
import { isPublicRemoteAddress, normalizeRemoteHostname } from './network-address';

type SafeFetchOptions = {
  allowedProtocols?: string[];
  maxBytes?: number;
  timeoutMs?: number;
};

type PinnedUrl = {
  url: URL;
  address: string;
  family: 4 | 6;
};

const DEFAULT_MAX_BYTES = Number(process.env.DRAPIXAI_REMOTE_FETCH_MAX_BYTES || 2 * 1024 * 1024);
const DEFAULT_TIMEOUT_MS = Number(process.env.DRAPIXAI_REMOTE_FETCH_TIMEOUT_MS || 8000);

const normalizeHostname = normalizeRemoteHostname;

// One budget covers DNS, connection/TLS, upload and the complete response.
// A socket inactivity timeout alone can be extended indefinitely by a slow drip.
const withRemoteDeadline = async <T>(
  options: SafeFetchOptions,
  defaultMaxBytes: number,
  operation: (signal: AbortSignal, maxBytes: number) => Promise<T>,
): Promise<T> => {
  const maxBytes = options.maxBytes ?? defaultMaxBytes;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) {
    throw new Error('REMOTE_FETCH_LIMITS_INVALID');
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error('REMOTE_FETCH_TIMEOUT');
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal, maxBytes), deadline]);
  } catch (error) {
    const failure = controller.signal.aborted ? controller.signal.reason : error;
    // Also close the request on redirects, oversized responses and decode errors.
    controller.abort(failure);
    throw failure;
  } finally {
    clearTimeout(timer!);
  }
};

const assertSafeUrl = async (rawUrl: string, allowedProtocols: string[]): Promise<PinnedUrl> => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('INVALID_REMOTE_URL');
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error('REMOTE_URL_PROTOCOL_NOT_ALLOWED');
  }

  if (parsed.username || parsed.password) {
    throw new Error('REMOTE_URL_CREDENTIALS_NOT_ALLOWED');
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('REMOTE_HOST_NOT_ALLOWED');
  }

  if (net.isIP(hostname)) {
    if (!isPublicRemoteAddress(hostname)) throw new Error('REMOTE_HOST_NOT_ALLOWED');
    return { url: parsed, address: hostname, family: net.isIP(hostname) as 4 | 6 };
  }

  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some((record) => !isPublicRemoteAddress(record.address))) {
    throw new Error('REMOTE_HOST_NOT_ALLOWED');
  }

  return {
    url: parsed,
    address: records[0].address,
    family: records[0].family as 4 | 6,
  };
};

const fetchPinned = async (target: PinnedUrl, maxBytes: number, signal: AbortSignal) => {
  signal.throwIfAborted();
  const transport = target.url.protocol === 'https:' ? https : http;

  return new Promise<{ response: Response; buffer: Buffer }>((resolve, reject) => {
    const request = transport.request(target.url, {
      signal,
      family: target.family,
      servername: target.url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
      headers: {
        Accept: '*/*',
        'User-Agent': 'DrapixAI-SecureFetcher/1.0',
      },
    }, (incoming) => {
      // Install before any early size rejection can destroy the response.
      incoming.on('error', reject);
      const status = incoming.statusCode || 0;
      if (status >= 300 && status < 400) {
        reject(new Error('REMOTE_REDIRECT_NOT_ALLOWED'));
        return;
      }

      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, String(value));
      }

      const contentLength = Number(headers.get('content-length') || 0);
      if (contentLength > maxBytes) {
        incoming.destroy(new Error('REMOTE_RESPONSE_TOO_LARGE'));
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      incoming.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          incoming.destroy(new Error('REMOTE_RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      incoming.on('end', () => {
        try {
          const body = Buffer.concat(chunks);
          resolve({
            response: new Response(body.byteLength ? body : null, { status, headers }),
            buffer: body,
          });
        } catch (error) { reject(error); }
      });
    });

    request.on('error', reject);
    request.end();
  });
};

export const safePostJson = async (
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  options: SafeFetchOptions = {},
) => withRemoteDeadline(options, 64 * 1024, async (signal, maxBytes) => {
  const target = await assertSafeUrl(rawUrl, options.allowedProtocols || ['https:']);
  signal.throwIfAborted();
  const transport = target.url.protocol === 'https:' ? https : http;

  return new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
    const request = transport.request(target.url, {
      signal,
      method: 'POST',
      family: target.family,
      servername: target.url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
        'User-Agent': 'DrapixAI-Webhook/1.0',
        ...headers,
      },
    }, (incoming) => {
      const status = incoming.statusCode || 0;
      if (status >= 300 && status < 400) {
        reject(new Error('REMOTE_REDIRECT_NOT_ALLOWED'));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      incoming.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          incoming.destroy(new Error('REMOTE_RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      incoming.on('end', () => resolve({ status, body: Buffer.concat(chunks) }));
      incoming.on('error', reject);
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
});

export const safeFetchText = async (rawUrl: string, options: SafeFetchOptions = {}) => {
  const { response, buffer } = await safeFetchBuffer(rawUrl, options);

  return {
    response,
    text: buffer.toString('utf8'),
  };
};

export const safeFetchBuffer = async (rawUrl: string, options: SafeFetchOptions = {}) => {
  return withRemoteDeadline(options, DEFAULT_MAX_BYTES, async (signal, maxBytes) => {
    const target = await assertSafeUrl(rawUrl, options.allowedProtocols || ['https:']);
    return fetchPinned(target, maxBytes, signal);
  });
};

export const normalizePublicDomain = (value: string) => {
  const raw = value.trim().toLowerCase();
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('INVALID_DOMAIN');
  }
  return parsed.hostname.trim().toLowerCase().replace(/\.$/, '');
};
