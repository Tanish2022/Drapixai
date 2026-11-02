import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readMigrationFiles, inspectMigrationHistory } from '../deploy/scripts/verify-migration-history.mjs';
import { createRequire } from 'node:module';

assert.equal(process.argv.length, 2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = crypto.randomBytes(8).toString('hex'), name = `drapixai-db-release-${id}`, label = `drapixai.database-release=${id}`;
const out = path.join(root, 'runtime/launch-evidence', `database-release-${id}`); fs.mkdirSync(out, { recursive: true });
const password = crypto.randomBytes(32).toString('hex'), runtimePassword = crypto.randomBytes(32).toString('hex');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|comspec|temp|tmp|localappdata|appdata|userprofile|programfiles|programdata|pathext|docker_config)$/i.test(key)));
const redact = s => String(s || '').replaceAll(password, '[redacted]').replaceAll(runtimePassword, '[redacted]');
const run = (exe, args, options = {}) => spawnSync(exe, args, { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 2*1024*1024, ...options });
const docker = (args, options) => run('docker', args, options);
const must = r => { assert.equal(r.status, 0, redact(r.error?.message || r.stderr || r.stdout)); return r.stdout.trim(); };
const sql = (text, role = 'neondb_owner', database = 'drapixai_staging') => must(docker(['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-U', role, '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: text }));
const policy = (file, role = 'neondb_owner') => sql(fs.readFileSync(path.join(root, file), 'utf8'), role);
const local = readMigrationFiles(); assert.equal(local.length, 15); // Intentional reviewed release boundary, update after review.
const report = { passed: false, scope: 'Owned disposable PostgreSQL only; actual Prisma 12-to-15 migration, seeded data, backup/restore and both runtime policies; no live credentials/providers/GPU', checks: [], sourceSha256: {} };
const pass = text => report.checks.push(text);
let prisma;
try {
  const image = 'postgres@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4';
  const metadata = JSON.parse(must(docker(['image', 'inspect', image])))[0]; report.image = { reference: image, id: metadata.Id };
  must(docker(['run', '--pull=never', '-d', '--name', name, '--label', label, '--memory', '768m', '--cpus', '2', '--pids-limit', '128', '--tmpfs', '/var/lib/postgresql/data:rw,size=384m', '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=drapixai_staging', metadata.Id], { env: { ...env, POSTGRES_PASSWORD: password } }));
  let ready = false; for (let n=0;n<60;n++) { if(docker(['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'drapixai_staging']).status===0){ready=true;break;} await delay(250); } assert.ok(ready);
  sql(`CREATE ROLE neondb_owner LOGIN CREATEROLE NOINHERIT PASSWORD '${password}'; CREATE ROLE drapixai_staging LOGIN SUPERUSER; CREATE ROLE drapixai_staging_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}'; ALTER DATABASE drapixai_staging OWNER TO neondb_owner; CREATE DATABASE neondb OWNER neondb_owner;`, 'postgres');
  const address = must(docker(['port', name, '5432/tcp'])); assert.match(address, /^127\.0\.0\.1:\d+$/);
  const url = `postgresql://neondb_owner:${password}@${address}/drapixai_staging`;
  const cliEnv = { ...env, DATABASE_URL: url, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' };
  const cli = path.join(root, 'apps/api/node_modules/prisma/build/index.js');
  const firstSchema = path.join(out, 'prefix/prisma/schema.prisma'); fs.mkdirSync(path.dirname(firstSchema), { recursive: true });
  fs.copyFileSync(path.join(root, 'apps/api/prisma/schema.prisma'), firstSchema);
  fs.mkdirSync(path.join(path.dirname(firstSchema), 'migrations'), { recursive: true });
  fs.copyFileSync(path.join(root, 'apps/api/prisma/migrations/migration_lock.toml'), path.join(path.dirname(firstSchema), 'migrations/migration_lock.toml'));
  // A distinct schema directory controls which immutable SQL files Prisma sees.
  for (const row of local.slice(0,12)) { const dest=path.join(path.dirname(firstSchema),'migrations',row.name); fs.mkdirSync(dest,{recursive:true}); fs.copyFileSync(path.join(root,'apps/api/prisma/migrations',row.name,'migration.sql'),path.join(dest,'migration.sql')); }
  const initial = run(process.execPath, [cli,'migrate','deploy','--schema',firstSchema], { env:cliEnv, timeout:120_000 }); must(initial); fs.writeFileSync(path.join(out,'initial-deploy.log'),redact(initial.stdout));
  const require=createRequire(path.join(root,'apps/api/package.json')); const {PrismaClient}=require('@prisma/client'); prisma=new PrismaClient({datasources:{db:{url}},log:[]});
  const pending=await inspectMigrationHistory(prisma); assert.equal(pending.appliedCount,12); assert.equal(pending.pendingCount,3); pass('Canonical read-only history accepts the matched 12-migration prefix and lists exactly three pending migrations');
  sql(`INSERT INTO "User" (email,"passwordHash","companyName") VALUES ('fixture@invalid.test','not-a-login','Synthetic'); INSERT INTO "ShopifyInstallation" ("shopDomain","encryptedAccessToken",scopes,status,"updatedAt") VALUES ('active.myshopify.com','synthetic-token','read_products,write_app_proxy','active',CURRENT_TIMESTAMP),('gone.myshopify.com','synthetic-token','read_products,write_app_proxy','uninstalled',CURRENT_TIMESTAMP); INSERT INTO "CatalogProduct" ("userId","productId",source,"preparationStatus","updatedAt") SELECT id,'legacy-shopify','shopify:active.myshopify.com','processing',CURRENT_TIMESTAMP FROM "User"; INSERT INTO "CatalogProduct" ("userId","productId",source,"preparationStatus","updatedAt") SELECT id,'other-source','manual','processing',CURRENT_TIMESTAMP FROM "User";`);
  const seed=sql(`SELECT json_agg(t ORDER BY id) FROM "User" t; SELECT string_agg("productId"||':'||"preparationStatus",',' ORDER BY "productId") FROM "CatalogProduct";`);
  must(docker(['exec',name,'pg_dump','-U','neondb_owner','-d','drapixai_staging','--format=custom','--no-owner','--no-acl','--file=/tmp/prefix.dump']));
  const dumpHash=must(docker(['exec',name,'sha256sum','/tmp/prefix.dump'])).split(' ')[0]; assert.match(dumpHash,/^[a-f0-9]{64}$/); must(docker(['exec',name,'pg_restore','--list','/tmp/prefix.dump'])); pass('Seeded pre-change schema/data backed up inside the disposable container with a verified custom archive and digest');
  const deploy=run(process.execPath,[cli,'migrate','deploy','--schema','apps/api/prisma/schema.prisma'],{env:cliEnv,timeout:120_000}); must(deploy); fs.writeFileSync(path.join(out,'pending-deploy.log'),redact(deploy.stdout));
  assert.equal((await inspectMigrationHistory(prisma)).pendingCount,0);
  assert.equal(sql(`SELECT count(*) FROM "ShopifyInstallation" WHERE "encryptedRefreshToken" IS NULL AND "accessTokenExpiresAt" IS NULL AND "refreshTokenExpiresAt" IS NULL;`),'2');
  assert.equal(sql(`SELECT "catalogRequestedVersion"||':'||("catalogNextAttemptAt" IS NOT NULL)::text FROM "ShopifyInstallation" WHERE status='active';`),'1:true');
  assert.equal(sql(`SELECT "catalogRequestedVersion"||':'||("catalogNextAttemptAt" IS NULL)::text FROM "ShopifyInstallation" WHERE status='uninstalled';`),'0:true');
  assert.equal(sql(`SELECT "preparationStatus"||':'||"preparationError" FROM "CatalogProduct" WHERE "productId"='legacy-shopify';`),'reconciliation_required:SHOPIFY_LEGACY_PREPARATION_RECONCILIATION_REQUIRED');
  assert.equal(sql(`SELECT "preparationStatus" FROM "CatalogProduct" WHERE "productId"='other-source';`),'processing');
  pass('Actual Prisma 12-to-15 deploy preserves users, requires fresh legacy Shopify authorization, schedules active sync and fences only legacy Shopify in-flight preparation');
  must(run(process.execPath,[cli,'migrate','diff','--from-schema-datasource','apps/api/prisma/schema.prisma','--to-schema-datamodel','apps/api/prisma/schema.prisma','--exit-code'],{env:cliEnv,timeout:120_000})); pass('Actual native Prisma schema diff reports no datamodel drift after all fifteen migrations');
  must(docker(['exec','-i',name,'sh','-c','mkdir -p /run/secrets && cat > /run/secrets/api_database_password'],{input:runtimePassword}));
  const shellPolicy=(file)=>must(docker(['exec','-i','-e','POSTGRES_USER=drapixai_staging','-e','POSTGRES_DB=drapixai_staging',name,'bash'],{input:fs.readFileSync(path.join(root,file),'utf8')}));
  // Deliberately reproduce the exact pre-fix grant primitives with synthetic
  // rows; never import an unsafe production policy into the fixed release.
  sql('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO drapixai_staging_api;');
  const recipient='a'.repeat(64),provider='11111111-1111-4111-8111-111111111111';
  sql(`INSERT INTO "EmailRecipientSuppression" ("recipientHash",reason,priority,"providerEmailId","updatedAt") VALUES ('${recipient}','complaint',2,'${provider}',CURRENT_TIMESTAMP);`);
  assert.equal(sql(`WITH removed AS (DELETE FROM "EmailRecipientSuppression" RETURNING 1) SELECT count(*) FROM removed;`,'drapixai_staging_api'),'1'); pass('Pre-fix Neon provisioning reproduces actual complaint-block deletion under the runtime login in the disposable fixture');
  sql('ALTER DEFAULT PRIVILEGES FOR ROLE drapixai_staging IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO drapixai_staging_api;','drapixai_staging');
  sql('CREATE TABLE public.unknown_before_review (id serial);','drapixai_staging');
  sql('INSERT INTO public.unknown_before_review VALUES (1);','drapixai_staging_api'); pass('Pre-fix generic provisioning reproduces automatic runtime write access to a new unreviewed table');
  shellPolicy('deploy/staging/provision-database-role.sh'); shellPolicy('deploy/staging/provision-database-role.sh');
  const verifyGrantPolicy=(tag)=>{
    const protectedModels = new Set(['SecurityAuditLog','TermsDocument','AccountTermsAcceptance','EmailDeliveryEvent','EmailRecipientSuppression']);
    const ordinaryModels = [...fs.readFileSync(path.join(root,'apps/api/prisma/schema.prisma'),'utf8').matchAll(/^model ([A-Za-z0-9_]+) \{/gm)].map(match=>match[1]).filter(model=>!protectedModels.has(model));
    assert.equal(ordinaryModels.length,26);
    assert.equal(sql("SELECT has_sequence_privilege('drapixai_staging_api','unknown_before_review_id_seq','USAGE,SELECT,UPDATE');"),'f');
    const relations = ordinaryModels.map(model=>`('"${model}"')`).join(',');
    assert.equal(sql(`SELECT bool_and(has_table_privilege('drapixai_staging_api',rel,'SELECT') AND has_table_privilege('drapixai_staging_api',rel,'INSERT') AND has_table_privilege('drapixai_staging_api',rel,'UPDATE') AND has_table_privilege('drapixai_staging_api',rel,'DELETE')) FROM (VALUES ${relations}) AS reviewed(rel);`),'t');
    sql(`INSERT INTO "EmailRecipientSuppression" ("recipientHash",reason,priority,"providerEmailId","updatedAt") VALUES ('${recipient}','complaint',2,'${provider}',CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;`);
    assert.equal(sql(`SELECT has_table_privilege('drapixai_staging_api','"EmailRecipientSuppression"','DELETE') OR has_table_privilege('drapixai_staging_api','"EmailRecipientSuppression"','TRUNCATE') OR has_table_privilege('drapixai_staging_api','"EmailDeliveryEvent"','UPDATE') OR has_table_privilege('drapixai_staging_api','unknown_before_review','SELECT,INSERT,UPDATE,DELETE');`),'f');
    for(const statement of ['DELETE FROM "EmailRecipientSuppression"','TRUNCATE "EmailRecipientSuppression"','UPDATE "EmailDeliveryEvent" SET "eventType"=\'email.sent\'','SELECT * FROM _prisma_migrations','INSERT INTO unknown_before_review VALUES (2)']){
      const denied=docker(['exec','-i',name,'psql','-X','-q','-U','drapixai_staging_api','-d','drapixai_staging','-v','ON_ERROR_STOP=1'],{input:statement}); assert.notEqual(denied.status,0); assert.match(denied.stderr,/permission denied/);
    }
    sql('BEGIN; INSERT INTO "ShopifyTokenLease" ("shopDomain",owner,"expiresAt") VALUES (\'fixture.myshopify.com\',\'fixture\',CURRENT_TIMESTAMP); DELETE FROM "ShopifyTokenLease" WHERE "shopDomain"=\'fixture.myshopify.com\'; INSERT INTO "EmailDeliveryEvent" ("webhookId","providerEmailId","recipientHash","eventType","eventDigest","occurredAt") VALUES (\'msg_grant_probe\',\'11111111-1111-4111-8111-111111111111\',repeat(\'b\',64),\'email.sent\',repeat(\'c\',64),CURRENT_TIMESTAMP); DELETE FROM "EmailDeliveryEvent" WHERE "webhookId"=\'msg_grant_probe\'; ROLLBACK;','drapixai_staging_api');
    pass(tag+' preserves reviewed app/event DML while denying block erasure, event mutation, migration access and unknown-table access');
  };
  verifyGrantPolicy('Repeated generic provisioning');
  policy('deploy/staging/verify-database-role.sql','drapixai_staging'); pass('Existing real SQL verifier still passes application DML, append-only audit/terms and administration/DDL refusal');
  // Separate bootstrap owners coexist only in this combined fixture. Hand the
  // synthetic extra relation to the Neon owner before its owner-scoped policy.
  sql('ALTER TABLE unknown_before_review OWNER TO neondb_owner;','postgres');
  policy('deploy/staging/neon-runtime-grants.sql'); policy('deploy/staging/neon-runtime-grants.sql');
  verifyGrantPolicy('Repeated Neon provisioning');
  for(const role of ['neondb_owner','drapixai_staging']){
    const suffix=role==='neondb_owner'?'neon':'generic'; sql(`CREATE TABLE public.future_${suffix} (id serial); CREATE FUNCTION public.future_${suffix}_fn() RETURNS integer LANGUAGE sql AS 'SELECT 1';`,role);
    assert.equal(sql(`SELECT has_table_privilege('drapixai_staging_api','future_${suffix}','SELECT,INSERT,UPDATE,DELETE') OR has_sequence_privilege('drapixai_staging_api','future_${suffix}_id_seq','USAGE,SELECT,UPDATE') OR has_function_privilege('drapixai_staging_api','future_${suffix}_fn()','EXECUTE');`),'f');
  }
  pass('Both migration-owner and generic-owner future tables, sequences and functions remain inaccessible by default');
  for(const file of ['deploy/staging/neon-shopify-token-grants.proposed.sql','deploy/staging/neon-shopify-preparation-grants.proposed.sql','deploy/staging/neon-email-events-grants.proposed.sql']){policy(file);policy(file);}
  verifyGrantPolicy('All proposed incremental grants'); pass('Incremental staging grants apply repeatably only after the actual reviewed ledger exists');
  const beforeWrong=sql(`SELECT has_table_privilege('drapixai_staging_api','"EmailRecipientSuppression"','DELETE');`);
  const wrong=docker(['exec','-i',name,'psql','-X','-q','-U','neondb_owner','-d','neondb','-v','ON_ERROR_STOP=1'],{input:fs.readFileSync(path.join(root,'deploy/staging/neon-email-events-grants.proposed.sql'),'utf8')}); assert.notEqual(wrong.status,0); assert.equal(sql(`SELECT has_table_privilege('drapixai_staging_api','"EmailRecipientSuppression"','DELETE');`),beforeWrong); pass('Wrong database refuses the email grant transaction without changing staging privileges');
  sql('CREATE DATABASE prefix_restore OWNER neondb_owner;','postgres');
  must(docker(['exec',name,'pg_restore','-U','neondb_owner','-d','prefix_restore','--no-owner','--no-acl','--single-transaction','--exit-on-error','/tmp/prefix.dump']));
  assert.equal(sql(`SELECT json_agg(t ORDER BY id) FROM "User" t; SELECT string_agg("productId"||':'||"preparationStatus",',' ORDER BY "productId") FROM "CatalogProduct";`,'neondb_owner','prefix_restore'),seed);
  assert.equal(sql(`SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;`,'neondb_owner','prefix_restore'),'12'); report.backupSha256=dumpHash; pass('Owned backup restores into a separate database with exact seeded rows and the original twelve-entry migration ledger');
  report.passed=true;
} catch(error){report.failure=redact(error.message);process.exitCode=1;}
finally{
  try{await prisma?.$disconnect();}catch{report.passed=false;process.exitCode=1;}
  const owned=docker(['ps','-aq','--filter',`label=${label}`]);report.ownedFixturesRemoved=owned.status===0;
  if(owned.status===0)for(const cid of owned.stdout.trim().split(/\s+/).filter(Boolean))if(!/^[a-f0-9]{12,64}$/.test(cid)||docker(['rm','-fv',cid]).status!==0)report.ownedFixturesRemoved=false;
  if(!report.ownedFixturesRemoved){report.passed=false;process.exitCode=1;}
  const files=['scripts/verify-database-release-preparation.mjs','apps/api/prisma/schema.prisma','apps/api/src/lib/neon-migration-history.ts','apps/api/src/scripts/manage-neon-staging-database.ts','deploy/staging/neon-runtime-grants.sql','deploy/staging/provision-database-role.sh','deploy/staging/verify-database-role.sql','deploy/staging/neon-shopify-token-grants.proposed.sql','deploy/staging/neon-shopify-preparation-grants.proposed.sql','deploy/staging/neon-email-events-grants.proposed.sql',...local.map(row=>`apps/api/prisma/migrations/${row.name}/migration.sql`)];
  report.sourceSha256=Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')])); report.recordedAt=new Date().toISOString(); fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,ownedFixturesRemoved:report.ownedFixturesRemoved,evidence:path.relative(root,path.join(out,'report.json')),failure:report.failure}));
}
