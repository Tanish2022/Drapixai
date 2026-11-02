import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import helmet from 'helmet';
import { S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { requireDisposableDatabase } from '../lib/disposable-database';
import { CURRENT_TERMS, recordAccountTermsAcceptance } from '../lib/account-terms';
import { issueApiKeyForUser } from '../lib/api-key-auth';
import { formatLogError } from '../lib/security';

// A one-shot CLI fixture. All outbound Shopify/feed responses are synthetic;
// persistence, OAuth crypto, HTTP routes and tenant checks are actual code.
async function main() {
  const url=requireDisposableDatabase(process.env);
  assert.equal(process.env.DRAPIXAI_SHOPIFY_HTTP_FIXTURE,'I_ACKNOWLEDGE_DISPOSABLE_SHOPIFY_HTTP');
  assert.equal(process.env.NODE_ENV,'test');assert.ok(!process.env.SMTP_HOST);
  Object.assign(process.env,{SHOPIFY_API_KEY:'synthetic-client-id',SHOPIFY_API_SECRET:crypto.randomBytes(32).toString('hex'),
    DRAPIXAI_SHOPIFY_STATE_SECRET:crypto.randomBytes(32).toString('hex'),DRAPIXAI_SHOPIFY_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),
    DRAPIXAI_STOREFRONT_TOKEN_SECRET:crypto.randomBytes(32).toString('hex'),SHOPIFY_SCOPES:'read_products,write_app_proxy',SHOPIFY_USE_LEGACY_INSTALL_FLOW:'0',
    DRAPIXAI_PUBLIC_API_BASE_URL:'https://api.fixture.example.invalid',DRAPIXAI_WEB_BASE_URL:'https://fixture.example.invalid',
    DRAPIXAI_SHOPIFY_AUTO_PREPARE:'0',DRAPIXAI_TRYON_INTAKE_ENABLED:'0',DRAPIXAI_SHOPIFY_PREPARE_MAX_PENDING_PER_TENANT:'3',DRAPIXAI_ENABLE_LOWER_BODY:'0',AWS_EC2_METADATA_DISABLED:'true',S3_BUCKET:'drapixai-merchant-fixture'});
  const prisma=new PrismaClient({datasources:{db:{url}}}),replica=new PrismaClient({datasources:{db:{url}}});
  const checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS '+s);};let server:http.Server|undefined;
  const realFetch=globalThis.fetch;
  const realStorageSend=S3Client.prototype.send;
  try {
    assert.equal(await prisma.user.count(),0,'Only a fresh empty owned database is allowed');
    const [a,b]=await Promise.all(['a','b'].map(part=>prisma.user.create({data:{email:`shopify-${part}@example.invalid`,passwordHash:'synthetic-not-a-login'}})));
    const {encryptShopifySecret,decryptShopifySecret}=await import('../lib/shopify-crypto');
    const {hashLinkToken}=await import('../lib/shopify-auth');
    const {linkShopifyInstallation,syncShopifyCatalog}=await import('../services/shopify');
    const pending=await prisma.shopifyInstallation.create({data:{shopDomain:'race.myshopify.com',primaryDomain:'race.example.invalid',scopes:'read_products',encryptedAccessToken:encryptShopifySecret('synthetic-offline-token'),linkTokenHash:hashLinkToken('synthetic-one-use-link'),linkTokenExpiresAt:new Date(Date.now()+60000)}});
    const race=await Promise.allSettled(Array.from({length:8},(_,i)=>linkShopifyInstallation(i%2?prisma:replica,pending,i%2?a.id:b.id)));
    if (!race.some(r=>r.status==='fulfilled')) for(const r of race)if(r.status==='rejected')console.error(formatLogError(r.reason));
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1,'Only one account may consume a link token under concurrent requests');
    const linked=await prisma.shopifyInstallation.findUniqueOrThrow({where:{id:pending.id}});
    assert.equal(await prisma.apiKey.count({where:{kind:'shopify'}}),1,'Losing links must not leave active orphan keys');
    assert.equal(linked.linkTokenHash,null);assert.equal(linked.linkTokenExpiresAt,null);
    const key=await prisma.apiKey.findUniqueOrThrow({where:{id:linked.storefrontApiKeyId!}});assert.equal(key.userId,linked.userId);
    await assert.rejects(linkShopifyInstallation(prisma,pending,linked.userId!),/SHOPIFY_LINK/);
    pass('Eight concurrent links across two accounts/Prisma replicas consume one token, create one owner-bound key and reject replay');
    for(const state of ['expired','uninstalled']) {
      const candidate=await prisma.shopifyInstallation.create({data:{shopDomain:`${state}.myshopify.com`,scopes:'read_products',encryptedAccessToken:encryptShopifySecret('synthetic-offline-token'),status:state==='uninstalled'?'uninstalled':'pending_link',linkTokenHash:hashLinkToken(state),linkTokenExpiresAt:new Date(Date.now()+(state==='expired'?-60000:60000))}});
      await assert.rejects(linkShopifyInstallation(prisma,candidate,a.id),/SHOPIFY_LINK/);
    }
    pass('Expired and uninstalled installation snapshots cannot mint a storefront credential');
    const rollback=await prisma.shopifyInstallation.create({data:{shopDomain:'rollback.myshopify.com',scopes:'read_products',encryptedAccessToken:encryptShopifySecret('synthetic-offline-token'),linkTokenHash:hashLinkToken('synthetic-rollback'),linkTokenExpiresAt:new Date(Date.now()+60000)}});
    const countBefore=await prisma.apiKey.count();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION merchant_fixture_key_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."label"='rollback.myshopify.com' THEN RAISE EXCEPTION 'SYNTHETIC_KEY_FAILURE'; END IF; RETURN NEW; END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER merchant_fixture_key_failure BEFORE INSERT ON "ApiKey" FOR EACH ROW EXECUTE FUNCTION merchant_fixture_key_failure()`);
      await assert.rejects(linkShopifyInstallation(prisma,rollback,a.id));
      assert.equal((await prisma.shopifyInstallation.findUniqueOrThrow({where:{id:rollback.id}})).linkTokenHash,rollback.linkTokenHash);
      assert.equal(await prisma.apiKey.count(),countBefore);
    } finally {await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS merchant_fixture_key_failure ON "ApiKey"`);await prisma.$executeRawUnsafe(`DROP FUNCTION merchant_fixture_key_failure()`);}
    await linkShopifyInstallation(prisma,rollback,a.id);
    pass('Real key-insert failure rolls back link-token consumption and key creation; a later retry succeeds');
    const assent={accepted:true,version:CURRENT_TERMS.version,documentHash:CURRENT_TERMS.documentHash};
    for(const user of [a,b])await prisma.$transaction(tx=>recordAccountTermsAcceptance(tx,user.id,assent,'authenticated_account'));
    const dashboardA=await issueApiKeyForUser(prisma,a.id,{kind:'dashboard'}),dashboardB=await issueApiKeyForUser(prisma,b.id,{kind:'dashboard'}),manual=await issueApiKeyForUser(prisma,a.id,{kind:'manual'});
    let catalogMode='normal', productRequests=0, exchanges=0;
    const product=(id:string,title:string,type='Shirt')=>({id:`gid://shopify/Product/${id}`,legacyResourceId:id,title,productType:type,featuredImage:{url:`https://cdn.shopify.com/s/files/synthetic/${id}.png`},variants:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}});
    globalThis.fetch=(async (input:any,options:any={})=>{
      const target=new URL(String(input));assert.equal(target.protocol,'https:');assert.equal(target.hostname,'fixture-store.myshopify.com');
      assert.equal(options.redirect,'error','Credential-bearing Shopify requests must refuse redirects');
      if(target.pathname==='/admin/oauth/access_token'){exchanges++;const form=new URLSearchParams(String(options.body));assert.equal(form.get('expiring'),'1');return new Response(JSON.stringify({access_token:'synthetic-offline-token',refresh_token:'synthetic-refresh-token',expires_in:3600,refresh_token_expires_in:7776000,scope:'read_products,write_app_proxy'}));}
      const body=JSON.parse(String(options.body||'{}'));
      assert.ok(target.pathname.endsWith('/graphql.json'));
      if(String(body.query).includes('DrapixAIShop'))return new Response(JSON.stringify({data:{shop:{name:'Synthetic shop',primaryDomain:{host:'fixture-store.example.invalid'}}}}));
      productRequests++;
      if(catalogMode==='failure')return new Response('{}',{status:503});
      if(catalogMode==='oversize')return new Response('{}',{headers:{'content-length':String(5*1024*1024)}});
      const nodes=catalogMode==='deleted'?[]:[product('101','Fixture Shirt'),product('201','Fixture Shirt - Blue')];
      if(nodes.length){nodes[0].variants.nodes=[{legacyResourceId:'1001',title:'Blue',image:{url:'https://cdn.shopify.com/s/files/synthetic/blue.png'}}] as any;nodes.push(product('301','Fixture Jeans','Jeans'));}
      return new Response(JSON.stringify({data:{products:{nodes,pageInfo:{hasNextPage:catalogMode==='cursor-loop',endCursor:catalogMode==='cursor-loop'?'same-cursor':null}}}}));
    }) as typeof fetch;
    const remote=await import('../lib/remote-fetch');let feedMode='normal';
    (remote as any).safeFetchText=(async (target:string,options:any)=>{
      assert.equal(options.allowedProtocols[0],'https:');assert.ok(options.maxBytes<=2*1024*1024);
      const u=new URL(target);assert.equal(u.hostname,'private-store.example.invalid');
      if(u.pathname==='/feed.json')return {response:{ok:true,headers:new Headers({'content-type':'application/json'})},text:JSON.stringify([{productId:'private-1',productName:'Private Shirt',category:'Shirt',imageUrl:'https://private-store.example.invalid/shirt.png',userId:b.id},{productId:'private-lower',productName:'Jeans',category:'Jeans'}])};
      if(feedMode==='failure')throw new Error('SYNTHETIC_REMOTE_FAILURE');
      const user=await prisma.user.findUniqueOrThrow({where:{id:b.id}});
      return {response:{ok:true,headers:new Headers()},text:`<meta name="drapixai-domain-verification" content="${user.storeVerificationToken}" />`};
    }) as any;
    const {default:shopify}=await import('../routes/shopify');const {default:webhooks}=await import('../routes/shopify-webhooks');const {default:account}=await import('../routes/account');const {default:storefront}=await import('../routes/shopify-storefront');
    const {default:embedded}=await import('../routes/shopify-embedded');
    const app=express();app.use(helmet());app.use('/shopify',embedded);app.use('/shopify/webhooks',express.raw({type:'application/json',limit:'64kb'}),webhooks);app.use(express.json({limit:'16kb'}));app.use('/shopify',shopify);app.use('/shopify',storefront);app.use('/account',account);
    app.use((_e:unknown,_q:express.Request,res:express.Response,_n:express.NextFunction)=>res.status(500).json({error:'FIXTURE_ROUTE_ERROR'}));
    server=await new Promise<http.Server>((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);});const address=server.address();assert.ok(address&&typeof address!=='string');const port=address.port;
    async function request(route:string,body?:unknown,headers:Record<string,string>={},method=body===undefined?'GET':'POST') {
      const bytes=body===undefined?undefined:Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
      return new Promise<{status:number;headers:http.IncomingHttpHeaders;body:any}>((resolve,reject)=>{
        const req=http.request({host:'127.0.0.1',port,path:route,method,signal:AbortSignal.timeout(12000),headers:{...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{}),...headers}},res=>{const chunks:Buffer[]=[];let n=0;res.on('data',c=>{n+=c.length;if(n>65536)res.destroy(new Error('RESPONSE_TOO_LARGE'));else chunks.push(c);});res.on('error',reject);res.on('end',()=>{const raw=Buffer.concat(chunks).toString();try{resolve({status:res.statusCode!,headers:res.headers,body:!String(res.headers['content-type']).includes('application/json')?raw:raw?JSON.parse(raw):null});}catch{reject(new Error('RESPONSE_NOT_JSON'));}});});req.on('error',reject);req.end(bytes);
      });
    }
    const auth=(token:string)=>({authorization:`Bearer ${token}`,'x-drapixai-dashboard-proxy-token':process.env.DRAPIXAI_DASHBOARD_PROXY_TOKEN!});
    assert.equal((await request('/shopify/status',undefined,auth(manual))).status,403);
    assert.equal((await request('/shopify/status',undefined,{authorization:`Bearer ${dashboardA}`})).status,403);
    const signed=(params:Record<string,string>)=>{const values=new URLSearchParams(params);const message=Array.from(values.entries()).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('&');values.set('hmac',crypto.createHmac('sha256',process.env.SHOPIFY_API_SECRET!).update(message).digest('hex'));return values.toString();};
    const install=await request('/shopify/install?'+signed({shop:'fixture-store.myshopify.com',timestamp:String(Math.floor(Date.now()/1000))}));assert.equal(install.status,302);
    const authorize=new URL(String(install.headers.location));assert.equal(authorize.hostname,'fixture-store.myshopify.com');assert.equal(authorize.searchParams.has('scope'),false);
    const cookie=String(install.headers['set-cookie']?.[0]||'').split(';')[0],state=authorize.searchParams.get('state')!;
    const callback=signed({shop:'fixture-store.myshopify.com',code:'synthetic-code',state,timestamp:String(Math.floor(Date.now()/1000))});
    const denied=await request('/shopify/callback?'+callback,undefined,{cookie:'drapixai_shopify_state=wrong'});assert.equal(denied.status,401);assert.equal(denied.body.error,'INVALID_SHOPIFY_STATE');assert.equal(exchanges,0);
    const accepted=await request('/shopify/callback?'+callback,undefined,{cookie});assert.equal(accepted.status,302);assert.equal(exchanges,1);
    const handoff=new URL(String(accepted.headers.location)),installationId=Number(handoff.searchParams.get('installation')),token=handoff.searchParams.get('token')!;
    const installation=await prisma.shopifyInstallation.findUniqueOrThrow({where:{id:installationId}});assert.notEqual(installation.encryptedAccessToken,'synthetic-offline-token');assert.equal(decryptShopifySecret(installation.encryptedAccessToken),'synthetic-offline-token');assert.equal(installation.status,'pending_link');
    pass('Actual OAuth routes bind cookie/state and signed shop, refuse wrong browser, exchange synthetic code and store only encrypted offline token');
    const connected=await request('/shopify/link',{installationId,token},auth(dashboardA));assert.equal(connected.status,200);
    const catalog=await prisma.catalogProduct.findMany({where:{userId:a.id,source:'shopify:fixture-store.myshopify.com'}});assert.equal(catalog.length,3);assert.equal(catalog.filter(p=>p.isVariant).length,1);assert.equal(catalog.filter(p=>p.preparationStatus==='queued').length,2);assert.equal(catalog.some(p=>p.productId==='301'),false);
    assert.equal((await request('/shopify/link',{installationId,token},auth(dashboardB))).status,400);
    const foreignStatus=await request('/shopify/status',undefined,auth(dashboardB));assert.ok(!JSON.stringify(foreignStatus.body).includes('fixture-store.myshopify.com'));
    assert.equal((await request('/shopify/prepare',{},auth(dashboardA))).status,503);assert.equal(await prisma.garment.count(),0);
    pass('Actual link/catalog routes isolate tenant data, sync product/variant without duplicate preparation, exclude lower-body and keep GPU intake disabled');
    catalogMode='failure';await assert.rejects(syncShopifyCatalog(prisma,installationId,'fixture-failure'));assert.equal(await prisma.catalogProduct.count({where:{userId:a.id,status:'archived'}}),0);
    catalogMode='oversize';await assert.rejects(syncShopifyCatalog(prisma,installationId,'fixture-oversize'),/SHOPIFY_RESPONSE_TOO_LARGE/);
    catalogMode='cursor-loop';const before=productRequests;await assert.rejects(syncShopifyCatalog(prisma,installationId,'fixture-loop'),/SHOPIFY_.*PAGINATION/);assert.ok(productRequests-before<=3);
    catalogMode='deleted';await syncShopifyCatalog(prisma,installationId,'fixture-deleted');assert.equal(await prisma.catalogProduct.count({where:{userId:a.id,source:'shopify:fixture-store.myshopify.com',status:'archived'}}),3);
    pass('Failed or repeating-cursor sync preserves catalog; complete empty sync archives only the owning shop catalog');
    const webhook=(id:string,topic:string,shop='fixture-store.myshopify.com',valid=true)=>{const bytes=Buffer.from('{"id":123}');return request('/shopify/webhooks',bytes,{'x-shopify-shop-domain':shop,'x-shopify-topic':topic,'x-shopify-webhook-id':id,'x-shopify-hmac-sha256':valid?crypto.createHmac('sha256',process.env.SHOPIFY_API_SECRET!).update(bytes).digest('base64'):'invalid'});};
    assert.equal((await webhook(crypto.randomUUID(),'app/uninstalled',undefined,false)).status,401);
    const busyId=crypto.randomUUID();await prisma.shopifyWebhookEvent.create({data:{webhookId:busyId,shopDomain:'fixture-store.myshopify.com',topic:'app/uninstalled',status:'processing'}});
    await prisma.shopifyInstallation.update({where:{id:installationId},data:{linkTokenHash:hashLinkToken('pending-at-uninstall'),linkTokenExpiresAt:new Date(Date.now()+60000)}});
    assert.equal((await webhook(busyId,'app/uninstalled')).status,409);
    await prisma.shopifyWebhookEvent.update({where:{webhookId:busyId},data:{receivedAt:new Date(Date.now()-6*60000)}});
    assert.equal((await webhook(busyId,'app/uninstalled')).status,200);assert.equal((await webhook(busyId,'app/uninstalled')).status,200);
    assert.equal((await webhook(busyId,'app/uninstalled','other.myshopify.com')).status,409);
    const removed=await prisma.shopifyInstallation.findUniqueOrThrow({where:{id:installationId}});assert.equal(removed.status,'uninstalled');assert.equal(removed.encryptedAccessToken,'');assert.equal(removed.linkTokenHash,null);
    assert.equal((await prisma.apiKey.findUniqueOrThrow({where:{id:removed.storefrontApiKeyId!}})).isActive,false);
    pass('Webhook HMAC, busy retry, stale-claim recovery, durable duplicate acknowledgement, shop binding and uninstall revocation operate through real HTTP/SQL');
    const settings=await request('/account/store',{domain:'private-store.example.invalid',syncSource:'feed_url',feedUrl:'https://private-store.example.invalid/feed.json'},auth(dashboardB));assert.equal(settings.status,200);
    assert.equal((await request('/account/store/verify',{},auth(dashboardB))).status,200);
    const synced=await request('/account/store/resync',{userId:a.id},auth(dashboardB));assert.equal(synced.status,200);assert.equal(await prisma.catalogProduct.count({where:{userId:b.id,productId:'private-1'}}),1);assert.equal(await prisma.catalogProduct.count({where:{userId:a.id,productId:'private-1'}}),0);
    assert.equal(await prisma.catalogProduct.count({where:{userId:b.id,productId:'private-lower'}}),0);
    assert.equal((await request('/account/store',{syncSource:'feed_url',feedUrl:'http://private-store.example.invalid/feed.json'},auth(dashboardB))).status,400);
    pass('Private-store settings/verification/feed parser persist only authenticated tenant products, reject HTTP feed and preserve upper-body scope with synthetic remote transport');
    const versions=new Set(['synthetic-v1','synthetic-v2']),removedVersions:string[]=[];let storageDenied=true;
    (S3Client.prototype as any).send=async (command:any)=>{
      assert.equal(command.input.Bucket,'drapixai-merchant-fixture');
      if(storageDenied)throw new Error('SYNTHETIC_STORAGE_DENIED');
      if(command.constructor.name==='GetBucketVersioningCommand')return {Status:'Enabled'};
      if(command.constructor.name==='ListObjectVersionsCommand'){assert.equal(command.input.Prefix,'garments/synthetic-merchant.png');return {IsTruncated:false,Versions:Array.from(versions).map((id,i)=>({Key:'garments/synthetic-merchant.png',VersionId:id,IsLatest:i===versions.size-1,ETag:'synthetic-etag'}))};}
      if(command.constructor.name==='DeleteObjectCommand'){assert.equal(command.input.Key,'garments/synthetic-merchant.png');assert.ok(command.input.VersionId);removedVersions.push(command.input.VersionId);versions.delete(command.input.VersionId);return {};}
      if(command.constructor.name==='HeadObjectCommand')throw Object.assign(new Error('not found'),{name:'NotFound',$metadata:{httpStatusCode:404}});
      throw new Error('UNEXPECTED_STORAGE_OPERATION');
    };
    const garmentId='synthetic-shopify-garment';
    await prisma.garment.create({data:{userId:a.id,garmentId,originalHash:'synthetic-hash',originalUrl:'s3://drapixai-merchant-fixture/garments/synthetic-merchant.png'}});
    await prisma.catalogProduct.update({where:{userId_productId:{userId:a.id,productId:'101'}},data:{preparedGarmentId:garmentId}});
    const redactId=crypto.randomUUID();assert.equal((await webhook(redactId,'shop/redact')).status,500);
    assert.equal(await prisma.garment.count({where:{userId:a.id,garmentId}}),1);assert.ok(await prisma.shopifyInstallation.findUnique({where:{id:installationId}}));
    storageDenied=false;assert.equal((await webhook(redactId,'shop/redact')).status,200);
    assert.equal(removedVersions.length,2);assert.equal(versions.size,0);
    assert.equal(await prisma.garment.count({where:{userId:a.id,garmentId}}),0);assert.equal(await prisma.shopifyInstallation.findUnique({where:{id:installationId}}),null);
    assert.equal(await prisma.catalogProduct.count({where:{userId:b.id,productId:'private-1'}}),1);
    assert.equal((await webhook(redactId,'shop/redact')).status,200);
    pass('Shop redaction retains metadata on storage failure, retries version-aware erasure and removes only the owning Shopify catalog; storage responses are synthetic');
    const {verifyShopifyReliability}=await import('./shopify-reliability-database-tests');
    checks.push(...await verifyShopifyReliability(prisma,replica,async(shop,topic)=>{return (await webhook(crypto.randomUUID(),topic,shop)).status;},
      async(id,token)=>request('/shopify/link',{installationId:id,token},auth(dashboardA)),a.id));
    const {verifyShopifyTokenLifecycle}=await import('./shopify-token-database-tests');
    checks.push(...await verifyShopifyTokenLifecycle(prisma,replica,async()=>{
      assert.equal((await webhook(crypto.randomUUID(),'app/uninstalled','tokens.myshopify.com')).status,200);
    }));
    const {verifyShopifyEmbedded}=await import('./shopify-embedded-database-tests');
    checks.push(...await verifyShopifyEmbedded(prisma,request,a.id,auth(dashboardA),auth(dashboardB),async()=>{assert.equal((await webhook(crypto.randomUUID(),'app/uninstalled','embedded-owner.myshopify.com')).status,200);}));
    const {verifyEmbeddedBrowser}=await import('./shopify-embedded-browser-tests');
    checks.push(...await verifyEmbeddedBrowser());
    console.log(JSON.stringify({passed:true,checks,scope:'actual Shopify/account routers and PostgreSQL; all provider/feed responses synthetic; no live Shopify install, theme save, CDN ingestion, storage erasure, GPU quality, email, public callback or App Store approval'}));
  } finally {globalThis.fetch=realFetch;S3Client.prototype.send=realStorageSend;if(server){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));}await prisma.$disconnect();await replica.$disconnect();}
}
if(require.main===module)main().then(()=>process.exit(0),e=>{console.error(formatLogError(e));process.exit(1);});
