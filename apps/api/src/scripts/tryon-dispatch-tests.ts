import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createTryOnDispatcher } from '../lib/tryon-dispatch';
import { observeTryOnTerminalResponse, type TryOnLease } from '../lib/tryon-concurrency';
import { aiTransportFailure } from '../lib/ai-client';

async function main() {
  const modes=['success','mark-failed','dispatch-denied','timeout','no-receipt','wrong-request','validation','quota','worker-failed','cleanup-failed','aborted'] as const;
  for(const mode of modes){
    const token=crypto.randomUUID(),controller=new AbortController();if(mode==='aborted'||mode==='cleanup-failed')controller.abort();
    const lease:TryOnLease={token,tenantKey:'synthetic',globalKey:'synthetic',guard:'synthetic',phase:'reserved',signal:controller.signal};
    const ticket={id:crypto.randomUUID(),userId:1,apiKeyId:2,requestId:crypto.randomUUID(),kind:'tryon' as const};
    let sends=0,marks=0,releases=0;const quotaReasons:string[]=[];
    const dispatcher=createTryOnDispatcher({
      markUsage:async()=>{marks++;if(mode==='mark-failed')throw new Error('SYNTHETIC_MARK_FAILURE');},
      dispatchSlot:async item=>{if(mode==='dispatch-denied')throw new Error('TRYON_ADMISSION_LEASE_LOST');item.phase='dispatched';},
      observe:observeTryOnTerminalResponse,
      releaseQuota:async(_db,actual,reason)=>{assert.equal(actual,ticket);quotaReasons.push(reason);if(mode==='cleanup-failed')throw new Error('PRIVATE-DB-DETAIL');return true;},
      releaseSlot:async item=>{assert.equal(item,lease);releases++;},
    });
    const operation=dispatcher({} as any,ticket,lease,async()=>{
      sends++;if(mode==='timeout')throw new Error('AI_REQUEST_TIMEOUT');
      const status=mode==='validation'?422:mode==='quota'?429:mode==='worker-failed'?500:200;
      const state=['validation','quota'].includes(mode)?'not-dispatched':'terminal';
      const headers:Record<string,string>=mode==='no-receipt'?{}:{'x-drapixai-admission-protocol':'1','x-drapixai-work-state':state,'x-request-id':mode==='wrong-request'?crypto.randomUUID():token};
      return new Response('synthetic',{status,headers});
    });
    const noCall=['mark-failed','dispatch-denied','cleanup-failed','aborted'].includes(mode);
    // cleanup-failed exercises cleanup before any send, with durable quota
    // failure preventing a misleading retryable reply.
    if(['success','validation','quota','worker-failed'].includes(mode))await operation;
    else await assert.rejects(operation,error=>{
      assert.ok(error instanceof Error);assert.ok(!error.message.includes('PRIVATE'));
      if(mode==='cleanup-failed')assert.equal(aiTransportFailure(error)?.body.retryable,false);
      return true;
    });
    assert.equal(releases,1);
    assert.equal(sends,noCall?0:1);
    if(noCall)assert.deepEqual(quotaReasons,['transport_not_invoked']);
    else if(['validation','quota'].includes(mode))assert.deepEqual(quotaReasons,['ai_not_dispatched']);
    else if(mode==='worker-failed')assert.deepEqual(quotaReasons,['ai_terminal_failure']);
    else assert.deepEqual(quotaReasons,[]);
    if(['timeout','no-receipt','wrong-request'].includes(mode))assert.equal(lease.phase,'dispatched');
    else assert.equal(lease.phase,'terminal');
    console.log('PASS actual dispatch orchestration: '+mode);
  }
  console.log('Try-on dispatch checks passed: 11 cases. Synthetic adapters; no AI, Redis, database or email.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
