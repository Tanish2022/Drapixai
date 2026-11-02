import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderShopifyAppHome, shopifyAppScript } from '../lib/shopify-app-home';

// Execute the exact shipped bootstrap, with only App Bridge and DOM/network
// boundaries adapted. Real iframe/cookie/privacy/browser behavior needs staging.
export const verifyEmbeddedBrowser = async () => {
  const checks:string[]=[], pass=(s:string)=>{checks.push(s);console.log('PASS '+s);};
  const elements:any=Object.fromEntries(['status','connect','continue'].map(id=>[id,{hidden:id!=='status',textContent:'',disabled:false,focused:false,handler:undefined as any,addEventListener(_type:string,handler:any){this.handler=handler;},focus(){this.focused=true;}}]));
  let tokens=0, rejectOwner=false;const requests:Array<{path:string;options:any}>=[];
  const context={document:{getElementById:(id:string)=>elements[id]},shopify:{idToken:async()=>`synthetic-id-${++tokens}`},URL,
    fetch:async(path:string,options:any)=>{requests.push({path,options});return {ok:!rejectOwner,json:async()=>rejectOwner?{error:'SHOPIFY_ACCOUNT_OWNER_REQUIRED'}:path.endsWith('/status')?{connected:false}:{continueUrl:'https://workspace.example.invalid/shopify/connect?installation=1&token=synthetic-one-use'}};}};
  vm.runInNewContext(shopifyAppScript,context,{timeout:1000});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,1);assert.ok(requests[0].path.endsWith('/status'));assert.equal(elements.connect.hidden,false);assert.equal(elements.continue.hidden,true);
  await elements.connect.handler();assert.equal(tokens,2);assert.equal(requests[1].options.headers.Authorization,'Bearer synthetic-id-2');assert.equal(requests[1].options.credentials,'omit');assert.equal(requests[1].options.redirect,'error');assert.equal(elements.continue.hidden,false);assert.equal(elements.continue.focused,true);assert.match(elements.continue.href,/^https:\/\/workspace\.example\.invalid\//);
  rejectOwner=true;await elements.connect.handler();assert.equal(tokens,3);assert.equal(elements.continue.hidden,true);assert.equal(elements.connect.disabled,false);assert.match(elements.status.textContent,/store owner/);
  pass('Shipped App Bridge bootstrap requests fresh ID tokens, omits cookies, requires a click before handoff, focuses its link and exposes owner errors without credentials');
  const rendered=renderShopifyAppHome('public-id"/><script>alert(1)</script>','synthetic-nonce');
  assert.ok(!rendered.includes('content="public-id"/>'));assert.match(rendered,/&lt;script&gt;/);assert.match(rendered,/role="status" aria-live="polite"/);assert.match(rendered,/<button[^>]+type="button"/);assert.match(rendered,/rel="noopener noreferrer"/);
  // WCAG contrast of shipped action text and body text; no visual quality claim.
  const luminance=(hex:string)=>{const c=hex.match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return c[0]*0.2126+c[1]*0.7152+c[2]*0.0722;};
  for(const [foreground,background] of [['ffffff','183f32'],['172019','f4f6f2']])assert.ok((Math.max(luminance(foreground),luminance(background))+0.05)/(Math.min(luminance(foreground),luminance(background))+0.05)>=4.5);
  pass('App-home rendering escapes public metadata, supplies native keyboard controls/status announcements and passes tested body/action text contrast');
  return checks;
};
