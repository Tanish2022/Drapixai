import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import previousTerms from '../legal/terms-2026-10-19.json';
import { CURRENT_TERMS, validateTermsAcceptance, recordAccountTermsAcceptance } from '../lib/account-terms';

const valid = { accepted: true, version: CURRENT_TERMS.version, documentHash: CURRENT_TERMS.documentHash };
assert.equal(validateTermsAcceptance(valid), null);
for (const input of [undefined, null, [], false, 'true', {}, { ...valid, accepted: 'true' }, { ...valid, accepted: 1 }, { ...valid, accepted: false }]) {
  assert.equal(validateTermsAcceptance(input), 'TERMS_ACCEPTANCE_REQUIRED');
}
for (const input of [{ ...valid, version: 'old-version' }, { ...valid, documentHash: '0'.repeat(64) }]) {
  assert.equal(validateTermsAcceptance(input), 'TERMS_VERSION_CHANGED');
}
for (const field of ['userId', 'acceptedAt', 'flow', 'ip', 'userAgent']) {
  assert.equal(validateTermsAcceptance({ ...valid, [field]: 'forged' }), 'INVALID_TERMS_ACCEPTANCE');
}
assert.equal(crypto.createHash('sha256').update(CURRENT_TERMS.content).digest('hex'), CURRENT_TERMS.documentHash);
assert.equal(JSON.parse(CURRENT_TERMS.content).version, CURRENT_TERMS.version);
assert.ok(JSON.parse(CURRENT_TERMS.content).sections.length >= 6);
const previousHash = crypto.createHash('sha256').update(JSON.stringify(previousTerms)).digest('hex');
assert.equal(previousHash, '5a7e225d6a4608492105f4431f973460b9cbcd9506034af3a73501f63b34a24f', 'Previously accepted terms must remain unchanged');
assert.equal(validateTermsAcceptance({ accepted: true, version: previousTerms.version, documentHash: previousHash }), 'TERMS_VERSION_CHANGED');

const noDatabase = new Proxy({}, { get() { throw new Error('MUST_NOT_ACCESS_DATABASE'); } }) as any;
async function main() {
  await assert.rejects(recordAccountTermsAcceptance(noDatabase, 1, { ...valid, accepted: false }, 'password_signup'), /TERMS_ACCEPTANCE_REQUIRED/);
  await assert.rejects(recordAccountTermsAcceptance(noDatabase, 0, valid, 'password_signup'), /INVALID_TERMS_ACCOUNT/);
  await assert.rejects(recordAccountTermsAcceptance(noDatabase, 1, valid, 'forged' as any), /INVALID_TERMS_FLOW/);
  console.log('Account terms validation and archive integrity checks passed; database immutability requires the separate PostgreSQL drill.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
