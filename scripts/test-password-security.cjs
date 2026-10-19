// Real Node scrypt/bcrypt with synthetic passwords. No network or real accounts.
const assert = require('node:assert/strict');
const bcrypt = require('../apps/api/node_modules/bcryptjs');
const crypto = require('node:crypto');
const { loader, response } = require('./test-security-boundaries.cjs');
const tests = [];
const test = (name, run) => tests.push({ name, run });
const modulePath = 'apps/api/src/lib/password-hash.ts';
const strong = 'A1!a' + 'x'.repeat(32);
const fresh = () => loader()(modulePath);

test('New hashes distinguish long ASCII suffixes and a truncated prefix', async () => {
  const m = fresh(), prefix = 'A1!a' + 'x'.repeat(68), original = prefix+'Original';
  const hash = await m.hashPassword(original);
  assert.equal((await m.verifyPassword(original, hash)).matches, true);
  for (const changed of [prefix, prefix+'Changed']) assert.equal((await m.verifyPassword(changed, hash)).matches, false);
});
test('Independent Python scrypt vector preserves all multibyte password bytes', async () => {
  const m = fresh(), password = 'A1!a'+'é'.repeat(34)+'Original';
  // hashlib.scrypt, N=32768/r=8/p=3/maxmem=64MiB/dklen=64; salt bytes 0..15.
  const derived = 'de2fe4c29b7dc52c067a903759392b3a78e2e4f363bf0e884e592ff0608887850879118d492d90c53870985eac8d0954832598907df3090375e424d2e8083c4f';
  const salt = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
  const hash = ['scrypt','v1','32768','8','3',salt.toString('base64url'),Buffer.from(derived,'hex').toString('base64url')].join('$');
  assert.equal((await m.verifyPassword(password, hash)).matches, true);
  assert.equal((await m.verifyPassword(password.replace('Original','Changed'), hash)).matches, false);
});
test('New hashes support exact 72-byte and full 128-character inputs', async () => {
  const m = fresh();
  for (const password of ['A1!a'+'x'.repeat(68), 'A1!a'+'界'.repeat(124)]) {
    const hash = await m.hashPassword(password);
    assert.equal((await m.verifyPassword(password, hash)).matches, true);
    assert.equal((await m.verifyPassword(password.slice(0,-1), hash)).matches, false);
  }
});
test('Whitespace and Unicode normalization remain exact rather than silently changed', async () => {
  const m = fresh(), password = '  '+strong+'é  ', hash = await m.hashPassword(password);
  assert.equal((await m.verifyPassword(password, hash)).matches, true);
  for (const changed of [password.trim(), password.normalize('NFD')]) assert.equal((await m.verifyPassword(changed, hash)).matches, false);
});
test('Random per-password salts differ and the stored version pins KDF parameters', async () => {
  const m = fresh(), first = await m.hashPassword(strong), second = await m.hashPassword(strong);
  assert.notEqual(first, second);
  const fields = first.split('$');
  assert.deepEqual(fields.slice(0,5), ['scrypt','v1','32768','8','3']);
  assert.equal(Buffer.from(fields[5],'base64url').length,16);
  assert.equal(Buffer.from(fields[6],'base64url').length,64);
});
test('Both password hash formats are removed from diagnostic logs',async()=>{
  const load=loader(),m=load(modulePath),security=load('apps/api/src/lib/security.ts');
  const current=await m.hashPassword(strong),legacy=await bcrypt.hash(strong,4);
  const diagnostic=security.formatLogError(Error(`Synthetic database error passwordHash: "${current}", oldHash: "${legacy}"`));
  assert.equal(diagnostic.includes(current),false);assert.equal(diagnostic.includes(legacy),false);
  assert.equal((diagnostic.match(/\[redacted-password-hash\]/g)||[]).length,2);
});
test('Short legacy passwords verify and request migration; wrong passwords do not', async () => {
  const m = fresh(), password='A1!a'+'x'.repeat(67), hash=await bcrypt.hash(password,4);
  const accepted=await m.verifyPassword(password,hash);
  assert.equal(accepted.matches,true); assert.equal(accepted.needsUpgrade,true);
  assert.equal((await m.verifyPassword(password+'x',hash)).matches,false);
});
test('Ambiguous exact-boundary and longer bcrypt inputs require recovery', async () => {
  const m=fresh();
  for (const prefix of ['A1!a'+'x'.repeat(68), 'A1!a'+'é'.repeat(34)]) {
    const hash=await bcrypt.hash(prefix+'Original',4);
    for (const value of [prefix,prefix+'Original',prefix+'Changed']) {
      const result=await m.verifyPassword(value,hash);
      assert.equal(result.matches,false); assert.equal(result.needsUpgrade,false); assert.equal(result.resetRequired,true);
    }
  }
});
test('Invalid types, excessive input, NUL and ill-formed UTF-16 fail before hashing', async () => {
  const m=fresh();
  for (const value of [null,{},[],123,'','x'.repeat(129),'A1!a\0'+'x'.repeat(20),'A1!a\ud800'+'x'.repeat(20)]) {
    await assert.rejects(m.hashPassword(value), /INVALID_PASSWORD/);
    assert.equal((await m.verifyPassword(value,m.LOGIN_TIMING_SENTINEL_HASH)).matches,false);
  }
});
test('Unreviewed formats, costs and encodings cannot launch a KDF', async () => {
  let calls=0;
  const m=loader({ 'node:crypto':{...crypto,scrypt(){calls++;throw Error('UNEXPECTED_KDF');}},
    bcryptjs:{compare:async()=>{calls++;throw Error('UNEXPECTED_BCRYPT');}} })(modulePath);
  const valid=m.LOGIN_TIMING_SENTINEL_HASH;
  for (const hash of [valid.replace('v1','v2'),valid.replace('32768','1073741824'),valid+'$extra',valid.slice(0,-1),
    valid.replace('AAAAAAAAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAB'),'$2b$31$'+'a'.repeat(53),'unknown']) {
    assert.equal((await m.verifyPassword(strong,hash)).matches,false);
  }
  assert.equal(calls,0);
});
test('Overload rejects before OTP consumption and slots recover after denial', async () => {
  const m=fresh(); let releaseA,releaseB,thirdCalls=0;
  const a=m.hashPasswordAfterAuthorization(strong,()=>new Promise(resolve=>{releaseA=resolve;}));
  const b=m.hashPasswordAfterAuthorization(strong,()=>new Promise(resolve=>{releaseB=resolve;}));
  await assert.rejects(m.hashPasswordAfterAuthorization(strong,async()=>{thirdCalls++;return true;}),e=>m.isPasswordHashBusy(e));
  assert.equal(thirdCalls,0);releaseA(false);releaseB(false);assert.equal(await a,null);assert.equal(await b,null);
  assert.equal((await m.verifyPassword(strong,await m.hashPassword(strong))).matches,true);
});
test('Failed authorization does no KDF work; authorization and crypto failures release slots', async () => {
  let calls=0;
  const m=loader({'node:crypto':{...crypto,scrypt(_p,_s,_n,_o,callback){calls++;callback(Error('SYNTHETIC_KDF_FAILURE'));}}})(modulePath);
  assert.equal(await m.hashPasswordAfterAuthorization(strong,async()=>false),null); assert.equal(calls,0);
  await assert.rejects(m.hashPasswordAfterAuthorization(strong,async()=>{throw Error('SYNTHETIC_AUTH_FAILURE');}),/SYNTHETIC_AUTH_FAILURE/);
  for(let i=0;i<4;i++)await assert.rejects(m.hashPassword(strong),/SYNTHETIC_KDF_FAILURE/);
  assert.equal(calls,4);
});

