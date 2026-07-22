/** @type {import('next').NextConfig} */
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';

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
