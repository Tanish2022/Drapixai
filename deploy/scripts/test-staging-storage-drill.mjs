import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createScopeGuard, validatePlan, classifyProductionResponse, BUCKET, ACCOUNT } from './staging-storage-drill.mjs';

const runId='p0-storage-20261025-11111111-1111-4111-8111-111111111111';
const plan={account:ACCOUNT,region:'ap-south-1',bucket:BUCKET,runId,
  keys:['garments','tryon-review','staging-verification'].map(p=>`${p}/${runId}/probe.txt`),
  dataVersionsMaximum:6,deleteMarkersMaximum:1,bytesPerVersionMaximum:1024};
const command=(name,input)=>({constructor:{name},input});
const put=(key,n=1)=>command('PutObjectCommand',{Bucket:BUCKET,Key:key,ServerSideEncryption:'AES256',Body:Buffer.from(`DrapixAI synthetic storage drill ${runId} version ${n}\n`)});

test('missing production target never counts as denial; unexpected responses reject',()=>{
  assert.equal(classifyProductionResponse(403,'AccessDenied'),'denied');
  assert.equal(classifyProductionResponse(404,'NoSuchBucket'),'target-unavailable');
  for(const [status,name] of [[200,undefined],[301,'PermanentRedirect'],[403,'Other'],[404,'NoSuchKey'],[undefined,'TimeoutError']]) {
    assert.equal(classifyProductionResponse(status,name),'rejected');
  }
});

