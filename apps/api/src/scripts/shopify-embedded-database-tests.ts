import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { requireDisposableDatabase } from '../lib/disposable-database';
import { decryptShopifySecret } from '../lib/shopify-crypto';

type RequestFixture = (path: string, body?: unknown, headers?: Record<string,string>, method?: string) => Promise<{status:number;headers:any;body:any}>;
export const verifyShopifyEmbedded = async (prisma: PrismaClient, request: RequestFixture, accountId: number, dashboard: Record<string,string>, otherDashboard: Record<string,string>, uninstall: () => Promise<void>) => {
  requireDisposableDatabase(process.env);
  const checks:string[]=[], pass=(s:string)=>{checks.push(s);console.log('PASS '+s);}, shop='embedded-owner.myshopify.com';
  const now=Math.floor(Date.now()/1000),claims={iss:`https://${shop}/admin`,dest:`https://${shop}`,aud:process.env.SHOPIFY_API_KEY!,sub:'42',iat:now,nbf:now-1,exp:now+60};
  const sign=(patch:any={},secret=process.env.SHOPIFY_API_SECRET!,algorithm:any='HS256')=>jwt.sign(Object.fromEntries(Object.entries({...claims,...patch}).filter(([,v])=>v!==undefined)),secret,{algorithm});
  const header=(token=sign())=>({authorization:`Bearer ${token}`});
  const originalFetch=globalThis.fetch;let providerCalls=0, offlineCalls=0, owner=true, subject='42';
  let holdOffline=false, entered:(()=>void)|undefined, release:(()=>void)|undefined;
  globalThis.fetch=(async(input:any,options:any)=>{
    const url=new URL(String(input));assert.equal(url.hostname,shop);assert.equal(options.redirect,'error');providerCalls++;
    if(url.pathname==='/admin/oauth/access_token') {
      const form=new URLSearchParams(String(options.body));assert.equal(form.get('grant_type'),'urn:ietf:params:oauth:grant-type:token-exchange');
      assert.equal(form.get('subject_token_type'),'urn:ietf:params:oauth:token-type:id_token');assert.equal(form.get('client_id'),process.env.SHOPIFY_API_KEY);assert.equal(form.get('client_secret'),process.env.SHOPIFY_API_SECRET);
      if(form.get('requested_token_type')?.endsWith('online-access-token'))return new Response(JSON.stringify({access_token:'synthetic-online-never-persisted',expires_in:300,associated_user:{id:subject,account_owner:owner,email:'not-collected@example.invalid'}}));
      assert.equal(form.get('requested_token_type'),'urn:shopify:params:oauth:token-type:offline-access-token');assert.equal(form.get('expiring'),'1');offlineCalls++;
      if (holdOffline) {entered!();await new Promise<void>(resolve=>{release=resolve;});} else await new Promise(resolve=>setTimeout(resolve,40));
      return new Response(JSON.stringify({access_token:'synthetic-embedded-access',refresh_token:'synthetic-embedded-refresh',expires_in:3600,refresh_token_expires_in:7776000,scope:'read_products,write_app_proxy'}));
    }
    const body=JSON.parse(String(options.body));
    if(body.query.includes('DrapixAIShop'))return new Response(JSON.stringify({data:{shop:{name:'Synthetic embedded shop',primaryDomain:{host:'embedded.example.invalid'}}}}));
    return new Response(JSON.stringify({data:{products:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}}));
  }) as typeof fetch;
  try {
    for(const token of [sign({aud:'foreign'}),sign({exp:now-1}),sign({nbf:now+60}),sign({dest:'https://attacker.example.invalid'}),sign({iss:'https://different.myshopify.com/admin'}),sign({iss:`https://user:pass@${shop}/admin`}),sign({exp:undefined}),sign({sub:''}),sign({},'wrong-secret'),sign({},process.env.SHOPIFY_API_SECRET,'HS384'),'invalid.token.signature']) {
      assert.equal((await request('/shopify/embedded/status?shop=other.myshopify.com',undefined,header(token))).status,401);
    }
    assert.equal((await request('/shopify/embedded/connect',{},header('invalid'))).status,401);assert.equal(providerCalls,0);
    pass('Actual embedded routes reject wrong signature/algorithm/audience/time/issuer/destination/subject before provider or tenant access');
    const unsigned=await request('/shopify/app?shop='+shop);assert.equal(unsigned.status,401);assert.match(unsigned.headers['content-security-policy'],/frame-ancestors 'none'/);
    const params=new URLSearchParams({shop,timestamp:String(now)}),message=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('&');params.set('hmac',crypto.createHmac('sha256',process.env.SHOPIFY_API_SECRET!).update(message).digest('hex'));
    const page=await request('/shopify/app?'+params);assert.equal(page.status,200);assert.equal(page.headers['x-frame-options'],undefined);assert.match(page.headers['content-security-policy'],new RegExp(`frame-ancestors https://${shop.replace(/\./g,'\\.')} https://admin.shopify.com`));assert.match(page.body,/shopify-api-key/);assert.match(page.body,/shopify\.idToken\(\)/);assert.equal(page.headers['cache-control'],'no-store');assert.equal(page.headers['referrer-policy'],'no-referrer');assert.ok(!page.body.includes('synthetic-embedded-refresh'));
    pass('Signed launch serves only bootstrap HTML with shop-specific iframe CSP, nonce scripts, no cookies, no-store and no merchant credentials');
    await prisma.shopifyInstallation.create({data:{shopDomain:'foreign-embedded.myshopify.com',userId:accountId,status:'active',encryptedAccessToken:'not-used',scopes:'read_products,write_app_proxy'}});
    const status=await request('/shopify/embedded/status?shop=foreign-embedded.myshopify.com',undefined,header());assert.deepEqual(status.body,{connected:false});
    owner=false;assert.equal((await request('/shopify/embedded/connect',{},header())).status,403);owner=true;subject='99';assert.equal((await request('/shopify/embedded/connect',{},header())).status,403);subject='42';assert.equal(offlineCalls,0);assert.equal(await prisma.shopifyInstallation.count({where:{shopDomain:shop}}),0);
    pass('Query-selected foreign tenant is ignored; staff/nonmatching online identities cannot mint a handoff or acquire offline credentials');
    holdOffline=true;const started=new Promise<void>(resolve=>{entered=resolve;});const initial=request('/shopify/embedded/connect',{},header());await started;
    await uninstall();release!();assert.equal((await initial).status,503);holdOffline=false;
    assert.equal(await prisma.shopifyInstallation.count({where:{shopDomain:shop}}),0);
    pass('Signed uninstall cancels the first embedded acquisition even before its installation row exists; late tokens cannot create a pending connection');
    const connections=await Promise.all(Array.from({length:4},()=>request('/shopify/embedded/connect',{shop:'foreign-embedded.myshopify.com'},header())));
    const winners=connections.filter(r=>r.status===200);assert.equal(winners.length,1);for(const r of connections)assert.ok([200,409].includes(r.status));assert.equal(offlineCalls,2);
    const handoff=new URL(winners[0].body.continueUrl);assert.equal(handoff.origin,'https://fixture.example.invalid');
    const installationId=Number(handoff.searchParams.get('installation')),token=handoff.searchParams.get('token');
    const row=await prisma.shopifyInstallation.findUniqueOrThrow({where:{id:installationId}});assert.equal(row.shopDomain,shop);assert.equal(row.userId,null);assert.equal(row.status,'pending_link');assert.equal(decryptShopifySecret(row.encryptedRefreshToken!),'synthetic-embedded-refresh');assert.ok(!JSON.stringify(row).includes('not-collected@example.invalid'));
    pass('Four concurrent embedded connections serialize acquisition, encrypt both offline tokens and retain no online token or staff email');
    assert.equal((await request('/shopify/link-preview',{installationId,token},dashboard)).status,200);assert.equal((await prisma.shopifyInstallation.findUniqueOrThrow({where:{id:installationId}})).userId,null);
    assert.equal((await request('/shopify/link-preview',{installationId,token:'wrong'},dashboard)).status,403);
    assert.equal((await request('/shopify/link',{installationId,token},dashboard)).status,200);
    assert.equal((await prisma.shopifyInstallation.findUniqueOrThrow({where:{id:installationId}})).userId,accountId);
    assert.equal((await request('/shopify/link-preview',{installationId,token},otherDashboard)).status,400);
    assert.deepEqual((await request('/shopify/embedded/status',undefined,header())).body,{connected:true});
    pass('Workspace preview does not consume or link; explicit authenticated confirmation links exactly once and replay cannot change ownership');
    const limited=await request('/shopify/embedded/connect',{},header());assert.equal(limited.status,200);
    // Includes the canceled acquisition. The per-shop cap blocks the eleventh.
    for(let i=0;i<2;i++)await request('/shopify/embedded/connect',{},header());
    const before=providerCalls;assert.equal((await request('/shopify/embedded/connect',{},header())).status,429);assert.equal(providerCalls,before);
    pass('Per-shop embedded connection cap refuses excess acquisitions before contacting Shopify');
  } finally {globalThis.fetch=originalFetch;}
  return checks;
};
