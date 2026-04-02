import { NextResponse } from 'next/server';

import { PUBLIC_API_BASE_URL, getPublicWebBaseUrl } from '@/app/lib/public-env';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    webBaseUrl: getPublicWebBaseUrl(),
    apiBaseUrl: PUBLIC_API_BASE_URL,
  });
}
