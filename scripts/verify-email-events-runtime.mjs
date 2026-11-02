import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

// Own, labelled, disposable services only; never use inherited DB/Redis/SMTP URLs.
assert.equal(process.argv.length,2);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const id=crypto.randomBytes(8).toString('hex'),label=`drapixai.email-fixture=${id}`;
const pgName=`drapixai-email-db-${id}`,redisName=`drapixai-email-cache-${id}`,database='drapixai_email_test';
const out=path.join(root,'runtime/launch-evidence',`email-events-${id}`);fs.mkdirSync(out,{recursive:true});
const password=crypto.randomBytes(32).toString('hex');
const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramFiles','ProgramData','ComSpec','DOCKER_CONFIG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const clean=s=>String(s||'').replaceAll(password,'[redacted]');
const report={passed:false,scope:'Owned disposable PostgreSQL/Redis, restricted role, actual raw HTTP/signatures/ORM/suppression/retention; no SMTP sends, cloud changes or live provider qualification',checks:[],sourceSha256:{},images:{}};
const run=(cmd,args,options={})=>spawnSync(cmd,args,{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024*1024,...options});
const docker=(args,options)=>run('docker',args,options);
const must=r=>{assert.equal(r.status,0,clean(r.error?.message||r.stderr||r.stdout));return r.stdout.trim();};
const image=ref=>{const meta=JSON.parse(must(docker(['image','inspect',ref])))[0];report.images[ref]=meta.Id;return meta.Id;};
try{
  const pg=image('postgres@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4');
  const redis=image('redis@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2');
  must(docker(['run','--pull=never','-d','--name',pgName,'--label',label,'--memory','512m','--cpus','2','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-p','127.0.0.1::5432','-e','POSTGRES_PASSWORD','-e',`POSTGRES_DB=${database}`,pg],{env:{...env,POSTGRES_PASSWORD:password}}));
  let ready=false;for(let i=0;i<60;i++){if(docker(['exec',pgName,'pg_isready','-U','postgres','-d',database]).status===0){ready=true;break;}await delay(250);}assert.ok(ready);
  const address=must(docker(['port',pgName,'5432/tcp']));assert.match(address,/^127\.0\.0\.1:\d+$/);
  const sql=text=>must(docker(['exec','-i',pgName,'psql','-X','-q','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],{input:text}));
  for(const entry of fs.readdirSync(path.join(root,'apps/api/prisma/migrations')).sort()){
    const file=path.join(root,'apps/api/prisma/migrations',entry,'migration.sql');if(!fs.existsSync(file))continue;const bytes=fs.readFileSync(file);sql(bytes);report.sourceSha256[path.relative(root,file).replaceAll('\\','/')]=crypto.createHash('sha256').update(bytes).digest('hex');
  }
  sql(`CREATE ROLE email_fixture_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${password}'; REVOKE ALL ON DATABASE ${database} FROM PUBLIC; GRANT CONNECT ON DATABASE ${database} TO email_fixture_api; GRANT USAGE ON SCHEMA public TO email_fixture_api; GRANT SELECT,INSERT,DELETE ON "EmailDeliveryEvent" TO email_fixture_api; GRANT SELECT,INSERT,UPDATE ON "EmailRecipientSuppression" TO email_fixture_api; GRANT SELECT ON "WebhookDelivery" TO email_fixture_api;`);
  must(docker(['run','--pull=never','-d','--name',redisName,'--label',label,'--memory','128m','--cpus','1','--pids-limit','64','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','redis','--tmpfs','/data:rw,noexec,nosuid,size=16m,mode=1777','-p','127.0.0.1::6379',redis,'redis-server','--save','','--appendonly','no','--requirepass',password]));
  const cache=must(docker(['port',redisName,'6379/tcp']));assert.match(cache,/^127\.0\.0\.1:\d+$/);
  let cacheReady=false;for(let i=0;i<30;i++){const r=docker(['exec','-e','REDISCLI_AUTH',redisName,'redis-cli','ping'],{env:{...env,REDISCLI_AUTH:password}});if(r.status===0&&r.stdout.trim()==='PONG'){cacheReady=true;break;}await delay(200);}assert.ok(cacheReady);
  const result=run(process.execPath,[path.join(root,'apps/api/node_modules/ts-node/dist/bin.js'),'--project',path.join(root,'apps/api/tsconfig.json'),path.join(root,'apps/api/src/scripts/email-event-database-tests.ts')],{timeout:120000,cwd:path.join(root,'apps/api'),env:{...env,NODE_ENV:'test',DATABASE_URL:`postgresql://email_fixture_api:${password}@${address}/${database}?connection_limit=4&pool_timeout=10`,REDIS_URL:`redis://:${password}@${cache}/15`,DRAPIXAI_DISPOSABLE_DB_APPROVAL:'I_ACKNOWLEDGE_DISPOSABLE_DATABASE',DRAPIXAI_EMAIL_FIXTURE_NONCE:id}});
  fs.writeFileSync(path.join(out,'sql-http.log'),clean(result.stdout)+'\n'+clean(result.stderr));must(result);report.checks=result.stdout.split('\n').filter(line=>line.startsWith('PASS ')).map(line=>line.slice(5));report.passed=true;
}catch(error){report.failure=clean(error.message);process.exitCode=1;}
finally{
  const owned=docker(['ps','-aq','--filter',`label=${label}`]);report.ownedFixturesRemoved=owned.status===0;
  if(owned.status===0)for(const cid of owned.stdout.trim().split(/\s+/).filter(Boolean))if(!/^[a-f0-9]{12,64}$/.test(cid)||docker(['rm','-fv',cid]).status!==0)report.ownedFixturesRemoved=false;
  if(!report.ownedFixturesRemoved){report.passed=false;process.exitCode=1;}
  for(const file of ['scripts/verify-email-events-runtime.mjs','apps/api/src/scripts/email-event-database-tests.ts','apps/api/src/scripts/email-event-tests.ts','apps/api/src/services/email-delivery-events.ts','apps/api/src/services/emailer.ts','apps/api/src/lib/email-delivery-policy.ts','apps/api/src/routes/email-webhooks.ts','apps/api/src/lib/operational-metrics.ts'])report.sourceSha256[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
  report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,ownedFixturesRemoved:report.ownedFixturesRemoved,evidence:path.relative(root,path.join(out,'report.json')),failure:report.failure}));
}
