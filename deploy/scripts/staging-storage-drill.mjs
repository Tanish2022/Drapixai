// Operator diagnostic: no .env files, production writes, or application startup.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRequire = createRequire(path.join(repo, 'apps/api/package.json'));
export const ACCOUNT = '111122223333';
export const REGION = 'ap-south-1';
export const BUCKET = 'drapixai-cpu-staging-111122223333-ap-south-1';
const PRODUCTION_BUCKET = 'drapixai-prod-assets-111122223333-ap-south-1-an';
const ROLE = 'drapixai-cpu-staging-storage';
const prefixes = ['garments', 'tryon-review', 'staging-verification'];
const helperDigest = 'fc4c3e65864c1829fcd87ae3718387db03b8ea48b8819f5a6031482ba5d243cd';
const evidenceDir = path.join(repo, 'runtime/launch-evidence');
export const planPath = path.join(evidenceDir, 'aws-storage-drill-plan-20261025.json');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export function classifyProductionResponse(status, errorName) {
  if (status === 403 && errorName === 'AccessDenied') return 'denied';
  if (status === 404 && errorName === 'NoSuchBucket') return 'target-unavailable';
  return 'rejected';
}
export function validatePlan(plan) {
  assert.equal(plan.account, ACCOUNT);
  assert.equal(plan.region, REGION);
  assert.equal(plan.bucket, BUCKET);
  assert.match(plan.runId, /^p0-storage-20261025-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.deepEqual(plan.keys, prefixes.map(prefix => `${prefix}/${plan.runId}/probe.txt`));
  assert.equal(plan.dataVersionsMaximum, 6);
  assert.equal(plan.deleteMarkersMaximum, 1);
  assert.equal(plan.bytesPerVersionMaximum, 1024);
}

// The application eraser sees this proxy, including during its own list/delete calls.
// Never authorize an object from a listing alone: it must match a version ID
// returned by our own uploads or our single marker-creation request.
export function createScopeGuard(plan, execute) {
  validatePlan(plan);
  const versions = new Map(plan.keys.map(key => [key, new Set()]));
  const markers = new Map();
  const puts = new Map();
  let requests = 0;
  return {
    versions, markers,
    async send(command) {
      const name = command.constructor.name;
      const input = command.input;
      assert.equal(input.Bucket, BUCKET, 'STAGING_BUCKET_ONLY');
      assert.ok(++requests <= 100, 'REQUEST_BUDGET_EXCEEDED');
      if (name === 'GetBucketVersioningCommand') {
        // Required by the application erasure routine.
      } else if (name === 'ListObjectVersionsCommand') {
        assert.ok(plan.keys.includes(input.Prefix), 'EXACT_DRILL_PREFIX_REQUIRED');
      } else {
        assert.ok(plan.keys.includes(input.Key), 'EXACT_DRILL_KEY_REQUIRED');
        if (name === 'PutObjectCommand') {
          assert.equal(input.ServerSideEncryption, 'AES256');
          assert.ok(Buffer.isBuffer(input.Body) && input.Body.length <= 1024);
          assert.equal(input.Body.toString(), `DrapixAI synthetic storage drill ${plan.runId} version ${(puts.get(input.Key) || 0) + 1}\n`);
          assert.ok((puts.get(input.Key) || 0) < 2, 'UPLOAD_BUDGET_EXCEEDED');
          puts.set(input.Key, (puts.get(input.Key) || 0) + 1);
        } else if (name === 'DeleteObjectCommand') {
          assert.equal(input.BypassGovernanceRetention, undefined);
          assert.equal(input.MFA, undefined);
          if (input.VersionId) {
            assert.ok(versions.get(input.Key).has(input.VersionId) || markers.get(input.Key) === input.VersionId, 'UNOWNED_VERSION_REFUSED');
          } else {
            assert.equal(input.Key, plan.keys[1], 'ONLY_REVIEW_MARKER_ALLOWED');
            assert.equal(markers.size, 0, 'MARKER_BUDGET_EXCEEDED');
          }
        } else if (name === 'GetObjectCommand') {
          assert.ok(versions.get(input.Key).has(input.VersionId), 'OWNED_VERSION_REQUIRED');
        } else {
          assert.equal(name, 'HeadObjectCommand', 'UNREVIEWED_COMMAND_REFUSED');
          if (input.VersionId) assert.ok(versions.get(input.Key).has(input.VersionId));
        }
      }
      input.ExpectedBucketOwner = ACCOUNT;
      const result = await execute(command);
      if (name === 'PutObjectCommand') {
        assert.ok(result.VersionId && result.VersionId !== 'null', 'VERSIONED_UPLOAD_REQUIRED');
        versions.get(input.Key).add(result.VersionId);
        assert.equal(result.ServerSideEncryption, 'AES256', 'ENCRYPTION_RESPONSE_REQUIRED');
      }
      if (name === 'DeleteObjectCommand' && !input.VersionId) {
        assert.equal(result.DeleteMarker, true);
        assert.ok(result.VersionId && result.VersionId !== 'null');
        markers.set(input.Key, result.VersionId);
      }
      if (name === 'ListObjectVersionsCommand') {
        assert.equal(result.IsTruncated, false, 'UNEXPECTED_INVENTORY_SIZE');
        assert.ok(!result.CommonPrefixes?.length);
        for (const item of result.Versions || []) {
          assert.equal(item.Key, input.Prefix, 'FOREIGN_KEY_IN_INVENTORY');
          assert.ok(versions.get(item.Key).has(item.VersionId), 'FOREIGN_VERSION_IN_INVENTORY');
        }
        for (const item of result.DeleteMarkers || []) {
          assert.equal(item.Key, input.Prefix);
          assert.equal(markers.get(item.Key), item.VersionId, 'FOREIGN_MARKER_IN_INVENTORY');
        }
      }
      return result;
    },
    requestCount: () => requests,
  };
}

export async function authenticate() {
  assert.equal(process.platform, 'win32');
  const bundle = path.join(evidenceDir, 'storage-identity-public-20261024');
  const helper = path.join(repo, 'runtime/tooling/aws-signing-helper/1.8.5/aws_signing_helper.exe');
  assert.equal(sha256(fs.readFileSync(helper)), helperDigest);
  const metadata = readJson(path.join(bundle, 'metadata.json'));
  assert.equal(metadata.leafSubject, 'CN=DrapixAI-CpuStaging-Windows-20261024');
  assert.equal(metadata.leafIssuer, 'CN=DrapixAI-CpuStaging-CA-20261024');
  assert.ok(Date.parse(metadata.leafExpires) > Date.now());
  assert.match(metadata.leafSerial, /^[A-F0-9]{1,40}$/);
  const selectorPath = path.join(bundle, 'selector.json');
  assert.deepEqual(readJson(selectorPath), [
    {Key:'x509Subject',Value:metadata.leafSubject},
    {Key:'x509Issuer',Value:metadata.leafIssuer},
    {Key:'x509Serial',Value:metadata.leafSerial},
  ]);
  const slash = p => p.replaceAll('\\', '/');
  const command = `"${slash(helper)}" credential-process --cert-selector "file://${slash(selectorPath)}" --system-store-name MY --region ${REGION} --trust-anchor-arn arn:aws:rolesanywhere:${REGION}:${ACCOUNT}:trust-anchor/d74aba83-7e91-41d9-9727-652b968273aa --profile-arn arn:aws:rolesanywhere:${REGION}:${ACCOUNT}:profile/a15e5850-4082-4e70-ada6-c4d770c85cdc --role-arn arn:aws:iam::${ACCOUNT}:role/${ROLE} --session-duration 900`;
  const configPath = path.join(bundle, 'aws-config');
  const credentialsPath = path.join(bundle, 'empty-credentials');
  assert.equal(fs.readFileSync(configPath, 'utf8'), `[profile ${ROLE}]\nregion = ${REGION}\ncredential_process = ${command}\n`);
  assert.equal(fs.readFileSync(credentialsPath, 'utf8'), '');
  for (const key of Object.keys(process.env)) if (/^AWS_/i.test(key)) delete process.env[key];
  process.env.AWS_EC2_METADATA_DISABLED = 'true';
  const { fromProcess } = apiRequire('@aws-sdk/credential-provider-process');
  const credentials = await fromProcess({profile:ROLE,configFilepath:configPath,filepath:credentialsPath,ignoreCache:true})();
  const seconds = Math.round((credentials.expiration.getTime()-Date.now())/1000);
  assert.ok(credentials.sessionToken && seconds > 0 && seconds <= 905);
  const { SignatureV4 } = apiRequire('@smithy/signature-v4');
  const { HttpRequest } = apiRequire('@smithy/protocol-http');
  const { Sha256 } = apiRequire('@aws-crypto/sha256-js');
  const hostname = 'sts.ap-south-1.amazonaws.com';
  const body = 'Action=GetCallerIdentity&Version=2011-06-15';
  const signed = await new SignatureV4({credentials,region:REGION,service:'sts',sha256:Sha256}).sign(new HttpRequest({
    hostname,protocol:'https:',method:'POST',path:'/',headers:{host:hostname,'content-type':'application/x-www-form-urlencoded'},body,
  }));
  const xml = await new Promise((resolve, reject) => {
    const req = https.request({hostname,path:'/',method:'POST',headers:signed.headers,minVersion:'TLSv1.2',rejectUnauthorized:true,timeout:15000}, res => {
      let value=''; res.setEncoding('utf8');
      res.on('data',chunk=>{value+=chunk;if(value.length>65536)res.destroy(new Error('RESPONSE_LIMIT'));});
      res.on('error',reject); res.on('end',()=>res.statusCode===200?resolve(value):reject(new Error('IDENTITY_REJECTED')));
    });
    req.on('timeout',()=>req.destroy(new Error('TIMEOUT'))); req.on('error',reject); req.end(body);
  });
  assert.equal(/<Account>(\d+)<\/Account>/.exec(xml)?.[1], ACCOUNT);
  const arn=/<Arn>([^<]+)<\/Arn>/.exec(xml)?.[1];
  assert.ok(arn?.startsWith(`arn:aws:sts::${ACCOUNT}:assumed-role/${ROLE}/`));
  return {credentials, callerArn:arn,sessionSeconds:seconds};
}

async function main() {
  const mode=process.argv[2];
  assert.ok(['--plan','--read-only','--execute'].includes(mode));
  if(mode==='--plan') {
    assert.equal(process.argv.length,3);
    const runId=`p0-storage-20261025-${randomUUID()}`;
    const plan={account:ACCOUNT,region:REGION,bucket:BUCKET,runId,keys:prefixes.map(p=>`${p}/${runId}/probe.txt`),dataVersionsMaximum:6,deleteMarkersMaximum:1,bytesPerVersionMaximum:1024};
    validatePlan(plan); const text=JSON.stringify(plan,null,2)+'\n';
    fs.writeFileSync(planPath,text,{flag:'wx'});
    console.log(JSON.stringify({passed:true,mode:'plan',networkRequests:0,plan,planSha256:sha256(text)})); return;
  }
  const rawPlan=fs.readFileSync(planPath,'utf8'); const plan=JSON.parse(rawPlan); validatePlan(plan);
  // This explicit content-bound switch is required before even obtaining a session.
  const acknowledgeDeleted=mode==='--execute' && process.argv.includes('--acknowledge-confirmed-deleted-production');
  if(mode==='--execute') {
    assert.deepEqual(process.argv.slice(3),[`--approve-disposable-plan-sha256=${sha256(rawPlan)}`,...(acknowledgeDeleted?['--acknowledge-confirmed-deleted-production']:[])]);
    if(acknowledgeDeleted) {
      const deletion=readJson(path.join(evidenceDir,'aws-former-production-deletion-summary-20261025.json'));
      assert.equal(deletion.bucket,PRODUCTION_BUCKET);
      assert.equal(deletion.httpStatus,204);
      assert.equal(deletion.ownerConfirmedIntentionalDeletion,true);
    }
  } else assert.equal(process.argv.length,3);
  const auth=await authenticate();
  const sdk=apiRequire('@aws-sdk/client-s3');
  const {NodeHttpHandler}=apiRequire('@smithy/node-http-handler');
  const client=new sdk.S3Client({region:REGION,credentials:auth.credentials,maxAttempts:1,followRegionRedirects:false,
    requestHandler:new NodeHttpHandler({connectionTimeout:5000,requestTimeout:15000,httpsAgent:new https.Agent({minVersion:'TLSv1.2',rejectUnauthorized:true})})});
  const evidence={checkedAt:new Date().toISOString(),mode,scope:mode==='--execute'?'staging data lifecycle; production isolation tracked separately':'staging read-only checks and production target observation',planSha256:sha256(rawPlan),callerArn:auth.callerArn,sessionSeconds:auth.sessionSeconds,checks:[],objectsUploaded:0,objectsDeleted:0};
  const output=path.join(evidenceDir,`aws-storage-${mode==='--read-only'?'read-only':'drill'}-20261025.json`);
  const save=()=>fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
  const guard=createScopeGuard(plan,command=>client.send(command));
  try {
    assert.equal((await client.send(new sdk.GetBucketLocationCommand({Bucket:BUCKET,ExpectedBucketOwner:ACCOUNT}))).LocationConstraint,REGION);
    assert.equal((await guard.send(new sdk.GetBucketVersioningCommand({Bucket:BUCKET}))).Status,'Enabled');
    evidence.checks.push('staging location and versioning match');
    for(const key of plan.keys) {
      const result=await client.send(new sdk.ListObjectsV2Command({Bucket:BUCKET,Prefix:key,MaxKeys:0,ExpectedBucketOwner:ACCOUNT}));
      assert.ok(!result.Contents?.length);
      const inventory=await guard.send(new sdk.ListObjectVersionsCommand({Bucket:BUCKET,Prefix:key,MaxKeys:10}));
      assert.ok(!inventory.Versions?.length && !inventory.DeleteMarkers?.length);
    }
    evidence.checks.push('three allowed listing prefixes accepted; exact new keys have no versions');
    for(const [label,command] of [
      ['staging root listing denied',new sdk.ListObjectsV2Command({Bucket:BUCKET,MaxKeys:0,ExpectedBucketOwner:ACCOUNT})],
      ['staging outside-prefix listing denied',new sdk.ListObjectsV2Command({Bucket:BUCKET,Prefix:'not-authorized/',MaxKeys:0,ExpectedBucketOwner:ACCOUNT})],
    ]) {
      let denied=false;
      try {
        const response=await client.send(command);
        evidence.lastAuthorizationObservation={label,status:response?.$metadata?.httpStatusCode||null,errorName:null};
      } catch(error) {
        const errorName=/^[A-Za-z0-9_]{1,64}$/.test(error?.name||'')?error.name:'SANITIZED';
        evidence.lastAuthorizationObservation={label,status:error?.$metadata?.httpStatusCode||null,errorName};
        denied=error?.$metadata?.httpStatusCode===403 && error?.name==='AccessDenied';
      }
      assert.ok(denied,'EXPECTED_ACCESS_DENIED'); evidence.checks.push(label);
    }
    let productionStatus;let productionError;
    try {productionStatus=(await client.send(new sdk.GetBucketVersioningCommand({Bucket:PRODUCTION_BUCKET,ExpectedBucketOwner:ACCOUNT}))).$metadata?.httpStatusCode;}
    catch(error) {productionStatus=error?.$metadata?.httpStatusCode;productionError=/^[A-Za-z0-9_]{1,64}$/.test(error?.name||'')?error.name:'SANITIZED';}
    const productionDecision=classifyProductionResponse(productionStatus,productionError);
    evidence.productionTargetObservation={bucket:PRODUCTION_BUCKET,status:productionStatus||null,errorName:productionError||null,decision:productionDecision};
    evidence.stagingReadOnlyPassed=true;
    evidence.productionIsolationVerified=productionDecision==='denied';
    evidence.incompleteChecks=productionDecision==='target-unavailable'?['live production isolation has no existing target']:[];
    assert.notEqual(productionDecision,'rejected','UNEXPECTED_PRODUCTION_ACCESS_RESULT');
    if(productionDecision==='denied') evidence.checks.push('production bucket metadata denied');
    if(mode==='--read-only') {evidence.passed=evidence.productionIsolationVerified;save();console.log(JSON.stringify(evidence));process.exitCode=evidence.passed?0:2;return;}
    // An absent target never becomes an isolation pass. A separate, explicit
    // acknowledgement permits only the independently guarded staging lifecycle test.
    assert.ok(productionDecision==='denied' || (acknowledgeDeleted && productionDecision==='target-unavailable'),'PRODUCTION_ISOLATION_OR_EXPLICIT_LIMITATION_REQUIRED');

    // Use the application's real erasure function, without importing bootstrap/.env/DB.
    apiRequire('ts-node').register({project:path.join(repo,'apps/api/tsconfig.json')});
    const {eraseStoredObjectVersions}=apiRequire(path.join(repo,'apps/api/src/lib/storage-erasure.ts'));
    for(const key of plan.keys) {
      for(let version=1;version<=2;version++) {
        await guard.send(new sdk.PutObjectCommand({Bucket:BUCKET,Key:key,Body:Buffer.from(`DrapixAI synthetic storage drill ${plan.runId} version ${version}\n`),ServerSideEncryption:'AES256',ContentType:'text/plain'}));
        evidence.objectsUploaded++; save();
      }
      const oldId=[...guard.versions.get(key)][0];
      const old=await guard.send(new sdk.GetObjectCommand({Bucket:BUCKET,Key:key,VersionId:oldId}));
      assert.equal(await old.Body.transformToString(),`DrapixAI synthetic storage drill ${plan.runId} version 1\n`);
      evidence.checks.push(`version history readable: ${prefixes[plan.keys.indexOf(key)]}`);
    }
    await guard.send(new sdk.DeleteObjectCommand({Bucket:BUCKET,Key:plan.keys[1]}));
    evidence.checks.push('ordinary delete creates marker; historical versions remain for erasure');save();
    for(const key of plan.keys) {
      assert.equal((await eraseStoredObjectVersions(guard,BUCKET,key)).deletedVersions,2);
      evidence.objectsDeleted+=2;save();
      assert.equal((await eraseStoredObjectVersions(guard,BUCKET,key)).deletedVersions,0);
      for(const id of guard.versions.get(key)) {
        let absent=false;
        try {await guard.send(new sdk.GetObjectCommand({Bucket:BUCKET,Key:key,VersionId:id}));} catch(error){absent=error?.$metadata?.httpStatusCode===404 && error?.name==='NoSuchVersion';}
        assert.ok(absent,'HISTORICAL_VERSION_STILL_ACCESSIBLE');
      }
    }
    evidence.checks.push('application eraser removed all six data versions; retry idempotent; old version GET rejected');
    const review=await guard.send(new sdk.ListObjectVersionsCommand({Bucket:BUCKET,Prefix:plan.keys[1],MaxKeys:10}));
    assert.equal(review.DeleteMarkers?.length,1,'ERASER_MUST_PRESERVE_MARKER');
    // Only the disposable marker ID returned by our own request may be cleaned up.
    await guard.send(new sdk.DeleteObjectCommand({Bucket:BUCKET,Key:plan.keys[1],VersionId:guard.markers.get(plan.keys[1])}));
    evidence.disposableMarkersDeleted=1;
    for(const key of plan.keys) {
      const final=await guard.send(new sdk.ListObjectVersionsCommand({Bucket:BUCKET,Prefix:key,MaxKeys:10}));
      assert.ok(!final.Versions?.length && !final.DeleteMarkers?.length);
    }
    evidence.passed=true;evidence.checks.push('exact drill keys have no remaining data versions or markers');
  } catch {
    evidence.passed=false;evidence.error='STAGING_STORAGE_CHECK_FAILED';
    // No broad automatic cleanup on failure. Preserve exact created IDs for review.
    if(mode==='--execute') evidence.createdVersions=[...guard.versions].map(([key,ids])=>({key,versionIds:[...ids],markerId:guard.markers.get(key)||null}));
    throw new Error('STAGING_STORAGE_CHECK_FAILED');
  } finally {
    evidence.guardedRequests=guard.requestCount();save();client.destroy();
  }
  console.log(JSON.stringify(evidence));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(()=>{console.error(JSON.stringify({passed:false,error:'STAGING_STORAGE_CHECK_FAILED',credentialsPrinted:false}));process.exitCode=1;});
}
