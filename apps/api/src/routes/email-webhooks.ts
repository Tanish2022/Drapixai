import express, { type ErrorRequestHandler, type Express, Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { EmailEventError, EMAIL_WEBHOOK_BODY_LIMIT, getEmailDeliveryConfig, parseVerifiedEmailEvent, verifyEmailWebhookSignature, type VerifiedEmailEvent } from '../lib/email-delivery-policy';
import { persistEmailDeliveryEvent } from '../services/email-delivery-events';
import { createRateLimitMiddleware } from '../lib/rate-limit';
import { observeEmailProviderEvent } from '../lib/operational-metrics';

export const createEmailWebhookRouter = (persist: (event: VerifiedEmailEvent) => Promise<{ duplicate: boolean }>) => {
  const router = Router();
  router.post('/', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const config = getEmailDeliveryConfig();
      if (!config) return res.status(503).json({ error: 'EMAIL_EVENTS_DISABLED' });
      const id = verifyEmailWebhookSignature(req.body, req.headers, config);
      const event = parseVerifiedEmailEvent(req.body, id, config);
      if (!event) return res.json({ ok: true, ignored: true });
      const result = await persist(event);
      if (!result.duplicate) observeEmailProviderEvent(event.eventType);
      return res.json({ ok: true, duplicate: result.duplicate });
    } catch (error) {
      const status = error instanceof EmailEventError ? error.status : 503;
      const code = error instanceof EmailEventError ? error.code : 'EMAIL_EVENT_STORAGE_UNAVAILABLE';
      if (status === 503) res.setHeader('Retry-After', '30');
      console.warn('EMAIL_EVENT_REJECTED', code);
      return res.status(status).json({ error: code });
    }
  });
  return router;
};

export const mountEmailWebhook = (app: Express, prisma: PrismaClient) => {
  const rejectBody: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = [400, 413, 415].includes(error?.status) ? error.status : 503;
    return res.status(status).setHeader('Cache-Control', 'no-store').json({ error: 'EMAIL_WEBHOOK_BODY_REJECTED' });
  };
  app.use('/email/webhooks/resend', createRateLimitMiddleware(300, 60000),
    express.raw({ type: 'application/json', limit: EMAIL_WEBHOOK_BODY_LIMIT, inflate: false }),
    createEmailWebhookRouter(event => persistEmailDeliveryEvent(prisma, event)), rejectBody);
};
