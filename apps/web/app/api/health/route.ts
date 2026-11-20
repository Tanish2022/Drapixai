import { NextResponse } from 'next/server';

import { SERVER_API_BASE_URL } from '@/app/lib/server-env';
import { getPublicWebBaseUrl } from '@/app/lib/public-env';

export const dynamic = 'force-dynamic';

export async function GET() {
  let apiReady = false;
  let dataReady = false;
  let aiReady = false;
  let inferenceDisabled = false;

  try {
    const response = await fetch(`${SERVER_API_BASE_URL}/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const payload = (await response.json().catch(() => null)) as {
      status?: string;
      checks?: {
        database?: boolean | { ready?: boolean };
        redis?: boolean;
        ai?: boolean | { status?: string };
        inferenceEnabled?: boolean;
      };
    } | null;
    const database = payload?.checks?.database;
    const ai = payload?.checks?.ai;
    // A dependency-level 503 still proves the API is reachable and reporting its
    // own fault domain. Data and AI readiness are represented separately below.
    apiReady = (response.ok && payload?.status === 'ready') || (response.status === 503 && payload?.status === 'not_ready');
    dataReady = apiReady && (database === true || (typeof database === 'object' && database?.ready === true)) && payload?.checks?.redis === true;
    inferenceDisabled = apiReady && payload?.checks?.inferenceEnabled === false;
    aiReady = apiReady && (ai === true || (typeof ai === 'object' && ai?.status === 'ready'));
  } catch {
    apiReady = false;
  }

  const operational = apiReady && dataReady && (aiReady || inferenceDisabled);
  return NextResponse.json({
    status: operational ? 'operational' : 'degraded',
    inferenceDisabled,
    webBaseUrl: getPublicWebBaseUrl(),
    checkedAt: new Date().toISOString(),
    services: {
      storefront: true,
      api: apiReady,
      data: dataReady,
      ai: aiReady,
    },
  }, { status: operational ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
