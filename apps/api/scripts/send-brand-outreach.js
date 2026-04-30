#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { parse } = require('csv-parse/sync');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const defaultCsvPath = path.join(repoRoot, 'marketing', 'brand-leads-template.csv');

const env = {
  smtpHost: process.env.OUTREACH_SMTP_HOST || '',
  smtpPort: Number(process.env.OUTREACH_SMTP_PORT || 587),
  smtpUser: process.env.OUTREACH_SMTP_USER || '',
  smtpPass: process.env.OUTREACH_SMTP_PASS || '',
  smtpSecure: (process.env.OUTREACH_SMTP_SECURE || 'false').toLowerCase() === 'true',
  fromName: process.env.OUTREACH_FROM_NAME || 'DrapixAI Partnerships',
  fromEmail: process.env.OUTREACH_FROM_EMAIL || process.env.OUTREACH_SMTP_USER || '',
  replyTo: process.env.OUTREACH_REPLY_TO || '',
  subject: process.env.OUTREACH_SUBJECT || 'Pre-launch invite: DrapixAI virtual try-on pilot',
  senderName: process.env.OUTREACH_SENDER_NAME || 'DrapixAI Partnerships Team',
  ctaUrl: process.env.OUTREACH_CTA_URL || 'https://drapixai.com/contact',
  csvPath: process.env.OUTREACH_LEADS_CSV || defaultCsvPath,
  dryRun: (process.env.OUTREACH_DRY_RUN || 'true').toLowerCase() === 'true',
  limit: Number(process.env.OUTREACH_LIMIT || 0),
};

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function loadCsv(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Leads CSV not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  return rows;
}

function fillTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '');
}

function getTextTemplate() {
  return [
    'Hi {{contact_name}},',
    '',
    'I am reaching out from DrapixAI. We are opening a pre-launch partner cohort for fashion ecommerce brands that want to test AI virtual try-on (upper-body) in a controlled rollout.',
    '',
    'Why this can be relevant for {{brand_name}}:',
    '- Help shoppers visualize products with more confidence',
    '- Pilot first, then scale only after internal validation',
    '- Launch with guided onboarding and measurable checkpoints',
    '',
    'If useful, we can share a one-page brief and set up a 20-minute pilot call.',
    '',
    'Best,',
    '{{sender_name}}',
    'DrapixAI Partnerships',
    '{{cta_url}}',
  ].join('\n');
}

function createTransport() {
  if (!env.smtpHost || !env.smtpUser || !env.smtpPass || !env.fromEmail) {
    fail(
      'Missing SMTP settings. Set OUTREACH_SMTP_HOST, OUTREACH_SMTP_USER, OUTREACH_SMTP_PASS, and OUTREACH_FROM_EMAIL.'
    );
  }
  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass,
    },
  });
}

async function main() {
  const leads = loadCsv(env.csvPath);
  const usableLeads = leads.filter((lead) => lead.contact_email && lead.brand_name);
  const selectedLeads = env.limit > 0 ? usableLeads.slice(0, env.limit) : usableLeads;

  if (selectedLeads.length === 0) {
    fail('No valid leads. Expected contact_email and brand_name columns.');
  }

  const template = getTextTemplate();

  if (env.dryRun) {
    console.log(`DRY RUN ENABLED. Previewing ${selectedLeads.length} emails.\n`);
    selectedLeads.forEach((lead, index) => {
      const variables = {
        contact_name: lead.contact_name || 'there',
        brand_name: lead.brand_name,
        sender_name: env.senderName,
        cta_url: env.ctaUrl,
      };
      const body = fillTemplate(template, variables);
      console.log(`--- Email ${index + 1}: ${lead.contact_email} ---`);
      console.log(`Subject: ${env.subject}`);
      console.log(body);
      console.log('');
    });
    console.log('Dry run complete. Set OUTREACH_DRY_RUN=false to send live emails.');
    return;
  }

  const transporter = createTransport();
  let sent = 0;
  let failed = 0;

  for (const lead of selectedLeads) {
    const variables = {
      contact_name: lead.contact_name || 'there',
      brand_name: lead.brand_name,
      sender_name: env.senderName,
      cta_url: env.ctaUrl,
    };
    const body = fillTemplate(template, variables);
    const message = {
      from: `"${env.fromName}" <${env.fromEmail}>`,
      to: lead.contact_email,
      subject: env.subject,
      text: body,
    };
    if (env.replyTo) {
      message.replyTo = env.replyTo;
    }

    try {
      await transporter.sendMail(message);
      sent += 1;
      console.log(`Sent: ${lead.contact_email}`);
    } catch (error) {
      failed += 1;
      console.error(`Failed: ${lead.contact_email} -> ${error.message}`);
    }
  }

  console.log(`Done. Sent=${sent} Failed=${failed} Total=${selectedLeads.length}`);
}

main().catch((error) => {
  fail(error.message || 'Unknown error during outreach send');
});
