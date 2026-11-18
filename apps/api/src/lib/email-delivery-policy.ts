import crypto from 'node:crypto';

export const EMAIL_EVENT_TYPES = new Set([
  'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.failed',
  'email.bounced', 'email.complained', 'email.suppressed',
]);
export const EMAIL_WEBHOOK_BODY_LIMIT = 64 * 1024;
export const EMAIL_EVENT_RETENTION_DAYS = 30;

export class EmailEventError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export const normalizeMailRecipient = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const recipient = value.trim();
  return recipient.length <= 254 && !/[\u0000-\u001f\u007f]/.test(recipient)
    && /^[^\s<>()\[\],;:\"\\@]+@[A-Za-z0-9.-]+$/.test(recipient) ? recipient.toLowerCase() : null;
};
const senderMailbox = (value: unknown) => {
  if (typeof value !== 'string') return null;
  return normalizeMailRecipient(value) || normalizeMailRecipient(/^(?:[^<>\r\n]{1,120})?<([^<>\r\n]+)>$/.exec(value.trim())?.[1]);
};
const decodeSigningKey = (value: string) => {
  if (!/^whsec_[A-Za-z0-9+/]{20,128}={0,2}$/.test(value)) throw new EmailEventError('EMAIL_EVENT_CONFIG_INVALID', 503);
  const encoded = value.slice(6), key = Buffer.from(encoded, 'base64');
  if (key.length < 16 || key.length > 96 || key.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new EmailEventError('EMAIL_EVENT_CONFIG_INVALID', 503);
  return key;
};
const secretList = (current: string | undefined, previous: string | undefined) => {
  const values = [current || '', ...(previous || '').split(',').filter(Boolean)].map(value => value.trim());
  if (!values[0] || values.length > 4 || new Set(values).size !== values.length) throw new EmailEventError('EMAIL_EVENT_CONFIG_INVALID', 503);
  return values;
};
export const getEmailDeliveryConfig = (env: NodeJS.ProcessEnv = process.env) => {
  const enabled = env.DRAPIXAI_EMAIL_EVENTS_ENABLED || '0';
  if (!['0', '1'].includes(enabled)) throw new EmailEventError('EMAIL_EVENT_CONFIG_INVALID', 503);
  if (enabled === '0') return null;
  const signingKeys = secretList(env.DRAPIXAI_RESEND_WEBHOOK_SECRET, env.DRAPIXAI_RESEND_WEBHOOK_PREVIOUS_SECRETS).map(decodeSigningKey);
  const hashKeys = secretList(env.DRAPIXAI_EMAIL_RECIPIENT_HASH_SECRET, env.DRAPIXAI_EMAIL_RECIPIENT_HASH_PREVIOUS_SECRETS);
  if (hashKeys.some(key => key.length < 32 || key.length > 256 || /\s|replace-with/i.test(key))) throw new EmailEventError('EMAIL_EVENT_CONFIG_INVALID', 503);
  const senders = (env.DRAPIXAI_EMAIL_EVENT_SENDERS || '').split(',').map(normalizeMailRecipient);
  const from = senderMailbox(env.SMTP_FROM);
  if (!from || !senders.length || senders.length > 8 || senders.some(value => !value) || !senders.includes(from)) throw new EmailEventError('EMAIL_EVENT_CONFIG_INVALID', 503);
  return { signingKeys, hashKeys, senders: new Set(senders as string[]) };
};
export type EmailDeliveryConfig = NonNullable<ReturnType<typeof getEmailDeliveryConfig>>;
export const recipientDigests = (recipient: string, config: EmailDeliveryConfig) => config.hashKeys.map(key => crypto.createHmac('sha256', key).update('email-recipient\0').update(recipient).digest('hex'));

export const verifyEmailWebhookSignature = (
  raw: Buffer, headers: Record<string, string | string[] | undefined>, config: EmailDeliveryConfig, now = Date.now(),
) => {
  const id = headers['svix-id'], timestamp = headers['svix-timestamp'], signatures = headers['svix-signature'];
  if (!Buffer.isBuffer(raw) || !raw.length || raw.length > EMAIL_WEBHOOK_BODY_LIMIT
      || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)
      || typeof timestamp !== 'string' || !/^\d{9,12}$/.test(timestamp)
      || typeof signatures !== 'string' || signatures.length > 2048) throw new EmailEventError('EMAIL_WEBHOOK_INVALID');
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) throw new EmailEventError('EMAIL_WEBHOOK_TIMESTAMP_INVALID', 401);
  const candidates = signatures.split(' ').filter(value => /^v1,[A-Za-z0-9+/]{43}=$/.test(value)).map(value => Buffer.from(value.slice(3), 'base64'));
  let verified = false;
  for (const key of config.signingKeys) {
    const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.`).update(raw).digest();
    for (const candidate of candidates) if (candidate.length === expected.length) verified = crypto.timingSafeEqual(candidate, expected) || verified;
  }
  if (!verified) throw new EmailEventError('EMAIL_WEBHOOK_SIGNATURE_INVALID', 401);
  return id;
};

export type VerifiedEmailEvent = {
  webhookId: string; providerEmailId: string; recipientHash: string; eventType: string;
  eventDigest: string; priorEventDigests: string[]; occurredAt: Date; suppression: 'hard_bounce' | 'complaint' | null;
};
export const parseVerifiedEmailEvent = (raw: Buffer, webhookId: string, config: EmailDeliveryConfig, now = Date.now()): VerifiedEmailEvent | null => {
  let payload: any;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw new EmailEventError('EMAIL_WEBHOOK_PAYLOAD_INVALID'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.type !== 'string') throw new EmailEventError('EMAIL_WEBHOOK_PAYLOAD_INVALID');
  // Click/open/inbound events are not collected or persisted by this endpoint.
  if (!EMAIL_EVENT_TYPES.has(payload.type)) return null;
  const data = payload.data;
  const sender = senderMailbox(data?.from);
  if (!sender) throw new EmailEventError('EMAIL_WEBHOOK_PAYLOAD_INVALID');
  if (!config.senders.has(sender)) return null;
  const recipient = Array.isArray(data.to) && data.to.length === 1 ? normalizeMailRecipient(data.to[0]) : null;
  if (!recipient || typeof data.email_id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(data.email_id)
      || typeof payload.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(payload.created_at)) throw new EmailEventError('EMAIL_WEBHOOK_PAYLOAD_INVALID');
  const occurredAt = new Date(payload.created_at);
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > now + 300000) throw new EmailEventError('EMAIL_WEBHOOK_PAYLOAD_INVALID');
  let suppression: VerifiedEmailEvent['suppression'] = null;
  if (payload.type === 'email.complained' || payload.type === 'email.suppressed' && data.suppressed?.reason === 'previous_complaint') suppression = 'complaint';
  if (payload.type === 'email.bounced' && data.bounce?.type === 'Permanent'
      || payload.type === 'email.suppressed' && data.suppressed?.reason === 'previous_bounce') suppression = 'hard_bounce';
  const digests = config.hashKeys.map(key => crypto.createHmac('sha256', key).update('email-event-body\0').update(raw).digest('hex'));
  return {
    webhookId, providerEmailId: data.email_id.toLowerCase(), recipientHash: recipientDigests(recipient, config)[0], eventType: payload.type,
    eventDigest: digests[0], priorEventDigests: digests.slice(1), occurredAt, suppression,
  };
};
