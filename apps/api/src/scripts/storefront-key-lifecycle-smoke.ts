import 'dotenv/config';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { hashApiKey, issueApiKeyForUser } from '../lib/api-key-auth';

const prisma = new PrismaClient();
const apiUrl = (process.env.API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const dashboardProxyToken = (process.env.DRAPIXAI_DASHBOARD_PROXY_TOKEN || '').trim();

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const dashboardHeaders = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  ...(dashboardProxyToken ? { 'x-drapixai-dashboard-proxy-token': dashboardProxyToken } : {}),
});

const run = async () => {
  const suffix = crypto.randomBytes(8).toString('hex');
  const email = `storefront-key-smoke-${suffix}@example.invalid`;
  const password = `Smoke-${crypto.randomBytes(18).toString('base64url')}`;
  let userId: number | null = null;

  try {
    const user = await prisma.user.create({
      data: {
        email,
        emailVerifiedAt: new Date(),
        passwordHash: await bcrypt.hash(password, 10),
        companyName: 'DrapixAI lifecycle smoke',
        planType: 'trial',
        subscriptionStatus: 'trialing',
      },
    });
    userId = user.id;

    const firstDashboardKey = await issueApiKeyForUser(prisma, user.id, {
      kind: 'dashboard',
      domainWhitelist: 'smoke.example.com',
    });

    const rotateResponse = await fetch(`${apiUrl}/analytics/api-key/rotate`, {
      method: 'POST',
      headers: dashboardHeaders(firstDashboardKey),
    });
    const rotatePayload = await rotateResponse.json() as { apiKey?: string; kind?: string; error?: string };
    assertCondition(rotateResponse.ok, `Storefront key creation failed: ${rotatePayload.error || rotateResponse.status}`);
    assertCondition(rotatePayload.kind === 'manual', 'Storefront key endpoint returned the wrong key kind');
    assertCondition(rotatePayload.apiKey, 'Storefront key endpoint did not return the one-time secret');
    const storefrontKey = rotatePayload.apiKey;

    const storedStorefrontKey = await prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(storefrontKey) },
    });
    assertCondition(storedStorefrontKey?.kind === 'manual', 'Stored storefront key is not a manual key');
    assertCondition(storedStorefrontKey.isActive, 'New storefront key is inactive');
    assertCondition(storedStorefrontKey.domainWhitelist === 'smoke.example.com', 'Storefront key did not inherit the verified domain');

    await prisma.user.update({
      where: { id: user.id },
      data: { storeVerifiedAt: new Date() },
    });
    const corsResponse = await fetch(`${apiUrl}/sdk/validate`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://smoke.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    assertCondition(corsResponse.ok, `Verified storefront CORS preflight failed with ${corsResponse.status}`);
    assertCondition(corsResponse.headers.get('access-control-allow-origin') === 'https://smoke.example.com', 'Verified storefront origin was not reflected by CORS');

    const legacyRenderResponse = await fetch(`${apiUrl}/sdk/render`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${storefrontKey}`,
        Origin: 'https://smoke.example.com',
      },
    });
    const legacyRenderPayload = await legacyRenderResponse.json() as { error?: string };
    assertCondition(legacyRenderResponse.status === 410, 'Legacy async render did not fail closed');
    assertCondition(legacyRenderPayload.error === 'LEGACY_ASYNC_RENDER_DISABLED', 'Legacy async render returned the wrong error');

    const loginResponse = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, issueNewKey: true }),
    });
    const loginPayload = await loginResponse.json() as { apiKey?: string; error?: string };
    assertCondition(loginResponse.ok, `Second dashboard login failed: ${loginPayload.error || loginResponse.status}`);
    assertCondition(loginPayload.apiKey, 'Second dashboard login did not return a dashboard key');

    const [oldDashboard, nextDashboard, survivingStorefront] = await Promise.all([
      prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(firstDashboardKey) } }),
      prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(loginPayload.apiKey) } }),
      prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(storefrontKey) } }),
    ]);
    assertCondition(oldDashboard?.isActive === false, 'Previous dashboard key was not rotated');
    assertCondition(nextDashboard?.kind === 'dashboard' && nextDashboard.isActive, 'Replacement dashboard key is invalid');
    assertCondition(survivingStorefront?.kind === 'manual' && survivingStorefront.isActive, 'Dashboard login revoked the storefront key');

    const statusResponse = await fetch(`${apiUrl}/analytics/api-key/status`, {
      headers: dashboardHeaders(loginPayload.apiKey),
    });
    const statusPayload = await statusResponse.json() as { exists?: boolean; key?: { domainWhitelist?: string } };
    assertCondition(statusResponse.ok, `Storefront key status failed with ${statusResponse.status}`);
    assertCondition(statusPayload.exists === true, 'Storefront key status did not report the active key');
    assertCondition(statusPayload.key?.domainWhitelist === 'smoke.example.com', 'Storefront key status returned the wrong domain');

    console.log('Storefront key lifecycle smoke passed.');
  } finally {
    if (userId !== null) {
      await prisma.apiKey.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Storefront key lifecycle smoke failed');
  process.exit(1);
});
