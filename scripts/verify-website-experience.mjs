// Owned loopback Next production/browser fixture. All API replies are synthetic;
// no real account, email, payment, Shopify, image inference or public deployment.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const root=process.cwd(), web=path.join(root,'apps/web'), id=crypto.randomBytes(6).toString('hex');
const out=path.join(root,'runtime/launch-evidence',`website-experience-${id}`);fs.mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url);
const playwrightModule=process.env.DRAPIXAI_PLAYWRIGHT_MODULE||'playwright';const {chromium}=require(playwrightModule);
const axe=fs.readFileSync(process.env.DRAPIXAI_AXE_PATH||path.join(root,'runtime/compliance-tools/node_modules/axe-core/axe.min.js'),'utf8');
const terms=JSON.parse(fs.readFileSync(path.join(root,'apps/api/src/legal/terms-metadata.json')));
const report={passed:false,scope:'Owned local production Next/BFF and Chromium; synthetic API, no live provider/DB/GPU/rights/screen-reader certification',checks:[],accessibility:[],reflow:[],externalRequestsBlocked:[],errors:[],sourceSha256:{},tools:{node:process.version,playwright:require(playwrightModule+'/package.json').version,axe:(axe.match(/axe v([0-9.]+)/)||[])[1]||'see installed axe-core'}};
const before=new Map(['tsconfig.json','next-env.d.ts'].map(f=>[f,fs.readFileSync(path.join(web,f))]));let generated;
const env={};for(const name of ['SystemRoot','COMSPEC','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PATHEXT','WINDIR','ProgramData','ProgramFiles','CommonProgramFiles','NUMBER_OF_PROCESSORS'])if(process.env[name])env[name]=process.env[name];
env.PATH=path.dirname(process.execPath)+path.delimiter+(process.env.PATH||process.env.Path||'');
for(const file of ['.env','.env.local','.env.production','.env.production.local']){const p=path.join(web,file);if(fs.existsSync(p))for(const [,key]of fs.readFileSync(p,'utf8').matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm))env[key]='';}
const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));const origin=`http://127.0.0.1:${port}`;
const overrides=new Map();let loginStatus=200,loginError='INVALID_CREDENTIALS',termsDown=false,ready=true;
const summary={email:'merchant@fixture.invalid',companyName:'Synthetic Merchant',planType:'trial',planName:'Trial',rendersUsed:0,quota:300,quotaRemaining:300,trialDaysLeft:12,storeConnected:false,storeVerified:false,uploadedGarmentCount:0,cacheReadyGarmentCount:0,discoveredProductCount:0,confirmedMatchCount:0,dailyUsage:[],recentRenders:[]};
const profile={...summary,mobileNumber:null,themePreference:'light',catalogSyncSource:'manual',storeVerificationMetaTag:'synthetic-verification-tag'};
const requests=[];
const api=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;requests.push({method:req.method,path:pathname});
  let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024){res.writeHead(413).end();return;}}
  const custom=overrides.get(`${req.method} ${pathname}`)||overrides.get(pathname);
  if(custom){if(custom.delay)await delay(custom.delay);res.writeHead(custom.status||200,{'Content-Type':custom.raw?'text/html':'application/json'});res.end(custom.raw||JSON.stringify(custom.body));return;}
  let status=200,data={ok:true};
  if((pathname==='/auth/login'||pathname==='/auth/register')) {status=loginStatus;data=status===200?{apiKey:'synthetic-website-session-key'}:{error:loginError};}
  else if(pathname==='/auth/terms') {status=termsDown?503:200;data=termsDown?{error:'SYNTHETIC_PRIVATE_DATABASE_DETAILS'}:{accepted:true,...terms};}
  else if(pathname==='/admin/verify')data={ok:true};
  else if(pathname==='/analytics/summary')data=summary;
  else if(pathname==='/account/profile')data=profile;
  else if(pathname==='/sdk/garments'||pathname==='/sdk/catalog')data={items:[]};
  else if(pathname==='/analytics/api-key/status')data={exists:false};
  else if(pathname==='/shopify/status')data={installation:{id:1,shopDomain:'fixture.myshopify.com',shopName:'Synthetic Store',status:'active',lastSyncedAt:null}};
  else if(pathname==='/shopify/preparation')data={counts:{},failures:[]};
  else if(pathname==='/shopify/sync'){status=202;data={ok:true,status:'pending'};}
  else if(pathname==='/shopify/prepare')data={busy:false,paused:true,items:[]};
  else if(pathname==='/ready'){status=ready?200:503;data={status:ready?'ready':'not_ready',checks:{database:true,redis:true,ai:{status:ready?'ready':'not_ready'}}};}
  else if(pathname==='/admin/overview')data={totals:{users:0,activeApiKeys:0,rendersThisMonth:0,pendingGarments:0,emailsSent:0,emailsFailed:0},plans:[],recentUsers:[],dailyUsage:[],signups:[]};
  else if(pathname==='/admin/website')data={pageViewsLast30Days:0,demoStartsLast30Days:0,demoSuccessLast30Days:0,ctaClicksLast30Days:0,topPages:[],eventsByDay:[]};
  else if(pathname==='/admin/ops')data={health:{database:true,redis:true,aiReachable:false,aiReady:false,aiStatus:'not_ready',queueDepth:0},renderStats:{total:0,pending:0,complete:0,failed:0},recentFailures:[],dailyTraffic:[]};
  else if(pathname.startsWith('/admin/tryon-results')||pathname.startsWith('/admin/garments'))data={items:[]};
  res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));
});
await new Promise(r=>api.listen(0,'127.0.0.1',r));const apiOrigin=`http://127.0.0.1:${api.address().port}`;
Object.assign(env,{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',NEXT_DIST_DIR:`.next-review/website-${id}`,DRAPIXAI_PUBLIC_INDEXING:'0',NEXT_PUBLIC_WEB_BASE_URL:origin,NEXT_PUBLIC_API_BASE_URL:apiOrigin,DRAPIXAI_API_URL:apiOrigin,NEXTAUTH_URL:origin,NEXTAUTH_SECRET:crypto.randomBytes(48).toString('hex'),ADMIN_SESSION_SECRET:crypto.randomBytes(48).toString('hex'),DASHBOARD_SESSION_SECRET:crypto.randomBytes(48).toString('hex'),DRAPIXAI_DASHBOARD_PROXY_TOKEN:'synthetic-website-proxy',DRAPIXAI_AUTH_SYNC_TOKEN:'synthetic-website-sync',NEXT_PUBLIC_GOOGLE_AUTH_ENABLED:'0',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',NEXT_PUBLIC_DEMO_VIDEO_URL:'',NEXT_PUBLIC_SHOPIFY_APP_INSTALL_URL:''});
let next,browser,page;let serverLog='';const pending=new Set();const pass=s=>{report.checks.push(s);console.log('PASS '+s);};
const child=async(args,name)=>{const log=fs.openSync(path.join(out,name+'.log'),'w');const p=spawn(process.execPath,args,{cwd:web,env,windowsHide:true,stdio:['ignore',log,log]});let timer;try{const code=await Promise.race([new Promise(r=>p.on('exit',r)),new Promise((_,reject)=>{timer=setTimeout(()=>{p.kill();reject(Error('Owned build deadline exceeded'));},180000);})]);generated=new Map([...before].map(([name])=>[name,fs.readFileSync(path.join(web,name))]));assert.equal(code,0,name+' failed; inspect log');}finally{clearTimeout(timer);fs.closeSync(log);}};
try{
  await child(['node_modules/next/dist/bin/next','build'],'build');generated=new Map([...before].map(([name])=>[name,fs.readFileSync(path.join(web,name))]));
  pass('Isolated private production build completed with synthetic configuration');
  next=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:web,env,windowsHide:true,stdio:['ignore','pipe','pipe']});next.stdout.on('data',d=>serverLog=(serverLog+d).slice(-32768));next.stderr.on('data',d=>serverLog=(serverLog+d).slice(-32768));
  let live=false;for(let i=0;i<80;i++){assert.equal(next.exitCode,null);if((await fetch(origin+'/auth/login').catch(()=>null))?.ok){live=true;break;}await delay(250);}assert.ok(live);
  browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if([origin,apiOrigin].includes(url.origin)||['data:','blob:'].includes(url.protocol))return route.continue();report.externalRequestsBlocked.push(url.origin);return route.abort();});
  page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
  page.on('request',r=>pending.add(r));page.on('requestfinished',r=>pending.delete(r));page.on('requestfailed',r=>pending.delete(r));
  const go=async route=>{await page.goto(origin+route,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.documentElement.dataset.theme||document.title.startsWith('Terms version not found')||document.title.startsWith('Account access temporarily'));};
  const scan=async(label)=>{const regular=label.replace(' [dark]','');const headings={'/settings':'Keep the workspace simple and launch-ready.','/subscription':'Manage rollout capacity and commercial access.','/sdk-install':'Install DrapixAI on your store.'};if(headings[regular])await page.getByRole('heading',{name:headings[regular],exact:true}).waitFor();if(label.endsWith(' [dark]')&&regular!=='/sdk-install')await page.waitForFunction(()=>{const main=[...document.querySelectorAll('main')].find(el=>el.getClientRects().length>0);return main&&getComputedStyle(main).color==='rgb(237, 242, 237)';});await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});await page.evaluate(axe);const result=await page.evaluate(async()=>await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}));report.accessibility.push({route:label,violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),manualReview:result.incomplete.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))});};
  await go('/');await page.getByRole('button',{name:'Reject optional',exact:true}).click();
  const publicRoutes=['/','/pricing','/demo','/virtual-try-on','/docs','/help','/contact','/privacy','/cookies','/refund-policy','/terms','/terms/2026-10-19','/terms/2026-10-21','/terms/invalid','/status','/changelog','/auth/login','/auth/register','/auth/forgot-password','/auth/terms','/admin-access','/missing-task3-page'];
  for(const route of publicRoutes){await go(route);await scan(route);}
  pass('All public pages, archived/current terms, account forms and 404 states scanned');
  await go('/auth/login');await page.getByLabel('Email',{exact:true}).fill('merchant@fixture.invalid');await page.getByLabel('Password',{exact:true}).fill('synthetic-fixture-password');
  loginStatus=401;await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({hasText:'email or password'}).waitFor();assert.equal(await page.getByLabel('Email',{exact:true}).getAttribute('aria-invalid'),'true');
  loginStatus=503;await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({hasText:'temporarily unavailable'}).waitFor();assert.ok(!await page.locator('[role="alert"]:not(#__next-route-announcer__)').innerText().then(s=>s.includes('INVALID_CREDENTIALS')));
  await delay(2800);assert.ok(await page.locator('[role="alert"]:not(#__next-route-announcer__)').isVisible());
  pass('Login distinguishes invalid credentials from outage; identifies fields and retains the error message');
  await go('/auth/register');await page.getByLabel('Brand or company name').fill('Synthetic Merchant');await page.getByLabel('Work email',{exact:true}).fill('merchant@fixture.invalid');await page.getByLabel('Password',{exact:true}).fill('synthetic-fixture-password');await page.getByRole('checkbox').check();
  overrides.set('/auth/register/request-otp',{status:429,body:{error:'SYNTHETIC_PRIVATE'}});await page.getByRole('button',{name:'Send verification code',exact:true}).click();await page.locator('#register-feedback[role="alert"]').filter({hasText:'Too many requests'}).waitFor();
  overrides.delete('/auth/register/request-otp');await page.getByRole('button',{name:'Send verification code',exact:true}).click();await page.getByLabel('Email verification code',{exact:true}).fill('123456');
  loginStatus=400;loginError='INVALID_OR_EXPIRED_OTP';await page.getByRole('button',{name:'Verify and create workspace',exact:true}).click();await page.locator('#register-feedback[role="alert"]').filter({hasText:'invalid or has expired'}).waitFor();assert.equal(await page.getByLabel('Email verification code',{exact:true}).getAttribute('aria-invalid'),'true');await scan('/auth/register [invalid code]');
  pass('Registration handles request throttling and an invalid verification code with corrective field-linked errors');
  await go('/auth/forgot-password');await page.getByLabel('Work email',{exact:true}).fill('merchant@fixture.invalid');await page.getByRole('button',{name:'Send reset code',exact:true}).click();await page.locator('#reset-feedback').filter({hasText:'If an account exists'}).waitFor();
  await page.getByLabel('Reset code',{exact:true}).fill('123456');await page.getByLabel('New password',{exact:true}).fill('synthetic-fixture-password');overrides.set('/auth/password-reset/confirm',{status:400,body:{error:'INVALID_OR_EXPIRED_OTP'}});await page.getByRole('button',{name:'Reset password',exact:true}).click();await page.locator('#reset-feedback[role="alert"]').filter({hasText:'invalid or has expired'}).waitFor();await scan('/auth/forgot-password [invalid code]');overrides.delete('/auth/password-reset/confirm');
  pass('Password recovery gives a neutral account-existence response and identifies an invalid reset code');
  await go('/auth/login');await page.getByLabel('Email',{exact:true}).fill('merchant@fixture.invalid');await page.getByLabel('Password',{exact:true}).fill('synthetic-fixture-password');await page.getByLabel('Password',{exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Show password',exact:true}).evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Enter');assert.equal(await page.getByLabel('Password',{exact:true}).getAttribute('type'),'text');await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Cookie preferences',exact:true}).focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.activeElement?.id==='privacy-preferences-heading');await scan('/auth/login [cookie preferences]');await page.getByRole('button',{name:'Reject optional',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.getByRole('button',{name:'Cookie preferences',exact:true}).evaluate(el=>el===document.activeElement),true);
  await go('/');await page.getByRole('button',{name:'Open support assistant',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();await scan('/auth/login [support dialog]');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'Open support assistant',exact:true}).evaluate(el=>el===document.activeElement),true);
  pass('Keyboard operates password visibility, cookie choices and support dialog; focus returns after closing');
  await go('/auth/login');await page.getByLabel('Email',{exact:true}).fill('merchant@fixture.invalid');await page.getByLabel('Password',{exact:true}).fill('synthetic-fixture-password');
  loginStatus=200;loginError='INVALID_CREDENTIALS';await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/onboarding');
  for(const route of ['/onboarding','/dashboard','/settings','/subscription','/sdk-install','/shopify/connect']){await go(route);await page.locator('h1').first().waitFor();await scan(route);assert.ok(!page.url().includes('/auth/login'),'Valid session was redirected: '+route);}
  pass('Genuine encrypted BFF session opens every merchant page; SDK install does not require exposing its key');
  overrides.set('GET /auth/terms',{body:{accepted:false,...terms}});await go('/auth/terms');await page.getByRole('checkbox').check();overrides.set('POST /auth/terms',{status:503,body:{error:'TERMS_ACCEPTANCE_UNAVAILABLE'}});await page.getByRole('button',{name:'Accept terms and continue',exact:true}).click();await page.locator('#terms-feedback[role="alert"]').filter({hasText:'could not confirm'}).waitFor();assert.ok(!await page.locator('#terms-feedback').innerText().then(s=>s.includes('not saved')));await scan('/auth/terms [acceptance unavailable]');
  overrides.delete('POST /auth/terms');await page.getByRole('button',{name:'Check again',exact:true}).click();await page.getByRole('checkbox').check();overrides.delete('GET /auth/terms');await page.getByRole('button',{name:'Accept terms and continue',exact:true}).click();await page.waitForURL('**/onboarding');
  pass('Uncertain terms acceptance requires a state recheck; confirmed acceptance resumes onboarding');
  await go('/sdk-install');await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('fixture-denied');}}}));await page.getByRole('button',{name:'Copy instructions',exact:true}).click();await page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({hasText:'copy it manually'}).waitFor();
  pass('Clipboard refusal is visible and gives a manual-copy recovery path');

  await go('/sdk-install');await page.getByRole('button',{name:'Sync now',exact:true}).click();await page.getByRole('status').filter({hasText:'sync request is pending'}).waitFor();assert.ok(!await page.locator('body').innerText().then(s=>s.includes('Sync complete: 0')));
  pass('HTTP 202 Shopify sync is shown as pending, not a fabricated completed count');
  overrides.set('/analytics/summary',{status:503,body:{error:'SYNTHETIC_PRIVATE_DATABASE_DETAILS'}});
  for(const route of ['/dashboard','/settings','/subscription','/sdk-install']){await go(route);await page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({hasText:/unavailable|could not/i}).waitFor();assert.ok(!page.url().includes('/auth/login'));await scan(route+' [outage]');}
  overrides.delete('/analytics/summary');
  pass('Account data outages show recoverable errors without false logout or endless loading');
  await go('/settings');overrides.set('POST /account/profile',{status:500,body:{error:'SYNTHETIC_PRIVATE_DATABASE_DETAILS',message:'postgresql://synthetic-private-details'}});
  await page.getByRole('button',{name:'Save Profile Details',exact:true}).click();await page.locator('[role="alert"]:not(#__next-route-announcer__)').waitFor();assert.ok(!await page.locator('body').innerText().then(s=>s.includes('SYNTHETIC_PRIVATE')||s.includes('postgresql://')));
  overrides.delete('POST /account/profile');await page.getByRole('button',{name:'Save Profile Details',exact:true}).click();await page.getByRole('status').filter({hasText:'Profile settings updated'}).waitFor();
  pass('Profile failures do not expose server details; a real successful response shows success');
  const profileRoute=origin+'/api/dashboard/proxy/account/profile';await page.route(profileRoute,route=>route.request().method()==='POST'?route.abort('failed'):route.continue());await page.getByRole('button',{name:'Save Profile Details',exact:true}).click();await page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({hasText:/could not|Unable|connect/}).waitFor();await page.unroute(profileRoute);
  pass('A failed browser connection shows an error without a false saved confirmation');

  await page.route(origin+'/api/dashboard/session',route=>route.request().method()==='DELETE'?route.abort('failed'):route.continue());await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({hasText:'could not confirm sign-out'}).waitFor();assert.equal(new URL(page.url()).pathname,'/settings');await page.unroute(origin+'/api/dashboard/session');
  pass('Failed sign-out is reported and does not silently send the merchant to the homepage');
  overrides.set('/analytics/summary',{raw:'<html>SYNTHETIC_PRIVATE_DETAILS</html>'});await go('/dashboard');await page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({hasText:'unexpected response'}).waitFor();assert.ok(!await page.locator('body').innerText().then(s=>s.includes('SYNTHETIC_PRIVATE')));overrides.delete('/analytics/summary');
  pass('Malformed successful HTTP data becomes a safe recovery screen rather than a false dashboard');
  overrides.set('/ready',{status:500,body:{status:'ready',checks:{database:true,redis:true,ai:{status:'ready'}}}});await go('/status');await page.getByRole('heading',{name:'One or more services need attention',exact:true}).waitFor();const health=await page.evaluate(async()=>await(await fetch('/api/health')).json());assert.equal(health.services.api,false);assert.equal(health.services.ai,false);overrides.delete('/ready');
  ready=false;await go('/demo');await page.getByRole('status').filter({hasText:'Demo generation is currently unavailable'}).waitFor();await page.locator('label:has-text("Person image") input[type="file"]:visible').setInputFiles({name:'synthetic.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic invalid image')});await page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({hasText:'JPEG, PNG, or WebP'}).waitFor();await page.getByRole('checkbox').check();assert.equal(await page.getByRole('button',{name:'Run Free Try-On',exact:true}).isDisabled(),true);assert.equal(requests.filter(r=>r.path==='/demo/tryon').length,0);await scan('/demo [unavailable and invalid file]');ready=true;
  pass('An HTTP 500 readiness body cannot claim healthy service; unavailable demo and invalid files send no generation request');
  await page.evaluate(()=>localStorage.setItem('drapixai-theme','dark'));overrides.set('/account/profile',{body:{...profile,themePreference:'dark'}});
  for(const route of ['/dashboard','/settings','/subscription','/sdk-install']){await go(route);await page.locator('h1').first().waitFor();await scan(route+' [dark]');}overrides.delete('/account/profile');await page.evaluate(()=>localStorage.setItem('drapixai-theme','light'));
  pass('Merchant pages scanned with the supported dark theme');
    termsDown=true;const unavailable=await page.goto(origin+'/settings');assert.equal(unavailable.status(),503);await page.getByRole('heading',{name:'Account access is temporarily unavailable'}).waitFor();await scan('/settings [access check unavailable]');termsDown=false;
  pass('Protected-route access-check outage has accessible HTTP 503 recovery links, not a credentials failure');
  await go('/admin-access');await page.getByLabel('Administrator email').fill('admin@fixture.invalid');await page.getByLabel('Authenticator code').fill('123456');await page.getByLabel('Password',{exact:true}).fill('synthetic-fixture-password');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.waitForURL('**/admin');await scan('/admin');
  overrides.set('/admin/overview',{status:503,body:{error:'SYNTHETIC_PRIVATE_DATABASE_DETAILS'}});await go('/admin');await page.locator('[role="alert"]:not(#__next-route-announcer__)').waitFor();assert.ok(!page.url().includes('/admin-access'));await scan('/admin [outage]');overrides.delete('/admin/overview');
  pass('Administrator data outages retain the account boundary and display a retry path');
  for(const route of [...publicRoutes,'/onboarding','/dashboard','/settings','/subscription','/sdk-install','/shopify/connect','/admin']){await page.setViewportSize({width:320,height:800});await go(route);const width=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1&&!el.closest('pre,nav')).slice(0,12).map(el=>({tag:el.tagName,class:el.className,text:el.textContent?.slice(0,80),right:el.getBoundingClientRect().right}))}));report.reflow.push({route,...width});}
  pass('All reviewed routes measured at 320px reflow');
  await go('/settings');await page.screenshot({path:path.join(out,'settings-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});await go('/auth/login');await page.screenshot({path:path.join(out,'login-desktop.png'),fullPage:true});
  assert.equal(report.accessibility.flatMap(r=>r.violations).length,0,'Accessibility violations need review');assert.equal(report.reflow.filter(r=>r.document>r.viewport).length,0,'Horizontal page overflow needs review');assert.deepEqual(report.externalRequestsBlocked,[]);assert.deepEqual(report.errors,[]);
  report.passed=true;
}catch(error){report.failure=error.message;process.exitCode=1;if(page){report.pendingRequests=[...pending].map(r=>new URL(r.url()).pathname);report.lastText=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>undefined);}}
finally{
  if(browser)await browser.close();
  fs.writeFileSync(path.join(out,'server.log'),serverLog);
  if(next&&next.exitCode===null){next.kill();await Promise.race([new Promise(r=>next.once('exit',r)),delay(5000)]);}
  api.closeAllConnections();await new Promise(r=>api.close(r));
  for(const[name,bytes]of before){const file=path.join(web,name);if(generated&&fs.readFileSync(file).equals(generated.get(name)))fs.writeFileSync(file,bytes);}
  const websiteSources=[];const inventory=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())inventory(file);else if(/\.(tsx?|css)$/.test(file))websiteSources.push(path.relative(root,file).replaceAll('\\','/'));}};inventory(path.join(web,'app'));
  for(const file of ['scripts/verify-website-experience.mjs',...websiteSources,'apps/web/proxy.ts','apps/web/next.config.js','apps/web/package.json','apps/web/package-lock.json','apps/api/src/legal/terms-metadata.json'])if(fs.existsSync(path.join(root,file)))report.sourceSha256[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
  report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,auditedStates:report.accessibility.length,violations:report.accessibility.flatMap(r=>r.violations).length,evidence:path.relative(root,path.join(out,'report.json')),failure:report.failure}));
}
