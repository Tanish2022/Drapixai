import crypto from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { normalizeShopDomain } from '../lib/shopify-auth';
import { lockShopifyLifecycle } from './shopify-catalog-state';
import { decryptShopifySecret, encryptShopifySecret } from '../lib/shopify-crypto';
import { runDatabaseTransaction } from '../lib/database-transaction';

export type ShopifyTokenLease = { shop: string; owner: string };
export type ShopifyOfflineTokens = {
  accessToken: string; refreshToken: string; scopes: string;
  accessTokenExpiresAt: Date; refreshTokenExpiresAt: Date;
};
const requiredScopes = new Set(['read_products', 'write_app_proxy']);
const tokenString = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 8192;
const expiresAt = (seconds: unknown, at: Date) => {
  if (!Number.isSafeInteger(seconds) || (seconds as number) <= 0 || (seconds as number) > 31536000) {
    throw new Error('SHOPIFY_EXPIRING_TOKEN_RESPONSE_INVALID');
  }
  return new Date(at.getTime() + (seconds as number) * 1000);
};
export const parseShopifyOfflineTokens = (value: unknown, at = new Date()): ShopifyOfflineTokens => {
  const payload = value as Record<string, unknown> | null;
  if (!payload || !tokenString(payload.access_token) || !tokenString(payload.refresh_token)
    || typeof payload.scope !== 'string' || payload.associated_user || !Number.isFinite(at.getTime())) {
    throw new Error('SHOPIFY_EXPIRING_TOKEN_RESPONSE_INVALID');
  }
  const scopes = new Set(payload.scope.split(',').map(s => s.trim()).filter(Boolean));
  if (scopes.size !== requiredScopes.size || [...scopes].some(s => !requiredScopes.has(s))) {
    throw new Error('SHOPIFY_REQUIRED_SCOPES_MISSING');
  }
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token, scopes: [...scopes].sort().join(','),
    accessTokenExpiresAt: expiresAt(payload.expires_in, at), refreshTokenExpiresAt: expiresAt(payload.refresh_token_expires_in, at) };
};

const requestShopifyTokenPayload = async (shop: string, fields: Record<string, string>) => {
  if (normalizeShopDomain(shop) !== shop) throw new Error('SHOPIFY_SHOP_DOMAIN_INVALID');
  const clientId = process.env.SHOPIFY_API_KEY, secret = process.env.SHOPIFY_API_SECRET;
  if (!clientId || !secret) throw new Error('SHOPIFY_CONFIGURATION_INCOMPLETE');
  const body = new URLSearchParams({ client_id: clientId, client_secret: secret, ...fields });
  let response: Response;
  const startedAt = new Date();
  try {
    response = await fetch(`https://${shop}/admin/oauth/access_token`, {method: 'POST', redirect: 'error',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body, signal: AbortSignal.timeout(15000)});
  } catch { throw new Error('SHOPIFY_TOKEN_TRANSPORT_RETRY'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error([400, 401, 403].includes(response.status) ? 'SHOPIFY_TOKEN_REAUTH_REQUIRED' : 'SHOPIFY_TOKEN_PROVIDER_RETRY');
  }
  if (!response.body || Number(response.headers.get('content-length')) > 65536) {
    await response.body?.cancel(); throw new Error('SHOPIFY_EXPIRING_TOKEN_RESPONSE_INVALID');
  }
  const reader = response.body.getReader(), chunks: Buffer[] = []; let length = 0;
  try {
    while (true) { const {done, value} = await reader.read(); if (done) break; length += value.byteLength;
      if (length > 65536) { await reader.cancel(); throw new Error('SHOPIFY_EXPIRING_TOKEN_RESPONSE_INVALID'); } chunks.push(Buffer.from(value)); }
    let payload: unknown; try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('SHOPIFY_EXPIRING_TOKEN_RESPONSE_INVALID'); }
    // Use request start, so network latency never extends the provider lifetime.
    return {payload, startedAt};
  } finally { reader.releaseLock(); }
};

const idTokenGrant = (idToken: string, kind: 'online' | 'offline') => ({
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: idToken,
  subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
  requested_token_type: `urn:shopify:params:oauth:token-type:${kind}-access-token`,
});
export const requestShopifyOfflineTokens = async (shop: string, input: {code: string} | {refreshToken: string} | {idToken: string}) => {
  const fields: Record<string, string> = 'code' in input ? {code: input.code, expiring: '1'} : 'idToken' in input
    ? {...idTokenGrant(input.idToken, 'offline'), expiring: '1'} : {grant_type: 'refresh_token', refresh_token: input.refreshToken};
  const {payload, startedAt} = await requestShopifyTokenPayload(shop, fields);
  return parseShopifyOfflineTokens(payload, startedAt);
};
// A signed ID token identifies staff, not their authority to bind a workspace.
// Confirm owner authority with Shopify; discard the online token and user data.
export const requireShopifyAccountOwner = async (shop: string, idToken: string, subject: string) => {
  const {payload} = await requestShopifyTokenPayload(shop, idTokenGrant(idToken, 'online'));
  const data = payload as any;
  if (!tokenString(data?.access_token) || !Number.isSafeInteger(data?.expires_in) || data.expires_in <= 0
    || data?.associated_user?.account_owner !== true || String(data.associated_user.id) !== subject) {
    throw new Error('SHOPIFY_ACCOUNT_OWNER_REQUIRED');
  }
};

