import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { requireDisposableDatabase } from '../lib/disposable-database';
import { CURRENT_TERMS, recordAccountTermsAcceptance } from '../lib/account-terms';
import { issueApiKeyForUser } from '../lib/api-key-auth';
import { getStripeClient } from '../lib/billing';
import { getPlanAccessContext } from '../lib/plans';
import { verifySecurityAuditChain } from '../lib/audit-log';
import { formatLogError } from '../lib/security';

// Real routers/HTTP/signatures/SQL. Only Stripe's outbound operations are
// replaced with synthetic adapters. No provider account, email or inference.
async function main() {
  const url = requireDisposableDatabase(process.env);
  assert.equal(process.env.DRAPIXAI_BILLING_HTTP_FIXTURE, 'I_ACKNOWLEDGE_DISPOSABLE_BILLING_HTTP');
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(!process.env.SMTP_HOST);
  assert.ok((process.env.DRAPIXAI_DASHBOARD_PROXY_TOKEN || '').length >= 32);
  Object.assign(process.env, {
    DRAPIXAI_STRIPE_BILLING_ENABLED: '1', DRAPIXAI_STRIPE_LIVE_MODE: '0',
    DRAPIXAI_STRIPE_SECRET_KEY: 'sk_test_' + 'synthetic'.repeat(8),
    DRAPIXAI_STRIPE_WEBHOOK_SECRET: 'whsec_' + 'synthetic'.repeat(8),
    DRAPIXAI_STRIPE_PRICE_STARTER: 'price_fixtureStarter',
    DRAPIXAI_STRIPE_PRICE_GROWTH: 'price_fixtureGrowth',
    DRAPIXAI_STRIPE_PRICE_PRO: 'price_fixturePro',
    DRAPIXAI_STRIPE_CURRENCY: 'usd', DRAPIXAI_WEB_BASE_URL: 'https://fixture.example.invalid',
  });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const checks: string[] = [], pass = (name: string) => { checks.push(name); console.log('PASS ' + name); };
  let server: http.Server | undefined;
  try {
    assert.equal(await prisma.user.count(), 0, 'Only a fresh owned empty database');
    assert.equal(await prisma.billingWebhookEvent.count(), 0);
    const [a,b] = await Promise.all(['a','b'].map(part => prisma.user.create({ data: {
      email: `billing-http-${part}@example.invalid`, passwordHash: 'synthetic-not-a-login', planType: 'none',
    } })));
    const assent = { accepted: true, version: CURRENT_TERMS.version, documentHash: CURRENT_TERMS.documentHash };
    for (const user of [a,b]) await prisma.$transaction(tx=>recordAccountTermsAcceptance(tx,user.id,assent,'authenticated_account'));
    const dashboard = await issueApiKeyForUser(prisma,a.id,{kind:'dashboard'});
    const manual = await issueApiKeyForUser(prisma,b.id,{kind:'manual'});
    const stripe = getStripeClient();
    let checkoutCalls=0, portalCalls=0, subscriptionReads=0;
    let currentSubscription: any;
    let failSubscriptionRead=false;
    let subscriptionReadHandler: (()=>Promise<any>) | undefined;
    // Disable every SDK HTTP operation except the explicitly replaced methods.
    // Signature construction/verification still uses the installed real SDK.
    (stripe as any)._requestSender._request = () => { throw new Error('EXTERNAL_PROVIDER_NETWORK_FORBIDDEN'); };
    stripe.checkout.sessions.create = (async (params: any, options: any) => {
      checkoutCalls++;
      assert.equal(params.mode,'subscription'); assert.equal(params.line_items[0].quantity,1);
      assert.equal(params.line_items[0].price,'price_fixtureStarter');
      assert.equal(params.metadata.drapixai_user_id,String(a.id));
      assert.equal(params.success_url,'https://fixture.example.invalid/subscription?billing=success');
      assert.ok(options.idempotencyKey.startsWith(`drapixai-checkout-${a.id}-`));
      return {id:'cs_fixtureCheckout',url:'https://checkout.stripe.com/c/pay/synthetic',status:'open'};
    }) as any;
    stripe.checkout.sessions.retrieve = (async () => ({id:'cs_fixtureCheckout',url:'https://checkout.stripe.com/c/pay/synthetic',status:'open'})) as any;
    stripe.billingPortal.sessions.create = (async (params:any) => {
      portalCalls++; assert.equal(params.customer,'cus_fixtureA');
      return {id:'bps_fixture',url:'https://billing.stripe.com/p/session/synthetic'};
    }) as any;
    stripe.subscriptions.retrieve = (async (id:string) => {
      subscriptionReads++; assert.equal(id,'sub_fixtureA');
      if (subscriptionReadHandler) return subscriptionReadHandler();
      if (failSubscriptionRead) throw new Error('SYNTHETIC_PROVIDER_UNAVAILABLE');
      return structuredClone(currentSubscription);
    }) as any;
    const {default:billing,stripeWebhookRouter} = await import('../routes/billing');
    const app=express();
    app.use('/billing/webhooks/stripe',express.raw({type:'application/json',limit:'64kb'}),stripeWebhookRouter);
    app.use(express.json({limit:'16kb'})); app.use('/billing',billing);
    app.use((_error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(500).json({error:'FIXTURE_ROUTE_ERROR'}));
    server=await new Promise<http.Server>((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);});
    const address=server.address();assert.ok(address&&typeof address!=='string');const port=address.port;
    async function request(route:string, body:unknown, headers:Record<string,string>={}) {
      const bytes=Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
      return new Promise<{status:number;body:any}>((resolve,reject)=>{
        const req=http.request({host:'127.0.0.1',port,path:route,method:'POST',signal:AbortSignal.timeout(8000),headers:{'content-type':'application/json','content-length':String(bytes.length),...headers}},res=>{
          const chunks:Buffer[]=[];let size=0;
          res.on('data',chunk=>{size+=chunk.length;if(size>65536)res.destroy(new Error('RESPONSE_TOO_LARGE'));else chunks.push(chunk);});
          res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode!,body:JSON.parse(Buffer.concat(chunks).toString())});}catch{reject(new Error('RESPONSE_NOT_JSON'));}});
        });req.on('error',reject);req.end(bytes);
      });
    }
    const headers={'authorization':`Bearer ${dashboard}`,'x-drapixai-dashboard-proxy-token':process.env.DRAPIXAI_DASHBOARD_PROXY_TOKEN!,'idempotency-key':'fixture-checkout-123456789'};
    assert.equal((await request('/billing/checkout',{plan:'starter'},{...headers,'x-drapixai-dashboard-proxy-token':''})).status,403);
    assert.equal((await request('/billing/checkout',{plan:'starter'},{...headers,authorization:`Bearer ${manual}`})).status,403);
    assert.equal((await request('/billing/checkout',{plan:'starter'},headers)).status,200);
    assert.equal((await request('/billing/checkout',{plan:'starter'},headers)).body.reused,true);
    assert.equal((await request('/billing/checkout',{plan:'pro'},headers)).status,409);
    assert.equal(checkoutCalls,1);assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.id}})).planType,'none');
    pass('Real checkout authorization, tenant-owned metadata, idempotent replay and plan conflict; browser checkout never grants access');
    const base=Math.floor(Date.now()/1000)-1000;
    let sequence=0;
    const event=(type:string,object:any,created=base+(++sequence))=>({id:'evt_fixture_'+crypto.randomBytes(8).toString('hex'),object:'event',api_version:'2026-07-29.dahlia',created,livemode:false,type,data:{object}});
    const send=(e:any,override?:string, timestamp?:number)=>{
      const payload=JSON.stringify(e),signature=override??stripe.webhooks.generateTestHeaderString({payload,secret:process.env.DRAPIXAI_STRIPE_WEBHOOK_SECRET!,timestamp});
      return request('/billing/webhooks/stripe',Buffer.from(payload),{'stripe-signature':signature});
    };
    const snapshot=(status='active',price='price_fixtureStarter'):any=>({id:'sub_fixtureA',customer:'cus_fixtureA',livemode:false,status,metadata:{drapixai_user_id:String(a.id),plan:'pro'},latest_invoice:'in_fixtureCurrent',items:{data:[{price:{id:price},quantity:1,current_period_end:Math.floor(Date.now()/1000)+86400}]}});
    const bad=event('customer.subscription.updated',snapshot());
    assert.equal((await send(bad,'invalid')).status,400);
    assert.equal((await send(bad,undefined,Math.floor(Date.now()/1000)-301)).status,400);
    assert.equal((await send({...bad,livemode:true})).status,400);
    assert.equal(await prisma.billingWebhookEvent.count(),0);
    pass('Real raw-body signatures reject invalid/stale authentication and test/live mismatch before event persistence');
    const unknown=event('customer.subscription.updated',snapshot('active','price_unknown'));
    assert.equal((await send(unknown)).status,500);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.id}})).planType,'none');
    const missingPeriod=snapshot();delete missingPeriod.items.data[0].current_period_end;
    assert.equal((await send(event('customer.subscription.updated',missingPeriod))).status,500);
    pass('Unknown price plus forged plan metadata and missing active period fail closed without paid entitlement');
    // A database/audit outage must roll back entitlement and event completion.
    // The fixture owns an empty disposable database; never install this trigger
    // through application configuration or against a real environment.
    const auditFailure=event('customer.subscription.updated',snapshot());
    await prisma.$executeRawUnsafe(`CREATE FUNCTION billing_fixture_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."actorRole" = 'billing_provider' THEN RAISE EXCEPTION 'SYNTHETIC_BILLING_AUDIT_FAILURE'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER billing_fixture_fail_audit BEFORE INSERT ON "SecurityAuditLog" FOR EACH ROW EXECUTE FUNCTION billing_fixture_fail_audit()`);
    try {
      assert.equal((await send(auditFailure)).status,500);
      assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.id}})).planType,'none','Audit failure must not leave paid access committed');
      assert.equal(await prisma.securityAuditLog.count({where:{targetId:auditFailure.id}}),0);
      assert.equal((await prisma.billingWebhookEvent.findUniqueOrThrow({where:{id:auditFailure.id}})).status,'failed');
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER billing_fixture_fail_audit ON "SecurityAuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION billing_fixture_fail_audit()`);
    }
    assert.equal((await send(auditFailure)).status,200);
    assert.equal(await prisma.securityAuditLog.count({where:{targetId:auditFailure.id}}),1);
    assert.equal((await prisma.billingWebhookEvent.findUniqueOrThrow({where:{id:auditFailure.id}})).attemptCount,2);
    pass('Audit failure rolls back paid entitlement; exact-event retry commits access, audit and receipt together');
    const purchase=event('customer.subscription.updated',snapshot());
    assert.equal((await send(purchase)).status,200);
    assert.equal((await send(purchase)).body.duplicate,true);
    assert.equal(await prisma.securityAuditLog.count({where:{targetId:purchase.id}}),1);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.id}})).planType,'starter');
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:b.id}})).planType,'none');
    pass('Signed configured subscription activates only its tenant; durable duplicate event produces one audit receipt');
    assert.equal((await request('/billing/portal',{customer:'cus_other'},headers)).status,200);assert.equal(portalCalls,1);
    assert.equal((await request('/billing/checkout',{plan:'starter'},{...headers,'idempotency-key':crypto.randomUUID()})).status,409);
    const crossed=snapshot();crossed.metadata.drapixai_user_id=String(b.id);
    assert.equal((await send(event('customer.subscription.updated',crossed))).status,500);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:b.id}})).planType,'none');
    pass('Portal uses authenticated tenant customer; existing subscriptions cannot create a second checkout; conflicting tenant linkage rejects');
    const cancelScheduled=snapshot();cancelScheduled.cancel_at_period_end=true;
    assert.equal((await send(event('customer.subscription.updated',cancelScheduled))).status,200);
    assert.equal(getPlanAccessContext(await prisma.user.findUniqueOrThrow({where:{id:a.id}})).active,true);
    assert.equal((await send(event('customer.subscription.deleted',snapshot('canceled')))).status,200);
    assert.equal(getPlanAccessContext(await prisma.user.findUniqueOrThrow({where:{id:a.id}})).active,false);
    assert.equal((await send(event('customer.subscription.updated',snapshot(),base))).status,200);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.id}})).subscriptionStatus,'canceled');
    pass('Scheduled cancellation preserves current-period access; terminal cancellation blocks access and stale active snapshot cannot reverse it');
    const invoice={id:'in_fixtureCurrent',customer:'cus_fixtureA',status:'paid',parent:{subscription_details:{subscription:'sub_fixtureA'}},lines:{data:[]}};
    currentSubscription=snapshot('canceled');
    assert.equal((await send(event('invoice.paid',invoice))).status,200);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.id}})).subscriptionStatus,'canceled');
    currentSubscription=snapshot('past_due');
    assert.equal((await send(event('invoice.paid',{...invoice,id:'in_historical'}))).status,200);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.id}})).subscriptionStatus,'canceled');
    pass('Delayed invoice payment cannot reactivate cancellation; historical invoice cannot replace current subscription state');
    currentSubscription=snapshot();failSubscriptionRead=true;
    const retry=event('invoice.paid',invoice);
    assert.equal((await send(retry)).status,500);
    assert.equal((await prisma.billingWebhookEvent.findUniqueOrThrow({where:{id:retry.id}})).status,'failed');
    failSubscriptionRead=false;assert.equal((await send(retry)).status,200);
    assert.equal((await prisma.billingWebhookEvent.findUniqueOrThrow({where:{id:retry.id}})).attemptCount,2);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.id}})).subscriptionStatus,'active');
    pass('Provider-read failure leaves entitlement unchanged and durable retry succeeds using current subscription state');
    currentSubscription=snapshot('past_due');
    assert.equal((await send(event('invoice.payment_failed',{...invoice,status:'open'}))).status,200);
    assert.equal(getPlanAccessContext(await prisma.user.findUniqueOrThrow({where:{id:a.id}})).active,false);
    const before=await prisma.user.findUniqueOrThrow({where:{id:a.id}});
    assert.equal((await send(event('charge.refunded',{id:'ch_fixture',customer:'cus_fixtureA',refunded:true}))).status,200);
    assert.deepEqual(await prisma.user.findUniqueOrThrow({where:{id:a.id}}),before);
    pass('Latest failed-payment refresh blocks access; authenticated refund notification never silently changes subscription or issues money');
    const identityConflict={...purchase,type:'invoice.payment_failed'};
    assert.equal((await send(identityConflict)).status,409);
    assert.equal(await prisma.securityAuditLog.count({where:{targetId:purchase.id}}),1);
    pass('A processed event ID cannot be replayed with a different event identity');

    // Hold only synthetic provider reads. Reclaiming a deliberately aged receipt
    // must fence both successful and failed work from the previous attempt.
    const deferred=()=>{let resolve!:(value?:any)=>void;let reject!:(error:Error)=>void;const promise=new Promise<any>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
    const bounded=async<T>(value:Promise<T>)=>{
      let timer:NodeJS.Timeout;try{return await Promise.race([value,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('FIXTURE_GATE_TIMEOUT')),2500);})]);}
      finally{clearTimeout(timer!);}
    };
    for(const oldOutcome of ['success','failure']){
      const firstStarted=deferred(),secondStarted=deferred(),first=deferred(),second=deferred();let reads=0;
      subscriptionReadHandler=async()=>{if(++reads===1){firstStarted.resolve();return first.promise;}secondStarted.resolve();return second.promise;};
      const replay=event('invoice.paid',invoice);
      const older=send(replay);await bounded(firstStarted.promise);
      await prisma.billingWebhookEvent.update({where:{id:replay.id},data:{updatedAt:new Date(Date.now()-6*60*1000)}});
      const newer=send(replay);await bounded(secondStarted.promise);
      if(oldOutcome==='success'){
        second.resolve(snapshot('canceled'));assert.equal((await newer).status,200);
        first.resolve(snapshot('active'));assert.equal((await older).status,500);
      }else{
        first.reject(new Error('SYNTHETIC_OLD_WORKER_FAILURE'));assert.equal((await older).status,500);
        const held=await prisma.billingWebhookEvent.findUniqueOrThrow({where:{id:replay.id}});
        assert.equal(held.status,'processing');assert.equal(held.attemptCount,2);
        second.resolve(snapshot('canceled'));assert.equal((await newer).status,200);
      }
      subscriptionReadHandler=undefined;
      const done=await prisma.billingWebhookEvent.findUniqueOrThrow({where:{id:replay.id}});
      assert.equal(done.status,'processed');assert.equal(done.attemptCount,2);
      assert.equal(await prisma.securityAuditLog.count({where:{targetId:replay.id}}),1);
      assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.id}})).subscriptionStatus,'canceled');
      assert.equal((await send(replay)).body.duplicate,true);
    }
    pass('Reclaimed receipt fences stale successful and failed workers; only the new attempt commits one audit/receipt');

    const c=await prisma.user.create({data:{email:'billing-http-concurrent@example.invalid',passwordHash:'synthetic-not-a-login',planType:'none'}});
    await prisma.$executeRawUnsafe(`CREATE FUNCTION billing_fixture_delay_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."subscriptionId" IS NULL AND NEW."subscriptionId" IS NOT NULL THEN PERFORM pg_sleep(0.2); END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER billing_fixture_delay_link BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION billing_fixture_delay_link()`);
    try{
      const competing=['first','second'].map(part=>{const object=snapshot();object.id='sub_fixtureC_'+part;object.customer='cus_fixtureC';object.metadata.drapixai_user_id=String(c.id);return event('customer.subscription.updated',object);});
      const outcomes=await Promise.all(competing.map(e=>send(e)));
      assert.deepEqual(outcomes.map(v=>v.status).sort(),[200,500]);
      const winner=await prisma.user.findUniqueOrThrow({where:{id:c.id}});
      assert.ok(competing.some(e=>e.data.object.id===winner.subscriptionId));
      assert.equal(await prisma.securityAuditLog.count({where:{targetId:{in:competing.map(e=>e.id)}}}),1);
    }finally{
      await prisma.$executeRawUnsafe(`DROP TRIGGER billing_fixture_delay_link ON "User"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION billing_fixture_delay_link()`);
    }
    pass('Concurrent subscription-link events re-read locked tenant state; the second active binding is rejected');
    assert.ok(subscriptionReads>=5);assert.equal((await verifySecurityAuditChain(prisma)).valid,true);
    process.env.DRAPIXAI_STRIPE_BILLING_ENABLED='0';
    assert.equal((await send(event('invoice.paid',invoice))).status,503);
    pass('Immutable audit chain validates and disabled billing refuses webhook intake');
    console.log(JSON.stringify({passed:true,checks,scope:'actual billing routes, HTTP, Stripe signature SDK and PostgreSQL; outbound provider adapters are synthetic; no real charge, refund, cancellation, invoice mail, Razorpay or Sheets proof'}));
  } finally {
    if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
    await prisma.$disconnect();
  }
}
if(require.main===module) main().then(()=>process.exit(0),error=>{console.error(formatLogError(error));process.exit(1);});
