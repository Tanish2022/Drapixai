import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);if(args.length!==0&&(args.length!==2||args[0]!=='--gitleaks'))throw Error('USAGE: --gitleaks approved-local-binary');
const scanner=args[1]?path.resolve(root,args[1]):'gitleaks',id=crypto.randomBytes(8).toString('hex');
const out=path.join(root,'runtime/launch-evidence',`source-secrets-${id}`),snapshot=path.join(out,'source');fs.mkdirSync(snapshot,{recursive:true});
const listing=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});if(listing.status!==0)throw Error('SOURCE_INVENTORY_FAILED');
const names=[...new Set(listing.stdout.split('\0').filter(Boolean))].sort();const inventory=[];let copied=0;
const extensions=new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','.jsonl','.yml','.yaml','.toml','.md','.txt','.py','.ps1','.sh','.sql','.css','.html','.svg','.ini','.conf','.example']);
const realRoot=fs.realpathSync(root);const canonical=v=>process.platform==='win32'?v.toLowerCase():v;
for(const name of names){
 const source=path.resolve(root,name);let disposition='excluded-nontext';
 try{
  const stat=fs.lstatSync(source);const base=path.basename(name);
  if(!canonical(source).startsWith(canonical(root+path.sep))||stat.isSymbolicLink()||!stat.isFile()||!canonical(fs.realpathSync(source)).startsWith(canonical(realRoot+path.sep)))disposition='excluded-nonregular-or-outside';
  else if(/^\.env(?:\.|$)/i.test(base)&&!/(?:example|template)$/i.test(base)||/\.(?:pem|key|pfx|p12|credential\.xml)$/i.test(base))disposition='excluded-credential-material';
  else if(stat.size>4*1024*1024)disposition='excluded-large';
  else if(extensions.has(path.extname(name).toLowerCase())||/^(?:Dockerfile(?:\..+)?|\.gitignore|\.gitleaksignore|Makefile)$/.test(base)){
   const bytes=fs.readFileSync(source);
   if(bytes.includes(0))disposition='excluded-binary';
   else{const dest=path.resolve(snapshot,name);if(!dest.startsWith(snapshot+path.sep))throw Error('SOURCE_PATH_INVALID');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);disposition='scanned-text';copied++;}
  }
 }catch(error){if(error.message==='SOURCE_PATH_INVALID')throw error;disposition=error.code==='ENOENT'?'deleted-from-working-tree':'unavailable';}
 inventory.push({file:name,disposition});
}
const result=spawnSync(scanner,['dir','.', '--config',path.join(root,'.gitleaks.toml'),'--redact','--no-banner','--no-color','--report-format','json','--report-path',path.join(out,'findings.redacted.json')],{cwd:snapshot,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});
fs.writeFileSync(path.join(out,'scanner.log'),(result.stdout||'')+'\n'+(result.stderr||''));fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify(inventory,null,2)+'\n');
const findings=fs.existsSync(path.join(out,'findings.redacted.json'))?JSON.parse(fs.readFileSync(path.join(out,'findings.redacted.json'),'utf8')):null;
const unavailable=inventory.filter(row=>row.disposition==='unavailable').map(row=>row.file);
const report={recordedAt:new Date().toISOString(),passed:result.status===0&&Array.isArray(findings)&&findings.length===0&&unavailable.length===0,scope:'Prospective tracked and nonignored text snapshot, same relative paths and existing scanner policy; credential stores/media/build/dependency contents excluded',inventoryFiles:names.length,scannedTextFiles:copied,unavailable,findings:Array.isArray(findings)?findings.map(({RuleID,File,StartLine})=>({rule:RuleID,file:File,line:StartLine})):null,exitCode:result.status,policySha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'.gitleaks.toml'))).digest('hex')};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,evidence:path.relative(root,path.join(out,'report.json'))}));if(!report.passed)process.exitCode=1;
