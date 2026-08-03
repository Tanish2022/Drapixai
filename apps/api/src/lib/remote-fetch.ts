import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';

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

const normalizeHostname = (hostname: string) => hostname.trim().toLowerCase().replace(/\.$/, '');

const isPrivateIpv4 = (address: string) => {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 168 ||
    a >= 224
  );
};

const isPrivateIpv6 = (address: string) => {
  const normalized = address.toLowerCase();
  const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('ff')
  );
};

const isPublicIp = (address: string) => {
  const family = net.isIP(address);
  if (family === 4) return !isPrivateIpv4(address);
  if (family === 6) return !isPrivateIpv6(address);
  return false;
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
    if (!isPublicIp(hostname)) throw new Error('REMOTE_HOST_NOT_ALLOWED');
    return { url: parsed, address: hostname, family: net.isIP(hostname) as 4 | 6 };
  }

  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some((record) => !isPublicIp(record.address))) {
    throw new Error('REMOTE_HOST_NOT_ALLOWED');
  }

  return {
    url: parsed,
    address: records[0].address,
    family: records[0].family as 4 | 6,
  };
};

const fetchPinned = async (target: PinnedUrl, maxBytes: number, timeoutMs: number) => {
  const transport = target.url.protocol === 'https:' ? https : http;

  return new Promise<{ response: Response; buffer: Buffer }>((resolve, reject) => {
    const request = transport.request(target.url, {
      servername: target.url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
      headers: {
        Accept: '*/*',
        'User-Agent': 'DrapixAI-SecureFetcher/1.0',
      },
    }, (incoming) => {
      const status = incoming.statusCode || 0;
      if (status >= 300 && status < 400) {
        incoming.resume();
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
        const body = Buffer.concat(chunks);
        resolve({
          response: new Response(body, { status, headers }),
          buffer: body,
        });
      });
      incoming.on('error', reject);
    });

    request.setTimeout(timeoutMs, () => request.destroy(new Error('REMOTE_FETCH_TIMEOUT')));
    request.on('error', reject);
    request.end();
  });
};

export const safePostJson = async (
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  options: SafeFetchOptions = {},
) => {
  const target = await assertSafeUrl(rawUrl, options.allowedProtocols || ['https:']);
  const maxBytes = options.maxBytes || 64 * 1024;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const transport = target.url.protocol === 'https:' ? https : http;

  return new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
    const request = transport.request(target.url, {
      method: 'POST',
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
        incoming.resume();
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
    request.setTimeout(timeoutMs, () => request.destroy(new Error('REMOTE_FETCH_TIMEOUT')));
    request.on('error', reject);
    request.write(body);
    request.end();
  });
};

export const safeFetchText = async (rawUrl: string, options: SafeFetchOptions = {}) => {
  const allowedProtocols = options.allowedProtocols || ['https:'];
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const target = await assertSafeUrl(rawUrl, allowedProtocols);
  const { response, buffer } = await fetchPinned(target, maxBytes, timeoutMs);

  return {
    response,
    text: buffer.toString('utf8'),
  };
};

export const safeFetchBuffer = async (rawUrl: string, options: SafeFetchOptions = {}) => {
  const allowedProtocols = options.allowedProtocols || ['https:'];
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const target = await assertSafeUrl(rawUrl, allowedProtocols);
  return fetchPinned(target, maxBytes, timeoutMs);
};

export const normalizePublicDomain = (value: string) => {
  const raw = value.trim().toLowerCase();
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('INVALID_DOMAIN');
  }
  return normalizeHostname(parsed.hostname);
};