// A durable per-shop lease covers both acquisition and refresh. Network calls
// happen outside SQL transactions; guarded commits fence expired/deleted leases.
export const withShopifyTokenLease = async <T>(prisma: PrismaClient, shop: string, operation: (lease: ShopifyTokenLease) => Promise<T>) => {
  if (normalizeShopDomain(shop) !== shop) throw new Error('SHOPIFY_SHOP_DOMAIN_INVALID');
  const owner = crypto.randomUUID();
  const rows = await prisma.$queryRaw<Array<{owner: string}>>`INSERT INTO "ShopifyTokenLease" ("shopDomain", "owner", "expiresAt")
    VALUES (${shop}, ${owner}, CURRENT_TIMESTAMP + INTERVAL '90 seconds')
    ON CONFLICT ("shopDomain") DO UPDATE SET "owner" = EXCLUDED."owner", "expiresAt" = EXCLUDED."expiresAt"
    WHERE "ShopifyTokenLease"."expiresAt" <= CURRENT_TIMESTAMP RETURNING "owner"`;
  if (rows.length !== 1 || rows[0].owner !== owner) throw new Error('SHOPIFY_TOKEN_BUSY');
  try { return await operation({shop, owner}); }
  finally {
    try { await prisma.shopifyTokenLease.deleteMany({where: {shopDomain: shop, owner}}); }
    catch { throw new Error('SHOPIFY_TOKEN_LEASE_RELEASE_FAILED'); }
  }
};
export const assertShopifyTokenLease = async (tx: Prisma.TransactionClient, lease: ShopifyTokenLease) => {
  const rows = await tx.$queryRaw<Array<{owner: string}>>`SELECT "owner" FROM "ShopifyTokenLease"
    WHERE "shopDomain" = ${lease.shop} AND "owner" = ${lease.owner} AND "expiresAt" > CURRENT_TIMESTAMP FOR UPDATE`;
  if (rows.length !== 1) throw new Error('SHOPIFY_TOKEN_LEASE_LOST');
};
export const encryptedShopifyTokenData = (tokens: ShopifyOfflineTokens) => ({
  encryptedAccessToken: encryptShopifySecret(tokens.accessToken), encryptedRefreshToken: encryptShopifySecret(tokens.refreshToken),
  accessTokenExpiresAt: tokens.accessTokenExpiresAt, refreshTokenExpiresAt: tokens.refreshTokenExpiresAt, scopes: tokens.scopes,
});
const requireReauth = async (prisma: PrismaClient, lease: ShopifyTokenLease, id: number) => runDatabaseTransaction(prisma, async tx => {
  await lockShopifyLifecycle(tx, lease.shop);
  await assertShopifyTokenLease(tx, lease);
  const current = await tx.shopifyInstallation.findUnique({where: {id}});
  if (!current || current.status !== 'active') throw new Error('SHOPIFY_INSTALLATION_NOT_ACTIVE');
  await tx.shopifyInstallation.update({where: {id}, data: {status: 'reauth_required', encryptedAccessToken: '',
    encryptedRefreshToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null, linkTokenHash: null, linkTokenExpiresAt: null}});
  if (current.storefrontApiKeyId) await tx.apiKey.updateMany({where: {id: current.storefrontApiKeyId, userId: current.userId!}, data: {isActive: false, revokedAt: new Date()}});
});
export const getShopifyAccessToken = async (prisma: PrismaClient, id: number) => {
  const installation = await prisma.shopifyInstallation.findUnique({where: {id}});
  if (!installation || installation.status !== 'active') throw new Error('SHOPIFY_INSTALLATION_NOT_ACTIVE');
  return withShopifyTokenLease(prisma, installation.shopDomain, async lease => {
    const current = await prisma.shopifyInstallation.findUnique({where: {id}});
    if (!current || current.status !== 'active' || current.shopDomain !== lease.shop) throw new Error('SHOPIFY_INSTALLATION_NOT_ACTIVE');
    if (!current.accessTokenExpiresAt || !current.refreshTokenExpiresAt || !current.encryptedRefreshToken
      || current.refreshTokenExpiresAt <= new Date() || !current.encryptedAccessToken) {
      await requireReauth(prisma, lease, id); throw new Error('SHOPIFY_TOKEN_REAUTH_REQUIRED');
    }
    if (current.accessTokenExpiresAt.getTime() > Date.now() + 300000) return decryptShopifySecret(current.encryptedAccessToken);
    let tokens: ShopifyOfflineTokens;
    try { tokens = await requestShopifyOfflineTokens(current.shopDomain, {refreshToken: decryptShopifySecret(current.encryptedRefreshToken)}); }
    catch (error) {
      if (error instanceof Error && error.message === 'SHOPIFY_TOKEN_REAUTH_REQUIRED') await requireReauth(prisma, lease, id);
      throw error;
    }
    await runDatabaseTransaction(prisma, async tx => {
      await lockShopifyLifecycle(tx, lease.shop);
      await assertShopifyTokenLease(tx, lease);
      const updated = await tx.shopifyInstallation.updateMany({where: {id, status: 'active', encryptedRefreshToken: current.encryptedRefreshToken}, data: encryptedShopifyTokenData(tokens)});
      if (updated.count !== 1) throw new Error('SHOPIFY_TOKEN_STATE_CHANGED');
    });
    return tokens.accessToken;
  });
};
