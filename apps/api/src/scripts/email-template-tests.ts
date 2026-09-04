import assert from 'node:assert';
import {
  buildGarmentDecisionEmail,
  buildOtpEmail,
  buildTrialReminderEmail,
  buildWelcomeEmail,
} from '../services/email-templates';

const templates = [
  buildOtpEmail('123456', 'signup'),
  buildOtpEmail('654321', 'password_reset'),
  buildWelcomeEmail('Example <Brand>'),
  buildGarmentDecisionEmail('SKU-<1042>', 'rejected', '<script>alert(1)</script>'),
  buildTrialReminderEmail(3),
];

for (const template of templates) {
  assert(template.subject.trim().length > 0, 'Every email needs a subject');
  assert(template.text.trim().length > 0, 'Every email needs a plain-text fallback');
  assert(template.html.startsWith('<!doctype html>'), 'Every HTML email needs a document shell');
  assert(template.html.includes('drapixai_wordmark.webp'), 'Every HTML email must use the canonical wordmark');
  assert(!template.html.toLowerCase().includes('<script'), 'Email templates must not contain scripts');
  assert(!template.html.toLowerCase().includes('tracking-pixel'), 'Email templates must not contain tracking pixels');
}

const rejected = templates[3];
assert(rejected.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'Dynamic review text must be HTML escaped');
assert(!rejected.html.includes('<script>alert(1)</script>'), 'Dynamic review text must never create executable markup');

const welcome = templates[2];
assert(welcome.text.includes('Your brand workspace is ready'));
assert(welcome.html.includes('never used to train AI models'));

console.log('Transactional email template tests passed.');
