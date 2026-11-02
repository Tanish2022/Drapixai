import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { requireDisposableDatabase } from '../lib/disposable-database';
import { decryptShopifySecret } from '../lib/shopify-crypto';
import { runDatabaseTransaction } from '../lib/database-transaction';
import { assertShopifyTokenLease, encryptedShopifyTokenData, getShopifyAccessToken, parseShopifyOfflineTokens, withShopifyTokenLease } from '../services/shopify-tokens';

export const verifyShopifyTokenLifecycle = async (prisma: PrismaClient, replica: PrismaClient, uninstall: () => Promise<void>) => {
  requireDisposableDatabase(process.env);
  const checks: string[] = [], pass = (value: string) => { checks.push(value); console.log('PASS '+value); };
  const scope='read_products,write_app_proxy', shop='tokens.myshopify.com';
  const payload=(version: number)=>({access_token:`synthetic-access-${version}`,refresh_token:`synthetic-refresh-${version}`,scope,expires_in:3600,refresh_token_expires_in:7776000});
  const start=new Date();
  for (const mutation of [{refresh_token:undefined},{expires_in:undefined},{expires_in:'3600'},{expires_in:0},{refresh_token_expires_in:-1},{scope:'read_products'},{scope:scope+',read_customers'},{associated_user:{id:123}}]) {
    assert.throws(()=>parseShopifyOfflineTokens({...payload(0),...mutation},start));
  }
  assert.equal(parseShopifyOfflineTokens({...payload(0),expires_in:1234},start).accessTokenExpiresAt.getTime(),start.getTime()+1234000);
  const encrypted=encryptedShopifyTokenData(parseShopifyOfflineTokens(payload(0)));
  assert.notEqual(encrypted.encryptedAccessToken,payload(0).access_token);assert.notEqual(encrypted.encryptedRefreshToken,payload(0).refresh_token);
  pass('Offline token parsing requires both lifetimes, exact approved scopes and offline shape; encrypted pair never equals plaintext');
  const user=await prisma.user.create({data:{email:'token-lifecycle@example.invalid',passwordHash:'synthetic-not-a-login'}});
  const key=await prisma.apiKey.create({data:{userId:user.id,keyHash:crypto.randomBytes(32).toString('hex'),kind:'shopify',domainWhitelist:'tokens.example.invalid'}});
  const installation=await prisma.shopifyInstallation.create({data:{shopDomain:shop,userId:user.id,status:'active',storefrontApiKeyId:key.id,...encrypted}});
  const realFetch=globalThis.fetch;let calls=0, mode='ok', issued=0;
  const presented: string[]=[];
  let entered: (()=>void)|undefined, release: (()=>void)|undefined;
  globalThis.fetch=(async (input:any, options:any)=>{
    assert.equal(String(input),`https://${shop}/admin/oauth/access_token`);assert.equal(options.redirect,'error');
    const body=new URLSearchParams(String(options.body));assert.equal(body.get('grant_type'),'refresh_token');presented.push(body.get('refresh_token')!);calls++;
    if(mode==='transport')throw new Error('SYNTHETIC_TRANSPORT_LOSS');
    if(mode==='server')return new Response('{}',{status:503});
    if(mode==='revoked')return new Response('{}',{status:400});
    if(mode==='invalid')return new Response(JSON.stringify({...payload(issued),scope:'read_customers'}));
    if(mode==='hold'){entered!();await new Promise<void>(resolve=>{release=resolve;});}
    else await new Promise(resolve=>setTimeout(resolve,40));
    return new Response(JSON.stringify(payload(++issued)));
  }) as typeof fetch;
  const current=()=>prisma.shopifyInstallation.findUniqueOrThrow({where:{id:installation.id}});
  const expireAccess=()=>prisma.shopifyInstallation.update({where:{id:installation.id},data:{accessTokenExpiresAt:new Date(Date.now()+1000)}});
  try {
    assert.equal(await getShopifyAccessToken(prisma,installation.id),'synthetic-access-0');assert.equal(calls,0);
    await expireAccess();
    const results=await Promise.allSettled(Array.from({length:8},(_,i)=>getShopifyAccessToken(i%2?prisma:replica,installation.id)));
    assert.ok(results.some(r=>r.status==='fulfilled'));for(const r of results)if(r.status==='rejected')assert.match(r.reason.message,/SHOPIFY_TOKEN_BUSY/);
    assert.equal(calls,1);assert.equal(decryptShopifySecret((await current()).encryptedRefreshToken!),'synthetic-refresh-1');
    assert.equal(await prisma.shopifyTokenLease.count(),0);
    await expireAccess();await getShopifyAccessToken(replica,installation.id);assert.equal(presented.at(-1),'synthetic-refresh-1');
    pass('Cached credentials avoid provider calls; concurrent refresh across replicas sends one request and next refresh uses the rotated encrypted token');
    await expireAccess();const before=await current();
    for(const scenario of ['server','transport','invalid']) {
      mode=scenario;await assert.rejects(getShopifyAccessToken(prisma,installation.id));
      const after=await current();assert.equal(after.encryptedAccessToken,before.encryptedAccessToken);assert.equal(after.encryptedRefreshToken,before.encryptedRefreshToken);assert.equal(after.status,'active');assert.equal(await prisma.shopifyTokenLease.count(),0);
    }
    pass('Transport/provider/invalid-response failures preserve the encrypted pair and release the lease without a false successful refresh');
    mode='ok';
    await prisma.$executeRawUnsafe(`CREATE FUNCTION merchant_token_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."shopDomain"='tokens.myshopify.com' THEN RAISE EXCEPTION 'SYNTHETIC_TOKEN_COMMIT_FAILURE'; END IF; RETURN NEW; END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER merchant_token_commit_failure BEFORE UPDATE OF "encryptedRefreshToken" ON "ShopifyInstallation" FOR EACH ROW EXECUTE FUNCTION merchant_token_commit_failure()`);
      await assert.rejects(getShopifyAccessToken(prisma,installation.id));assert.equal((await current()).encryptedRefreshToken,before.encryptedRefreshToken);
    } finally {await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS merchant_token_commit_failure ON "ShopifyInstallation"`);await prisma.$executeRawUnsafe(`DROP FUNCTION merchant_token_commit_failure()`);}
    await getShopifyAccessToken(prisma,installation.id);assert.equal(presented.at(-1),presented.at(-2));
    pass('Real persistence failure rolls back both credentials; retry presents the last committed refresh token (provider recovery behavior is simulated)');
    await withShopifyTokenLease(prisma,shop,async old=>{
      await assert.rejects(withShopifyTokenLease(replica,shop,async()=>undefined),/SHOPIFY_TOKEN_BUSY/);
      await prisma.$executeRaw`UPDATE "ShopifyTokenLease" SET "expiresAt"=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE "shopDomain"=${shop}`;
      await withShopifyTokenLease(replica,shop,async newer=>{
        await assert.rejects(runDatabaseTransaction(prisma,tx=>assertShopifyTokenLease(tx,old)),/SHOPIFY_TOKEN_LEASE_LOST/);
        await runDatabaseTransaction(replica,tx=>assertShopifyTokenLease(tx,newer));
      });
    });
    assert.equal(await prisma.shopifyTokenLease.count(),0);
    pass('Busy and expired SQL leases are bounded; stale owners cannot commit over a replacement owner');
    await expireAccess();mode='revoked';await assert.rejects(getShopifyAccessToken(prisma,installation.id),/SHOPIFY_TOKEN_REAUTH_REQUIRED/);
    const revoked=await current();assert.equal(revoked.status,'reauth_required');assert.equal(revoked.encryptedAccessToken,'');assert.equal(revoked.encryptedRefreshToken,null);assert.equal(revoked.accessTokenExpiresAt,null);assert.equal((await prisma.apiKey.findUniqueOrThrow({where:{id:key.id}})).isActive,false);
    const legacy=await prisma.shopifyInstallation.create({data:{shopDomain:'legacy-tokens.myshopify.com',userId:user.id,status:'active',encryptedAccessToken:'synthetic-legacy',scopes:scope}});
    const beforeLegacy=calls;await assert.rejects(getShopifyAccessToken(prisma,legacy.id),/SHOPIFY_TOKEN_REAUTH_REQUIRED/);assert.equal(calls,beforeLegacy);
    pass('Provider rejection and legacy records require reauthorization, clear credential material and revoke the storefront key rather than invent expiry/refresh values');
    await prisma.shopifyInstallation.update({where:{id:installation.id},data:{status:'active',...encryptedShopifyTokenData(parseShopifyOfflineTokens(payload(issued))) ,accessTokenExpiresAt:new Date(Date.now()+1000)}});
    mode='hold';const started=new Promise<void>(resolve=>{entered=resolve;});const pending=getShopifyAccessToken(prisma,installation.id);await started;
    await uninstall();release!();await assert.rejects(pending,/SHOPIFY_TOKEN_LEASE_LOST|SHOPIFY_TOKEN_STATE_CHANGED/);
    const uninstalled=await current();assert.equal(uninstalled.status,'uninstalled');assert.equal(uninstalled.encryptedAccessToken,'');assert.equal(uninstalled.encryptedRefreshToken,null);assert.equal(await prisma.shopifyTokenLease.count(),0);
    pass('Actual signed uninstall invalidates a held refresh lease; its late provider response cannot restore credentials');
  } finally {globalThis.fetch=realFetch;}
  return checks;
};
