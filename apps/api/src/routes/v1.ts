import crypto from 'crypto';
import net from 'net';
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import sdkRoutes from './sdk';
import {
  getApiEnvironment,
  issuePublicApiToken,
  resolveActiveApiKey,
  resolvePublicApiToken,
} from '../lib/api-key-auth';
import { createRateLimitMiddleware } from '../lib/rate-limit';
import { getPlanAccessContext } from '../lib/plans';
import { getUserMonthlyUsage } from '../lib/usage';
import { readStoredObject } from '../lib/storage';
import { appendSecurityAudit } from '../lib/audit-log';
import {
  createWebhookSecret,
  encryptWebhookSecret,
  queueWebhookEvent,
} from '../services/webhooks';
import { formatLogError } from '../lib/security';
import { requireTryOnIntake } from '../lib/tryon-intake';
import openApiV1 from '../openapi/v1';

const router = Router();
const prisma = new PrismaClient();
const TOKEN_SCOPES = new Set(['api:tryon', 'api:usage', 'api:webhooks']);
const WEBHOOK_EVENTS = new Set(['tryon.completed', 'tryon.rejected']);
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const requestIdMiddleware = (req: any, res: any, next: any) => {
  const supplied = String(req.headers['x-request-id'] || '').trim();
  const requestId = /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID();
  req.publicApiRequestId = requestId;
  res.setHeader('DrapixAI-Request-Id', requestId);
  res.setHeader('Cache-Control', 'no-store, private');
  next();
};

const errorEnvelopeMiddleware = (req: any, res: any, next: any) => {
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    req.publicApiResponseBody = body;
    if (res.statusCode >= 400 && typeof body?.error === 'string') {
      return originalJson({
        error: {
          code: body.error.replace(/[^A-Za-z0-9_]+/g, '_').toUpperCase(),
          message: String(body.message || body.error),
          request_id: req.publicApiRequestId,
          ...(body.reason ? { reason: body.reason } : {}),
        },
        ...(body.tryOnResultId ? { tryon_id: String(body.tryOnResultId) } : {}),
      });
    }
    return originalJson(body);
  };
  next();
};

const serverKeyAuth = async (req: any, res: any, next: any) => {
  try {
    const apiKey = await resolveActiveApiKey(prisma, req.headers.authorization);
    const scopes = new Set(String(apiKey?.scopes || '').split(',').filter(Boolean));
    if (!apiKey || apiKey.kind !== 'manual' || !scopes.has('api:token:issue')) {
      return res.status(401).json({ error: 'SERVER_API_KEY_REQUIRED' });
    }
    const user = await prisma.user.findUnique({ where: { id: apiKey.userId } });
    if (!user) return res.status(401).json({ error: 'SERVER_API_KEY_REQUIRED' });
    req.apiKey = apiKey;
    req.user = user;
    next();
  } catch (error) {
    console.error('Public API server-key authentication error:', formatLogError(error));
    res.status(500).json({ error: 'AUTHENTICATION_FAILED' });
  }
};

const accessTokenAuth = async (req: any, res: any, next: any) => {
  try {
    const credential = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const resolved = await resolvePublicApiToken(prisma, credential);
    if (!resolved) return res.status(401).json({ error: 'PUBLIC_API_ACCESS_TOKEN_REQUIRED' });
    const user = await prisma.user.findUnique({ where: { id: resolved.apiKey.userId } });
    if (!user) return res.status(401).json({ error: 'PUBLIC_API_ACCESS_TOKEN_REQUIRED' });
    req.apiKey = resolved.apiKey;
    req.user = user;
    req.publicApiScopes = resolved.scopes;
    req.publicApiContext = resolved.context;
    next();
  } catch (error) {
    console.error('Public API access-token authentication error:', formatLogError(error));
    res.status(500).json({ error: 'AUTHENTICATION_FAILED' });
  }
};