test('plan refuses foreign account/bucket, extra keys, traversal and altered limits',()=>{
  validatePlan(plan);
  for(const modified of [
    {...plan,account:'000000000000'},{...plan,bucket:'production'},
    {...plan,keys:[...plan.keys,'garments/customer.png']},
    {...plan,keys:plan.keys.map(k=>k.replace('/probe.txt','/../customer.png'))},
    {...plan,dataVersionsMaximum:7},{...plan,deleteMarkersMaximum:2},
    {...plan,bytesPerVersionMaximum:1025},{...plan,runId:runId+'/extra'},
  ]) assert.throws(()=>validatePlan(modified));
});
test('bucket/key/version and bulk-deletion guards fail before transport',async()=>{
  let sent=0;
  const guard=createScopeGuard(plan,async()=>{sent++;return {};});
  for(const cmd of [
    command('PutObjectCommand',{...put(plan.keys[0]).input,Bucket:'production'}),
    put('garments/customer.png'),
    command('DeleteObjectCommand',{Bucket:BUCKET,Key:plan.keys[0],VersionId:'foreign-version'}),
    command('DeleteObjectsCommand',{Bucket:BUCKET,Key:plan.keys[0],Delete:{Objects:[]}}),
    command('ListObjectVersionsCommand',{Bucket:BUCKET,Prefix:'garments/'}),
    command('DeleteObjectCommand',{Bucket:BUCKET,Key:plan.keys[0]}),
    command('GetObjectCommand',{Bucket:BUCKET,Key:plan.keys[0]}),
  ]) await assert.rejects(guard.send(cmd));
  assert.equal(sent,0);
});
test('upload permits exactly two bounded synthetic versions with AES256',async()=>{
  let sent=0;
  const guard=createScopeGuard(plan,async cmd=>{assert.equal(cmd.input.ExpectedBucketOwner,ACCOUNT);return {VersionId:`synthetic-${++sent}`,ServerSideEncryption:'AES256'};});
  await assert.rejects(guard.send(command('PutObjectCommand',{...put(plan.keys[0]).input,ServerSideEncryption:undefined})));
  await assert.rejects(guard.send(command('PutObjectCommand',{...put(plan.keys[0]).input,Body:Buffer.from('not the fixture')})));
  await assert.rejects(guard.send(command('PutObjectCommand',{...put(plan.keys[0]).input,Body:Buffer.alloc(1025)})));
  assert.equal(sent,0);
  await guard.send(put(plan.keys[0])); await guard.send(put(plan.keys[0],2));
  await assert.rejects(guard.send(put(plan.keys[0],3)));
  assert.equal(sent,2);
  assert.equal(guard.versions.get(plan.keys[0]).size,2);
});
test('only IDs returned by our own writes may be erased; no governance bypass',async()=>{
  let sent=0;
  const guard=createScopeGuard(plan,async()=>{sent++;return {VersionId:'synthetic-owned',ServerSideEncryption:'AES256'};});
  await guard.send(put(plan.keys[0]));
  await assert.rejects(guard.send(command('DeleteObjectCommand',{Bucket:BUCKET,Key:plan.keys[0],VersionId:'synthetic-owned',BypassGovernanceRetention:true})));
  await guard.send(command('DeleteObjectCommand',{Bucket:BUCKET,Key:plan.keys[0],VersionId:'synthetic-owned'}));
  assert.equal(sent,2);
});
test('inventory cannot authorize unknown versions, siblings, markers or pagination',async()=>{
  for(const result of [
    {IsTruncated:true},
    {IsTruncated:false,Versions:[{Key:plan.keys[0],VersionId:'foreign'}]},
    {IsTruncated:false,Versions:[{Key:plan.keys[0]+'.sibling',VersionId:'foreign'}]},
    {IsTruncated:false,DeleteMarkers:[{Key:plan.keys[0],VersionId:'foreign'}]},
  ]) {
    const guard=createScopeGuard(plan,async()=>result);
    await assert.rejects(guard.send(command('ListObjectVersionsCommand',{Bucket:BUCKET,Prefix:plan.keys[0]})));
  }
});
test('only one review-key marker may be created and only that marker cleaned up',async()=>{
  let sent=0;
  const guard=createScopeGuard(plan,async()=>{sent++;return {DeleteMarker:true,VersionId:'synthetic-marker'};});
  await guard.send(command('DeleteObjectCommand',{Bucket:BUCKET,Key:plan.keys[1]}));
  await assert.rejects(guard.send(command('DeleteObjectCommand',{Bucket:BUCKET,Key:plan.keys[1]})));
  await assert.rejects(guard.send(command('DeleteObjectCommand',{Bucket:BUCKET,Key:plan.keys[0],VersionId:'synthetic-marker'})));
  await guard.send(command('DeleteObjectCommand',{Bucket:BUCKET,Key:plan.keys[1],VersionId:'synthetic-marker'}));
  assert.equal(sent,2);
});
test('real application eraser works through guard, preserves marker and retries safely offline',async()=>{
  const apiRequire=createRequire(new URL('../../apps/api/package.json',import.meta.url));
  apiRequire('ts-node').register({project:fileURLToPath(new URL('../../apps/api/tsconfig.json',import.meta.url))});
  const {eraseStoredObjectVersions}=apiRequire(fileURLToPath(new URL('../../apps/api/src/lib/storage-erasure.ts',import.meta.url)));
  const key=plan.keys[1];const data=new Map();let marker;let sequence=0;
  const guard=createScopeGuard(plan,async cmd=>{
    assert.equal(cmd.input.ExpectedBucketOwner,ACCOUNT);
    switch(cmd.constructor.name) {
      case 'GetBucketVersioningCommand':return {Status:'Enabled'};
      case 'PutObjectCommand': {const id=`synthetic-${++sequence}`;data.set(id,cmd.input.Body);return {VersionId:id,ServerSideEncryption:'AES256'};}
      case 'ListObjectVersionsCommand':return {IsTruncated:false,Versions:[...data.keys()].map((id,i)=>({Key:key,VersionId:id,IsLatest:!marker && i===data.size-1})),DeleteMarkers:marker?[{Key:key,VersionId:marker,IsLatest:true}]:[]};
      case 'DeleteObjectCommand':if(cmd.input.VersionId){data.delete(cmd.input.VersionId);return {};}marker='synthetic-marker';return {DeleteMarker:true,VersionId:marker};
      case 'HeadObjectCommand':if(!marker && data.size)return {};throw Object.assign(new Error('synthetic absent'),{name:'NotFound',$metadata:{httpStatusCode:404}});
      default:throw new Error('UNEXPECTED_OFFLINE_COMMAND');
    }
  });
  await guard.send(put(key));await guard.send(put(key,2));
  await guard.send(command('DeleteObjectCommand',{Bucket:BUCKET,Key:key}));
  assert.equal((await eraseStoredObjectVersions(guard,BUCKET,key)).deletedVersions,2);
  assert.equal(data.size,0);assert.equal(marker,'synthetic-marker');
  assert.equal((await eraseStoredObjectVersions(guard,BUCKET,key)).deletedVersions,0);
});
