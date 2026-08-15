import type { PrismaClient } from '@prisma/client';

type RedisMetricsClient = {
  lLen(key: string): Promise<number>;
  zCard(key: string): Promise<number>;
};

const counters = new Map<string, number>();

const increment = (name: string, labels = '') => {
  const key = `${name}${labels}`;
  counters.set(key, (counters.get(key) || 0) + 1);
};

const quoteLabel = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

const stablePath = (path: string) => path
  .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
  .replace(/\/\d+(?=\/|$)/g, '/:id')
  .slice(0, 160);

export const observeHttpResponse = (method: string, path: string, statusCode: number) => {
  const route = quoteLabel(stablePath(path));
  increment('drapixai_http_requests_total', `{method="${quoteLabel(method)}",path="${route}",status="${statusCode}"}`);
  if ((statusCode === 401 || statusCode === 403) && (path.startsWith('/auth') || path.startsWith('/v1'))) {
    increment('drapixai_auth_failures_total');
  }
  if (statusCode === 429) increment('drapixai_rate_limited_total');
};

export const observeWebhookFailure = () => increment('drapixai_webhook_failures_total');
export const observeTryOnIntakeRejection = () => increment('drapixai_tryon_intake_rejections_total');

export const renderOperationalMetrics = async (
  prisma: PrismaClient,
  redis: RedisMetricsClient,
) => {
  const intakeSetting = String(process.env.DRAPIXAI_TRYON_INTAKE_ENABLED || '').trim();
  const intakeEnabled = intakeSetting === '1' || (!intakeSetting && process.env.NODE_ENV !== 'production');
  const lines = [
    '# HELP drapixai_http_requests_total HTTP responses returned by the API.',
    '# TYPE drapixai_http_requests_total counter',
    '# HELP drapixai_auth_failures_total Authentication and authorization failures.',
    '# TYPE drapixai_auth_failures_total counter',
    '# HELP drapixai_rate_limited_total Requests rejected by application rate limits.',
    '# TYPE drapixai_rate_limited_total counter',
    '# HELP drapixai_webhook_failures_total Webhook attempts that failed.',
    '# TYPE drapixai_webhook_failures_total counter',
    '# HELP drapixai_tryon_intake_rejections_total Try-on requests rejected while intake is paused.',
    '# TYPE drapixai_tryon_intake_rejections_total counter',
  ];
  for (const [key, value] of [...counters.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`${key} ${value}`);
  }

  const [pendingWebhooks, failedWebhooks, queueDepth, activeTryOns] = await Promise.all([
    prisma.webhookDelivery.count({ where: { status: { in: ['pending', 'retrying', 'processing'] } } }),
    prisma.webhookDelivery.count({ where: { status: 'failed' } }),
    redis.lLen(process.env.DRAPIXAI_RQ_QUEUE_KEY || 'rq:queue:default'),
    redis.zCard('drapixai:tryon-concurrency:global'),
  ]);

  lines.push(
    '# HELP drapixai_webhook_pending Current pending, retrying, or processing webhook deliveries.',
    '# TYPE drapixai_webhook_pending gauge',
    `drapixai_webhook_pending ${pendingWebhooks}`,
    '# HELP drapixai_webhook_failed Current permanently failed webhook deliveries.',
    '# TYPE drapixai_webhook_failed gauge',
    `drapixai_webhook_failed ${failedWebhooks}`,
    '# HELP drapixai_gpu_queue_depth Current RQ try-on queue depth.',
    '# TYPE drapixai_gpu_queue_depth gauge',
    `drapixai_gpu_queue_depth ${queueDepth}`,
    '# HELP drapixai_active_tryons Current distributed GPU slot leases.',
    '# TYPE drapixai_active_tryons gauge',
    `drapixai_active_tryons ${activeTryOns}`,
    '# HELP drapixai_tryon_intake_enabled Whether new try-on generation is accepted.',
    '# TYPE drapixai_tryon_intake_enabled gauge',
    `drapixai_tryon_intake_enabled ${intakeEnabled ? 1 : 0}`,
  );
  return `${lines.join('\n')}\n`;
};
