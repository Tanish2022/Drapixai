import assert from 'assert';
import { formatLogError, redactSensitiveText } from '../lib/security';

const bearer = 'Bearer launch-token-that-must-not-appear';
const apiKeys = [
  'dpx_this_is_a_private_server_key',
  'dpxst_this_is_a_private_shopify_key',
  'dpxsf_this_is_a_private_storefront_key',
  'dpxpv_this_is_a_private_preview_key',
  'dpxapi_this_is_a_private_public_api_key',
];
const email = 'shopper.private@example.com';
const databaseUrl = 'postgresql://private_user:private_password@db.internal:5432/private';
const imagePayload = 'A'.repeat(512);

const source = [
  bearer,
  ...apiKeys,
  email,
  `Cookie: session=private-cookie`,
  `person_image_base64=${imagePayload}`,
  `data:image/jpeg;base64,${imagePayload}`,
  databaseUrl,
  'DRAPIXAI_AI_SERVICE_TOKEN=private-service-token',
].join('\n');

const redacted = redactSensitiveText(source);
for (const sensitive of [bearer, ...apiKeys, email, 'private-cookie', imagePayload, databaseUrl, 'private-service-token']) {
  assert.ok(!redacted.includes(sensitive), 'Structured API logging must not retain sensitive request material');
}
assert.ok(redacted.includes('[redacted'), 'API log redaction must leave explicit redaction markers');

const error = new Error(`request failed for ${email} with ${bearer}`);
const formatted = formatLogError(error);
assert.ok(!formatted.includes(email));
assert.ok(!formatted.includes(bearer));

console.log('API log privacy tests passed.');
