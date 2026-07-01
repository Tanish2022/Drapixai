import dns from 'dns/promises';
import net from 'net';

type SafeFetchOptions = {
  allowedProtocols?: string[];
  maxBytes?: number;
  timeoutMs?: number;
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

const assertSafeUrl = async (rawUrl: string, allowedProtocols: string[]) => {
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
    return parsed;
  }

  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some((record) => !isPublicIp(record.address))) {
    throw new Error('REMOTE_HOST_NOT_ALLOWED');
  }

  return parsed;
};

export const safeFetchText = async (rawUrl: string, options: SafeFetchOptions = {}) => {
  const allowedProtocols = options.allowedProtocols || ['https:'];
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const url = await assertSafeUrl(rawUrl, allowedProtocols);

  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    throw new Error('REMOTE_RESPONSE_TOO_LARGE');
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return { response, text: '' };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error('REMOTE_RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }

  return {
    response,
    text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'),
  };
};

export const safeFetchBuffer = async (rawUrl: string, options: SafeFetchOptions = {}) => {
  const allowedProtocols = options.allowedProtocols || ['https:'];
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const url = await assertSafeUrl(rawUrl, allowedProtocols);

  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    throw new Error('REMOTE_RESPONSE_TOO_LARGE');
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return { response, buffer: Buffer.alloc(0) };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error('REMOTE_RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }

  return {
    response,
    buffer: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
  };
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
