const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),web=path.join(root,'apps/web'),requireWeb=createRequire(path.join(web,'package.json')),ts=requireWeb('typescript');
function load(file,globals={},mocks={}) {
 const absolute=path.join(root,file),exports={};
 const code=ts.transpileModule(fs.readFileSync(absolute,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{exports,console,AbortSignal,AbortController,Response,Headers,FormData,Error,URL,setTimeout,clearTimeout,...globals,require(name){if(name in mocks)return mocks[name];if(name==='@/app/lib/user-feedback')return load('apps/web/app/lib/user-feedback.ts',globals);return requireWeb(name);}},{filename:absolute});return exports;
}
const tests=[],test=(name,run)=>tests.push({name,run});
test('Reviewed codes give corrective messages; arbitrary server text and prototype names never become copy',()=>{
 const m=load('apps/web/app/lib/user-feedback.ts');
 assert.match(m.getApiErrorMessage({error:'INVALID_OR_EXPIRED_OTP'},'fallback',400),/code.*invalid.*expired/);
 assert.match(m.getApiErrorMessage({error:'STORE_VERIFICATION_FAILED',reason:'STORE_VERIFICATION_TIMEOUT'},'fallback',400),/took too long/);
 for(const payload of [{error:'postgresql://secret:password@private/db'},{message:'<script>private details</script>'},{error:'toString'},null,'raw-server-message'])assert.equal(m.getApiErrorMessage(payload,'safe context',400),'safe context');
});
test('Credential, session, permission, rate and service failures remain distinct',()=>{
 const m=load('apps/web/app/lib/user-feedback.ts');
 assert.match(m.getApiErrorMessage({},'',401,'login'),/email or password/);
 assert.match(m.getApiErrorMessage({},'',401),/session.*expired/);
 assert.match(m.getApiErrorMessage({},'',403),/permission/);
 assert.match(m.getApiErrorMessage({},'',429),/wait/);
 assert.match(m.getApiErrorMessage({},'',503),/temporarily unavailable/);
 assert.match(m.getApiErrorMessage({error:'INVALID_CREDENTIALS'},'',500,'login'),/could not complete/);
});
test('Successful JSON is returned once; no implicit retry follows an HTTP error',async()=>{
 let calls=0;const m=load('apps/web/app/lib/user-feedback.ts',{fetch:async()=>{calls++;return Response.json({ok:true});}});
 assert.equal((await m.requestJson('/fixture')).ok,true);assert.equal(calls,1);
 let fails=0;const n=load('apps/web/app/lib/user-feedback.ts',{fetch:async()=>{fails++;return Response.json({error:'SYNTHETIC_SECRET'},{status:500});}});
 await assert.rejects(n.requestJson('/fixture'),e=>e instanceof n.WebsiteError&&!e.message.includes('SECRET'));assert.equal(fails,1);
});
test('Malformed HTML, null and array success bodies do not masquerade as successful operations',async()=>{
 for(const text of ['<html>private error</html>','null','[]']){
  const m=load('apps/web/app/lib/user-feedback.ts',{fetch:async()=>new Response(text)});
  await assert.rejects(m.requestJson('/fixture'),e=>e instanceof m.WebsiteError&&/unexpected response/.test(e.message));
 }
});
test('Offline errors do not expose transport details or imply a mutation was not saved',async()=>{
 const m=load('apps/web/app/lib/user-feedback.ts',{fetch:async()=>{throw Error('synthetic-password-in-transport');}});
 await assert.rejects(m.requestJson('/fixture',{method:'POST'}),e=>/Check.*latest status/.test(e.message)&&!e.message.includes('password'));
});
test('A stalled fetch and stalled JSON body both hit the complete operation deadline',async()=>{
 for(const body of [false,true]){
  const m=load('apps/web/app/lib/user-feedback.ts',{fetch:async(_url,init)=>{
   const pending=()=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('synthetic abort')),{once:true}));
   return body?{ok:true,status:200,json:pending}:pending();
  }});
  const start=Date.now();await assert.rejects(m.requestJson('/fixture',{}, {timeoutMs:1000}),e=>/took too long/.test(e.message));assert.ok(Date.now()-start<1800);
 }
});
test('Caller cancellation prevents an initial request or reports interruption during it',async()=>{
 let calls=0;const controller=new AbortController();controller.abort();
 const m=load('apps/web/app/lib/user-feedback.ts',{fetch:async()=>{calls++;return Response.json({ok:true});}});
 await assert.rejects(m.requestJson('/fixture',{signal:controller.signal}),/interrupted/);assert.equal(calls,0);
 const active=new AbortController();const n=load('apps/web/app/lib/user-feedback.ts',{fetch:async(_url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('abort'))))});
 const request=n.requestJson('/fixture',{signal:active.signal});active.abort();await assert.rejects(request,/interrupted/);
});
test('Field identification is limited to known validation failures, never service outages',async()=>{
 const m=load('apps/web/app/lib/user-feedback.ts',{fetch:async()=>Response.json({error:'INVALID_OR_EXPIRED_OTP'},{status:400})});
 try{await m.requestJson('/fixture');assert.fail();}catch(e){assert.equal(m.errorField(e),'otp');}
 assert.equal(m.errorField(new m.WebsiteError('service down',503,'INVALID_OR_EXPIRED_OTP')),undefined);
});
test('Blocked clipboard provides manual recovery without an unhandled browser exception',async()=>{
 const m=load('apps/web/app/lib/user-feedback.ts',{navigator:{clipboard:{writeText:async()=>{throw Error('denied');}}}});
 await assert.rejects(m.copyText('synthetic-only'),/copy it manually/);
});
test('Optional theme storage failure does not crash the account interface',()=>{
 const document={documentElement:{dataset:{theme:'light'}}},window={localStorage:{setItem(){throw Error('blocked');},getItem(){throw Error('blocked');}},addEventListener(){},removeEventListener(){}};
 const m=load('apps/web/app/lib/theme-client.ts',{document,window},{react:{useEffect(fn){fn();},useState(v){return[v,()=>{}];}}});m.applyThemePreference('dark');assert.equal(document.documentElement.dataset.theme,'dark');m.useThemePreference();
});
test('Success and error feedback expose different live roles and safe text; page errors hide raw details',()=>{
 const React=requireWeb('react'),{renderToStaticMarkup}=requireWeb('react-dom/server');
 const m=load('apps/web/app/components/FeedbackMessage.tsx');
 assert.match(renderToStaticMarkup(React.createElement(m.default,{feedback:{message:'Saved',tone:'success'}})),/role="status"/);
 assert.match(renderToStaticMarkup(React.createElement(m.default,{feedback:{message:'Try again',tone:'error'}})),/role="alert"/);
 const page=load('apps/web/app/error.tsx',{},{});const raw=renderToStaticMarkup(React.createElement(page.default,{error:Object.assign(Error('SYNTHETIC_PRIVATE_STACK'),{digest:'safe-reference'}),reset(){}}));assert.ok(!raw.includes('SYNTHETIC_PRIVATE_STACK'));assert.ok(raw.includes('safe-reference'));
});
(async()=>{let failures=0;for(const t of tests){try{await t.run();console.log('PASS '+t.name);}catch(e){failures++;console.error('FAIL '+t.name+': '+e.message);}}console.log(`${tests.length-failures}/${tests.length} website feedback groups passed`);process.exitCode=failures?1:0;})();
