#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const [sandboxPath, productionPath] = process.argv.slice(2);
if (!sandboxPath || !productionPath) {
  console.error('Usage: node deploy/scripts/verify-environment-isolation.mjs <sandbox.env> <production.env>');
  process.exit(2);
}

const parseEnv = (filePath) => {
  const values = {};
  const source = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
};

const urlIdentity = (value, includePath = true) => {
  const parsed = new URL(value);
  return `${parsed.hostname.toLowerCase()}:${parsed.port || 'default'}${includePath ? parsed.pathname : ''}`;
};

const sandbox = parseEnv(path.resolve(sandboxPath));
const production = parseEnv(path.resolve(productionPath));
const failures = [];

if (sandbox.DRAPIXAI_API_ENVIRONMENT !== 'sandbox') {
  failures.push('Sandbox DRAPIXAI_API_ENVIRONMENT must equal sandbox');
}
if (production.DRAPIXAI_API_ENVIRONMENT !== 'live') {
  failures.push('Production DRAPIXAI_API_ENVIRONMENT must equal live');
}

const comparisons = [
  ['PostgreSQL server/database', 'DATABASE_URL', (value) => urlIdentity(value, true)],
  ['Redis server/database', 'REDIS_URL', (value) => urlIdentity(value, true)],
  ['Object-storage bucket', 'S3_BUCKET', (value) => value.trim().toLowerCase()],
  ['Secrets-manager record', 'DRAPIXAI_AWS_SECRET_ID', (value) => value.trim()],
  ['AI service', 'DRAPIXAI_AI_URL', (value) => urlIdentity(value, false)],
];

for (const [label, key, normalize] of comparisons) {
  const sandboxValue = sandbox[key];
  const productionValue = production[key];
  if (!sandboxValue || !productionValue) {
    failures.push(`${label} identity is missing (${key})`);
    continue;
  }
  try {
    if (normalize(sandboxValue) === normalize(productionValue)) {
      failures.push(`${label} is shared between sandbox and production`);
    }
  } catch {
    failures.push(`${label} contains an invalid value (${key})`);
  }
}

for (const [name, values] of [['sandbox', sandbox], ['production', production]]) {
  if (!['aws-secrets-manager', 'mounted-file'].includes(values.DRAPIXAI_SECRETS_PROVIDER)) {
    failures.push(`${name} must use a managed secrets provider`);
  }
}

if (failures.length > 0) {
  console.error('Environment isolation verification FAILED:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Environment isolation verification PASSED.');
console.log('Sandbox and production use distinct database, Redis, bucket, secret, and AI identities.');
