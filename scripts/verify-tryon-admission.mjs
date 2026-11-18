import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
assert.equal(process.argv.length,2);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),nonce=crypto.randomBytes(8).toString('hex');
const name=`drapixai-admission-cache-${nonce}`,password=crypto.randomBytes(32).toString('hex');
const out=path.join(root,'runtime/launch-evidence',`admission-${nonce}`);fs.mkdirSync(out,{recursive:true});
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(path|systemroot|windir|comspec|temp|tmp|localappdata|appdata|userprofile|programfiles|programdata|pathext|docker_config)$/i.test(k)));
const run=(exe,args,options={})=>spawnSync(exe,args,{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024*1024,...options});
const docker=(args,options)=>run('docker',args,options);const clean=s=>String(s||'').replaceAll(password,'[redacted]');
const must=r=>{assert.equal(r.status,0,clean(r.error?.message||r.stderr||r.stdout));return r.stdout.trim();};
const report={passed:false,scope:'Owned authenticated loopback Redis, actual Lua/heartbeat/dispatch/operator helpers and a real Redis process restart; synthetic work, no GPU/cloud/live DB',checks:[]};
try{
 const image='redis@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2';report.imageId=JSON.parse(must(docker(['image','inspect',image])))[0].Id;
 must(docker(['run','--pull=never','-d','--name',name,'--label',`drapixai.admission-fixture=${nonce}`,'--memory','128m','--cpus','1','--pids-limit','64','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','redis','--tmpfs','/data:rw,noexec,nosuid,size=16m,mode=1777','-p','127.0.0.1::6379',report.imageId,'redis-server','--save','','--appendonly','no','--requirepass',password]));
 let ready=false;for(let n=0;n<30;n++){const r=docker(['exec','-e','REDISCLI_AUTH',name,'redis-cli','ping'],{env:{...env,REDISCLI_AUTH:password}});if(r.status===0&&r.stdout.trim()==='PONG'){ready=true;break;}await wait(200);}assert.ok(ready);
 const address=must(docker(['port',name,'6379/tcp']));assert.match(address,/^127\.0\.0\.1:\d+$/);
 const result=run(process.execPath,[path.join(root,'apps/api/node_modules/ts-node/dist/bin.js'),'--project',path.join(root,'apps/api/tsconfig.json'),path.join(root,'apps/api/src/scripts/tryon-admission-tests.ts')],{timeout:120000,env:{...env,NODE_ENV:'test',REDIS_URL:`redis://:${password}@${address}/15`,DRAPIXAI_ADMISSION_FIXTURE_NONCE:nonce}});
 fs.writeFileSync(path.join(out,'tests.log'),clean(result.stdout)+'\n'+clean(result.stderr));report.checks=result.stdout.split('\n').filter(s=>s.startsWith('PASS ')).map(s=>s.slice(5));must(result);report.passed=true;
}catch(error){report.failure=clean(error.message);process.exitCode=1;}
finally{
 const owned=docker(['ps','-aq','--filter',`label=drapixai.admission-fixture=${nonce}`]);report.ownedFixtureRemoved=owned.status===0;
 if(owned.status===0)for(const cid of owned.stdout.trim().split(/\s+/).filter(Boolean))if(!/^[a-f0-9]{12,64}$/.test(cid)||docker(['rm','-fv',cid]).status!==0)report.ownedFixtureRemoved=false;
 if(!report.ownedFixtureRemoved){report.passed=false;process.exitCode=1;}
 report.sourceSha256=Object.fromEntries(['apps/api/src/lib/tryon-concurrency.ts','apps/api/src/scripts/tryon-admission-tests.ts','scripts/verify-tryon-admission.mjs'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
 report.recordedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,ownedFixtureRemoved:report.ownedFixtureRemoved,evidence:path.relative(root,path.join(out,'report.json')),failure:report.failure}));
}
