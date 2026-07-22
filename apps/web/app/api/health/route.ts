import { NextResponse } from 'next/server';

import { PUBLIC_API_BASE_URL, getPublicWebBaseUrl } from '@/app/lib/public-env';

export const dynamic = 'force-dynamic';

export async function GET() {
  let apiReady = false;
  let dataReady = false;
  let aiReady = false;

  try {
    const response = await fetch(`${PUBLIC_API_BASE_URL}/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const payload = (await response.json().catch(() => null)) as {
      status?: string;
      checks?: {
        database?: boolean | { ready?: boolean };
        redis?: boolean;
        ai?: boolean | { status?: string };
      };
    } | null;
    const database = payload?.checks?.database;
    const ai = payload?.checks?.ai;
    // A dependency-level 503 still proves the API is reachable and reporting its
    // own fault domain. Data and AI readiness are represented separately below.
    apiReady = payload?.status === 'ready' || payload?.status === 'not_ready';
    dataReady = (database === true || (typeof database === 'object' && database?.ready === true)) && payload?.checks?.redis === true;
    aiReady = ai === true || (typeof ai === 'object' && ai?.status === 'ready');
  } catch {
    apiReady = false;
  }

  return NextResponse.json({
    status: apiReady && dataReady && aiReady ? 'operational' : 'degraded',
    webBaseUrl: getPublicWebBaseUrl(),
    checkedAt: new Date().toISOString(),
    services: {
      storefront: true,
      api: apiReady,
      data: dataReady,
      ai: aiReady,
    },
  });
}
