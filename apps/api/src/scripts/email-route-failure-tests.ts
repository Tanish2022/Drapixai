import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual route handlers with synthetic dependency adapters. This
// covers response behavior, not Express middleware, PostgreSQL or SMTP delivery.
export const verifyEmailFailureRoutes = async () => {
  const user = {id:42,email:'current@example.invalid',role:'brand_admin'};
  const routes = new Map<string, (...args: any[]) => Promise<unknown>>();
  let existing = false;
  let deliveries: Array<{sent:boolean;skipped:boolean;error?:string;logError?:string}> = [];
  const env: NodeJS.ProcessEnv = {NODE_ENV:'production',SMTP_HOST:'smtp.example.invalid'};
  const router = {
    use: () => router,
    get: () => router,
    post: (route: string, ...handlers: any[]) => { routes.set(route, handlers[handlers.length-1]); return router; },
  };
  const loadRoute = (name: string) => {
    const source = fs.readFileSync(path.resolve(__dirname, `../routes/${name}.ts`), 'utf8');
    const module = {exports:{}};
    const verification = {normalizeEmail:(value:string)=>value.trim().toLowerCase(),issueVerificationCode:async()=>({code:'synthetic-code'})};
    const adapters: Record<string, unknown> = {
      express:{Router:()=>router}, crypto:{},
      '@prisma/client':{PrismaClient:class {user={findUnique:async ({where}:any)=>where.id || existing ? user : null};}},
      '../lib/rate-limit':{createRateLimitMiddleware:()=>()=>{}},
      '../lib/verification':verification,
      '../services/emailer':{sendOtpEmail:async()=>{const result=deliveries.shift();assert.ok(result,'Missing synthetic send result');return result;}},
      '../lib/api-key-auth':{resolveActiveApiKey:async()=>({userId:user.id})},
      '../lib/authorization':{hasPermission:()=>true},
      '../lib/password-hash':{isPasswordHashBusy:()=>false},
    };
    const requireAdapter = (id:string) => {
      if (id in adapters) return adapters[id];
      if (id.startsWith('../lib/')) return {};
      throw new Error('UNEXPECTED_ROUTE_TEST_IMPORT');
    };
    vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,
      {module,exports:module.exports,require:requireAdapter,process:{env},Buffer,console,URL}, {filename:`synthetic-${name}.js`});
  };
  loadRoute('auth'); loadRoute('account');
  const call = async (route:string,body:any) => {
    let status=200,payload:any;
    const response:any={status:(code:number)=>{status=code;return response;},json:(value:any)=>{payload=value;return response;},setHeader:()=>{}};
    await routes.get(route)!({body,headers:{authorization:'synthetic-key'}},response);
    return {status,body:JSON.parse(JSON.stringify(payload))};
  };
  deliveries=[{sent:false,skipped:false,error:'EAUTH'}];
  assert.deepEqual(await call('/register/request-otp',{email:'new@example.invalid'}),{status:503,body:{error:'EMAIL_DELIVERY_UNAVAILABLE'}});
  deliveries=[{sent:true,skipped:false,logError:'EMAIL_LOG_WRITE_FAILED'}];
  assert.deepEqual(await call('/register/request-otp',{email:'new@example.invalid'}),{status:200,body:{ok:true}});
  deliveries=[{sent:true,skipped:false},{sent:false,skipped:false,error:'ETIMEDOUT'}];
  assert.deepEqual(await call('/email/request-change',{newEmail:'new@example.invalid'}),{status:503,body:{error:'EMAIL_DELIVERY_UNAVAILABLE'}});
  deliveries=[{sent:false,skipped:false,error:'EAUTH'},{sent:true,skipped:false}];
  assert.equal((await call('/email/request-change',{newEmail:'new@example.invalid'})).status,503);
  deliveries=[{sent:true,skipped:false},{sent:true,skipped:false}];
  assert.equal((await call('/email/request-change',{newEmail:'new@example.invalid'})).status,200);
  existing=true; deliveries=[{sent:false,skipped:false,error:'EAUTH'}];
  const known=await call('/password-reset/request-otp',{email:user.email});
  existing=false;
  const unknown=await call('/password-reset/request-otp',{email:'unknown@example.invalid'});
  assert.equal(known.status,unknown.status);
  assert.equal(JSON.stringify(known.body),JSON.stringify(unknown.body));
  env.NODE_ENV='development';delete env.SMTP_HOST;
  deliveries=[{sent:false,skipped:true}];
  const local=await call('/register/request-otp',{email:'new@example.invalid'});
  assert.equal(local.status,200);assert.equal(local.body.debugOtp,'synthetic-code');
  console.log('PASS actual signup and email-change handlers expose send failures, log-only failure preserves success, recovery remains generic, and local debug behavior is preserved');
};
