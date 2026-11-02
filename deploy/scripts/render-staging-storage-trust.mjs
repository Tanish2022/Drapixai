import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Render a public policy only. No AWS calls, certificate creation or deployment.
const args = process.argv.slice(2);
const prefix = '--anchor-arn=';
const anchor = args.length === 1 && args[0].startsWith(prefix) ? args[0].slice(prefix.length) : '';
const scope = /^arn:aws:rolesanywhere:ap-south-1:111122223333:trust-anchor\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
if (!scope.test(anchor)) {
  process.stderr.write('STAGING_TRUST_EXACT_ANCHOR_REQUIRED\n');
  process.exitCode = 1;
} else {
  const policy = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../staging/storage-runtime-trust.template.json', import.meta.url)), 'utf8'));
  policy.Statement[0].Condition.ArnEquals['aws:SourceArn'] = anchor;
  process.stdout.write(JSON.stringify(policy, null, 2) + '\n');
}
