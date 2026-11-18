import { PrismaClient } from '@prisma/client';
import { createHash,randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NEON_STAGING, normalizeNeonStagingUrl } from '../lib/neon-staging';
import { verifyNeonRuntimeAccess } from './verify-neon-runtime-access';
import { inspectNeonMigrationHistory } from '../lib/neon-migration-history';

// Only the fixed, owned staging database is accepted. No dotenv, URL arguments,
// raw provider errors, reset/db-push, or application startup in this operator.
const apiRoot=path.resolve(__dirname,'../..');
const migrationsRoot=path.join(apiRoot,'prisma/migrations');
const snapshot=()=>fs.readdirSync(migrationsRoot).filter(name=>/^\d{14}_/.test(name)).sort().map(name=>{
  const bytes=fs.readFileSync(path.join(migrationsRoot,name,'migration.sql'));
  return {name,sha256:createHash('sha256').update(bytes).digest('hex')};
});
let phase='input';
const requireIdentity=async(client:PrismaClient,role:string=NEON_STAGING.migrationRole)=>{
  const rows=await client.$queryRaw<Array<{db:string;role:string}>>`SELECT current_database() AS db,current_user AS role`;
  if(rows.length!==1||rows[0].db!==NEON_STAGING.database||rows[0].role!==role)throw new Error('IDENTITY_MISMATCH');
};
const verifyMigrations=async(client:PrismaClient)=>{
  const expected=snapshot();
  const actual=await client.$queryRaw<Array<{migration_name:string;checksum:string;finished:boolean;rolled_back:boolean}>>`
    SELECT migration_name,checksum,finished_at IS NOT NULL AS finished,rolled_back_at IS NOT NULL AS rolled_back FROM public._prisma_migrations ORDER BY migration_name`;
  if(actual.length!==expected.length||actual.some((row,i)=>!row.finished||row.rolled_back||row.migration_name!==expected[i].name||row.checksum!==expected[i].sha256))throw new Error('MIGRATION_HISTORY_MISMATCH');
  return expected;
};

