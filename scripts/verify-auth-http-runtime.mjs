import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const [apiRef] = process.argv.slice(2);
assert.ok(apiRef, 'Usage: node scripts/verify-auth-http-runtime.mjs <api-image>');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = crypto.randomBytes(8).toString('hex');
const label = `drapixai.auth-http-fixture=${id}`;
const database = `drapixai-auth-http-db-${id}`;
const cache = `drapixai-auth-http-cache-${id}`;
const runner = `drapixai-auth-http-api-${id}`;
const password = crypto.randomBytes(32).toString('hex');
const dbName = 'drapixai_auth_http_test';
const output = path.join(root,'runtime/launch-evidence',`auth-http-${id}.json`);
fs.mkdirSync(path.dirname(output),{recursive:true});
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const report = { scope:'owned no-host-port HTTP auth/account routers, PostgreSQL and Redis; not staging, full server, SMTP, inference or independent pentest', passed:false, startedAt:new Date().toISOString(), images:{}, source:{}, checks:[] };
const invoke = (cmd,args,options={}) => spawnSync(cmd,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:2*1024*1024,...options});
const redact = value => String(value).replaceAll(password,'[redacted]');
const checked = (cmd,args,options) => {
  const result = invoke(cmd,args,options);
  assert.equal(result.status,0,redact(result.error?.message || result.stderr || result.stdout || 'Fixture command failed'));
  return result.stdout.trim();
};
const docker = (args,options) => checked('docker',args,options);
const git = args => checked('git',args);
const limited = ['--memory','512m','--cpus','2','--pids-limit','128','--ulimit','core=0'];
const readonly = ['--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',...limited,'--tmpfs','/tmp:rw,noexec,nosuid,size=32m'];
const start = (name,args,env) => {
  const cid = docker(['run','--pull=never','-d','--name',name,'--label',label,...args],{env});
  assert.match(cid,/^[a-f0-9]{64}$/); return cid;
};
const wait = async (args,success) => {
  for(let i=0;i<60;i++) { const result=invoke('docker',args); if(result.status===0 && success(result.stdout.trim())) return; await delay(500); }
  throw new Error('Owned fixture service did not become ready');
};
try {
  const commit = git(['rev-parse','HEAD']); assert.match(commit,/^[a-f0-9]{40}$/);
  report.source = {commit,dirtyEntries:git(['-c','core.fsmonitor=false','status','--porcelain']).split('\n').filter(Boolean).length,
    verifierSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))), fixtureTypeScriptSha256:sha(fs.readFileSync(path.join(root,'apps/api/src/scripts/auth-http-database-tests.ts'))),migrationSha256:{}};
  const api = JSON.parse(docker(['image','inspect',apiRef]))[0];
  assert.equal(api.Config.Labels?.['org.opencontainers.image.revision'],commit,'API revision must match the verifier commit');
  assert.match(api.Id,/^sha256:[a-f0-9]{64}$/);
  assert.ok(api.Config.User && !['root','0'].includes(api.Config.User));
  report.images.api={ref:apiRef,id:api.Id,revision:commit};
  const metadata = JSON.parse(docker(['run','--pull=never','--rm',...readonly,'--network','none',api.Id,'-e',
    "const fs=require('node:fs'),c=require('node:crypto');console.log(JSON.stringify({node:process.versions.node,uid:process.getuid(),fixtureCompiledSha256:c.createHash('sha256').update(fs.readFileSync('./dist/scripts/auth-http-database-tests.js')).digest('hex')}))"]));
  assert.equal(metadata.uid,65532); report.images.api.runtime=metadata;
  const pgRef='postgres:16-bookworm@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4';
  const redisRef='redis:7-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2';
  const serviceImage = ref => {
    if(invoke('docker',['image','inspect',ref]).status!==0) docker(['pull',ref]);
    return JSON.parse(docker(['image','inspect',ref]))[0];
  };
  const pg = serviceImage(pgRef);
  const redis = serviceImage(redisRef);
  for(const image of [pg,redis]) assert.match(image.Id,/^sha256:[a-f0-9]{64}$/);
  report.images.postgres={id:pg.Id,pinnedReference:pgRef};
  report.images.redis={id:redis.Id,pinnedReference:redisRef,repoDigests:redis.RepoDigests};
  const env={...process.env,POSTGRES_PASSWORD:password};
  start(database,[...limited,'--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_PASSWORD','-e',`POSTGRES_DB=${dbName}`,pg.Id],env);
  await wait(['exec',database,'psql','-X','-t','-A','-h','127.0.0.1','-U','postgres','-d',dbName,'-c','SELECT 1;'],text=>text==='1');
  const migrations=path.join(root,'apps/api/prisma/migrations');
  for(const name of fs.readdirSync(migrations).sort()) {
    const file=path.join(migrations,name,'migration.sql'); if(!fs.existsSync(file)) continue;
    const bytes=fs.readFileSync(file); report.source.migrationSha256[`apps/api/prisma/migrations/${name}/migration.sql`]=sha(bytes);
    docker(['exec','-i',database,'psql','-X','-q','-h','127.0.0.1','-U','postgres','-d',dbName,'-v','ON_ERROR_STOP=1'],{input:bytes,env});
  }
  start(cache,[...readonly,'--user','redis','--network',`container:${database}`,'--tmpfs','/data:rw,noexec,nosuid,size=16m,mode=1777',redis.Id,'redis-server','--bind','127.0.0.1','--save','','--appendonly','no','--requirepass',password],env);
  await wait(['exec','-e',`REDISCLI_AUTH=${password}`,cache,'redis-cli','ping'],text=>text==='PONG');
  const fixtureEnv = {...process.env,DATABASE_URL:`postgresql://postgres:${password}@127.0.0.1:5432/${dbName}?connection_limit=2&pool_timeout=10`,
    REDIS_URL:`redis://:${password}@127.0.0.1:6379/15`,NODE_ENV:'production',
    DRAPIXAI_DISPOSABLE_DB_APPROVAL:'I_ACKNOWLEDGE_DISPOSABLE_DATABASE',DRAPIXAI_DISPOSABLE_HTTP_APPROVAL:'I_ACKNOWLEDGE_DISPOSABLE_HTTP_FIXTURE',
    DRAPIXAI_DASHBOARD_PROXY_TOKEN:crypto.randomBytes(48).toString('hex'),DRAPIXAI_AUDIT_LOG_SECRET:crypto.randomBytes(48).toString('hex')};
  // Only explicitly named synthetic values enter the container. Host SMTP,
  // production configuration and cloud credentials are never forwarded.
  const keys=['DATABASE_URL','REDIS_URL','NODE_ENV','DRAPIXAI_DISPOSABLE_DB_APPROVAL','DRAPIXAI_DISPOSABLE_HTTP_APPROVAL','DRAPIXAI_DASHBOARD_PROXY_TOKEN','DRAPIXAI_AUDIT_LOG_SECRET'];
  const result=invoke('docker',['run','--pull=never','--rm','--name',runner,'--label',label,...readonly,'--network',`container:${database}`,
    ...keys.flatMap(key=>['-e',key]),'-e','SMTP_HOST=','-e','DRAPIXAI_ADMIN_EMAIL=','-e','DRAPIXAI_ADMIN_TOTP_SECRET=',api.Id,'dist/scripts/auth-http-database-tests.js'],{env:fixtureEnv});
  assert.equal(result.status,0,redact(result.error?.message || result.stderr || result.stdout || 'HTTP fixture failed'));
  const lines=result.stdout.trim().split('\n');
  const body=JSON.parse(lines.at(-1)); assert.equal(body.passed,true); assert.equal(body.checks.length,9);
  report.checks=body.checks; report.output=redact(result.stdout.trim()); report.outputSha256=sha(Buffer.from(report.output));
  report.passed=true;
} catch(error) {report.failure=redact(error.message);process.exitCode=1;}
finally {
  // The API may survive a Docker-client timeout; remove only its exact label.
  const running=invoke('docker',['ps','-aq','--filter',`label=${label}`]);
  if(running.status!==0) {report.passed=false;report.cleanupFailure='Unable to inspect owned fixture containers';process.exitCode=1;}
  else for(const cid of running.stdout.trim().split(/\s+/).filter(Boolean)) {
    if(!/^[a-f0-9]{12,64}$/.test(cid) || invoke('docker',['rm','-fv',cid]).status!==0) {report.passed=false;report.cleanupFailure='Owned fixture removal failed';process.exitCode=1;}
  }
  report.finishedAt=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,evidence:path.relative(root,output),failure:report.failure||report.cleanupFailure||null}));
}
