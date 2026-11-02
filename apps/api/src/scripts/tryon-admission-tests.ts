import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from 'redis';
import * as admission from '../lib/tryon-concurrency';
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

async function main() {
  const nonce=process.env.DRAPIXAI_ADMISSION_FIXTURE_NONCE || '';
  assert.match(nonce,/^[a-f0-9]{16}$/);
  const container=`drapixai-admission-cache-${nonce}`;
  const target=new URL(process.env.REDIS_URL!); assert.equal(target.hostname,'127.0.0.1'); assert.equal(target.pathname,'/15');
  process.env.NODE_ENV='test'; process.env.DRAPIXAI_TRYON_ADMISSION_EPOCH=crypto.randomUUID();
  process.env.DRAPIXAI_MAX_CONCURRENT_TRYONS='3'; process.env.DRAPIXAI_TENANT_MAX_CONCURRENT_TRYONS='1'; process.env.DRAPIXAI_TRYON_SLOT_LEASE_MS='400';
  let control=createClient({url:target.toString(),socket:{reconnectStrategy:false}}); control.on('error',()=>undefined); await control.connect();
  let runId=await admission.redisRunId(control),groups=0;
  const pass=(message:string)=>{groups++;console.log('PASS '+message);};
  const acquire=async(id:number,signal?:AbortSignal)=>{const result=await admission.acquireTryOnSlot(id,signal);if(!result.ok)throw Error(result.reason);return result.lease;};
  const receipt=(lease:admission.TryOnLease,state:string,status=200,requestId=lease.token)=>new Response(status===204?null:'synthetic',{status,headers:{'x-drapixai-admission-protocol':'1','x-drapixai-work-state':state,'x-request-id':requestId}});
  try {
    assert.equal((await admission.acquireTryOnSlot(1)).ok,false);
    await assert.rejects(admission.acknowledgeTryOnWorkersIdle(control,'0'.repeat(40),'owned-fixture-idle'));
    await admission.acknowledgeTryOnWorkersIdle(control,runId,'owned-fixture-idle');
    pass('Missing or wrong restart identity fails closed until an explicit idle-worker acknowledgement');
    const first=await acquire(1),second=await acquire(2),third=await acquire(3);
    assert.deepEqual(await admission.acquireTryOnSlot(1),{ok:false,reason:'TENANT_CONCURRENCY_LIMIT'});
    assert.deepEqual(await admission.acquireTryOnSlot(4),{ok:false,reason:'GLOBAL_CAPACITY_BUSY'});
    for(const lease of [first,second,third])await admission.releaseTryOnSlot(lease);
    pass('Atomic tenant/global limits and ordinary undispatched release remain enforced');
    const renewed=await acquire(5); await wait(1100);
    assert.equal(renewed.signal.aborted,false); assert.equal((await admission.acquireTryOnSlot(5)).ok,false);
    const savedNow=Date.now; try{Date.now=()=>savedNow()+86400000;assert.equal((await admission.acquireTryOnSlot(5)).ok,false);}finally{Date.now=savedNow;}
    await admission.releaseTryOnSlot(renewed);
    pass('Live reserved work renews past its original lease using Redis time rather than skewed API clocks');
    const crashed=await acquire(6);admission.stopTryOnHeartbeatForTests(crashed);await wait(600);
    const recovered=await acquire(6);await assert.rejects(admission.dispatchTryOnSlot(crashed),/LEASE_LOST/);await admission.releaseTryOnSlot(crashed);await admission.releaseTryOnSlot(recovered);
    pass('A crashed undispatched reservation expires; a stale owner cannot dispatch or remove its replacement');
    const held=await acquire(7);await admission.dispatchTryOnSlot(held);await wait(1100);
    assert.equal(await control.sendCommand(['ZSCORE',admission.ADMISSION_KEYS.global,held.token]),'inf');
    assert.equal(await control.pTTL(admission.ADMISSION_KEYS.global),-1);
    assert.equal((await admission.acquireTryOnSlot(7)).ok,false);
    await admission.releaseTryOnSlot(held);assert.equal(await control.hLen(admission.ADMISSION_KEYS.uncertain),1);
    const other=await acquire(8);await admission.releaseTryOnSlot(other);assert.equal(await control.pTTL(admission.ADMISSION_KEYS.global),-1);
    await admission.closeTryOnConcurrencyForTests();assert.equal((await admission.acquireTryOnSlot(7)).ok,false);
    pass('Dispatched/uncertain work survives lease expiry, unrelated key TTL updates and API client restart');
    admission.observeTryOnTerminalResponse(held,new Response('unbound',{status:200}));assert.equal(held.phase,'dispatched');
    admission.observeTryOnTerminalResponse(held,receipt(held,'terminal',200,crypto.randomUUID()));assert.equal(held.phase,'dispatched');
    admission.observeTryOnTerminalResponse(held,receipt(held,'uncertain',504));assert.equal(held.phase,'dispatched');
    admission.observeTryOnTerminalResponse(held,receipt(held,'terminal'));await admission.releaseTryOnSlot(held);
    assert.equal(await control.hLen(admission.ADMISSION_KEYS.uncertain),0);assert.equal(await control.zCard(admission.ADMISSION_KEYS.global),0);
    pass('Only complete protocol/request-bound terminal evidence releases a dispatched slot; status or timeout alone cannot');
    for(const [state,status] of [['not-dispatched',422],['not-dispatched',429],['terminal',500]] as const){const lease=await acquire(9);await admission.dispatchTryOnSlot(lease);admission.observeTryOnTerminalResponse(lease,receipt(lease,state,status));await admission.releaseTryOnSlot(lease);assert.equal(await control.zCard(admission.ADMISSION_KEYS.global),0);}
    pass('Typed pre-enqueue refusals and confirmed worker failure release capacity without requiring a generated result');
    const a=await acquire(10),b=await acquire(11);await admission.dispatchTryOnSlot(a);await admission.dispatchTryOnSlot(b);await admission.releaseTryOnSlot(a);await admission.releaseTryOnSlot(b);
    await assert.rejects(admission.reconcileTerminalTryOn(control,a.token,'0'.repeat(40),'owned-terminal-proof'));
    assert.equal((await admission.reconcileTerminalTryOn(control,a.token,runId,'owned-terminal-proof')).released,true);
    assert.equal(await control.zCard(admission.ADMISSION_KEYS.global),1);assert.equal(await control.sendCommand(['ZSCORE',admission.ADMISSION_KEYS.global,b.token]),'inf');
    await admission.reconcileTerminalTryOn(control,b.token,runId,'owned-terminal-proof');
    pass('Operator reconciliation is identity-bound, exact-token scoped and preserves another tenant hold');
    const cancel=new AbortController(),reserved=await acquire(12,cancel.signal);cancel.abort();await wait(50);assert.equal(reserved.signal.aborted,true);await assert.rejects(admission.dispatchTryOnSlot(reserved),/LEASE_LOST/);
    process.env.DRAPIXAI_TRYON_RESERVATION_MAX_MS='100';const bounded=await acquire(13);await wait(200);assert.equal(bounded.signal.aborted,true);await assert.rejects(admission.dispatchTryOnSlot(bounded),/LEASE_LOST/);delete process.env.DRAPIXAI_TRYON_RESERVATION_MAX_MS;
    pass('Client abort and an absolute pre-dispatch deadline stop renewal and cannot start remote work');
    const lost=await acquire(14);await control.del(admission.ADMISSION_KEYS.guard);await wait(200);assert.equal(lost.signal.aborted,true);await assert.rejects(admission.dispatchTryOnSlot(lost),/LEASE_LOST/);
    await admission.acknowledgeTryOnWorkersIdle(control,runId,'owned-fixture-idle');await admission.releaseTryOnSlot(lost);
    pass('Lost admission state aborts a reserved owner; renewing never silently reacquires a lost slot');
    const inspect=spawnSync('docker',['inspect','--format','{{index .Config.Labels "drapixai.admission-fixture"}}',container],{encoding:'utf8',windowsHide:true});assert.equal(inspect.status,0);assert.equal(inspect.stdout.trim(),nonce);
    const oldGuard=await control.get(admission.ADMISSION_KEYS.guard);await admission.closeTryOnConcurrencyForTests();await control.disconnect();
    assert.equal(spawnSync('docker',['restart',container],{encoding:'utf8',windowsHide:true,timeout:30000}).status,0);
    const published=spawnSync('docker',['port',container,'6379/tcp'],{encoding:'utf8',windowsHide:true});assert.equal(published.status,0);const port=/^127\.0\.0\.1:(\d+)\s*$/.exec(published.stdout)?.[1];assert.ok(port);target.port=port;process.env.REDIS_URL=target.toString();
    control=createClient({url:target.toString(),socket:{reconnectStrategy:false}});control.on('error',()=>undefined);await control.connect();const newRun=await admission.redisRunId(control);assert.notEqual(newRun,runId);
    await control.set(admission.ADMISSION_KEYS.guard,oldGuard!);assert.equal((await admission.acquireTryOnSlot(15)).ok,false);
    runId=newRun;await admission.acknowledgeTryOnWorkersIdle(control,runId,'owned-restart-idle-proof');const afterRestart=await acquire(15);await admission.releaseTryOnSlot(afterRestart);
    pass('An actual owned Redis restart invalidates even a restored old acknowledgement until new idle proof');
  } finally {await admission.closeTryOnConcurrencyForTests();if(control.isOpen)await control.disconnect();}
  console.log(`Try-on admission checks passed: ${groups} groups. Synthetic work only; no GPU.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
