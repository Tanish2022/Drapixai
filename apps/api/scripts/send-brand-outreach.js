#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { parse } = require('csv-parse/sync');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const defaultCsvPath = path.join(repoRoot, 'marketing', 'brand-leads-template.csv');
const defaultSuppressionPath = path.join(repoRoot, 'marketing', 'outreach-suppression.csv');
const defaultLogPath = path.join(repoRoot, 'runtime', 'outreach', 'delivery-log.jsonl');
const MAX_LIVE_BATCH = 50;

const parseBoolean = (value) => ['1', 'true', 'yes', 'approved'].includes(String(value || '').trim().toLowerCase());
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const env = {
  smtpHost: process.env.OUTREACH_SMTP_HOST || '',
  smtpPort: Number(process.env.OUTREACH_SMTP_PORT || 587),
  smtpUser: process.env.OUTREACH_SMTP_USER || '',
  smtpPass: process.env.OUTREACH_SMTP_PASS || '',
  smtpSecure: parseBoolean(process.env.OUTREACH_SMTP_SECURE),
  fromName: process.env.OUTREACH_FROM_NAME || 'DrapixAI Partnerships',
  fromEmail: process.env.OUTREACH_FROM_EMAIL || process.env.OUTREACH_SMTP_USER || '',
  replyTo: process.env.OUTREACH_REPLY_TO || 'sales@drapixai.com',
  senderName: process.env.OUTREACH_SENDER_NAME || 'DrapixAI Partnerships Team',
  ctaUrl: process.env.OUTREACH_CTA_URL || 'https://drapixai.com/contact',
  logoUrl: process.env.OUTREACH_LOGO_URL || 'https://drapixai.com/drapixai_wordmark.webp',
  companyAddress: process.env.OUTREACH_COMPANY_ADDRESS || '',
  unsubscribeEmail: process.env.OUTREACH_UNSUBSCRIBE_EMAIL || 'privacy@drapixai.com',
  subjectOverride: process.env.OUTREACH_SUBJECT || '',
  csvPath: process.env.OUTREACH_LEADS_CSV || defaultCsvPath,
  suppressionPath: process.env.OUTREACH_SUPPRESSION_CSV || defaultSuppressionPath,
  deliveryLogPath: process.env.OUTREACH_DELIVERY_LOG || defaultLogPath,
  dryRun: !Object.prototype.hasOwnProperty.call(process.env, 'OUTREACH_DRY_RUN') || parseBoolean(process.env.OUTREACH_DRY_RUN),
  confirmSend: process.env.OUTREACH_CONFIRM_SEND || '',
  limit: Math.max(0, Number(process.env.OUTREACH_LIMIT || 10)),
  intervalMs: Math.max(1000, Number(process.env.OUTREACH_MIN_INTERVAL_MS || 2500)),
};

function fail(message) {
  throw new Error(message);
}

