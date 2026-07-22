import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const MODERN_API_KEY_PREFIX = 'dpx_';
const LEGACY_API_KEY_PATTERN = /^[a-f0-9]{32}$/i;
const STOREFRONT_TOKEN_PREFIX = 'dpxst_';
const GENERIC_STOREFRONT_TOKEN_PREFIX = 'dpxsf_';
const DASHBOARD_PREVIEW_TOKEN_PREFIX = 'dpxpv_';

export type ApiKeyKind = 'dashboard' | 'manual' | 'shopify';
export type StorefrontCredentialContext = {
  channel: 'web' | 'mobile';
  allowedDomain: string | null;
  appId: string | null;
  productIds: string[];
  purpose: 'tryon';
};

export const isStorefrontProductAllowed = (
  context: StorefrontCredentialContext | null | undefined,
  productId: unknown,
) => !context || context.productIds.includes(String(productId || '').trim());

export const generateApiKey = () => `${MODERN_API_KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;

export const hashApiKey = (apiKey: string) =>
  crypto.createHash('sha256').update(apiKey, 'utf8').digest('hex');

export const issueApiKeyForUser = async (
  prisma: PrismaClient,
  userId: number,
  options: {
    kind?: ApiKeyKind;
    label?: string;
    domainWhitelist?: string;
    deactivateExisting?: boolean;
    expiresAt?: Date | null;
    scopes?: string[];
  } = {},
) => {
  const kind = options.kind || 'dashboard';
  const defaultExpiry = kind === 'dashboard' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null;
  const defaultScopes = kind === 'dashboard'
    ? ['dashboard']
    : kind === 'shopify'
      ? ['shopify:storefront']
      : ['storefront:tryon'];
  const apiKey = generateApiKey();
  const keyHash = hashApiKey(apiKey);

  const operations = [];
  if (options.deactivateExisting !== false) {
    operations.push(prisma.apiKey.updateMany({
      where: { userId, kind, isActive: true },
      data: { isActive: false, revokedAt: new Date() },
    }));
  }
  operations.push(prisma.apiKey.create({
    data: {
      userId,
      keyHash,
      kind,
      label: options.label || null,
      domainWhitelist: options.domainWhitelist || '*',
      scopes: (options.scopes || defaultScopes).join(','),
      expiresAt: options.expiresAt === undefined ? defaultExpiry : options.expiresAt,
    },
  }));
  await prisma.$transaction(operations);

  return apiKey;
};

const getStorefrontTokenSecret = () => {
  const secret = (process.env.DRAPIXAI_STOREFRONT_TOKEN_SECRET || '').trim();
  if (secret.length < 32) throw new Error('STOREFRONT_TOKEN_SECRET_NOT_CONFIGURED');
  return secret;
};

const getDashboardPreviewTokenSecret = () => {
  const secret = (process.env.JWT_SECRET || '').trim();
  if (secret.length < 32) throw new Error('DASHBOARD_PREVIEW_TOKEN_SECRET_NOT_CONFIGURED');
  return secret;
};

export const issueDashboardPreviewToken = (input: {
  apiKeyId: number;
  userId: number;
  allowedDomain: string;
}) => `${DASHBOARD_PREVIEW_TOKEN_PREFIX}${jwt.sign(
  {
    kind: 'dashboard-preview',
    apiKeyId: input.apiKeyId,
    userId: input.userId,
    allowedDomain: input.allowedDomain.toLowerCase(),
  },
  getDashboardPreviewTokenSecret(),
  { algorithm: 'HS256', audience: 'drapixai-sdk-preview', issuer: 'drapixai-api', expiresIn: '15m' },
)}`;

export const issueStorefrontToken = (input: {
  apiKeyId: number;
  userId: number;
  shopDomain: string;
  allowedDomain: string;
  productIds: string[];
}) => `${STOREFRONT_TOKEN_PREFIX}${jwt.sign(
  {
    kind: 'shopify-storefront',
    apiKeyId: input.apiKeyId,
    userId: input.userId,
    shopDomain: input.shopDomain,
    allowedDomain: input.allowedDomain,
    productIds: input.productIds,
    purpose: 'tryon',
  },
  getStorefrontTokenSecret(),
  { algorithm: 'HS256', audience: 'drapixai-storefront', issuer: 'drapixai-api', expiresIn: '5m' },
)}`;

export const issueGenericStorefrontToken = (input: {
  apiKeyId: number;
  userId: number;
  channel: 'web' | 'mobile';
  allowedDomain?: string | null;
  appId?: string | null;
  productIds: string[];
}) => `${GENERIC_STOREFRONT_TOKEN_PREFIX}${jwt.sign(
  {
    kind: 'generic-storefront',
    apiKeyId: input.apiKeyId,
    userId: input.userId,
    channel: input.channel,
    allowedDomain: input.allowedDomain || null,
    appId: input.appId || null,
    productIds: input.productIds,
    purpose: 'tryon',
    jti: crypto.randomUUID(),
  },
  getStorefrontTokenSecret(),
  { algorithm: 'HS256', audience: 'drapixai-storefront', issuer: 'drapixai-api', expiresIn: '5m' },
)}`;

const parseScopedProductIds = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return null;
  const productIds = value.map((item) => typeof item === 'string' ? item.trim() : '');
  if (productIds.some((item) => !item || item.length > 160)) return null;
  return [...new Set(productIds)];
};

const resolveStorefrontToken = async (prisma: PrismaClient, credential: string) => {
  if (!credential.startsWith(STOREFRONT_TOKEN_PREFIX)) return null;
  try {
    const claims = jwt.verify(
      credential.slice(STOREFRONT_TOKEN_PREFIX.length),
      getStorefrontTokenSecret(),
      { algorithms: ['HS256'], audience: 'drapixai-storefront', issuer: 'drapixai-api' },
    ) as jwt.JwtPayload;
    const productIds = parseScopedProductIds(claims.productIds);
    if (
      claims.kind !== 'shopify-storefront'
      || !Number.isInteger(claims.apiKeyId)
      || !Number.isInteger(claims.userId)
      || typeof claims.allowedDomain !== 'string'
      || !claims.allowedDomain.trim()
      || claims.purpose !== 'tryon'
      || !productIds
    ) {
      return null;
    }
    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id: Number(claims.apiKeyId),
        userId: Number(claims.userId),
        kind: 'shopify',
        isActive: true,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return apiKey ? {
      apiKey,
      context: {
        channel: 'web' as const,
        allowedDomain: claims.allowedDomain.trim().toLowerCase(),
        appId: null,
        productIds,
        purpose: 'tryon' as const,
      },
    } : null;
  } catch {
    return null;
  }
};

const resolveGenericStorefrontToken = async (prisma: PrismaClient, credential: string) => {
  if (!credential.startsWith(GENERIC_STOREFRONT_TOKEN_PREFIX)) return null;
  try {
    const claims = jwt.verify(
      credential.slice(GENERIC_STOREFRONT_TOKEN_PREFIX.length),
      getStorefrontTokenSecret(),
      { algorithms: ['HS256'], audience: 'drapixai-storefront', issuer: 'drapixai-api' },
    ) as jwt.JwtPayload;
    const productIds = parseScopedProductIds(claims.productIds);
    const channel = claims.channel === 'web' || claims.channel === 'mobile' ? claims.channel : null;
    const allowedDomain = typeof claims.allowedDomain === 'string' ? claims.allowedDomain.trim().toLowerCase() : null;
    const appId = typeof claims.appId === 'string' ? claims.appId.trim() : null;
    if (
      claims.kind !== 'generic-storefront'
      || !Number.isInteger(claims.apiKeyId)
      || !Number.isInteger(claims.userId)
      || claims.purpose !== 'tryon'
      || !channel
      || !productIds
      || (channel === 'web' && !allowedDomain)
      || (channel === 'mobile' && !appId)
    ) {
      return null;
    }
    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id: Number(claims.apiKeyId),
        userId: Number(claims.userId),
        kind: 'manual',
        isActive: true,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return apiKey ? {
      apiKey,
      context: {
        channel,
        allowedDomain: channel === 'web' ? allowedDomain : null,
        appId: channel === 'mobile' ? appId : null,
        productIds,
        purpose: 'tryon' as const,
      },
    } : null;
  } catch {
    return null;
  }
};

const resolveDashboardPreviewToken = async (prisma: PrismaClient, credential: string) => {
  if (!credential.startsWith(DASHBOARD_PREVIEW_TOKEN_PREFIX)) return null;
  try {
    const claims = jwt.verify(
      credential.slice(DASHBOARD_PREVIEW_TOKEN_PREFIX.length),
      getDashboardPreviewTokenSecret(),
      { algorithms: ['HS256'], audience: 'drapixai-sdk-preview', issuer: 'drapixai-api' },
    ) as jwt.JwtPayload;
    if (
      claims.kind !== 'dashboard-preview'
      || !Number.isInteger(claims.apiKeyId)
      || !Number.isInteger(claims.userId)
      || typeof claims.allowedDomain !== 'string'
      || !claims.allowedDomain.trim()
    ) {
      return null;
    }
    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id: Number(claims.apiKeyId),
        userId: Number(claims.userId),
        kind: 'dashboard',
        isActive: true,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return apiKey
      ? { ...apiKey, domainWhitelist: claims.allowedDomain.trim().toLowerCase() }
      : null;
  } catch {
    return null;
  }
};

const legacyApiKeyLookupEnabled = () =>
  process.env.NODE_ENV !== 'production' || process.env.DRAPIXAI_ALLOW_LEGACY_API_KEYS === '1';

export const resolveActiveApiKey = async (prisma: PrismaClient, rawApiKey: string | undefined) => {
  const apiKey = String(rawApiKey || '').replace(/^Bearer\s+/i, '').trim();
  if (!apiKey) {
    return null;
  }

  const directMatch = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(apiKey) },
  });
  if (
    directMatch?.isActive
    && !directMatch.revokedAt
    && (!directMatch.expiresAt || directMatch.expiresAt > new Date())
  ) {
    await prisma.apiKey.update({ where: { id: directMatch.id }, data: { lastUsedAt: new Date() } });
    return directMatch;
  }

  if (!legacyApiKeyLookupEnabled() || !LEGACY_API_KEY_PATTERN.test(apiKey)) {
    return null;
  }

  const keys = await prisma.apiKey.findMany({
    where: {
      isActive: true,
      revokedAt: null,
      keyHash: { startsWith: '$2' },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  for (const key of keys) {
    if (await bcrypt.compare(apiKey, key.keyHash)) {
      await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
      return key;
    }
  }

  return null;
};

export const resolveSdkApiKey = async (prisma: PrismaClient, rawApiKey: string | undefined) => {
  const credential = String(rawApiKey || '').replace(/^Bearer\s+/i, '').trim();
  if (!credential) return null;

  const dashboardPreviewKey = await resolveDashboardPreviewToken(prisma, credential);
  if (dashboardPreviewKey) {
    return { apiKey: dashboardPreviewKey, dashboardPreview: true, storefront: null };
  }

  const storefrontCredential = await resolveStorefrontToken(prisma, credential)
    || await resolveGenericStorefrontToken(prisma, credential);
  if (storefrontCredential) {
    await prisma.apiKey.update({
      where: { id: storefrontCredential.apiKey.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      apiKey: storefrontCredential.apiKey,
      dashboardPreview: false,
      storefront: storefrontCredential.context as StorefrontCredentialContext,
    };
  }

  const apiKey = await resolveActiveApiKey(prisma, credential);
  return apiKey ? { apiKey, dashboardPreview: false, storefront: null } : null;
};
