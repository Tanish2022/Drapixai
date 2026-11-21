import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { observeHttpResponse, observeEmailProviderEvent, renderOperationalMetrics } from '../lib/operational-metrics';
import { requireTryOnIntake } from '../lib/tryon-intake';
const prisma = { webhookDelivery: { count: async () => 0 } } as any;
const redis = {
  zCard: async () => 2,
  hLen: async (key: string) => {
    assert.equal(key, 'drapixai:tryon-concurrency:uncertain');
    return 1;
  },
};
const renderFixture = () => renderOperationalMetrics(prisma, redis, async () => 31);
async function main() {
  const sensitive = crypto.randomBytes(32).toString('hex');
  observeHttpResponse('GET', `/unknown/${sensitive}`, 404);
  let text = await renderFixture();
  assert.match(text, /^drapixai_gpu_queue_depth 31$/m);
  assert.match(text, /^drapixai_gpu_queue_metrics_available 1$/m);
  assert.match(text, /^drapixai_tryon_uncertain_work 1$/m);
  const unavailable = await renderOperationalMetrics(prisma, redis, async () => { throw new Error('fixture'); });
  assert.match(unavailable, /^drapixai_gpu_queue_metrics_available 0$/m);
  assert.match(unavailable, /^drapixai_gpu_queue_depth NaN$/m);
  assert.match(unavailable, /^drapixai_tryon_uncertain_work 1$/m);
  assert.doesNotMatch(await renderOperationalMetrics(prisma, redis, null), /drapixai_gpu_queue_/);
  assert.match(await renderOperationalMetrics(prisma, redis, async () => 0), /^drapixai_gpu_queue_depth 0$/m);
  assert.ok(!text.includes(sensitive), 'Unmatched request identifiers must not enter metrics');
  for (let i = 0; i < 3000; i++) observeHttpResponse('GET', `/unknown/visitor-${i}`, 404);
  text = await renderFixture();
  assert.ok(text.split('\n').filter(line => line.startsWith('drapixai_http_requests_total{')).length <= 2, 'Arbitrary paths must not grow the metric label set');
  const savedEnv = { NODE_ENV: process.env.NODE_ENV, DRAPIXAI_TRYON_INTAKE_ENABLED: process.env.DRAPIXAI_TRYON_INTAKE_ENABLED };
  process.env.NODE_ENV = 'production'; process.env.DRAPIXAI_TRYON_INTAKE_ENABLED = '0';
  const app = express(), router = express.Router(); let generated = 0;
  app.use((req, res, next) => { res.once('finish', () => observeHttpResponse(req.method, req.originalUrl.split('?')[0], res.statusCode, req.route?.path)); next(); });
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/v1/usage', (_req, res) => res.json({ synthetic: true }));
  const auth = express.Router(); auth.post('/login', (_req, res) => res.status(401).json({ synthetic: true })); app.use('/auth', auth);
  router.get('/results/:id', (_req, res) => res.json({ synthetic: true }));
  router.post('/tryon', requireTryOnIntake, (_req, res) => { generated++; res.json({ synthetic: true }); });
  app.use('/sdk', router);
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const request = async (route: string, method = 'GET') => {
    const result = await fetch(origin + route, { method, signal: AbortSignal.timeout(3000) });
    await result.arrayBuffer(); return result;
  };
  try {
    let paused = await request('/sdk/tryon', 'POST');
    assert.equal(paused.status, 503); assert.equal(paused.headers.get('retry-after'), '60');
    assert.equal(paused.headers.get('x-drapixai-intake-status'), 'paused'); assert.equal(generated, 0);
    for (const route of ['/health', '/v1/usage', `/sdk/results/${sensitive}`]) assert.equal((await request(route)).status, 200);
    assert.equal((await request('/auth/login', 'POST')).status, 401);
    assert.equal((await request('/AUTH/login', 'POST')).status, 401);
    text = await renderFixture();
    assert.match(text, /drapixai_tryon_intake_enabled 0/);
    assert.match(text, /path="\/sdk\/results\/:id"/); assert.ok(!text.includes(sensitive));
    assert.match(text, /drapixai_auth_failures_total 2/);
    process.env.DRAPIXAI_TRYON_INTAKE_ENABLED = '1';
    assert.equal((await request('/sdk/tryon', 'POST')).status, 200); assert.equal(generated, 1);
    assert.match(await renderFixture(), /drapixai_tryon_intake_enabled 1/);
    process.env.DRAPIXAI_TRYON_INTAKE_ENABLED = '0';
    paused = await request('/sdk/tryon', 'POST'); assert.equal(paused.status, 503); assert.equal(generated, 1);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    for (const [key, value] of Object.entries(savedEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  observeHttpResponse('POST', '/email/webhooks/resend', 200, '/');
  observeEmailProviderEvent(sensitive); observeEmailProviderEvent('email.complained');
  observeHttpResponse('POST', '/auth/login', 401, '/login'); observeHttpResponse('POST', '/v1/usage', 429, '/usage');
  text = await renderFixture();
  assert.ok(!text.includes(sensitive));
  assert.match(text, /path="\/email\/webhooks\/resend"/);
  assert.match(text, /drapixai_email_provider_events_total\{event="complained"\} 1/);
  for (let i = 0; i < 2000; i++) observeHttpResponse('GET', '/known', 200, `/registered-route-${i}`);
  observeHttpResponse(sensitive, '/unknown', Number.NaN);
  text = await renderFixture();
  assert.ok(!text.includes(sensitive));
  assert.ok(text.split('\n').filter(line => line.startsWith('drapixai_http_requests_total{')).length <= 1024);
  assert.match(text, /drapixai_http_series_overflow_total [1-9]\d*/);
  assert.match(text, /drapixai_auth_failures_total [1-9]\d*/); assert.match(text, /drapixai_rate_limited_total [1-9]\d*/);
  console.log(JSON.stringify({ passed: true, scope: 'Owned loopback Express fixture; actual metrics/intake helpers, synthetic generation/usage/result routes and database/Redis adapters; not deployed operations', checks: ['private unmatched paths aggregate', 'registered parameter templates exclude identifiers', '1024-series cap preserves global security counters', 'paused intake rejects before synthetic handler', 'health/usage/metadata remain available', 'synthetic resume/pause matches metrics'] }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