function authFixture(user, authorized=true, mfa=true) {
  const routes=new Map(), issued=[], codes=[], audit=[], writes=[];
  let current=user?{...user}:null;
  const router={use(){},post(name,...handlers){routes.set(name,handlers.at(-1));}};
  const db={
    termsDocument:{upsert:async({create})=>create},
    accountTermsAcceptance:{findUnique:async()=>user?require('../apps/api/src/legal/terms-metadata.json'):null,
      upsert:async({create})=>create},
    user:{findUnique:async()=>current?{...current}:null,create:async({data})=>{current={id:10,authVersion:1,role:'brand_admin',...data};writes.push('create');return {...current};},
      update:async({data})=>{writes.push(data);current={...current,...data};return {...current};}},
    apiKey:{updateMany:async(args)=>{writes.push({keys:args});return{count:1};}},
    verificationCode:{updateMany:async(args)=>{writes.push({codes:args});return{count:1};}},
    $transaction:async(ops)=>typeof ops==='function'?ops(db):Promise.all(ops),
  };
  const load=loader({express:{Router:()=>router},'@prisma/client':{PrismaClient:class{constructor(){return db;}}},
    '../lib/rate-limit':{createRateLimitMiddleware:()=>()=>{}},
    '../lib/verification':{normalizeEmail:value=>value.trim().toLowerCase(),consumeVerificationCode:async(_db,params)=>{codes.push(params);return authorized;},issueVerificationCode:async()=>{throw Error('MAIL_NOT_ALLOWED');}},
    '../lib/admin-mfa':{requiresAdminMfa:(_email,role)=>role==='system_admin',consumeAdminTotp:async()=>mfa,ADMIN_MFA_SCOPE:'admin:mfa',ADMIN_SESSION_KEY_MAX_AGE_MS:8*3600000},
    '../lib/api-key-auth':{issueApiKeyForUser:async(_db,id,options)=>{issued.push({id,options});return'synthetic-key';},applyVerifiedPassword:async()=>{writes.push('proof-without-key');},resolveActiveApiKey:async()=>null},
    '../lib/audit-log':{appendSecurityAudit:async(_db,record)=>{audit.push(record);}},
    '../services/emailer':{sendOtpEmail:async()=>{throw Error('MAIL_NOT_ALLOWED');},sendWelcomeEmail:async()=>{}},
  });
  const password=load(modulePath);load('apps/api/src/routes/auth.ts');
  return {routes,issued,codes,audit,writes,password,current:()=>current};
}
const userWith = hash => ({id:10,email:'merchant@example.test',role:'brand_admin',authVersion:1,emailVerifiedAt:new Date(0),passwordHash:hash,planType:'trial'});
test('Real password login passes an upgrade and credential snapshot only after successful authentication',async()=>{
  const old=await bcrypt.hash(strong,4),f=authFixture(userWith(old)),res=response();
  await f.routes.get('/login')({body:{email:'merchant@example.test',password:strong}},res);
  assert.equal(res.statusCode,200);assert.equal(f.issued.length,1);
  const proof=f.issued[0].options.passwordProof;assert.equal(proof.snapshot.passwordHash,old);
  assert.equal((await f.password.verifyPassword(strong,proof.upgradedHash)).matches,true);
  assert.equal(JSON.stringify(res.body).includes('passwordHash'),false);
});
test('Legacy boundary, wrong password and unknown-account sentinel all fail without a key',async()=>{
  const prefix='A1!a'+'x'.repeat(68),old=await bcrypt.hash(prefix+'Original',4);
  for(const [user,password]of [[userWith(old),prefix],[userWith(old),prefix+'Changed'],[userWith(old),'wrong'],[null,'public-timing-fixture-only']]){
    const f=authFixture(user),res=response();await f.routes.get('/login')({body:{email:'merchant@example.test',password}},res);
    assert.equal(res.statusCode,401);assert.equal(res.body.error,'Invalid credentials');assert.equal(f.issued.length,0);
  }
});
test('Failed operator MFA cannot persist a legacy upgrade or issue a key',async()=>{
  const old=await bcrypt.hash(strong,4),f=authFixture({...userWith(old),role:'system_admin'},true,false),res=response();
  await f.routes.get('/login')({body:{email:'merchant@example.test',password:strong}},res);
  assert.equal(res.statusCode,401);assert.equal(f.issued.length,0);assert.equal(f.writes.length,0);assert.equal(f.current().passwordHash,old);
});
test('Reset creates a full-input hash and revokes keys and outstanding recovery codes',async()=>{
  const f=authFixture(userWith(await bcrypt.hash(strong,4))),res=response(),password='A1!a'+'界'.repeat(90);
  await f.routes.get('/password-reset/confirm')({body:{email:'merchant@example.test',otp:'123456',password}},res);
  assert.equal(res.statusCode,200);assert.equal(f.codes.length,1);
  assert.equal((await f.password.verifyPassword(password,f.current().passwordHash)).matches,true);
  assert.equal(f.writes.some(w=>w.keys?.data?.isActive===false),true);
  assert.equal(f.writes.some(w=>w.codes?.where?.userId===10),true);
});
test('Signup uses the full input, while invalid OTPs and overload cannot consume extra codes',async()=>{
  const f=authFixture(null),password='A1!a'+'é'.repeat(50),res=response();
  const termsAcceptance={accepted:true,...require('../apps/api/src/legal/terms-metadata.json')};
  await f.routes.get('/register')({body:{email:'new@example.test',password,otp:'123456',termsAcceptance}},res);
  assert.equal(res.statusCode,200);assert.equal((await f.password.verifyPassword(password,f.current().passwordHash)).matches,true);
  const denied=authFixture(null,false),bad=response();await denied.routes.get('/register')({body:{email:'new@example.test',password,otp:'123456',termsAcceptance}},bad);
  assert.equal(bad.statusCode,400);assert.equal(denied.writes.length,0);
  const busy=authFixture(userWith('fixture')),releases=[];
  const holds=[0,1].map(()=>busy.password.hashPasswordAfterAuthorization(strong,()=>new Promise(resolve=>releases.push(resolve))));
  const blocked=response();await busy.routes.get('/password-reset/confirm')({body:{email:'merchant@example.test',password,otp:'123456'}},blocked);
  assert.equal(blocked.statusCode,503);assert.equal(blocked.body.error,'AUTHENTICATION_BUSY');assert.equal(busy.codes.length,0);
  releases.forEach(resolve=>resolve(false));await Promise.all(holds);
});
test('A new merchant Google account uses the shared versioned hasher',async()=>{
  const f=authFixture(null),res=response();
  await f.routes.get('/oauth/google')({headers:{},body:{email:'google@example.test',name:'Fixture',issueNewKey:true}},res);
  assert.equal(res.statusCode,200);assert.ok(f.current().passwordHash.startsWith('scrypt$v1$'));
});

