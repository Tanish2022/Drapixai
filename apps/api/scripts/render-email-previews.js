#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  buildGarmentDecisionEmail,
  buildOtpEmail,
  buildTrialReminderEmail,
  buildWelcomeEmail,
} = require('../dist/services/email-templates');
const { buildMessage } = require('./send-brand-outreach');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const outputDirectory = path.join(repoRoot, 'runtime', 'email-previews');
fs.mkdirSync(outputDirectory, { recursive: true });

const outreachConfiguration = {
  subjectOverride: '',
  senderName: 'Tanish Patel',
  ctaUrl: 'https://drapixai.com/contact',
  logoUrl: 'http://127.0.0.1:3000/drapixai_wordmark.webp',
  replyTo: 'sales@drapixai.com',
  unsubscribeEmail: 'privacy@drapixai.com',
  companyAddress: 'Ahmedabad, Gujarat, India',
};

const previews = {
  'transactional-otp.html': buildOtpEmail('123456', 'signup').html,
  'transactional-welcome.html': buildWelcomeEmail('Example Fashion Brand').html,
  'transactional-garment-review.html': buildGarmentDecisionEmail('SKU SH-1042', 'rejected', 'Collar edge needs another cache review.').html,
  'transactional-trial-reminder.html': buildTrialReminderEmail(3).html,
  'outreach-pilot.html': buildMessage({
    brand_name: 'Example Fashion Brand',
    contact_name: 'Asha',
    contact_email: 'asha@example.com',
    contact_role: 'Ecommerce Lead',
    source_url: 'https://example.com/contact',
    approved_to_contact: 'yes',
    unsubscribed: 'no',
    notes: 'Your structured-shirt catalog looks relevant to a controlled garment-faithfulness evaluation.',
    template_key: 'pilot',
  }, outreachConfiguration).html,
  'outreach-shopify.html': buildMessage({
    brand_name: 'Example Shopify Brand',
    contact_name: 'Arjun',
    contact_email: 'arjun@example.com',
    contact_role: 'Digital Commerce Lead',
    source_url: 'https://example.com/about',
    approved_to_contact: 'yes',
    unsubscribed: 'no',
    template_key: 'shopify',
  }, outreachConfiguration).html,
};

for (const [fileName, html] of Object.entries(previews)) {
  fs.writeFileSync(path.join(outputDirectory, fileName), html, 'utf8');
}

console.log(`Rendered ${Object.keys(previews).length} safe email previews to ${outputDirectory}`);
