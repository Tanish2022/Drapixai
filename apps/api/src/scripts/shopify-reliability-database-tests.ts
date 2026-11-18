import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { requireDisposableDatabase } from '../lib/disposable-database';
import { encryptedShopifyTokenData, parseShopifyOfflineTokens } from '../services/shopify-tokens';
import { syncShopifyCatalog, processPendingShopifySyncs } from '../services/shopify';
import { processShopifyCatalogPreparationBatch, retryShopifyPreparation } from '../services/catalog-preparation';
import { recoverShopifyPreparationJobs } from '../services/shopify-preparation-cleanup';
import { hashLinkToken } from '../lib/shopify-auth';
import { shopifyPreparationSourceHash } from '../services/shopify-catalog-state';

const latch = () => {let release!: () => void, entered!: () => void; const waiting = new Promise<void>(r => {release = r;}); const started = new Promise<void>(r => {entered = r;}); return {started, release, hold: async () => {entered(); await waiting;}};};
export const verifyShopifyReliability = async (
  prisma: PrismaClient, replica: PrismaClient,
  webhook: (shop: string, topic: string) => Promise<number>,
  link: (id: number, token: string) => Promise<{status: number; body: any}>,
  linkingUser: number,
) => {
  requireDisposableDatabase(process.env);
  const checks: string[] = [], pass = (value: string) => {checks.push(value); console.log('PASS '+value);};
  const savedFetch = globalThis.fetch, savedS3 = S3Client.prototype.send, savedIntake = process.env.DRAPIXAI_TRYON_INTAKE_ENABLED;
  const users: number[] = [], shops: string[] = [];
  const nodes = new Map<string, any[]>(), failGraph = new Set<string>();
  const objects = new Map<string, Map<string, Buffer>>(), caches = new Set<string>();
  let graphHook: (() => Promise<void>) | undefined, aiHook: (() => Promise<void>) | undefined;
  let failDelete = false, uncertainPut = false, graphRequests = 0, imageRequests = 0, aiRequests = 0;
  const image = await sharp({create: {width: 512, height: 512, channels: 3, background: '#123f65'}}).png().toBuffer();
  const tokenData = () => encryptedShopifyTokenData(parseShopifyOfflineTokens({access_token:'synthetic-reliability-access',refresh_token:'synthetic-reliability-refresh',expires_in:3600,refresh_token_expires_in:7776000,scope:'read_products,write_app_proxy'}));
  const product = (id: string, title = 'Synthetic Shirt') => ({id:`gid://shopify/Product/${id}`,legacyResourceId:id,title,productType:'Shirt',featuredImage:{url:`https://cdn.shopify.com/s/files/reliability/${id}.png`},variants:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}});
  const make = async (label: string, owner?: number) => {
    const userId = owner ?? (await prisma.user.create({data:{email:`reliability-${label}@example.invalid`,passwordHash:'synthetic-no-login'}})).id;
    if (owner === undefined) users.push(userId);
    const shopDomain = `reliability-${label}.myshopify.com`; shops.push(shopDomain); nodes.set(shopDomain, []);
    return prisma.shopifyInstallation.create({data:{shopDomain,userId,status:'active',...tokenData()}});
  };
  globalThis.fetch = (async (input: any, options: any = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'cdn.shopify.com') {imageRequests++; return new Response(image, {headers:{'content-type':'image/png'}});}
    if (url.pathname === '/ai/garment/preprocess/base64') {
      assert.equal(url.origin, 'http://localhost:8080'); aiRequests++;
      const payload = JSON.parse(String(options.body)); assert.equal(payload.admin_bypass, false); assert.equal(payload.garment_type, 'upper');
      const bytes = Buffer.from(payload.cloth_image_base64, 'base64');
      const key = `v3-1024x1365:${payload.brand_id}:${payload.garment_id}:shirt:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
      caches.add(key);
      if (aiHook) {const hook = aiHook; aiHook = undefined; await hook();}
      return new Response(JSON.stringify({cache_key:key,image_base64:image.toString('base64'),warnings:[]}));
    }
    if (url.pathname === '/ai/garment/cache/delete') {assert.equal(url.origin,'http://localhost:8080'); caches.delete(JSON.parse(String(options.body)).cache_key); return new Response('{}');}
    assert.ok(shops.includes(url.hostname), 'No real provider URL is allowed'); assert.equal(url.protocol,'https:'); assert.equal(options.redirect,'error');
    assert.ok(url.pathname.endsWith('/graphql.json')); graphRequests++;
    const snapshot = [...nodes.get(url.hostname)!];
    if (graphHook) {const hook = graphHook; graphHook = undefined; await hook();}
    if (failGraph.has(url.hostname)) return new Response('{}',{status:503});
    return new Response(JSON.stringify({data:{products:{nodes:snapshot,pageInfo:{hasNextPage:false,endCursor:null}}}}));
  }) as typeof fetch;
  (S3Client.prototype as any).send = async (command: any) => {
    const input = command.input; assert.equal(input.Bucket,'drapixai-merchant-fixture');
    if (command.constructor.name === 'GetBucketVersioningCommand') return {Status:'Enabled'};
    if (command.constructor.name === 'PutObjectCommand') {
      assert.ok(input.Key.startsWith('garments/')); assert.ok(Buffer.isBuffer(input.Body));
      const versions = objects.get(input.Key) || new Map<string,Buffer>(); const id = crypto.randomUUID(); versions.set(id, input.Body); objects.set(input.Key, versions);
      if (uncertainPut) throw new Error('SYNTHETIC_RESPONSE_LOST_AFTER_PUT');
      return {VersionId:id};
    }
    if (command.constructor.name === 'ListObjectVersionsCommand') return {IsTruncated:false,Versions:[...objects].filter(([key])=>key.startsWith(input.Prefix)).flatMap(([key,versions])=>[...versions.keys()].map((id,i)=>({Key:key,VersionId:id,IsLatest:i===versions.size-1,ETag:'synthetic'})))};
    if (command.constructor.name === 'DeleteObjectCommand') {
      if (failDelete) throw new Error('SYNTHETIC_DELETE_DENIED');
      assert.ok(input.VersionId); const versions = objects.get(input.Key); versions?.delete(input.VersionId); if (!versions?.size) objects.delete(input.Key); return {};
    }
    if (command.constructor.name === 'HeadObjectCommand') {
      if (!objects.has(input.Key)) throw Object.assign(new Error('not found'),{name:'NotFound',$metadata:{httpStatusCode:404}});
      return {ETag:'synthetic',VersionId:[...objects.get(input.Key)!.keys()].at(-1)};
    }
    throw new Error('UNEXPECTED_SYNTHETIC_STORAGE_OPERATION');
  };
  try {
    const firstRedactionShop='reliability-first-redaction.myshopify.com';
    await prisma.shopifyTokenLease.create({data:{shopDomain:firstRedactionShop,owner:crypto.randomUUID(),expiresAt:new Date(Date.now()+60000)}});
    assert.equal(await webhook(firstRedactionShop,'shop/redact'),200);
    assert.equal(await prisma.shopifyTokenLease.findUnique({where:{shopDomain:firstRedactionShop}}),null);
    assert.equal(await prisma.shopifyInstallation.findUnique({where:{shopDomain:firstRedactionShop}}),null);
    pass('Signed shop redaction cancels the first credential-acquisition lease even before an installation row exists');
    const stale = await make('stale'); nodes.set(stale.shopDomain,[product('stale-1')]);
    const gate = latch(); graphHook = gate.hold;
    const syncing = syncShopifyCatalog(prisma,stale.id,'fixture-held').then(()=>null,e=>e);
    await gate.started; assert.equal(await webhook(stale.shopDomain,'app/uninstalled'),200); gate.release();
    assert.match((await syncing)?.message,/SHOPIFY_CATALOG_STATE_CHANGED/);
    assert.equal(await prisma.catalogProduct.count({where:{userId:stale.userId!}}),0);
    assert.equal((await prisma.shopifyInstallation.findUniqueOrThrow({where:{id:stale.id}})).status,'uninstalled');
    pass('Actual uninstall webhook fences a held sync; no catalog resurrection or late failure-status overwrite');

    await prisma.shopifyInstallation.update({where:{id:stale.id},data:{status:'active',...tokenData()}});
    const oldGate = latch(); graphHook=oldGate.hold;
    const oldSync=syncShopifyCatalog(prisma,stale.id,'fixture-old-epoch').then(()=>null,e=>e);
    await oldGate.started; await webhook(stale.shopDomain,'app/uninstalled');
    await replica.shopifyInstallation.update({where:{id:stale.id},data:{status:'active',catalogEpoch:{increment:1},...tokenData()}});
    nodes.set(stale.shopDomain,[product('new-epoch','New epoch Shirt')]); await syncShopifyCatalog(replica,stale.id,'fixture-new-epoch'); oldGate.release();
    assert.match((await oldSync)?.message,/SHOPIFY_CATALOG_STATE_CHANGED/);
    assert.deepEqual((await prisma.catalogProduct.findMany({where:{userId:stale.userId!,status:{not:'archived'}}})).map(p=>p.productId),['new-epoch']);
    await webhook(stale.shopDomain,'app/uninstalled');
    pass('Reinstallation epoch prevents an old process from overwriting the newer catalog snapshot');

    const deleting=await make('redact-sync'); nodes.set(deleting.shopDomain,[product('redact-sync-1')]);
    const deleteGate=latch(); graphHook=deleteGate.hold; const pending=syncShopifyCatalog(prisma,deleting.id).then(()=>null,e=>e);
    await deleteGate.started; assert.equal(await webhook(deleting.shopDomain,'shop/redact'),200); deleteGate.release();
    assert.match((await pending)?.message,/SHOPIFY_CATALOG_STATE_CHANGED/); assert.equal(await prisma.catalogProduct.count({where:{userId:deleting.userId!}}),0);
    pass('Redaction during provider pagination deletes only its scope and rejects late sync commits');

    const atomic=await make('atomic'); nodes.set(atomic.shopDomain,[product('atomic-old')]); await syncShopifyCatalog(prisma,atomic.id);
    nodes.set(atomic.shopDomain,[product('atomic-new-1'),product('atomic-new-2')]);
    await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_catalog_atomic_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."productId"='atomic-new-2' THEN RAISE EXCEPTION 'SYNTHETIC_ATOMIC_FAILURE'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fixture_catalog_atomic_failure BEFORE INSERT OR UPDATE ON "CatalogProduct" FOR EACH ROW EXECUTE FUNCTION fixture_catalog_atomic_failure()`);
    try {await assert.rejects(syncShopifyCatalog(prisma,atomic.id)); assert.deepEqual((await prisma.catalogProduct.findMany({where:{userId:atomic.userId!}})).map(p=>p.productId),['atomic-old']);}
    finally {await prisma.$executeRawUnsafe(`DROP TRIGGER fixture_catalog_atomic_failure ON "CatalogProduct"`); await prisma.$executeRawUnsafe(`DROP FUNCTION fixture_catalog_atomic_failure()`);}
    await syncShopifyCatalog(prisma,atomic.id); await webhook(atomic.shopDomain,'app/uninstalled');
    pass('Real mid-snapshot SQL failure rolls back catalog/archive/preparation changes; full retry succeeds');

    const bulk=await make('bulk'); const quotedTitle="Synthetic Shirt '); DROP TABLE ignored; --";
    nodes.set(bulk.shopDomain,Array.from({length:1000},(_,i)=>product(`bulk-${i}`,i===0?quotedTitle:'Synthetic Shirt')));
    const bulkResult=await syncShopifyCatalog(prisma,bulk.id); assert.equal(bulkResult.eligible,1000); assert.equal(bulkResult.queued,3); assert.equal(bulkResult.deferred,997);
    assert.equal((await prisma.catalogProduct.findUniqueOrThrow({where:{userId_productId:{userId:bulk.userId!,productId:'bulk-0'}}})).productName,quotedTitle);
    await prisma.catalogProduct.updateMany({where:{userId:bulk.userId!},data:{preparationStatus:'failed',preparationAttempts:3}});
    await syncShopifyCatalog(prisma,bulk.id); assert.equal(await prisma.catalogProduct.count({where:{userId:bulk.userId!,preparationStatus:'failed',preparationAttempts:3}}),1000);
    const manualRetry=await retryShopifyPreparation(prisma,bulk.userId!); assert.equal(manualRetry.queued,3); assert.equal(manualRetry.deferred,997);
    await webhook(bulk.shopDomain,'app/uninstalled');
    pass('A thousand-row atomic snapshot preserves quoted input, bounds admission and explicit retry; ordinary resync cannot reset failed attempt budgets');

    const durable=await make('durable'); nodes.set(durable.shopDomain,[product('durable-1')]);
    const eventGate=latch(); graphHook=eventGate.hold; const first=syncShopifyCatalog(prisma,durable.id);
    await eventGate.started; const before=graphRequests; assert.equal(await webhook(durable.shopDomain,'products/update'),200); assert.equal(graphRequests,before);
    await assert.rejects(syncShopifyCatalog(replica,durable.id,'fixture-duplicate'),/SHOPIFY_SYNC_BUSY/);
    eventGate.release(); await first;
    let state=await prisma.shopifyInstallation.findUniqueOrThrow({where:{id:durable.id}}); assert.ok(state.catalogRequestedVersion>state.catalogSyncedVersion);
    await processPendingShopifySyncs(replica); state=await prisma.shopifyInstallation.findUniqueOrThrow({where:{id:durable.id}}); assert.equal(state.catalogRequestedVersion,state.catalogSyncedVersion);
    const interrupted=await prisma.shopifySyncRun.create({data:{installationId:durable.id,trigger:'synthetic-crash'}});
    await prisma.shopifyInstallation.update({where:{id:durable.id},data:{catalogRequestedVersion:{increment:1},catalogNextAttemptAt:new Date(0),catalogLeaseOwner:'synthetic-dead-owner',catalogLeaseExpiresAt:new Date(0)}});
    await processPendingShopifySyncs(replica); assert.equal((await prisma.shopifySyncRun.findUniqueOrThrow({where:{id:interrupted.id}})).errorCode,'SHOPIFY_SYNC_INTERRUPTED');
    state=await prisma.shopifyInstallation.findUniqueOrThrow({where:{id:durable.id}}); assert.equal(state.catalogRequestedVersion,state.catalogSyncedVersion);
    await webhook(durable.shopDomain,'app/uninstalled');
    pass('Webhook acknowledgement records durable work without network fetch; overlapping requests coalesce and expired sync leases recover');

    const linked=await make('link-outage',linkingUser), rawLink='synthetic-reliable-link';
    await prisma.shopifyInstallation.update({where:{id:linked.id},data:{userId:null,status:'pending_link',linkTokenHash:hashLinkToken(rawLink),linkTokenExpiresAt:new Date(Date.now()+60000)}});
    failGraph.add(linked.shopDomain); const linkedResponse=await link(linked.id,rawLink); assert.equal(linkedResponse.status,200); assert.equal(linkedResponse.body.ok,true); assert.equal(linkedResponse.body.sync.status,'pending');
    state=await prisma.shopifyInstallation.findUniqueOrThrow({where:{id:linked.id}}); assert.equal(state.userId,linkingUser); assert.equal(state.linkTokenHash,null); assert.ok(state.catalogRequestedVersion>state.catalogSyncedVersion);
    failGraph.delete(linked.shopDomain); await prisma.shopifyInstallation.update({where:{id:linked.id},data:{catalogNextAttemptAt:new Date(0)}}); await processPendingShopifySyncs(replica);
    assert.ok((await prisma.shopifyInstallation.findUniqueOrThrow({where:{id:linked.id}})).lastSyncedAt); await webhook(linked.shopDomain,'app/uninstalled');
    pass('Actual one-use link stays successfully linked during provider outage; scheduled work recovers without reusing the link token');

    const a=await make('queue-a'), b=await make('queue-b');
    nodes.set(a.shopDomain,Array.from({length:5},(_,i)=>product(`qa-${i}`))); nodes.set(b.shopDomain,[product('qb-0')]);
    const admission=await syncShopifyCatalog(prisma,a.id); assert.equal(admission.queued,3); assert.equal(admission.deferred,2); await syncShopifyCatalog(prisma,b.id);
    await prisma.catalogProduct.update({where:{userId_productId:{userId:a.userId!,productId:'qa-0'}},data:{preparationAttempts:1}});
    await syncShopifyCatalog(prisma,a.id); assert.equal((await prisma.catalogProduct.findUniqueOrThrow({where:{userId_productId:{userId:a.userId!,productId:'qa-0'}}})).preparationAttempts,1);
    process.env.DRAPIXAI_TRYON_INTAKE_ENABLED='1';
    const fair=await processShopifyCatalogPreparationBatch(prisma,2); assert.deepEqual(fair.items.map(i=>i.productId),['qa-0','qb-0']);
    assert.equal(await prisma.shopifyPreparationJob.count({where:{status:'completed',userId:{in:[a.userId!,b.userId!]}}}),2);
    const ownedB=[...objects.keys()].filter(key=>key.includes(`/${b.userId}/`)); assert.equal(ownedB.length,2);
    pass('Tenant admission cap defers excess products, preserves attempt budgets on resync and fairly serves a second tenant before draining the first');

    const aiGate=latch(); aiHook=aiGate.hold; const active=processShopifyCatalogPreparationBatch(prisma,1);
    await aiGate.started; const beforeImages=imageRequests, beforeAi=aiRequests; const duplicate=await processShopifyCatalogPreparationBatch(replica,1);
    assert.equal(duplicate.busy,true); assert.equal(duplicate.items.length,0); assert.equal(imageRequests,beforeImages); assert.equal(aiRequests,beforeAi); assert.equal(await prisma.shopifyPreparationJob.count({where:{status:'processing'}}),1);
    aiGate.release(); await active;
    await prisma.catalogProduct.updateMany({where:{userId:a.userId!,preparationStatus:{in:['queued','capacity_wait','retry']}},data:{preparationStatus:'failed',preparationAttempts:3}});
    pass('Two real database clients cannot start overlapping preprocessing; durable owner records preserve the previous single-operation global limit');

    const changed=await make('changed'); nodes.set(changed.shopDomain,[product('changed-0')]); await syncShopifyCatalog(prisma,changed.id);
    const changedGate=latch(); aiHook=changedGate.hold; const changedWork=processShopifyCatalogPreparationBatch(prisma,1); await changedGate.started;
    nodes.set(changed.shopDomain,[product('changed-0','Replacement Synthetic Shirt')]); await syncShopifyCatalog(replica,changed.id);
    changedGate.release(); const changedResult=await changedWork; assert.equal(changedResult.items[0]?.status,'retry');
    assert.equal(await prisma.garment.count({where:{userId:changed.userId!}}),0);
    assert.equal([...objects.keys()].some(key=>key.includes(`/${changed.userId}/`)),false);
    assert.equal([...caches].some(key=>key.split(':')[1]===String(changed.userId)),false);
    await prisma.catalogProduct.updateMany({where:{userId:changed.userId!},data:{preparationNextAttemptAt:new Date(0)}});
    const replacementBatch=await processShopifyCatalogPreparationBatch(prisma,1);
    assert.equal(replacementBatch.items[0]?.status,'review_required', JSON.stringify({replacementBatch, jobs:await prisma.shopifyPreparationJob.findMany({where:{installationId:changed.id},select:{status:true,errorCode:true}}),product:await prisma.catalogProduct.findMany({where:{userId:changed.userId!},select:{preparationStatus:true,preparationAttempts:true}})}));
    const replacement=await prisma.catalogProduct.findFirstOrThrow({where:{userId:changed.userId!}});
    assert.equal(replacement.preparedSourceHash,shopifyPreparationSourceHash(replacement));
    assert.equal((await prisma.garment.findFirstOrThrow({where:{userId:changed.userId!}})).productName,'Replacement Synthetic Shirt');
    pass('A product changing during AI preparation cannot publish stale metadata; its cache/assets are compensated before the replacement is prepared');

    const late=await make('late'); nodes.set(late.shopDomain,[product('late-0')]); await syncShopifyCatalog(prisma,late.id);
    const lateGate=latch(); aiHook=lateGate.hold; const lateWork=processShopifyCatalogPreparationBatch(prisma,1); await lateGate.started;
    await prisma.shopifyPreparationJob.updateMany({where:{installationId:late.id,status:'processing'},data:{expiresAt:new Date(0)}});
    await recoverShopifyPreparationJobs(replica,late.id); assert.equal(await prisma.shopifyPreparationJob.count({where:{installationId:late.id,status:'ambiguous'}}),1);
    assert.equal(await webhook(late.shopDomain,'shop/redact'),500); assert.ok(await prisma.shopifyInstallation.findUnique({where:{id:late.id}}));
    failDelete=true; lateGate.release(); await lateWork;
    assert.equal(await prisma.garment.count({where:{userId:late.userId!}}),0); assert.equal(await prisma.shopifyPreparationJob.count({where:{installationId:late.id,status:'cleanup_pending'}}),1);
    assert.equal(await webhook(late.shopDomain,'shop/redact'),500); failDelete=false;
    assert.equal(await webhook(late.shopDomain,'shop/redact'),200); assert.equal(await prisma.catalogProduct.count({where:{userId:late.userId!}}),0);
    assert.ok(ownedB.every(key=>objects.has(key))); assert.equal([...caches].some(key=>key.split(':')[1]===String(late.userId)),false);
    assert.equal([...objects.keys()].some(key=>key.includes(`/${late.userId}/`)),false);
    pass('Late AI response after expiry/redaction is tracked and compensated; failed erasure stays pending, retries remove all synthetic versions and preserve another tenant');

    const recovery=await make('recovery'); nodes.set(recovery.shopDomain,[product('recovery-0')]); await syncShopifyCatalog(prisma,recovery.id);
    const recoveryProduct=await prisma.catalogProduct.findUniqueOrThrow({where:{userId_productId:{userId:recovery.userId!,productId:'recovery-0'}}}); const old=new Date(Date.now()-600000), deadId=crypto.randomUUID();
    await prisma.catalogProduct.update({where:{id:recoveryProduct.id},data:{preparationStatus:'processing',preparationStartedAt:old,preparationAttempts:1}});
    await prisma.shopifyPreparationJob.create({data:{id:deadId,installationId:recovery.id,catalogProductId:recoveryProduct.id,userId:recovery.userId!,epoch:recovery.catalogEpoch,sourceImageUrl:recoveryProduct.imageUrl!,sourceHash:shopifyPreparationSourceHash(recoveryProduct),garmentId:'synthetic-crashed-before-write',originalUrl:'s3://drapixai-merchant-fixture/garments/originals/synthetic-unused.img',thumbnailUrl:'s3://drapixai-merchant-fixture/garments/thumbs/synthetic-unused.png',createdAt:old,expiresAt:old}});
    await recoverShopifyPreparationJobs(replica,recovery.id); assert.equal((await prisma.catalogProduct.findUniqueOrThrow({where:{id:recoveryProduct.id}})).preparationStatus,'retry'); assert.equal((await prisma.shopifyPreparationJob.findUniqueOrThrow({where:{id:deadId}})).status,'cleaned');
    const retried=await processShopifyCatalogPreparationBatch(prisma,1); assert.equal(retried.items[0]?.productId,'recovery-0'); assert.equal(retried.items[0]?.status,'review_required');
    pass('Expired preprocessing before any external write safely requeues with the original attempt budget and completes on retry');

    const race=await make('recover-race'); nodes.set(race.shopDomain,[product('recover-race-0')]); await syncShopifyCatalog(prisma,race.id);
    const raceProduct=await prisma.catalogProduct.findFirstOrThrow({where:{userId:race.userId!}}), raceId=crypto.randomUUID();
    await prisma.catalogProduct.update({where:{id:raceProduct.id},data:{preparationStatus:'processing',preparationStartedAt:old,preparationAttempts:1}});
    await prisma.shopifyPreparationJob.create({data:{id:raceId,installationId:race.id,catalogProductId:raceProduct.id,userId:race.userId!,epoch:race.catalogEpoch,sourceImageUrl:raceProduct.imageUrl!,sourceHash:shopifyPreparationSourceHash(raceProduct),garmentId:'synthetic-read-race',originalUrl:'s3://drapixai-merchant-fixture/garments/originals/synthetic-race.img',thumbnailUrl:'s3://drapixai-merchant-fixture/garments/thumbs/synthetic-race.png',createdAt:old,expiresAt:old}});
    let inject=true;
    const observingClient=prisma.$extends({query:{shopifyPreparationJob:{async findMany({args,query}) {
      const rows=await query(args); if(inject&&rows.some(row=>row.id===raceId)){inject=false;await replica.shopifyPreparationJob.update({where:{id:raceId},data:{externalWorkStarted:true}});} return rows;
    }}}}) as unknown as PrismaClient;
    await recoverShopifyPreparationJobs(observingClient,race.id);
    assert.equal((await prisma.shopifyPreparationJob.findUniqueOrThrow({where:{id:raceId}})).status,'processing');
    await recoverShopifyPreparationJobs(prisma,race.id); assert.equal((await prisma.shopifyPreparationJob.findUniqueOrThrow({where:{id:raceId}})).status,'ambiguous');
    assert.equal((await prisma.catalogProduct.findUniqueOrThrow({where:{id:raceProduct.id}})).preparationStatus,'reconciliation_required');
    // No actual external bytes were created by this controlled stale-read race.
    await prisma.shopifyPreparationJob.update({where:{id:raceId},data:{status:'cleaned'}});
    await prisma.catalogProduct.update({where:{id:raceProduct.id},data:{preparationStatus:'failed'}}); await webhook(race.shopDomain,'app/uninstalled');
    pass('Recovery cannot mark a stale pre-write observation safely cleaned after another database client records an external write');

    const uncertain=await make('uncertain'); nodes.set(uncertain.shopDomain,[product('uncertain-0')]); await syncShopifyCatalog(prisma,uncertain.id); uncertainPut=true;
    const uncertainWork=await processShopifyCatalogPreparationBatch(prisma,1); uncertainPut=false;
    assert.equal(uncertainWork.items[0]?.status,'reconciliation_required'); const uncertainJob=await prisma.shopifyPreparationJob.findFirstOrThrow({where:{installationId:uncertain.id}});
    assert.equal(uncertainJob.status,'ambiguous'); assert.equal(await webhook(uncertain.shopDomain,'shop/redact'),500);
    const denied=await processShopifyCatalogPreparationBatch(replica,1); assert.equal(denied.busy,true); assert.equal(denied.items.length,0);
    // Fixture-only operator attestation after inspecting/removing synthetic bytes;
    // there is intentionally no public "mark reconciliation complete" endpoint.
    for(const key of [...objects.keys()].filter(key=>key.includes(`/${uncertain.userId}/`)))objects.delete(key);
    await prisma.shopifyPreparationJob.update({where:{id:uncertainJob.id},data:{status:'cleaned'}});
    await prisma.catalogProduct.updateMany({where:{userId:uncertain.userId!},data:{preparationStatus:'failed'}});
    assert.equal(await webhook(uncertain.shopDomain,'shop/redact'),200);
    pass('A lost storage-write response creates a durable reconciliation hold; it cannot automatically retry, publish or acknowledge deletion');
    process.env.DRAPIXAI_TRYON_INTAKE_ENABLED='0'; const beforeCalls=aiRequests; assert.equal((await processShopifyCatalogPreparationBatch(prisma)).paused,true); assert.equal(aiRequests,beforeCalls);
    pass('Paused intake prevents new preprocessing after recovery and cleanup bookkeeping');
    return checks;
  } finally {
    globalThis.fetch=savedFetch; S3Client.prototype.send=savedS3; process.env.DRAPIXAI_TRYON_INTAKE_ENABLED=savedIntake;
    await prisma.catalogProduct.updateMany({where:{userId:{in:users}},data:{status:'archived',preparationStatus:'cancelled'}});
    await prisma.shopifyInstallation.updateMany({where:{shopDomain:{in:shops}},data:{status:'uninstalled',catalogLeaseOwner:null,catalogLeaseExpiresAt:null}});
  }
};