function loadCsv(filePath, required = true) {
  if (!fs.existsSync(filePath)) {
    if (required) fail(`CSV file not found: ${filePath}`);
    return [];
  }
  return parse(fs.readFileSync(filePath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

function recipientHash(email) {
  return crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 16);
}

function redactEmail(email) {
  const [local, domain] = normalizeEmail(email).split('@');
  if (!local || !domain) return '<invalid-email>';
  return `${local.slice(0, 2)}***@${domain}`;
}

function getSuppressionSet(filePath) {
  return new Set(loadCsv(filePath, false).map((row) => normalizeEmail(row.contact_email || row.email)).filter(Boolean));
}

function selectApprovedLeads(leads, suppressions) {
  const selected = [];
  const seen = new Set();
  const rejected = [];

  for (const lead of leads) {
    const email = normalizeEmail(lead.contact_email);
    let reason = '';
    if (!lead.brand_name) reason = 'BRAND_NAME_REQUIRED';
    else if (!validEmail(email)) reason = 'VALID_BUSINESS_EMAIL_REQUIRED';
    else if (!lead.contact_role) reason = 'CONTACT_ROLE_REQUIRED';
    else if (!lead.source_url) reason = 'SOURCE_URL_REQUIRED';
    else if (!parseBoolean(lead.approved_to_contact)) reason = 'MANUAL_APPROVAL_REQUIRED';
    else if (parseBoolean(lead.unsubscribed) || suppressions.has(email)) reason = 'SUPPRESSED';
    else if (seen.has(email)) reason = 'DUPLICATE';

    if (reason) {
      rejected.push({ brand: lead.brand_name || '<unknown>', email: redactEmail(email), reason });
      continue;
    }
    seen.add(email);
    selected.push({ ...lead, contact_email: email });
  }
  return { selected, rejected };
}

function getTemplate(templateKey = 'pilot') {
  if (String(templateKey).trim().toLowerCase() === 'shopify') {
    return {
      subject: (brand) => `${brand}: a controlled Shopify virtual try-on pilot`,
      headline: 'A storefront-native try-on pilot, starting with a few products.',
      body: (lead) => [
        `I am reaching out from DrapixAI because ${lead.brand_name} appears to operate a product-led fashion storefront where a controlled try-on evaluation could be useful.`,
        'DrapixAI connects approved garment assets to confirmed product IDs and presents virtual try-on through a brand-native storefront experience. Weak or unreviewed results stay internal instead of reaching shoppers.',
        'We would start with 5-10 eligible upper-body products on staging, review garment accuracy and latency together, and publish only if the evidence is acceptable.',
      ],
    };
  }
  return {
    subject: (brand) => `${brand}: invitation to a garment-faithful try-on pilot`,
    headline: 'Prove the garment first. Decide on rollout second.',
    body: (lead) => [
      `I am reaching out from DrapixAI after reviewing ${lead.brand_name}. ${lead.notes || lead.relevance_note || 'Your fashion catalog looks relevant to our controlled upper-body virtual try-on pilot.'}`,
      'Our approach prepares and reviews each garment before shoppers can use it, then checks color, structure, pose preservation, and publishability on every result.',
      'Rather than proposing a catalog-wide commitment, we would certify a small product set and give your team the evidence to decide whether a wider rollout makes sense.',
    ],
  };
}

function buildMessage(lead, configuration = env) {
  const template = getTemplate(lead.template_key);
  const subject = configuration.subjectOverride || template.subject(lead.brand_name);
  const unsubscribeMailto = `mailto:${configuration.unsubscribeEmail}?subject=${encodeURIComponent('Unsubscribe ' + lead.brand_name)}`;
  const body = template.body(lead);
  const text = [
    `Hi ${lead.contact_name || 'there'},`,
    '',
    ...body.flatMap((paragraph) => [paragraph, '']),
    'Would a 20-minute product review be useful next week?',
    configuration.ctaUrl,
    '',
    'Best,',
    configuration.senderName,
    'DrapixAI Partnerships',
    configuration.replyTo,
    '',
    `You are receiving this one-to-one business email because your public business contact was reviewed from ${lead.source_url}.`,
    `To stop future DrapixAI outreach, reply "unsubscribe" or email ${configuration.unsubscribeEmail}.`,
    configuration.companyAddress ? `Business address: ${configuration.companyAddress}` : '',
  ].filter(Boolean).join('\n');
  const paragraphs = body.map((paragraph) => `<p style="margin:0 0 16px;">${escapeHtml(paragraph)}</p>`).join('');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#eef2ed;color:#172019;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px;background:#eef2ed;"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d8dfd9;">
      <tr><td style="padding:22px 28px;border-bottom:1px solid #e1e6e2;"><img src="${escapeHtml(configuration.logoUrl)}" width="176" height="59" alt="DrapixAI" style="display:block;width:150px;height:auto;border:0;"></td></tr>
      <tr><td style="padding:34px 28px;color:#536057;font-size:16px;line-height:1.7;">
        <p style="margin:0 0 12px;color:#31725b;font-size:12px;font-weight:700;text-transform:uppercase;">Private pilot invitation</p>
        <h1 style="margin:0 0 20px;color:#101712;font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:1.15;">${escapeHtml(template.headline)}</h1>
        <p style="margin:0 0 16px;">Hi ${escapeHtml(lead.contact_name || 'there')},</p>
        ${paragraphs}
        <p style="margin:0 0 18px;font-weight:700;color:#172019;">Would a 20-minute product review be useful next week?</p>
        <a href="${escapeHtml(configuration.ctaUrl)}" style="display:inline-block;background:#154b3a;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 20px;">Review the pilot</a>
        <p style="margin:26px 0 0;">Best,<br><strong style="color:#172019;">${escapeHtml(configuration.senderName)}</strong><br>DrapixAI Partnerships<br><a href="mailto:${escapeHtml(configuration.replyTo)}" style="color:#154b3a;">${escapeHtml(configuration.replyTo)}</a></p>
      </td></tr>
      <tr><td style="padding:18px 28px;background:#101712;color:#9fac9f;font-size:11px;line-height:1.6;">
        This one-to-one business email was sent after reviewing the public contact source at ${escapeHtml(lead.source_url)}.<br>
        <a href="${escapeHtml(unsubscribeMailto)}" style="color:#ffffff;">Stop future DrapixAI outreach</a>${configuration.companyAddress ? `<br>${escapeHtml(configuration.companyAddress)}` : ''}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { subject, text, html, unsubscribeMailto };
}

function createTransport(configuration = env) {
  if (!configuration.smtpHost || !configuration.smtpUser || !configuration.smtpPass || !configuration.fromEmail) {
    fail('Missing outreach SMTP settings. Transactional SMTP credentials must not be reused.');
  }
  return nodemailer.createTransport({
    host: configuration.smtpHost,
    port: configuration.smtpPort,
    secure: configuration.smtpSecure,
    auth: { user: configuration.smtpUser, pass: configuration.smtpPass },
  });
}

function appendDeliveryLog(record, filePath = env.deliveryLogPath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function validateLiveConfiguration(configuration, selectedCount) {
  if (configuration.dryRun) return;
  if (configuration.confirmSend !== 'I_HAVE_REVIEWED_EACH_RECIPIENT') {
    fail('Live outreach requires OUTREACH_CONFIRM_SEND=I_HAVE_REVIEWED_EACH_RECIPIENT.');
  }
  if (!configuration.companyAddress) fail('OUTREACH_COMPANY_ADDRESS is required for live outreach.');
  if (!configuration.unsubscribeEmail) fail('OUTREACH_UNSUBSCRIBE_EMAIL is required for live outreach.');
  if (selectedCount > MAX_LIVE_BATCH) fail(`Live batches are capped at ${MAX_LIVE_BATCH} reviewed recipients.`);
}

async function main() {
  const leads = loadCsv(env.csvPath);
  const suppressions = getSuppressionSet(env.suppressionPath);
  const { selected, rejected } = selectApprovedLeads(leads, suppressions);
  const limited = env.limit > 0 ? selected.slice(0, Math.min(env.limit, MAX_LIVE_BATCH)) : selected.slice(0, MAX_LIVE_BATCH);
  validateLiveConfiguration(env, limited.length);

  console.log(`Reviewed=${leads.length} Eligible=${selected.length} Selected=${limited.length} Rejected=${rejected.length}`);
  rejected.slice(0, 20).forEach((lead) => console.log(`Skipped ${lead.email} (${lead.brand}): ${lead.reason}`));
  if (limited.length === 0) fail('No approved outreach recipients passed the safety checks.');

  if (env.dryRun) {
    console.log('\nDRY RUN. No email will be sent.\n');
    limited.forEach((lead, index) => {
      const message = buildMessage(lead);
      console.log(`--- Preview ${index + 1}: ${lead.brand_name} / ${redactEmail(lead.contact_email)} ---`);
      console.log(`Subject: ${message.subject}`);
      console.log(message.text);
      console.log('');
    });
    return;
  }

  const transporter = createTransport();
  let sent = 0;
  let failed = 0;
  for (let index = 0; index < limited.length; index += 1) {
    const lead = limited[index];
    const message = buildMessage(lead);
    const commonLog = {
      timestamp: new Date().toISOString(),
      recipientHash: recipientHash(lead.contact_email),
      brand: lead.brand_name,
      template: lead.template_key || 'pilot',
    };
    try {
      await transporter.sendMail({
        from: `"${env.fromName}" <${env.fromEmail}>`,
        to: lead.contact_email,
        replyTo: env.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: {
          'List-Unsubscribe': `<${message.unsubscribeMailto}>`,
          'X-Entity-Ref-ID': recipientHash(`${lead.contact_email}:${Date.now()}`),
        },
      });
      sent += 1;
      appendDeliveryLog({ ...commonLog, status: 'sent' });
      console.log(`Sent ${lead.brand_name} (${redactEmail(lead.contact_email)})`);
    } catch (error) {
      failed += 1;
      appendDeliveryLog({ ...commonLog, status: 'failed', error: String(error?.code || error?.name || 'SMTP_DELIVERY_FAILED').slice(0, 80) });
      console.error(`Failed ${lead.brand_name} (${redactEmail(lead.contact_email)})`);
    }
    if (index < limited.length - 1) await sleep(env.intervalMs);
  }
  console.log(`Done. Sent=${sent} Failed=${failed} Total=${limited.length}`);
  if (failed > 0) process.exitCode = 1;
}

module.exports = {
  buildMessage,
  getTemplate,
  selectApprovedLeads,
  validateLiveConfiguration,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message || 'Unknown outreach error'}`);
    process.exit(1);
  });
}
