import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const renderer = fileURLToPath(new URL('./render-staging-storage-trust.mjs', import.meta.url));
const anchor = 'arn:aws:rolesanywhere:ap-south-1:111122223333:trust-anchor/11111111-1111-4111-8111-111111111111';
test('trust renderer accepts only an exact anchor in the approved account/region', () => {
  const valid = spawnSync(process.execPath, [renderer, `--anchor-arn=${anchor}`], { encoding: 'utf8' });
  assert.equal(valid.status, 0);
  const trust = JSON.parse(valid.stdout).Statement[0];
  assert.equal(trust.Condition.ArnEquals['aws:SourceArn'], anchor);
  assert.equal(trust.Condition.StringEquals['aws:SourceAccount'], '111122223333');
  assert.equal(trust.Principal.Service, 'rolesanywhere.amazonaws.com');
  assert.equal(trust.Condition.StringEquals['aws:PrincipalTag/x509Subject/CN'], 'DrapixAI-CpuStaging-Windows-20261024');
  assert.equal(trust.Condition.StringEquals['aws:PrincipalTag/x509Issuer/CN'], 'DrapixAI-CpuStaging-CA-20261024');
  for (const value of ['', anchor.replace('111122223333', '000000000000'), anchor.replace('ap-south-1', 'us-east-1'), anchor.replace(/trust-anchor\/.+/, 'trust-anchor/*'), anchor + '/extra']) {
    const rejected = spawnSync(process.execPath, [renderer, `--anchor-arn=${value}`], { encoding: 'utf8' });
    assert.notEqual(rejected.status, 0);
    assert.equal(rejected.stdout, '', 'Invalid scope must emit no deployable trust policy');
  }
});
test('proposed policy allow statements stay within staging prefixes and omit storage administration', () => {
  // A policy scope/contract check, not an IAM permission simulator.
  const policy = JSON.parse(fs.readFileSync(new URL('../staging/storage-runtime-policy.proposed.json', import.meta.url), 'utf8'));
  const bucket = 'arn:aws:s3:::drapixai-cpu-staging-111122223333-ap-south-1';
  const allowedActions = new Set(['s3:GetBucketLocation', 's3:GetBucketVersioning', 's3:ListBucket', 's3:ListBucketVersions', 's3:GetObject', 's3:GetObjectVersion', 's3:PutObject', 's3:DeleteObject', 's3:DeleteObjectVersion']);
  assert.ok(policy.Statement.some(s => s.Effect === 'Deny' && s.Action === 's3:*' && JSON.stringify(s.NotResource) === JSON.stringify([bucket, `${bucket}/*`])));
  for (const statement of policy.Statement.filter(s => s.Effect === 'Allow')) {
    for (const action of [statement.Action].flat()) assert.ok(allowedActions.has(action));
    for (const resource of [statement.Resource].flat()) assert.ok([bucket, ...['garments', 'tryon-review', 'staging-verification'].map(prefix => `${bucket}/${prefix}/*`)].includes(resource));
    if ([statement.Action].flat().includes('s3:PutObject')) assert.equal(statement.Condition.StringEquals['s3:x-amz-server-side-encryption'], 'AES256');
    if ([statement.Action].flat().includes('s3:ListBucketVersions')) assert.deepEqual(statement.Condition.StringLike['s3:prefix'], ['garments/*', 'tryon-review/*', 'staging-verification/*']);
  }
});
test('proposed profile is initially disabled, permits one role and maps both constrained CNs', () => {
  const profile = JSON.parse(fs.readFileSync(new URL('../staging/storage-runtime-profile.proposed.json', import.meta.url), 'utf8'));
  assert.equal(profile.enabled, false);
  assert.equal(profile.durationSeconds, 900);
  assert.equal(profile.acceptRoleSessionName, false);
  assert.deepEqual(profile.roleArns, ['arn:aws:iam::111122223333:role/drapixai-cpu-staging-storage']);
  assert.deepEqual(profile.attributeMappings, ['x509Subject','x509Issuer'].map(certificateField => ({certificateField, mappingRules:[{specifier:'CN'}]})));
});
