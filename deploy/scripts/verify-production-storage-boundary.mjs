// Read-only verification: staging credentials must not reach production metadata.
// No object upload/read/delete, configuration changes, or ambient credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { authenticate, ACCOUNT, REGION } from './staging-storage-drill.mjs';

const apiRequire=createRequire(new URL('../../apps/api/package.json',import.meta.url));
const productionBucket='drapixai-prod-assets-v2-111122223333-ap-south-1-an';
const output=fileURLToPath(new URL('../../runtime/launch-evidence/aws-production-v2-staging-denial-20261025.json',import.meta.url));
let phase='authentication';
try {
  assert.equal(process.argv.length,2);
  const {credentials,callerArn,sessionSeconds}=await authenticate();
  const sdk=apiRequire('@aws-sdk/client-s3');
  const {NodeHttpHandler}=apiRequire('@smithy/node-http-handler');
  const client=new sdk.S3Client({region:REGION,credentials,maxAttempts:1,followRegionRedirects:false,
    requestHandler:new NodeHttpHandler({connectionTimeout:5000,requestTimeout:15000,httpsAgent:new https.Agent({minVersion:'TLSv1.2',rejectUnauthorized:true})})});
  const checks=[];
  try {
    for(const [action,command] of [
      ['GetBucketLocation',new sdk.GetBucketLocationCommand({Bucket:productionBucket,ExpectedBucketOwner:ACCOUNT})],
      ['GetBucketVersioning',new sdk.GetBucketVersioningCommand({Bucket:productionBucket,ExpectedBucketOwner:ACCOUNT})],
      ['ListObjectsV2 MaxKeys=0',new sdk.ListObjectsV2Command({Bucket:productionBucket,MaxKeys:0,ExpectedBucketOwner:ACCOUNT})],
    ]) {
      phase=action;
      let status;let errorName;
      try {status=(await client.send(command)).$metadata?.httpStatusCode;}
      catch(error) {status=error?.$metadata?.httpStatusCode;errorName=/^[A-Za-z0-9_]{1,64}$/.test(error?.name||'')?error.name:'SANITIZED';}
      checks.push({action,status:status||null,errorName:errorName||null});
      assert.equal(status,403);assert.equal(errorName,'AccessDenied');
    }
  } finally {client.destroy();}
  const result={passed:true,checkedAt:new Date().toISOString(),account:ACCOUNT,productionBucket,callerArn,sessionSeconds,checks,
    verifiedScope:'Three live staging-role metadata/listing denials against the independently console-verified replacement bucket',
    productionWriteDeleteTested:false,productionRuntimeRoleVerified:false,objectsUploaded:0,objectsRead:0,objectsDeleted:0,iamChanges:0,credentialsPrinted:false};
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
} catch {
  console.error(JSON.stringify({passed:false,error:'PRODUCTION_STORAGE_BOUNDARY_CHECK_FAILED',phase,credentialsPrinted:false}));process.exitCode=1;
}
