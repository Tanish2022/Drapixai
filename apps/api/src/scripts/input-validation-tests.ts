import assert from 'assert';
import { validateRequestInput } from '../lib/input-validation';

assert.equal(validateRequestInput({ companyName: 'Drapix Fashion Pvt Ltd' }), null);
assert.equal(validateRequestInput({ reason: 'The garment edge is not clean enough.' }), null);
assert.equal(validateRequestInput({ companyName: '<script>alert(1)</script>' })?.code, 'INPUT_MUST_BE_PLAIN_TEXT');
assert.equal(validateRequestInput({ notes: 'SELECT * FROM users' })?.code, 'INPUT_MUST_BE_PLAIN_TEXT');
assert.equal(validateRequestInput({ query: { '$where': 'true' } })?.code, 'INVALID_INPUT_STRUCTURE');
assert.equal(validateRequestInput({ constructor: { prototype: { polluted: true } } })?.code, 'INVALID_INPUT_STRUCTURE');
assert.equal(validateRequestInput({ notes: 'line\u0000break' })?.code, 'INVALID_INPUT_STRUCTURE');

console.log('Input validation tests passed.');
