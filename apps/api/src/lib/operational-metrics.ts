import type { PrismaClient } from '@prisma/client';

type RedisMetricsClient = {
  lLen(key: string): Promise<number>;
  zCard(key: string): Promise<number>;
  hLen?(key: string): Promise<number>;
};

const counters = new Map<string, number>();
const MAX_HTTP_SERIES = 1024;
let httpSeries = 0;

const increment = (name: string, labels = '') => {
  const key = `${name}${labels}`;
  if (name === 'drapixai_http_requests_total' && !counters.has(key)) {
    if (httpSeries >= MAX_HTTP_SERIES) {
      increment('drapixai_http_series_overflow_total');
      return;
    }
    httpSeries++;
  }
  counters.set(key, (counters.get(key) || 0) + 1);
};

const quoteLabel = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

const stablePath = (requestPath: string, routeTemplate: unknown) => {
  // Only Express's registered route template is exported, never a raw URL.
  if (typeof routeTemplate !== 'string' || !/^\/[A-Za-z0-9_:/.\-]{0,159}$/.test(routeTemplate)) return '/:unmatched';
  const mount = /^(\/email\/webhooks\/resend|\/auth\/terms|\/shopify\/webhooks|\/(?:auth|v1|sdk|analytics|account|billing|admin|shopify))(?=\/|$)/i.exec(requestPath)?.[1].toLowerCase() || '';
  return (mount && routeTemplate !== mount && !routeTemplate.startsWith(`${mount}/`) ? `${mount}${routeTemplate}` : routeTemplate).replace(/\/$/, '') || '/';
};
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE']);

export const observeHttpResponse = (method: string, path: string, statusCode: number, routeTemplate?: unknown) => {
  const route = quoteLabel(stablePath(path, routeTemplate));
  const safeMethod = methods.has(method.toUpperCase()) ? method.toUpperCase() : 'OTHER';
  const safeStatus = Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? String(statusCode) : 'other';
  increment('drapixai_http_requests_total', `{method="${safeMethod}",path="${route}",status="${safeStatus}"}`);
  if ((statusCode === 401 || statusCode === 403) && /^\/(?:auth|v1)(?:\/|$)/i.test(path)) {
    increment('drapixai_auth_failures_total');
  }
  if (statusCode === 429) increment('drapixai_rate_limited_total');
};

export const observeWebhookFailure = () => increment('drapixai_webhook_failures_total');
export const observeTryOnIntakeRejection = () => increment('drapixai_tryon_intake_rejections_total');
export const observeEmailSend = (outcome: 'accepted' | 'failed' | 'unknown' | 'blocked') => increment('drapixai_email_send_total', `{outcome="${outcome}"}`);
export const observeEmailProviderEvent = (event: string) => {
  if (['email.sent','email.delivered','email.delivery_delayed','email.failed','email.bounced','email.complained','email.suppressed'].includes(event)) {
    increment('drapixai_email_provider_events_total', `{event="${event.slice(6)}"}`);
  }
};

export const renderOperationalMetrics = async (
  prisma: PrismaClient,
  redis: RedisMetricsClient,
) => {
  const intakeSetting = String(process.env.DRAPIXAI_TRYON_INTAKE_ENABLED || '').trim();
  const intakeEnabled = intakeSetting === '1' || (!intakeSetting && process.env.NODE_ENV !== 'production');
  const lines = [
    '# HELP drapixai_http_requests_total HTTP responses returned by the API.',
    '# TYPE drapixai_http_requests_total counter',
    '# HELP drapixai_http_series_overflow_total Requests aggregated without new labels after the HTTP series limit.',
    '# TYPE drapixai_http_series_overflow_total counter',
    '# HELP drapixai_auth_failures_total Authentication and authorization failures.',
    '# TYPE drapixai_auth_failures_total counter',
    '# HELP drapixai_rate_limited_total Requests rejected by application rate limits.',
    '# TYPE drapixai_rate_limited_total counter',
    '# HELP drapixai_webhook_failures_total Webhook attempts that failed.',
    '# TYPE drapixai_webhook_failures_total counter',
    '# HELP drapixai_tryon_intake_rejections_total Try-on requests rejected while intake is paused.',
    '# TYPE drapixai_tryon_intake_rejections_total counter',
    '# HELP drapixai_email_send_total SMTP accepted, failed, uncertain or locally blocked attempts; acceptance is not inbox delivery.',
    '# TYPE drapixai_email_send_total counter',
    '# HELP drapixai_email_provider_events_total Newly persisted authenticated provider callbacks by reviewed event type.',
    '# TYPE drapixai_email_provider_events_total counter',
  ];
  for (const [key, value] of [...counters.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`${key} ${value}`);
  }

  const [pendingWebhooks, failedWebhooks, queueDepth, activeTryOns, uncertainTryOns] = await Promise.all([
    prisma.webhookDelivery.count({ where: { status: { in: ['pending', 'retrying', 'processing'] } } }),
    prisma.webhookDelivery.count({ where: { status: 'failed' } }),
    redis.lLen(process.env.DRAPIXAI_RQ_QUEUE_KEY || 'rq:queue:default'),
    redis.zCard('drapixai:tryon-concurrency:global'),
    redis.hLen ? redis.hLen('drapixai:tryon-concurrency:uncertain') : Promise.resolve(0),
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
    '# HELP drapixai_tryon_uncertain_work Work held pending explicit terminal reconciliation.',
    '# TYPE drapixai_tryon_uncertain_work gauge',
    `drapixai_tryon_uncertain_work ${uncertainTryOns}`,
    '# HELP drapixai_tryon_intake_enabled Whether new try-on generation is accepted.',
    '# TYPE drapixai_tryon_intake_enabled gauge',
    `drapixai_tryon_intake_enabled ${intakeEnabled ? 1 : 0}`,
  );
  if (process.env.DRAPIXAI_EMAIL_EVENTS_ENABLED === '1') {
    const now = Date.now();
    const [events, suppressed, overdue] = await Promise.all([
      prisma.emailDeliveryEvent.groupBy({ by: ['eventType'], where: { receivedAt: { gte: new Date(now - 15 * 60000) } }, _count: { _all: true } }),
      prisma.emailRecipientSuppression.count(),
      prisma.emailDeliveryEvent.count({ where: { receivedAt: { lt: new Date(now - 30 * 86400000) } } }),
    ]);
    const count = (types: string[]) => events.filter(row => types.includes(row.eventType)).reduce((total, row) => total + row._count._all, 0);
    lines.push(
      '# HELP drapixai_email_complaints_recent Persisted complaint callbacks received in the last fifteen minutes.',
      '# TYPE drapixai_email_complaints_recent gauge', `drapixai_email_complaints_recent ${count(['email.complained'])}`,
      '# HELP drapixai_email_failures_recent Persisted bounce/failure callbacks received in the last fifteen minutes.',
      '# TYPE drapixai_email_failures_recent gauge', `drapixai_email_failures_recent ${count(['email.bounced','email.failed'])}`,
      '# HELP drapixai_email_suppression_count Current hashed recipient suppression records.',
      '# TYPE drapixai_email_suppression_count gauge', `drapixai_email_suppression_count ${suppressed}`,
      '# HELP drapixai_email_retention_overdue Callback records awaiting thirty-day retention cleanup.',
      '# TYPE drapixai_email_retention_overdue gauge', `drapixai_email_retention_overdue ${overdue}`,
    );
  }
  return `${lines.join('\n')}\n`;
};
