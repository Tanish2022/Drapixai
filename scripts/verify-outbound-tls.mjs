// Separate CPU-only assessment: real TLS/HTTP framing with synthetic DNS and
// a transport adapter that can connect only to this owned loopback server.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {loader}=require('./test-security-boundaries.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'runtime/launch-evidence',`outbound-tls-${crypto.randomBytes(6).toString('hex')}`);
fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'drapixai-outbound-tls-'));
const hostname='controlled.example.test',sockets=new Set(),checks=[];
let server,agent,untrusted,port,received=0,peerIdentity=false;
const passed=name=>{checks.push(name);console.log('PASS '+name);};
const report={passed:false,scope:'Real native loopback TLS/framing; synthetic DNS and a loopback-only dial adapter. No external network, live services, real records, GPU or LLM.',checks};
try{
 const certificateProgram=String.raw`
import sys,datetime
from pathlib import Path
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
p=Path(sys.argv[1]);key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Controlled outbound TLS fixture')]);now=datetime.datetime.now(datetime.timezone.utc)
cert=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=1)).not_valid_after(now+datetime.timedelta(days=1)).add_extension(x509.BasicConstraints(ca=True,path_length=None),critical=True).add_extension(x509.SubjectAlternativeName([x509.DNSName('controlled.example.test')]),critical=False).sign(key,hashes.SHA256()))
(p/'key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));(p/'cert.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
`;
 const generationOptions={encoding:'utf8',windowsHide:true,timeout:15000};
 const generated=process.platform==='win32'
  ?spawnSync('python',['-c',certificateProgram,temp],generationOptions)
  :spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',path.join(temp,'key.pem'),'-out',path.join(temp,'cert.pem'),'-subj','/CN=Controlled outbound TLS fixture','-addext',`subjectAltName=DNS:${hostname}`,'-addext','basicConstraints=critical,CA:TRUE'],generationOptions);
 assert.equal(generated.status,0,'Synthetic certificate creation failed');
 const cert=fs.readFileSync(path.join(temp,'cert.pem'));
 server=https.createServer({key:fs.readFileSync(path.join(temp,'key.pem')),cert},(req,res)=>{
  received++;peerIdentity=req.socket.servername===hostname&&req.headers.host===`${hostname}:${port}`;
  req.resume();
  if(req.url==='/stall')return;
  if(req.url==='/redirect'){res.writeHead(302,{location:'https://unapproved.example.invalid/'});res.flushHeaders();return;}
  if(req.url==='/short'){res.writeHead(200,{'content-length':'200'});res.write('short');setTimeout(()=>res.destroy(),10);return;}
  if(req.url==='/empty'){res.writeHead(204);res.end();return;}
  if(req.url==='/declared'){res.writeHead(200,{'content-length':'65'});res.end(Buffer.alloc(65));return;}
  if(req.url==='/chunked'){res.writeHead(200);res.write(Buffer.alloc(32));res.end(Buffer.alloc(33));return;}
  if(req.url==='/drip'){
   res.writeHead(200);res.flushHeaders();const timer=setInterval(()=>res.write('x'),15);
   res.once('close',()=>clearInterval(timer));return;
  }
  res.writeHead(200,{'content-type':'application/octet-stream'});res.end(Buffer.alloc(64,71));
 });
 server.on('tlsClientError',()=>undefined);
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;
 agent=new https.Agent({ca:cert,keepAlive:false});untrusted=new https.Agent({keepAlive:false});
 const fixture=(lookup,trust=agent)=>{
  let dnsCalls=0,dials=0,pinned;
  const remote=loader({
   'dns/promises':{lookup:async (...args)=>{dnsCalls++;return lookup(...args);}},
   http:{request(){throw Error('UNEXPECTED_HTTP_TRANSPORT');}},
   https:{request(url,options,callback){
    assert.ok([hostname,'wrong.example.test'].includes(url.hostname),'Only synthetic hostnames may reach transport');
    assert.equal(Number(url.port),port);assert.notEqual(options.rejectUnauthorized,false);
    options.lookup(url.hostname,{},(error,address,family)=>{assert.equal(error,null);pinned={address,family};});
    assert.ok(['8.8.8.8','1.1.1.1'].includes(pinned.address));assert.equal(pinned.family,4);
    dials++;
    // Preserve URL, SNI and Host identity. Only the TCP destination is translated
    // to the owned fixture after recording/asserting the helper's validated pin.
    return https.request(url,{...options,agent:trust,family:4,lookup:(_h,_o,cb)=>cb(null,'127.0.0.1',4)},callback);
   }},
  })('apps/api/src/lib/remote-fetch.ts');
  return {remote,counts:()=>({dnsCalls,dials,pinned})};
 };
 const publicDns=async()=>[{address:'8.8.8.8',family:4}];
 const url=(route='/ok',host=hostname)=>`https://${host}:${port}${route}`;
 const call=(f,method,route,options={})=>method==='GET'?f.remote.safeFetchBuffer(url(route),options):f.remote.safePostJson(url(route),'synthetic-only',{'X-Fixture':'owned'},options);
 const happy=fixture(publicDns);const good=await call(happy,'GET','/ok');assert.deepEqual(good.buffer,Buffer.alloc(64,71));assert.ok(peerIdentity);
 assert.equal((await call(happy,'GET','/empty')).response.status,204);
 assert.deepEqual((await call(happy,'POST','/ok')).body,Buffer.alloc(64,71));
 passed('Actual TLS preserves trusted hostname/SNI/Host, exact bytes, successful POST and empty responses');
 const before=received;
 await assert.rejects(fixture(publicDns,untrusted).remote.safeFetchBuffer(url()),/self-signed|certificate/i);
 await assert.rejects(happy.remote.safePostJson(url('/ok','wrong.example.test'),'synthetic-only',{}),/altname|hostname|certificate/i);
 assert.equal(received,before);
 passed('Untrusted certificates and trusted certificates for the wrong hostname fail before application bytes are handled');
 let answers=0;const rebinding=fixture(async()=>[{address:++answers===1?'8.8.8.8':'127.0.0.1',family:4}]);
 await call(rebinding,'GET','/ok');assert.equal(answers,1);assert.equal(rebinding.counts().dials,1);assert.equal(rebinding.counts().pinned.address,'8.8.8.8');
 passed('Validated DNS pin is supplied to native transport without a second application DNS resolution');
 let blocked=0;
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fe80::1']){
  const f=fixture(async()=>[{address,family:address.includes(':')?6:4}]);
  await assert.rejects(f.remote.safeFetchBuffer(url()),/REMOTE_HOST_NOT_ALLOWED/);assert.equal(f.counts().dials,0);blocked++;
 }
 const mixed=fixture(async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]);
 await assert.rejects(mixed.remote.safeFetchBuffer(url()),/REMOTE_HOST_NOT_ALLOWED/);assert.equal(mixed.counts().dials,0);
 for(const destination of ['https://127.1/','https://2130706433/','https://0x7f000001/','https://localhost./','https://sub.localhost/','https://u:p@controlled.example.test/','http://controlled.example.test/','file:///fixture']){
  const f=fixture(publicDns);await assert.rejects(f.remote.safeFetchBuffer(destination),/REMOTE_(HOST_NOT_ALLOWED|URL_CREDENTIALS_NOT_ALLOWED|URL_PROTOCOL_NOT_ALLOWED)/);assert.equal(f.counts().dials,0);blocked++;
 }
 passed(`Private/mixed DNS and ${blocked} direct or encoded unsafe destinations are refused before a socket opens`);
 for(const method of ['GET','POST']){
  const redirected=fixture(publicDns);await assert.rejects(call(redirected,method,'/redirect',{timeoutMs:1000}),/REMOTE_REDIRECT_NOT_ALLOWED/);
  assert.equal(redirected.counts().dnsCalls,1);assert.equal(redirected.counts().dials,1);
 }
 passed('GET and POST redirects are rejected without resolving or connecting to their destination');
 for(const method of ['GET','POST'])for(const route of ['/declared','/chunked'])await assert.rejects(call(fixture(publicDns),method,route,{maxBytes:64,timeoutMs:1000}),/REMOTE_RESPONSE_TOO_LARGE/);
 for(const method of ['GET','POST'])await call(fixture(publicDns),method,'/ok',{maxBytes:64});
 passed('Actual declared and chunked byte excess is rejected for GET/POST; exact-boundary bodies work');
 for(const method of ['GET','POST']){
  await assert.rejects(call(fixture(publicDns),method,'/short',{timeoutMs:1000}),/aborted|reset|closed|socket/i);
  for(const route of ['/stall','/drip']){
   const begin=Date.now();await assert.rejects(call(fixture(publicDns),method,route,{timeoutMs:150}),/REMOTE_FETCH_TIMEOUT/);assert.ok(Date.now()-begin<1500);
  }
 }
 passed('Premature responses fail; native TLS GET/POST absent headers and drip bodies cannot extend the total deadline');
 const late=fixture(async()=>{await new Promise(resolve=>setTimeout(resolve,80));return publicDns();});
 await assert.rejects(call(late,'GET','/ok',{timeoutMs:20}),/REMOTE_FETCH_TIMEOUT/);
 await new Promise(resolve=>setTimeout(resolve,100));assert.equal(late.counts().dials,0);
 passed('DNS finishing after the total deadline cannot start a late native TLS connection');
 report.passed=true;
}catch(error){report.failure=String(error.message);process.exitCode=1;}
finally{
 agent?.destroy();untrusted?.destroy();for(const socket of sockets)socket.destroy();
 if(server)await new Promise(resolve=>server.close(()=>resolve()));
 for(const name of ['cert.pem','key.pem']){const file=path.join(temp,name);if(fs.existsSync(file))fs.unlinkSync(file);}
 fs.rmdirSync(temp);
 report.temporaryCertificateFilesRemoved=!fs.existsSync(temp);
 report.sourceSha256=Object.fromEntries(['apps/api/src/lib/remote-fetch.ts','apps/api/src/lib/network-address.ts','scripts/verify-outbound-tls.mjs','scripts/test-security-boundaries.cjs'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
 report.recordedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,checks:checks.length,evidence:path.relative(root,path.join(out,'report.json')),failure:report.failure}));
}
