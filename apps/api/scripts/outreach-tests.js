const assert = require('assert');
const {
  buildMessage,
  selectApprovedLeads,
  validateLiveConfiguration,
} = require('./send-brand-outreach');

const approvedLead = {
  brand_name: 'Example Brand',
  contact_name: 'Asha',
  contact_email: 'asha@example.com',
  contact_role: 'Ecommerce Lead',
  source_url: 'https://example.com/contact',
  approved_to_contact: 'yes',
  unsubscribed: 'no',
  notes: 'The brand sells structured upper-body garments.',
  template_key: 'pilot',
};

const selection = selectApprovedLeads([
  approvedLead,
  { ...approvedLead, contact_email: 'blocked@example.com' },
  { ...approvedLead, contact_email: 'missing-source@example.com', source_url: '' },
  { ...approvedLead, contact_email: 'not-approved@example.com', approved_to_contact: 'no' },
], new Set(['blocked@example.com']));

assert.equal(selection.selected.length, 1);
assert(selection.rejected.some((entry) => entry.reason === 'SUPPRESSED'));
assert(selection.rejected.some((entry) => entry.reason === 'SOURCE_URL_REQUIRED'));
assert(selection.rejected.some((entry) => entry.reason === 'MANUAL_APPROVAL_REQUIRED'));

const message = buildMessage(approvedLead, {
  subjectOverride: '',
  senderName: 'DrapixAI Partnerships',
  ctaUrl: 'https://drapixai.com/contact',
  logoUrl: 'https://drapixai.com/drapixai_wordmark.webp',
  replyTo: 'sales@drapixai.com',
  unsubscribeEmail: 'privacy@drapixai.com',
  companyAddress: 'Ahmedabad, Gujarat, India',
});
assert(message.subject.includes('Example Brand'));
assert(message.text.includes('stop future DrapixAI outreach'));
assert(message.html.includes('drapixai_wordmark.webp'));
assert(message.html.includes('Stop future DrapixAI outreach'));
assert(!message.html.includes('<script'));

assert.throws(() => validateLiveConfiguration({ dryRun: false, confirmSend: '', companyAddress: '', unsubscribeEmail: '' }, 1));
assert.doesNotThrow(() => validateLiveConfiguration({
  dryRun: false,
  confirmSend: 'I_HAVE_REVIEWED_EACH_RECIPIENT',
  companyAddress: 'Ahmedabad, Gujarat, India',
  unsubscribeEmail: 'privacy@drapixai.com',
}, 1));

console.log('Outreach safety tests passed.');
