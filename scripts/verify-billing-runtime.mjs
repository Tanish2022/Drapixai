import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

// Own fresh fixtures only. No inherited DATABASE_URL, .env, cloud/SMTP/payment
// credentials, provider requests, real shoppers or host-volume mounts.
assert.equal(process.argv.length,2,'Usage: node scripts/verify-billing-runtime.mjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const id=crypto.randomBytes(8).toString('hex'), label=`drapixai.billing-fixture=${id}`;
const database='drapixai_billing_test', pgName=`drapixai-billing-db-${id}`, redisName=`drapixai-billing-cache-${id}`;
const out=path.join(root,'runtime/launch-evidence',`billing-${id}`);fs.mkdirSync(out,{recursive:true});
const password=crypto.randomBytes(32).toString('hex');
const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramFiles','ProgramData','ComSpec','DOCKER_CONFIG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const clean=s=>String(s||'').replaceAll(password,'[redacted]');
const report={passed:false,startedAt:new Date().toISOString(),scope:'Fresh loopback PostgreSQL/Redis; actual billing routers, real signatures and SQL quota accounting; synthetic outbound Stripe adapters; no Razorpay/live provider, email, tax, Sheets or GPU acceptance',checks:[],sourceSha256:{},images:{}};
const run=(cmd,args,options={})=>spawnSync(cmd,args,{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024*1024,...options});
const docker=(args,options)=>run('docker',args,options);
const must=r=>{assert.equal(r.status,0,clean(r.error?.message||r.stderr||r.stdout));return r.stdout.trim();};
const image=ref=>{if(docker(['image','inspect',ref]).status!==0)must(docker(['pull',ref],{timeout:180000}));const meta=JSON.parse(must(docker(['image','inspect',ref])))[0];report.images[ref]=meta.Id;return meta.Id;};
const node=(file,extra=[],options={})=>run(process.execPath,[file,...extra],{timeout:120000,...options});
function fixture(name,extraEnv={}) {
 const result=node(path.join(root,'apps/api/node_modules/ts-node/dist/bin.js'),['--project',path.join(root,'apps/api/tsconfig.json'),path.join(root,'apps/api/src/scripts',name+'.ts')],{cwd:path.join(root,'apps/api'),env:{...env,...extraEnv}});
 fs.writeFileSync(path.join(out,name+'.log'),clean(result.stdout)+'\n'+clean(result.stderr));must(result);
 const passed=result.stdout.split('\n').filter(l=>l.startsWith('PASS '));report.checks.push(...passed.map(l=>l.slice(5)));
 return result.stdout;
}
try {
 const pg=image('postgres@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4');
 const redis=image('redis:7-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2');
 must(docker(['run','--pull=never','-d','--name',pgName,'--label',label,'--memory','512m','--cpus','2','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-p','127.0.0.1::5432','-e','POSTGRES_PASSWORD','-e',`POSTGRES_DB=${database}`,pg],{env:{...env,POSTGRES_PASSWORD:password}}));
 let ready=false;
 for(let i=0;i<60;i++){const probe=docker(['exec',pgName,'psql','-h','127.0.0.1','-U','postgres','-d',database,'-t','-A','-c','SELECT 1']);if(probe.status===0&&probe.stdout.trim()==='1'){ready=true;break;}await delay(300);}assert.ok(ready);
 const pgAddress=must(docker(['port',pgName,'5432/tcp']));assert.match(pgAddress,/^127\.0\.0\.1:\d+$/);
 const dbUrl=`postgresql://postgres:${password}@${pgAddress}/${database}?connection_limit=4&pool_timeout=10`;
 const migrations=path.join(root,'apps/api/prisma/migrations');
 for(const name of fs.readdirSync(migrations).sort()) {
  const f=path.join(migrations,name,'migration.sql');if(!fs.existsSync(f))continue;const bytes=fs.readFileSync(f);
  report.sourceSha256[path.relative(root,f).replaceAll('\\','/')]=hash(bytes);
  must(docker(['exec','-i',pgName,'psql','-X','-q','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],{input:bytes}));
 }
 // Accounting runs first and removes its exact created records. Immutable
 // audit rows remain and are subsequently verified by the HTTP fixture.
 const base={...env,DATABASE_URL:dbUrl,NODE_ENV:'test',DRAPIXAI_AUDIT_LOG_SECRET:crypto.randomBytes(48).toString('hex'),DRAPIXAI_DISPOSABLE_DB_APPROVAL:'I_ACKNOWLEDGE_DISPOSABLE_DATABASE',SMTP_HOST:'',AWS_EC2_METADATA_DISABLED:'true'};
 fixture('billing-database-tests',base);
 must(docker(['run','--pull=never','-d','--name',redisName,'--label',label,'--memory','128m','--cpus','1','--pids-limit','64','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','redis','--tmpfs','/data:rw,noexec,nosuid,size=16m,mode=1777','-p','127.0.0.1::6379',redis,'redis-server','--save','','--appendonly','no','--requirepass',password]));
 const redisAddress=must(docker(['port',redisName,'6379/tcp']));assert.match(redisAddress,/^127\.0\.0\.1:\d+$/);
 let cacheReady=false;for(let i=0;i<30;i++){const r=docker(['exec','-e','REDISCLI_AUTH',redisName,'redis-cli','ping'],{env:{...env,REDISCLI_AUTH:password}});if(r.status===0&&r.stdout.trim()==='PONG'){cacheReady=true;break;}await delay(200);}assert.ok(cacheReady);
 fixture('billing-http-database-tests',{...base,REDIS_URL:`redis://:${password}@${redisAddress}/15`,DRAPIXAI_DASHBOARD_PROXY_TOKEN:crypto.randomBytes(48).toString('hex'),DRAPIXAI_BILLING_HTTP_FIXTURE:'I_ACKNOWLEDGE_DISPOSABLE_BILLING_HTTP'});
 report.passed=true;
}catch(error){report.failure=clean(error.message);process.exitCode=1;}
finally {
 const owned=docker(['ps','-aq','--filter',`label=${label}`]);report.ownedFixturesRemoved=owned.status===0;
 if(owned.status===0)for(const cid of owned.stdout.trim().split(/\s+/).filter(Boolean))if(!/^[a-f0-9]{12,64}$/.test(cid)||docker(['rm','-fv',cid]).status!==0)report.ownedFixturesRemoved=false;
 if(!report.ownedFixturesRemoved){report.passed=false;process.exitCode=1;}
 for(const file of ['scripts/verify-billing-runtime.mjs','apps/api/src/scripts/billing-http-database-tests.ts','apps/api/src/scripts/billing-database-tests.ts','apps/api/src/scripts/quota-reservation-database-tests.ts','apps/api/src/lib/billing.ts','apps/api/src/lib/plans.ts','apps/api/src/lib/quota-reservations.ts','apps/api/src/lib/usage.ts','apps/api/src/routes/billing.ts'])report.sourceSha256[file]=hash(fs.readFileSync(path.join(root,file)));
 report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,ownedFixturesRemoved:report.ownedFixturesRemoved,evidence:path.relative(root,path.join(out,'report.json')),failure:report.failure}));
}