const provision=async(admin:PrismaClient,runtimeUrl:string)=>{
  phase='migration-history';
  await requireIdentity(admin);await verifyMigrations(admin);
  const runtime=new PrismaClient({datasources:{db:{url:runtimeUrl}},log:[]});
  const policyPath=path.resolve(apiRoot,'../../deploy/staging/neon-runtime-grants.sql');
  const policy=fs.readFileSync(policyPath,'utf8');
  try{
    const exists=await admin.$queryRaw<Array<{exists:boolean}>>`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${NEON_STAGING.runtimeRole})`;
    // Never silently replace a saved or provider password on a retry.
    if(exists[0].exists)await requireIdentity(runtime,NEON_STAGING.runtimeRole);
    const password=decodeURIComponent(new URL(runtimeUrl).password);
    if(!/^[a-f0-9]{64}$/.test(password))throw new Error('GENERATED_RUNTIME_PASSWORD_REQUIRED');
    phase='runtime-grants';
    await admin.$transaction(async tx=>{
      if(!exists[0].exists){
        // Fixed role plus validated random hex literal: PostgreSQL role DDL has
        // no parameter placeholders. No query logging or raw errors are emitted.
        await tx.$executeRawUnsafe(`CREATE ROLE drapixai_staging_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
      }
      for(const statement of policy.split('-- statement --').map(s=>s.trim()).filter(Boolean))await tx.$executeRawUnsafe(statement);
    },{timeout:60_000,maxWait:15_000});
    phase='runtime-permission-probe';
    const access=await verifyNeonRuntimeAccess(runtime);
    const connections=await verifyRejectedConnections(runtimeUrl);
    return {runtimeRole:NEON_STAGING.runtimeRole,roleCreated:!exists[0].exists,policySha256:createHash('sha256').update(policy).digest('hex'),...access,...connections};
  }finally{await runtime.$disconnect();}
};

const verifyRejectedConnections=async(runtimeUrl:string)=>{
  // Exactly two negative connection attempts against the same owned staging
  // endpoint: one random wrong password; one forbidden legacy database. No SQL.
  phase='negative-connection-probes';
  const attempts=[{kind:'wrong-password',code:'P1000'},{kind:'legacy-database',code:'P1010'}];
  for(const attempt of attempts){
    phase=`negative-${attempt.kind}`;
    const target=new URL(normalizeNeonStagingUrl(runtimeUrl,'runtime'));
    if(attempt.kind==='wrong-password')target.password=randomBytes(32).toString('hex');
    else {
      // PgBouncer may obscure a database CONNECT denial as a pool timeout.
      // Test this same branch's exact direct endpoint for the SQL-auth verdict.
      target.pathname='/neondb';target.hostname=NEON_STAGING.host;target.searchParams.delete('pgbouncer');
    }
    target.searchParams.set('connect_timeout','5');target.searchParams.set('pool_timeout','5');
    const denied=new PrismaClient({datasources:{db:{url:target.toString()}},log:[]});
    let code:unknown;
    try{
      await denied.$connect();
      // Exercise a real backend request rather than trusting pool initialization.
      await denied.$queryRaw`SELECT 1`;
    }catch(error){
      const value=error as {errorCode?:unknown;code?:unknown;message?:unknown};code=value.errorCode||value.code;
      // Native Prisma sometimes wraps this FATAL without a P-code. Classify
      // that exact permission verdict in memory; never emit provider messages.
      if(attempt.kind==='legacy-database'&&typeof value.message==='string'&&/permission denied for database/i.test(value.message))code='P1010';
    }
    finally{await denied.$disconnect();}
    if(code!==attempt.code)throw Object.assign(new Error('NEGATIVE_CONNECTION_EXPECTATION_FAILED'),{code});
  }
  return {wrongPasswordRejected:true,legacyDatabaseDirectConnectionRejected:true,negativeConnectionAttempts:2};
};

const main=async()=>{
  let text='';for await(const chunk of process.stdin){text+=chunk.toString();if(Buffer.byteLength(text)>16_384)throw new Error('INPUT_INVALID');}
  const input=JSON.parse(text) as {url?:unknown;action?:unknown;runtimeUrl?:unknown};text='';
  if(!['Plan','Migrate','ProvisionRuntime','VerifyRuntime'].includes(String(input.action)))throw new Error('ACTION_INVALID');
  const url=normalizeNeonStagingUrl(input.url);input.url=undefined;
  if(input.action==='Migrate'){
    // The old Windows shortcut bypassed the canonical clean-release, backup
    // and ledger preflight workflow. Keep it closed before constructing a DB
    // client; use deploy/scripts/migrate-with-evidence.sh on the approved host.
    phase='reviewed-backup-release-workflow-required';
    throw new Error('USE_MIGRATE_WITH_EVIDENCE');
  }
  const runtimeUrl=['Plan','Migrate'].includes(String(input.action))?undefined:normalizeNeonStagingUrl(input.runtimeUrl,'runtime');input.runtimeUrl=undefined;
  const admin=new PrismaClient({datasources:{db:{url}},log:[]});
  try{
    let result:unknown;
    if(input.action==='Plan'){
      phase='plan';await requireIdentity(admin);
      const migrationPlan=inspectNeonMigrationHistory(url);
      const databases=await admin.$queryRaw<Array<{database:string;owner:string;template:boolean;allows_connections:boolean;public_connect:boolean}>>`
        SELECT datname AS database,pg_get_userbyid(datdba) AS owner,datistemplate AS template,datallowconn AS allows_connections,
          EXISTS(SELECT 1 FROM aclexplode(COALESCE(datacl,acldefault('d',datdba))) WHERE grantee=0 AND privilege_type='CONNECT') AS public_connect
        FROM pg_database WHERE datallowconn ORDER BY datname`;
      const roles=await admin.$queryRaw<Array<{exists:boolean}>>`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${NEON_STAGING.runtimeRole})`;
      result={readOnly:true,...migrationPlan,databases,runtimeRoleExists:roles[0].exists};
    }
    else if(input.action==='ProvisionRuntime')result=await provision(admin,runtimeUrl!);
    else {
      await requireIdentity(admin);await verifyMigrations(admin);
      const runtime=new PrismaClient({datasources:{db:{url:runtimeUrl!}},log:[]});
      try{result={...await verifyNeonRuntimeAccess(runtime),...await verifyRejectedConnections(runtimeUrl!)};}finally{await runtime.$disconnect();}
    }
    console.log(JSON.stringify({passed:true,action:input.action,branchId:NEON_STAGING.branchId,database:NEON_STAGING.database,...result as object,applicationConnected:false,productionChanged:false}));
  }finally{await admin.$disconnect();}
};
if(require.main===module)main().catch((error:unknown)=>{
  const value=error as {code?:unknown;meta?:{code?:unknown}};
  const code=typeof value?.code==='string'&&/^P\d{4}$/.test(value.code)?value.code:'REDACTED';
  const sqlstate=typeof value?.meta?.code==='string'&&/^[0-9A-Z]{5}$/.test(value.meta.code)?value.meta.code:'REDACTED';
  console.error(`NEON_STAGING_OPERATOR_FAILED phase=${phase} code=${code} sqlstate=${sqlstate}`);process.exitCode=1;
});
