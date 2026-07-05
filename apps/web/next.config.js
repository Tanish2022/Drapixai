/** @type {import('next').NextConfig} */
const path = require('path');

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');
const webBaseUrl = trimTrailingSlash(process.env.NEXT_PUBLIC_WEB_BASE_URL || 'http://localhost:3000');
const apiBaseUrl = trimTrailingSlash(process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000');
const demoVideoUrl = String(process.env.NEXT_PUBLIC_DEMO_VIDEO_URL || '').trim();
const isProduction = process.env.NODE_ENV === 'production';

const parseCspOrigins = (value) => String(value || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean)
  .filter((origin) => {
    try {
      const parsed = new URL(origin);
      return parsed.protocol === 'https:' || (!isProduction && parsed.protocol === 'http:');
    } catch {
      return false;
    }
  });

const extraConnectSources = parseCspOrigins(
  process.env.DRAPIXAI_WEB_CSP_CONNECT_SRC || process.env.NEXT_PUBLIC_CSP_CONNECT_SRC || '',
);

const cspSources = {
  connect: ["'self'", webBaseUrl, apiBaseUrl, ...extraConnectSources, ...(isProduction ? [] : ['https:'])],
  frame: ["'self'", 'https://www.youtube.com', 'https://youtube.com', 'https://player.vimeo.com'],
  media: ["'self'", 'blob:', 'data:', 'https:'],
};

try {
  if (demoVideoUrl) {
    const demoOrigin = new URL(demoVideoUrl).origin;
    cspSources.frame.push(demoOrigin);
    cspSources.media.push(demoOrigin);
  }
} catch {
  // Ignore malformed optional demo video URLs here; runtime code handles the fallback UI.
}

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  `connect-src ${Array.from(new Set(cspSources.connect)).join(' ')}`,
  `media-src ${Array.from(new Set(cspSources.media)).join(' ')}`,
  `frame-src ${Array.from(new Set(cspSources.frame)).join(' ')}`,
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProduction ? ['upgrade-insecure-requests'] : []),
].join('; ');

const privateNoIndexHeaders = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
];

const privateNoIndexSources = [
  '/api/:path*',
  '/admin',
  '/admin/:path*',
  '/admin-access',
  '/dashboard',
  '/dashboard/:path*',
  '/settings',
  '/settings/:path*',
  '/sdk-install',
  '/subscription',
];

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ...(isProduction ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }] : []),
];

const nextConfig = {
  poweredByHeader: false,
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  turbopack: {
    root: path.join(__dirname, '..', '..'),
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      ...privateNoIndexSources.map((source) => ({
        source,
        headers: privateNoIndexHeaders,
      })),
    ];
  },
}

module.exports = nextConfig
