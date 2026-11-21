const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const origins = process.argv.slice(2);
assert.equal(origins.length, 2, 'Provide the expected API and website origins');
for (const origin of origins) {
  const url = new URL(origin);
  assert.ok(url.protocol === 'https:' && url.origin === origin, 'Expected an HTTPS origin without a path or credentials');
}

const missing = new Set(origins);
const chunks = path.join('.next', 'static', 'chunks');
for (const file of fs.readdirSync(chunks, { recursive: true })) {
  if (!file.endsWith('.js')) continue;
  const content = fs.readFileSync(path.join(chunks, file), 'utf8');
  for (const origin of missing) {
    if (content.includes(JSON.stringify(origin)) || content.includes(`'${origin}'`)) missing.delete(origin);
  }
  if (!missing.size) break;
}
assert.equal(missing.size, 0, `Missing from compiled browser assets: ${[...missing].join(', ')}`);
console.log('Verified the public API and website origins in the compiled browser assets.');
