import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Read-only fixed public-DNS inventory. No provider API key, inbox access,
// email transmission, DNS update, third-party scanner or dependency is used.
const queries=[
  ['rootSpf','TXT','drapixai.com'],['rootMx','MX','drapixai.com'],
  ['rootDmarc','TXT','_dmarc.drapixai.com'],
  ['mailDmarc','TXT','_dmarc.mail.drapixai.com'],
  ['zohoDkim','TXT','zmail._domainkey.drapixai.com'],
  ['resendDkim','TXT','resend._domainkey.mail.drapixai.com'],
  ['resendReturnPathSpf','TXT','send.mail.drapixai.com'],
  ['resendReturnPathMx','MX','send.mail.drapixai.com'],
  ['marketingDkim','TXT','resend._domainkey.marketing.drapixai.com'],
  ['salesDkim','TXT','resend._domainkey.sales.drapixai.com'],
  ['marketingDmarc','TXT','_dmarc.marketing.drapixai.com'],
  ['salesDmarc','TXT','_dmarc.sales.drapixai.com'],
  ['marketingReturnPathSpf','TXT','send.marketing.drapixai.com'],
  ['salesReturnPathSpf','TXT','send.sales.drapixai.com'],
  ['mtaSts','TXT','_mta-sts.drapixai.com'],
  ['tlsReports','TXT','_smtp._tls.drapixai.com'],
];
const tags=text=>Object.fromEntries(text.split(';').map(p=>p.trim()).filter(Boolean).map(p=>{const i=p.indexOf('=');return [p.slice(0,i).trim().toLowerCase(),p.slice(i+1).trim()];}));
const safeError=error=>['ENODATA','ENOTFOUND','ETIMEOUT','ESERVFAIL','EREFUSED'].includes(error.code)?error.code:'DNS_LOOKUP_FAILED';
const main=async()=>{
  const evidenceRoot=path.resolve('runtime/launch-evidence');
  const output=path.resolve(process.argv[2]||path.join(evidenceRoot,`email-dns-security-${new Date().toISOString().replace(/[:.]/g,'-')}.json`));
  if(!output.startsWith(evidenceRoot+path.sep))throw new Error('EVIDENCE_OUTPUT_OUTSIDE_WORKSPACE');
  const resolver=new dns.Resolver({timeout:5000,tries:1});
  const result={observedAt:new Date().toISOString(),domain:'drapixai.com',messagesSent:0,dnsChanged:false,records:{}};
  await Promise.all(queries.map(async([key,type,name])=>{
    try{
      if(type==='MX'){
        result.records[key]={name,type,status:'found',records:await resolver.resolveMx(name)};return;
      }
      const strings=(await resolver.resolveTxt(name)).map(parts=>parts.join(''));
      if(key.toLowerCase().includes('dkim')){
        const values=strings.filter(value=>/(?:^|;)\s*p=/i.test(value));
        result.records[key]={name,type,status:values.length?'found':'no-key',keys:values.map(value=>{
          const item=tags(value);if(!item.p)return {revoked:true};
          const key=crypto.createPublicKey({key:Buffer.from(item.p,'base64'),format:'der',type:'spki'});
          return {algorithm:key.asymmetricKeyType,bits:key.asymmetricKeyDetails?.modulusLength,publicKeySha256:crypto.createHash('sha256').update(item.p).digest('hex'),revoked:!item.p};
        })};
      }else if(key.toLowerCase().includes('dmarc')){
        const values=strings.filter(value=>/^v=DMARC1(?:;|$)/i.test(value));
        result.records[key]={name,type,status:values.length?'found':'no-policy',policyCount:values.length,policies:values.map(value=>{
          const item=tags(value);return {policy:item.p,subdomainPolicy:item.sp||'inherits-p',percentage:item.pct||'100',dkimAlignment:item.adkim||'r',spfAlignment:item.aspf||'r',aggregateReportingConfigured:Boolean(item.rua),failureReportingConfigured:Boolean(item.ruf)};
        })};
      }else if(key.toLowerCase().includes('spf')){
        const records=strings.filter(value=>/^v=spf1(?:\s|$)/i.test(value));
        result.records[key]={name,type,status:records.length?'found':'no-policy',policyCount:records.length,records};
      }else{
        // Reporting addresses/verification tokens need not be copied to evidence.
        result.records[key]={name,type,status:'found',recordCount:strings.length};
      }
    }catch(error){result.records[key]={name,type,status:safeError(error)};}
  }));
  const root=result.records.rootDmarc;
  result.effectiveTransactionalDmarc=result.records.mailDmarc.policyCount===1?'explicit mail subdomain policy':
    root.policyCount===1?'inherits organizational-domain subdomain/policy setting':'unresolved';
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result));
};
main().catch(()=>{console.error('EMAIL_DNS_AUDIT_FAILED');process.exitCode=1;});
