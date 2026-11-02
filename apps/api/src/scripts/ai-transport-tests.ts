import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawn, spawnSync } from 'node:child_process';
import { aiRequestSignal } from '../lib/ai-request-signal';

async function main() {
  const plain = process.argv.includes('--plain');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drapixai-ai-transport-'));
  let requests = 0, authorized = false; const sockets = new Set<import('node:net').Socket>();
  const handler: http.RequestListener = (req, res) => {
    requests++; authorized ||= (req.socket as import('node:tls').TLSSocket).authorized === true;
    if (req.url === '/stall') return;
    if (req.url === '/drip') { res.writeHead(200); const timer=setInterval(()=>res.write(Buffer.alloc(4)),20); res.once('close',()=>clearInterval(timer)); return; }
    if (req.url === '/declared') { res.writeHead(200, {'Content-Length':'1025'}); res.flushHeaders(); return; }
    if (req.url === '/stream') { res.write(Buffer.alloc(800)); res.end(Buffer.alloc(800)); return; }
    if (req.url === '/short') { res.writeHead(200, {'Content-Length':'1000'}); res.flushHeaders(); res.write('x'); setTimeout(()=>res.destroy(),10); return; }
    if (req.url === '/empty') { res.writeHead(204); res.end(); return; }
    if (req.url === '/redirect') { res.writeHead(302,{Location:'http://127.0.0.1:1/denied'}); res.end(); return; }
    res.writeHead(200,{'Content-Type':'image/png','x-drapixai-quality-score':'0.98'}); res.end(Buffer.alloc(1024,29));
  };
  if (!plain) {
    if (process.platform === 'win32') {
      const generation = spawnSync('python', ['-c', `import sys,datetime,ipaddress
from pathlib import Path
from cryptography import x509
from cryptography.x509.oid import NameOID,ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
p=Path(sys.argv[1]); k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Synthetic AI transport fixture')]); now=datetime.datetime.now(datetime.timezone.utc)
c=(x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=1)).not_valid_after(now+datetime.timedelta(days=1)).add_extension(x509.BasicConstraints(ca=True,path_length=None),critical=True).add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),critical=False).add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH,ExtendedKeyUsageOID.CLIENT_AUTH]),critical=False).sign(k,hashes.SHA256()))
(p/'key.pem').write_bytes(k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption())); (p/'cert.pem').write_bytes(c.public_bytes(serialization.Encoding.PEM))`, temp],{encoding:'utf8',windowsHide:true});
      assert.equal(generation.status,0,'Synthetic certificate generation failed');
    } else {
      const generation=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',path.join(temp,'key.pem'),'-out',path.join(temp,'cert.pem'),'-subj','/CN=Synthetic AI transport fixture','-addext','subjectAltName=IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE','-addext','extendedKeyUsage=serverAuth,clientAuth'],{encoding:'utf8'});
      assert.equal(generation.status,0,'Synthetic certificate generation failed');
    }
  }
  const server = plain ? http.createServer(handler) : https.createServer({key:fs.readFileSync(path.join(temp,'key.pem')),cert:fs.readFileSync(path.join(temp,'cert.pem')),ca:fs.readFileSync(path.join(temp,'cert.pem')),requestCert:true,rejectUnauthorized:true},handler);
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  process.env.NODE_ENV='test'; process.env.DRAPIXAI_AI_URL=`${plain?'http':'https'}://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  process.env.DRAPIXAI_AI_MTLS_ENABLED=plain?'0':'1';
  process.env.DRAPIXAI_AI_MTLS_CERT_FILE=path.join(temp,'cert.pem'); process.env.DRAPIXAI_AI_MTLS_KEY_FILE=path.join(temp,'key.pem'); process.env.NODE_EXTRA_CA_CERTS=path.join(temp,'cert.pem');
  const client=await import('../lib/ai-client'); let groups=0; const pass=(s:string)=>{groups++;console.log('PASS '+s);};
  const call=(route:string,init?:RequestInit)=>client.aiFetch(process.env.DRAPIXAI_AI_URL!+route,init);
  try {
    delete process.env.DRAPIXAI_AI_REQUEST_TIMEOUT_MS; delete process.env.DRAPIXAI_AI_MAX_RESPONSE_BYTES;
    assert.equal(client.getAiTransportLimits().timeoutMs,360000); assert.equal(client.getAiTransportLimits().maxResponseBytes,67108864);
    process.env.DRAPIXAI_AI_MAX_RESPONSE_BYTES='1024'; process.env.DRAPIXAI_AI_REQUEST_TIMEOUT_MS='1500';
    const ok=await call('/ok'); assert.deepEqual(Buffer.from(await ok.arrayBuffer()),Buffer.alloc(1024,29)); assert.equal(ok.headers.get('x-drapixai-quality-score'),'0.98'); if(!plain)assert.ok(authorized);
    assert.equal((await (await call('/empty')).arrayBuffer()).byteLength,0); pass('Actual transport preserves successful bytes/quality metadata and empty responses; mTLS peer is verified');
    for(const route of ['/declared','/stream'])await assert.rejects(call(route),/AI_RESPONSE_TOO_LARGE/);
    pass('Declared oversize and actual chunked excess are rejected before an unbounded response can accumulate');
    await assert.rejects(call('/short'),/AI_RESPONSE_INCOMPLETE|AI_UPSTREAM_CONNECTION_FAILED/); pass('Premature native HTTP closure settles with a sanitized error');
    process.env.DRAPIXAI_AI_REQUEST_TIMEOUT_MS='150';
    for(const route of ['/stall','/drip'])await assert.rejects(call(route),/AI_REQUEST_TIMEOUT/);
    pass('Wall-clock deadline covers absent headers and a continuously progressing response body');
    process.env.DRAPIXAI_AI_REQUEST_TIMEOUT_MS='1500'; const abort=new AbortController(); const pending=call('/stall',{signal:abort.signal}); setTimeout(()=>abort.abort(new Error('PRIVATE-ABORT-DETAIL')),30);
    await assert.rejects(pending,error=>error instanceof Error && error.message==='AI_REQUEST_ABORTED');
    const count=requests; await assert.rejects(call('/ok',{signal:AbortSignal.abort()}),/AI_REQUEST_ABORTED/); assert.equal(requests,count); pass('Caller/pre-abort closes transport and never leaks caller reason or dispatches a pre-aborted request');
    await assert.rejects(client.aiFetch('http://example.invalid/denied'),/AI_ENDPOINT_ORIGIN_DENIED/);
    if(plain)await assert.rejects(call('/redirect'),/AI_UPSTREAM_CONNECTION_FAILED/); else assert.equal((await call('/redirect')).status,302);
    pass('Origin changes are refused and redirects cannot send credentials to another origin');
    process.env.DRAPIXAI_AI_MAX_RESPONSE_BYTES='134217729'; await assert.rejects(call('/ok'),/AI_TRANSPORT_CONFIG_INVALID/); process.env.DRAPIXAI_AI_MAX_RESPONSE_BYTES='1024';
    const signalReq=new (await import('node:events')).EventEmitter() as any, signalRes=new (await import('node:events')).EventEmitter() as any;
    signalRes.writableFinished=false; const signal=aiRequestSignal(signalReq,signalRes); signalRes.emit('close'); assert.equal(signal.aborted,true); assert.equal(signalReq.listenerCount('aborted'),0);
    assert.equal(client.aiTransportFailure(new Error('AI_REQUEST_TIMEOUT'))?.body.retryable,false); pass('Invalid limits fail closed and disconnect/error feedback avoids unsafe automatic retries');
  } finally {
    client.closeAiTransportForTests(); for(const socket of sockets)socket.destroy(); await new Promise<void>(resolve=>server.close(()=>resolve()));
    fs.rmSync(temp,{recursive:true,force:true});
  }
  console.log(`AI ${plain?'HTTP':'mTLS'} transport checks passed: ${groups} groups. Owned loopback only; no inference.`);
  if(!plain)await new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,[require.resolve('ts-node/dist/bin.js'),__filename,'--plain'],{stdio:'inherit',env:{...process.env,NODE_EXTRA_CA_CERTS:undefined},windowsHide:true}); child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('PLAIN_TRANSPORT_REGRESSION_FAILED')));
  });
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
