const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const PUBLIC_API_BASE_URL = trimTrailingSlash(
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'
);

export const GOOGLE_AUTH_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === '1';
export const DEMO_VIDEO_URL = (process.env.NEXT_PUBLIC_DEMO_VIDEO_URL || '').trim();

export function getPublicWebBaseUrl() {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_WEB_BASE_URL;
  if (configuredBaseUrl) {
    return trimTrailingSlash(configuredBaseUrl);
  }

  if (typeof window !== 'undefined') {
    return trimTrailingSlash(window.location.origin);
  }

  return 'http://localhost:3000';
}

export function getSdkScriptUrl() {
  return `${getPublicWebBaseUrl()}/sdk.js`;
}