function accountFixture(user, stale=false) {
  let current={...user};const routes=new Map(),writes=[];
  const router={use(){},get(){},post(name,...handlers){routes.set(name,handlers.at(-1));}};
  const db={user:{findUnique:async()=>({...current})},apiKey:{updateMany:async(args)=>{writes.push({keys:args});return{count:1};}},
    verificationCode:{updateMany:async(args)=>{writes.push({codes:args});return{count:1};}},$transaction:async ops=>Promise.all(ops)};
  const load=loader({express:{Router:()=>router},'@prisma/client':{PrismaClient:class{constructor(){return db;}}},
    '../lib/rate-limit':{createRateLimitMiddleware:()=>()=>{}},'../lib/dashboard-proxy-auth':{requireDashboardProxy:()=>{}},
    '../lib/api-key-auth':{resolveActiveApiKey:async()=>({userId:10}),applyVerifiedPassword:async(_db,snapshot,passwordHash,advance)=>{
      if(stale)throw Object.assign(Error('synthetic stale proof'),{code:'P2025'});
      writes.push({proof:snapshot.id,advance});current={...current,passwordHash,authVersion:current.authVersion+Number(advance)};return {...current};}},
  });
  const password=load(modulePath);load('apps/api/src/routes/account.ts');
  return{routes,password,writes,current:()=>current};
}
test('Account password change uses the whole new input and revokes credentials',async()=>{
  const f=accountFixture(userWith(await bcrypt.hash(strong,4))),res=response(),next='A1!a'+'界'.repeat(90);
  await f.routes.get('/password')({headers:{authorization:'Bearer synthetic-key'},body:{currentPassword:strong,newPassword:next}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.sessionsRevoked,true);
  assert.equal(f.current().authVersion,2);assert.equal((await f.password.verifyPassword(next,f.current().passwordHash)).matches,true);
  assert.ok(f.writes.some(w=>w.proof===10&&w.advance===true));assert.ok(f.writes.some(w=>w.keys));assert.ok(f.writes.some(w=>w.codes));
});
test('Account change denies ambiguous legacy inputs and maps stale proof safely',async()=>{
  const prefix='A1!a'+'x'.repeat(68),f=accountFixture(userWith(await bcrypt.hash(prefix+'Original',4))),res=response();
  await f.routes.get('/password')({headers:{},body:{currentPassword:prefix,newPassword:strong}},res);
  assert.equal(res.statusCode,400);assert.equal(f.writes.length,0);
  const stale=accountFixture(userWith(await bcrypt.hash(strong,4)),true),changed=response();
  await stale.routes.get('/password')({headers:{},body:{currentPassword:strong,newPassword:strong+'New'}},changed);
  assert.equal(changed.statusCode,400);assert.equal(changed.body.error,'CURRENT_PASSWORD_INCORRECT');
});
test('Account overload returns retryable denial before any mutation',async()=>{
  const f=accountFixture(userWith(await bcrypt.hash(strong,4))),releases=[],res=response();
  const holds=[0,1].map(()=>f.password.hashPasswordAfterAuthorization(strong,()=>new Promise(resolve=>releases.push(resolve))));
  await f.routes.get('/password')({headers:{},body:{currentPassword:strong,newPassword:strong+'New'}},res);
  assert.equal(res.statusCode,503);assert.equal(f.writes.length,0);
  releases.forEach(resolve=>resolve(false));await Promise.all(holds);
});

(async()=>{
  let failures=0;
  for(const {name,run}of tests){try{await run();console.log(`PASS ${name}`);}catch(error){failures++;console.error(`FAIL ${name}: ${error.message}`);}}
  console.log(`${tests.length-failures}/${tests.length} password security cases passed (real crypto, synthetic route adapters; database races checked separately)`);
  process.exitCode=failures?1:0;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
