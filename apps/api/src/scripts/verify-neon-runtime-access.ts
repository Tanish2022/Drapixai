import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { NEON_STAGING } from '../lib/neon-staging';
import { CURRENT_TERMS, hasCurrentAccountTerms, recordAccountTermsAcceptance } from '../lib/account-terms';
import { generateApiKey, hashApiKey, resolveActiveApiKey } from '../lib/api-key-auth';

// Called only after the operator pins both private connection URLs. Uses the
// actual pooled runtime login; all synthetic row writes are rolled back.
export const verifyNeonRuntimeAccess=async(runtime:PrismaClient)=>{
  const identity=await runtime.$queryRaw<Array<{db:string;role:string}>>`SELECT current_database() AS db,current_user AS role`;
  assert.equal(identity[0].db,NEON_STAGING.database);assert.equal(identity[0].role,NEON_STAGING.runtimeRole);
  const forbidden=await runtime.$queryRaw<Array<{bad:boolean}>>`
    SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls))
      OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=current_user::regrole)
      OR EXISTS(SELECT 1 FROM pg_class WHERE relowner=current_user::regrole)
      OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=current_user::regrole)
      OR EXISTS(SELECT 1 FROM pg_database WHERE datdba=current_user::regrole)
      OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner=current_user::regrole)
      OR has_schema_privilege(current_user,'public','CREATE')
      OR has_database_privilege(current_user,current_database(),'CREATE')
      OR has_database_privilege(current_user,current_database(),'TEMP')
      OR has_database_privilege(current_user,'neondb','CONNECT') AS bad`;
  assert.equal(forbidden[0].bad,false);
  const futureGrants=await runtime.$queryRaw<Array<{broad:boolean}>>`
    SELECT EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole='neondb_owner'::regrole AND d.defaclnamespace IN (0,'public'::regnamespace)
        AND d.defaclobjtype IN ('r','S','f') AND a.grantee IN (0,current_user::regrole::oid)) AS broad`;
  assert.equal(futureGrants[0].broad,false);
  const before={users:await runtime.user.count(),terms:await runtime.termsDocument.count(),acceptances:await runtime.accountTermsAcceptance.count(),audits:await runtime.securityAuditLog.count(),keys:await runtime.apiKey.count()};
  const token=randomUUID();const rollback=new Error('SYNTHETIC_PROBE_ROLLBACK');
  let deniedOperations=0;
  try{
    await runtime.$transaction(async tx=>{
      const a=await tx.user.create({data:{email:`stage-a-${token}@example.invalid`,passwordHash:'synthetic-not-a-login'}});
      const b=await tx.user.create({data:{email:`stage-b-${token}@example.invalid`,passwordHash:'synthetic-not-a-login'}});
      await tx.user.update({where:{id:b.id},data:{companyName:'Synthetic staging probe'}});
      assert.equal((await tx.user.findUniqueOrThrow({where:{id:b.id}})).companyName,'Synthetic staging probe');
      await tx.user.delete({where:{id:b.id}});
      const key=generateApiKey();
      await tx.apiKey.create({data:{userId:a.id,keyHash:hashApiKey(key),domainWhitelist:'example.invalid',kind:'dashboard',scopes:'dashboard'}});
      const client=tx as unknown as PrismaClient;
      assert.equal(await resolveActiveApiKey(client,key),null);
      const input={accepted:true,version:CURRENT_TERMS.version,documentHash:CURRENT_TERMS.documentHash};
      const acceptance=await recordAccountTermsAcceptance(tx,a.id,input,'password_signup');
      assert.equal((await recordAccountTermsAcceptance(tx,a.id,input,'authenticated_account')).id,acceptance.id);
      assert.equal(await hasCurrentAccountTerms(tx,a.id),true);
      assert.equal(await hasCurrentAccountTerms(tx,b.id),false);
      assert.equal((await resolveActiveApiKey(client,key))?.userId,a.id);
      await tx.apiKey.updateMany({where:{userId:a.id},data:{revokedAt:new Date()}});
      assert.equal(await resolveActiveApiKey(client,key),null);
      await tx.securityAuditLog.create({data:{actorRole:'staging-runtime-probe',action:'synthetic-rollback-only',previousHash:'GENESIS',entryHash:token}});
      const denied=[
        'UPDATE public."TermsDocument" SET "content"="content"',
        'DELETE FROM public."TermsDocument"', 'TRUNCATE public."TermsDocument"',
        'ALTER TABLE public."TermsDocument" DISABLE TRIGGER ALL', 'DROP TABLE public."TermsDocument"',
        'UPDATE public."AccountTermsAcceptance" SET "flow"="flow"',
        'DELETE FROM public."AccountTermsAcceptance"','TRUNCATE public."AccountTermsAcceptance"',
        'ALTER TABLE public."AccountTermsAcceptance" DISABLE TRIGGER ALL','DROP TABLE public."AccountTermsAcceptance"',
        'UPDATE public."SecurityAuditLog" SET "outcome"=\'tampered\'',
        'DELETE FROM public."SecurityAuditLog"','TRUNCATE public."SecurityAuditLog"',
        'ALTER TABLE public."SecurityAuditLog" DISABLE TRIGGER ALL','DROP TABLE public."SecurityAuditLog"',
        'TRUNCATE public."User" CASCADE',
        'CREATE TABLE public.drapixai_forbidden_probe (id integer)',
        'CREATE ROLE drapixai_forbidden_role',
        'SELECT * FROM public._prisma_migrations',
        'UPDATE public._prisma_migrations SET checksum=checksum',
        'ALTER ROLE drapixai_staging_api CREATEROLE',
      ];
      // PostgreSQL catches each permission rejection in a subtransaction; any
      // unexpected success raises and rolls back the complete synthetic probe.
      for(const statement of denied){
        const literal=statement.replace(/'/g,"''");
        await tx.$executeRawUnsafe(`DO $$ BEGIN BEGIN EXECUTE '${literal}'; RAISE EXCEPTION 'Forbidden operation succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;`);
        deniedOperations++;
      }
      throw rollback;
    },{timeout:60_000,maxWait:15_000});
  }catch(error){if(error!==rollback)throw error;}
  const after={users:await runtime.user.count(),terms:await runtime.termsDocument.count(),acceptances:await runtime.accountTermsAcceptance.count(),audits:await runtime.securityAuditLog.count(),keys:await runtime.apiKey.count()};
  assert.deepEqual(after,before);
  const systemDatabases=await runtime.$queryRaw<Array<{database:string;connect_allowed:boolean}>>`
    SELECT datname AS database,has_database_privilege(current_user,oid,'CONNECT') AS connect_allowed FROM pg_database WHERE datname IN ('postgres','template1') ORDER BY datname`;
  return {runtimeAuthentication:true,pooledConnection:true,administrationMembershipOwnership:false,ddlAllowedInApplicationDatabase:false,legacyApplicationDatabaseConnectAllowed:false,
    providerOwnedDatabaseConnect:systemDatabases,
    applicationDml:true,auditAppend:true,actualTermsHelpers:true,accountBoundAssent:true,actualApiKeyAssentAndRevocationChecks:true,
    deniedOperations,futureTableAccessRequiresExplicitGrant:true,futureFunctionExecuteRequiresExplicitGrant:true,syntheticRowsRolledBack:true,sequenceGapsPossible:true,httpTenantIsolationVerified:false};
};
