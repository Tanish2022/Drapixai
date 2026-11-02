import net from 'node:net';
import tls from 'node:tls';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Fixed, console-verified staging endpoint. No credentials, auth packets or SQL.
const host = 'ep-sample-staging.ap-southeast-1.aws.neon.tech';
const probe = servername => new Promise((resolve, reject) => {
  let encrypted;
  const socket = net.createConnection({host, port:5432});
  const finish = (error, value) => {
    clearTimeout(deadline); encrypted?.destroy(); socket.destroy();
    error ? reject(error) : resolve(value);
  };
  const deadline = setTimeout(() => finish(Object.assign(new Error('TLS_PROBE_TIMEOUT'),{code:'TLS_PROBE_TIMEOUT'})),15_000);
  socket.once('error',error=>finish(error));
  socket.once('connect',()=>{
    const request=Buffer.alloc(8);request.writeInt32BE(8,0);request.writeInt32BE(80877103,4);socket.write(request);
  });
  socket.once('data',response=>{
    if (response.length!==1 || response[0]!==83) {finish(Object.assign(new Error('POSTGRES_TLS_NOT_ACCEPTED'),{code:'POSTGRES_TLS_NOT_ACCEPTED'}));return;}
    encrypted=tls.connect({socket,servername,rejectUnauthorized:true,minVersion:'TLSv1.2'});
    encrypted.once('error',error=>finish(error));
    encrypted.once('secureConnect',()=>finish(null,{authorized:encrypted.authorized,protocol:encrypted.getProtocol()}));
  });
});
try {
  const result=await probe(host);assert.equal(result.authorized,true);
  let wrongNameCode;
  try {await probe('drapixai-wrong-name.invalid');}catch(error){wrongNameCode=error.code;}
  assert.equal(wrongNameCode,'ERR_TLS_CERT_ALTNAME_INVALID');
  const evidence={date:'2026-10-23',project:'sample-staging-project',branch:'sample-staging-branch',host,
    certificateVerified:true,protocol:result.protocol,wrongHostnameRejected:true,credentialsUsed:false,sqlSent:false,
    scope:'Postgres endpoint TLS handshake only; not Prisma authentication, SQL privileges or data-at-rest verification'};
  await fs.writeFile('runtime/launch-evidence/neon-staging-tls-20261023.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
}catch(error){console.error(JSON.stringify({passed:false,code:/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'TLS_PROBE_FAILED'}));process.exitCode=1;}
