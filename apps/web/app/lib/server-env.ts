const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const SERVER_API_BASE_URL = trimTrailingSlash(
  process.env.DRAPIXAI_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'
);