const requireScope = (scope: string) => (req: any, res: any, next: any) => {
  if (!Array.isArray(req.publicApiScopes) || !req.publicApiScopes.includes(scope)) {
    return res.status(403).json({ error: 'API_SCOPE_DENIED', message: `Required scope: ${scope}` });
  }
  next();
};

const serverKeyRateLimit = createRateLimitMiddleware(
  Number(process.env.DRAPIXAI_SERVER_KEY_RATE_LIMIT || 120),
  RATE_LIMIT_WINDOW_MS,
  (req: any) => `public-api:server-key:${req.apiKey?.id || 'unknown'}:${req.path}`,
);
const apiKeyRateLimit = createRateLimitMiddleware(
  Number(process.env.DRAPIXAI_API_KEY_RATE_LIMIT || 600),
  RATE_LIMIT_WINDOW_MS,
  (req: any) => `public-api:key:${req.apiKey?.id || 'unknown'}:${req.path}`,
);
const tenantRateLimit = createRateLimitMiddleware(
  Number(process.env.DRAPIXAI_TENANT_RATE_LIMIT || 1200),
  RATE_LIMIT_WINDOW_MS,
  (req: any) => `public-api:tenant:${req.user?.id || 'unknown'}:${req.path}`,
);

const isSafeWebhookUrl = (value: unknown) => {
  try {
    const parsed = new URL(String(value || ''));
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return false;
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
    if (net.isIP(hostname)) {
      const mappedIpv4 = hostname.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
      if (mappedIpv4 && !isSafeWebhookUrl(`https://${mappedIpv4}`)) return false;
      if (hostname === '::1' || hostname === '::' || hostname.startsWith('fc') || hostname.startsWith('fd')
        || hostname.startsWith('fe80:') || hostname.startsWith('ff') || hostname.startsWith('127.') || hostname.startsWith('10.')
        || hostname.startsWith('192.168.') || hostname.startsWith('169.254.')) return false;
      const parts = hostname.split('.').map(Number);
      if (parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const replayIdempotentResult = async (req: any, res: any, record: any) => {
  if (!record.tryOnResultId) return false;
  const result = await prisma.tryOnResult.findFirst({
    where: { id: record.tryOnResultId, userId: req.user.id },
  });
  if (!result) return false;
  if (record.responseStatus === 422 || result.status === 'rejected') {
    res.status(422).json({
      error: 'TRYON_RESULT_NOT_PUBLISHABLE',
      message: 'This idempotent request completed, but its result was not publishable.',
      tryOnResultId: result.id,
    });
    return true;
  }
  const image = await readStoredObject(result.resultImageUrl);
  if (!image) return false;
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('x-drapixai-tryon-result-id', String(result.id));
  res.setHeader('x-drapixai-engine', result.engine);
  if (result.qualityScore !== null) res.setHeader('x-drapixai-quality-score', String(result.qualityScore));
  res.setHeader('x-drapixai-candidate-count', String(result.candidateCount));
  if (result.processingMs !== null) res.setHeader('x-drapixai-processing-ms', String(result.processingMs));
  if (result.latencyMs !== null) res.setHeader('x-drapixai-latency-ms', String(result.latencyMs));
  res.setHeader('DrapixAI-Idempotent-Replay', 'true');
  res.send(image);
  return true;
};

router.use(requestIdMiddleware);
router.use(errorEnvelopeMiddleware);
router.use(createRateLimitMiddleware(300, 15 * 60 * 1000));

router.get('/openapi.json', (_req, res) => res.json(openApiV1));

router.post('/tokens', serverKeyAuth, serverKeyRateLimit, async (req: any, res) => {
  const requestedScopes = Array.isArray(req.body?.scopes) ? req.body.scopes.map(String) : ['api:tryon'];
  const productIds = Array.isArray(req.body?.product_ids)
    ? [...new Set<string>(req.body.product_ids.map((value: unknown) => String(value || '').trim()).filter(Boolean))]
    : [];
  if (requestedScopes.length === 0 || requestedScopes.some((scope: string) => !TOKEN_SCOPES.has(scope))) {
    return res.status(400).json({ error: 'INVALID_API_SCOPES' });
  }
  if (productIds.length > 50 || productIds.some((id) => id.length > 160)) {
    return res.status(400).json({ error: 'INVALID_PRODUCT_SCOPE' });
  }
  if (requestedScopes.includes('api:tryon') && productIds.length === 0) {
    return res.status(400).json({ error: 'PRODUCT_SCOPE_REQUIRED' });
  }
  const keyScopes = new Set(String(req.apiKey.scopes || '').split(',').filter(Boolean));
  if (requestedScopes.some((scope: string) => !keyScopes.has(scope))) {
    return res.status(403).json({ error: 'API_SCOPE_DENIED' });
  }
  if (productIds.length > 0) {
    const readyMatches = await prisma.garmentMatch.findMany({
      where: { userId: req.user.id, status: 'confirmed', confirmedProductId: { in: productIds } },
      select: { confirmedProductId: true },
    });
    const ready = new Set(readyMatches.map((match) => match.confirmedProductId));
    const unavailable = productIds.filter((id) => !ready.has(id));
    if (unavailable.length > 0) return res.status(409).json({ error: 'PRODUCT_NOT_DRAPIXAI_READY', product_ids: unavailable });
  }
  const environment = getApiEnvironment();
  const token = issuePublicApiToken({
    apiKeyId: req.apiKey.id,
    userId: req.user.id,
    scopes: requestedScopes,
    productIds,
    environment,
  });
  await appendSecurityAudit(prisma, {
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'public_api.token_issued',
    targetType: 'api_key',
    targetId: req.apiKey.id,
    requestId: req.publicApiRequestId,
    ip: req.ip,
    metadata: { environment, scopes: requestedScopes.join(','), productCount: productIds.length },
  });
  res.json({ access_token: token, token_type: 'Bearer', expires_in: 900, environment, scopes: requestedScopes, product_ids: productIds });
});

router.get('/usage', accessTokenAuth, apiKeyRateLimit, tenantRateLimit, requireScope('api:usage'), async (req: any, res) => {
  const plan = getPlanAccessContext(req.user);
  const used = await getUserMonthlyUsage(prisma, req.user.id);
  res.json({
    environment: getApiEnvironment(),
    period: new Date().toISOString().slice(0, 7),
    approved_tryons: used,
    quota: plan.quota,
    remaining: Math.max(0, plan.quota - used),
    active: plan.active,
  });
});

router.post('/tryons', accessTokenAuth, apiKeyRateLimit, tenantRateLimit, requireScope('api:tryon'), requireTryOnIntake, async (req: any, res: any, next) => {
  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    return res.status(400).json({ error: 'VALID_IDEMPOTENCY_KEY_REQUIRED' });
  }
  const keyHash = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
  let record = await prisma.apiIdempotencyRecord.findUnique({
    where: { userId_route_keyHash: { userId: req.user.id, route: 'POST /v1/tryons', keyHash } },
  });
  if (record?.state === 'completed') {
    if (await replayIdempotentResult(req, res, record)) return;
    return res.status(409).json({
      error: 'IDEMPOTENT_RESPONSE_NOT_RETAINED',
      message: 'This request already completed. DrapixAI does not retain shopper preview bytes; use the original response or create a new logical try-on with a new key.',
    });
  }
  if (record?.state === 'processing' && record.expiresAt > new Date()) {
    res.setHeader('Retry-After', '2');
    return res.status(409).json({ error: 'IDEMPOTENT_REQUEST_IN_PROGRESS' });
  }
  if (record) {
    record = await prisma.apiIdempotencyRecord.update({
      where: { id: record.id },
      data: { state: 'processing', responseStatus: null, tryOnResultId: null, expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS) },
    });
  } else {
    try {
      record = await prisma.apiIdempotencyRecord.create({
        data: {
          userId: req.user.id,
          apiKeyId: req.apiKey.id,
          route: 'POST /v1/tryons',
          keyHash,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });
    } catch {
      return res.status(409).json({ error: 'IDEMPOTENT_REQUEST_IN_PROGRESS' });
    }
  }

  res.on('finish', () => {
    const resultId = Number(res.getHeader('x-drapixai-tryon-result-id') || req.publicApiResponseBody?.tryOnResultId || 0);
    const completed = (res.statusCode >= 200 && res.statusCode < 300) || (res.statusCode === 422 && resultId > 0);
    void prisma.apiIdempotencyRecord.update({
      where: { id: record!.id },
      data: {
        state: completed ? 'completed' : 'failed',
        responseStatus: res.statusCode,
        tryOnResultId: resultId || null,
      },
    }).then(async () => {
      if (!resultId) return;
      const result = await prisma.tryOnResult.findFirst({ where: { id: resultId, userId: req.user.id } });
      if (!result) return;
      await queueWebhookEvent(prisma, req.user.id, res.statusCode === 422 ? 'tryon.rejected' : 'tryon.completed', {
        tryon_id: String(result.id),
        product_id: result.productId,
        status: result.status,
        quality_score: result.qualityScore,
        latency_ms: result.latencyMs,
        warnings: result.warnings,
      });
    }).catch((error) => console.error('Public API completion bookkeeping error:', formatLogError(error)));
  });

  req.url = '/tryon';
  sdkRoutes(req, res, next);
});

router.get('/tryons/:id', accessTokenAuth, apiKeyRateLimit, tenantRateLimit, requireScope('api:tryon'), async (req: any, res) => {
  const id = Number(req.params.id);
  const result = await prisma.tryOnResult.findFirst({ where: { id, userId: req.user.id } });
  if (!result) return res.status(404).json({ error: 'TRYON_NOT_FOUND' });
  res.json({
    id: String(result.id),
    product_id: result.productId,
    status: result.status,
    engine: result.engine,
    quality_score: result.qualityScore,
    candidate_count: result.candidateCount,
    processing_ms: result.processingMs,
    latency_ms: result.latencyMs,
    warnings: result.warnings,
    created_at: result.createdAt.toISOString(),
  });
});

router.get('/webhook-endpoints', accessTokenAuth, apiKeyRateLimit, tenantRateLimit, requireScope('api:webhooks'), async (req: any, res) => {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ data: endpoints.map((endpoint) => ({
    id: endpoint.id,
    url: endpoint.url,
    events: endpoint.events.split(','),
    active: endpoint.isActive,
    created_at: endpoint.createdAt.toISOString(),
  })) });
});

router.post('/webhook-endpoints', accessTokenAuth, apiKeyRateLimit, tenantRateLimit, requireScope('api:webhooks'), async (req: any, res) => {
  const url = String(req.body?.url || '').trim();
  const events = Array.isArray(req.body?.events) ? [...new Set<string>(req.body.events.map(String))] : [];
  if (!isSafeWebhookUrl(url)) return res.status(400).json({ error: 'INVALID_WEBHOOK_URL' });
  if (events.length === 0 || events.some((event) => !WEBHOOK_EVENTS.has(event))) {
    return res.status(400).json({ error: 'INVALID_WEBHOOK_EVENTS' });
  }
  const secret = createWebhookSecret();
  const endpoint = await prisma.webhookEndpoint.create({
    data: { userId: req.user.id, url, events: events.join(','), encryptedSecret: encryptWebhookSecret(secret) },
  });
  await appendSecurityAudit(prisma, {
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'public_api.webhook_created',
    targetType: 'webhook_endpoint',
    targetId: endpoint.id,
    requestId: req.publicApiRequestId,
    ip: req.ip,
    metadata: { eventCount: events.length },
  });
  res.status(201).json({ id: endpoint.id, url, events, secret, active: true });
});

router.delete('/webhook-endpoints/:id', accessTokenAuth, apiKeyRateLimit, tenantRateLimit, requireScope('api:webhooks'), async (req: any, res) => {
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!endpoint) return res.status(404).json({ error: 'WEBHOOK_ENDPOINT_NOT_FOUND' });
  await prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { isActive: false } });
  res.status(204).end();
});

export default router;
