import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),nonce=crypto.randomBytes(8).toString('hex'),password=crypto.randomBytes(32).toString('hex');
const out=path.join(root,'runtime/launch-evidence',`private-redis-${nonce}`);fs.mkdirSync(out,{recursive:true});
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(path|systemroot|windir|comspec|temp|tmp|localappdata|appdata|userprofile|programfiles|programdata|pathext|docker_config)$/i.test(k)));
const docker=(args,options={})=>spawnSync('docker',args,{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:30000,...options});
const clean=s=>String(s||'').replaceAll(password,'[redacted]'); const must=r=>{assert.equal(r.status,0,clean(r.stderr||r.stdout||r.error?.message));return r.stdout.trim();};
const report={passed:false,scope:'Two owned no-network/no-port Redis fixtures; private startup, health stdin and daemon helper, synthetic credentials only',checks:[]};
try{
 const ref='redis@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2';const image=JSON.parse(must(docker(['image','inspect',ref])))[0].Id;report.imageId=image;
 for(const mode of ['server','daemon']){
  const name=`drapixai-private-redis-${mode}-${nonce}`;
  const command=mode==='server'?'while [ ! -f /tmp/private-redis.sh ]; do sleep 0.05; done; exec sh /tmp/private-redis.sh server /tmp/secret':'while true; do sleep 1; done';
  // This owned no-network fixture executes generated audit wrappers from /tmp.
  // Production tmpfs options remain unchanged; no host directory is mounted.
  must(docker(['run','--pull=never','-d','--name',name,'--network','none','--label',`drapixai.private-redis-fixture=${nonce}`,'--memory','128m','--cpus','1','--pids-limit','64','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/data:rw,size=16m,mode=700','--tmpfs','/tmp:rw,exec,size=16m,mode=1777','-e','PATH=/tmp/audit-bin:/usr/local/bin:/usr/bin:/bin','-e','DATABASE_URL=synthetic-unrelated-application-setting',image,'sh','-c',command]));
  const put=(file,bytes)=>must(docker(['exec','-i',name,'sh','-c',`umask 077; mkdir -p "$(dirname '${file}')"; cat > '${file}'`],{input:bytes}));
  put('/tmp/secret',password);put('/tmp/wrong-secret',crypto.randomBytes(32).toString('hex'));
  for(const binary of ['redis-server','redis-cli']){
   const wrapper=`#!/bin/sh\nset -eu\n[ -z "\${DATABASE_URL:-}" ] && [ -z "\${DRAPIXAI_REDIS_PASSWORD:-}" ] && [ -z "\${REDISCLI_AUTH:-}" ] || exit 98\nfor arg in "$@"; do case "$arg" in --requirepass|-a|--pass) exit 99;; esac; done\nprintf '%s\\n' '${binary}:private' >> /tmp/native-audit\nexec /usr/local/bin/${binary} "$@"\n`;
   put('/tmp/audit-bin/'+binary,wrapper);must(docker(['exec',name,'chmod','700','/tmp/audit-bin/'+binary]));
  }
  put('/tmp/private-redis.new',fs.readFileSync(path.join(root,'deploy/scripts/private-redis.sh')));
  must(docker(['exec',name,'mv','/tmp/private-redis.new','/tmp/private-redis.sh']));
  if(mode==='daemon'){
   must(docker(['exec','-e','DRAPIXAI_REDIS_PASSWORD','-e','DRAPIXAI_REDIS_RUNTIME_DIR=/tmp/app/runtime/redis',name,'sh','/tmp/private-redis.sh','daemon'],{env:{...env,DRAPIXAI_REDIS_PASSWORD:password}}));
  }
  let ready=false;for(let n=0;n<40;n++){const r=docker(['exec',name,'sh','/tmp/private-redis.sh','health','/tmp/secret']);if(r.status===0){ready=true;break;}await delay(100);}
  if(!ready){const logs=docker(['logs',name]);report.fixtureLogs=clean(logs.stdout+'\n'+logs.stderr);const health=docker(['exec',name,'sh','-x','/tmp/private-redis.sh','health','/tmp/secret']);report.healthDiagnostic=clean(health.stdout+'\n'+health.stderr);}
  assert.ok(ready,mode+' health');
  assert.notEqual(docker(['exec',name,'sh','/tmp/private-redis.sh','health','/tmp/wrong-secret']).status,0);
  const auditRead=docker(['exec',name,'cat','/tmp/native-audit']);
  if(auditRead.status!==0)report.pathDiagnostic=clean(docker(['exec',name,'sh','-c','printf "%s\\n" "$PATH"; command -v redis-server; command -v redis-cli; ls -l /tmp/audit-bin']).stdout);
  const audit=must(auditRead);assert.ok(audit.includes('redis-server:private')&&audit.includes('redis-cli:private'));
  const args=must(docker(['exec',name,'sh','-c','for file in /proc/[0-9]*/cmdline; do cat "$file" 2>/dev/null | tr "\\000" " "; printf "\\n"; done']));assert.ok(!args.includes(password));
  if(mode==='daemon')assert.equal(must(docker(['exec',name,'sh','-c','find /tmp/app/runtime/redis -name "redis.conf.*" | wc -l'])),'0');
  else {
   const modes=must(docker(['exec',name,'sh','-c','for file in /tmp/drapixai-redis.*/redis.conf.*; do stat -c "%a" "$file"; stat -c "%a" "$(dirname "$file")"; done']));assert.equal(modes,'600\n700');
  }
  const removeAuth=docker(['exec','-i',name,'env','-i','PATH=/usr/local/bin:/usr/bin:/bin','REDISCLI_HISTFILE=/dev/null','/usr/local/bin/redis-cli','--raw'],{input:`AUTH ${password}\nCONFIG SET requirepass ""\n`});
  must(removeAuth);
  assert.notEqual(docker(['exec',name,'sh','/tmp/private-redis.sh','health','/tmp/secret']).status,0,'Health must not pass on an accidentally unauthenticated Redis');
  report.checks.push(mode+': real authentication, wrong-secret refusal, no native credential args/environment, private configuration lifecycle');
  report.checks.push(mode+': unauthenticated Redis is rejected even though its PING returns PONG');
 }
 report.passed=true;
}catch(error){report.failure=clean(error.message);process.exitCode=1;}
finally{
 const owned=docker(['ps','-aq','--filter',`label=drapixai.private-redis-fixture=${nonce}`]);report.ownedFixturesRemoved=owned.status===0;
 if(owned.status===0)for(const cid of owned.stdout.trim().split(/\s+/).filter(Boolean))if(!/^[a-f0-9]{12,64}$/.test(cid)||docker(['rm','-fv',cid]).status!==0)report.ownedFixturesRemoved=false;
 if(!report.ownedFixturesRemoved){report.passed=false;process.exitCode=1;}
 report.sourceSha256=Object.fromEntries(['deploy/scripts/private-redis.sh','deploy/runpod/start-redis.sh','deploy/docker-compose.edge.yml','deploy/docker-compose.ai.yml','deploy/staging/docker-compose.edge.yml','deploy/staging/docker-compose.ai.yml','scripts/verify-private-redis.mjs'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));report.recordedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,ownedFixturesRemoved:report.ownedFixturesRemoved,evidence:path.relative(root,path.join(out,'report.json')),failure:report.failure}));
}
