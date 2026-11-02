import assert from 'node:assert/strict';
import { NEON_STAGING, normalizeNeonStagingUrl } from '../lib/neon-staging';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { hasStrictDatabaseTransport } from '../lib/database-transport';

const base=new URL(`postgresql://${NEON_STAGING.migrationRole}:synthetic-not-a-password@${NEON_STAGING.host}/${NEON_STAGING.database}?sslmode=require&channel_binding=require`);
const normalized=new URL(normalizeNeonStagingUrl(base.toString()));
assert.equal(hasStrictDatabaseTransport(normalized.toString()),true);
assert.equal(hasStrictDatabaseTransport(normalized.toString().replace('postgresql:','postgres:')),true);
let transportRefusals=0;
for(const change of [
  (u:URL)=>u.searchParams.delete('sslaccept'),
  (u:URL)=>u.searchParams.set('sslaccept','accept_invalid_certs'),
  (u:URL)=>u.searchParams.set('sslmode','verify-full'),
  (u:URL)=>u.searchParams.set('sslmode','prefer'),
  (u:URL)=>u.searchParams.set('sslmode','disable'),
  (u:URL)=>u.searchParams.append('sslmode','disable'),
  (u:URL)=>u.searchParams.append('sslaccept','accept_invalid_certs'),
  (u:URL)=>u.searchParams.set('host','/tmp'),
  (u:URL)=>u.password='',
  (u:URL)=>u.hash='sslaccept=strict',
]){
  const candidate=new URL(normalized);change(candidate);
  assert.equal(hasStrictDatabaseTransport(candidate.toString()),false);transportRefusals++;
}
for(const candidate of [null,'invalid',normalized.toString().replace(/^postgresql:/,'https:')]){
  assert.equal(hasStrictDatabaseTransport(candidate),false);transportRefusals++;
}
console.log(`PASS production database transport accepts strict native-Prisma TLS and rejects ${transportRefusals} insecure, contradictory or malformed configurations`);
assert.equal(normalized.hostname,NEON_STAGING.host);
assert.equal(normalized.searchParams.get('sslmode'),'require');
assert.equal(normalized.searchParams.get('sslaccept'),'strict');
assert.equal(normalized.searchParams.get('connect_timeout'),'15');
assert.equal(normalized.searchParams.get('socket_timeout'),'20');
assert.equal(normalized.searchParams.has('channel_binding'),false);
console.log('PASS migration URL pins staging identity and strict native-Prisma TLS settings without claiming channel-binding proof');
let refused=0;
for (const change of [
  (u:URL)=>u.hostname='production.example.invalid',
  (u:URL)=>u.hostname=NEON_STAGING.host.replace('.ap-','-pooler.ap-'),
  (u:URL)=>u.pathname='/neondb',
  (u:URL)=>u.pathname='/postgres',
  (u:URL)=>u.username=NEON_STAGING.runtimeRole,
  (u:URL)=>u.password='',
  (u:URL)=>u.port='5433',
  (u:URL)=>u.hash='x',
  (u:URL)=>u.searchParams.set('sslmode','disable'),
  (u:URL)=>u.searchParams.delete('sslmode'),
  (u:URL)=>u.searchParams.set('sslaccept','accept_invalid_certs'),
  (u:URL)=>u.searchParams.set('schema','other'),
  (u:URL)=>u.searchParams.set('sslrootcert','/untrusted.pem'),
  (u:URL)=>u.searchParams.set('host','/tmp'),
  (u:URL)=>u.searchParams.append('sslmode','require'),
]) {
  const target=new URL(base);change(target);
  assert.throws(()=>normalizeNeonStagingUrl(target.toString()),/^Error: NEON_STAGING_TARGET_OR_TLS_INVALID$/);refused++;
}
for (const value of [null,undefined,{},'', 'invalid', 'x'.repeat(4097),base.toString().replace(/^postgresql:/,'https:')]) {
  assert.throws(()=>normalizeNeonStagingUrl(value),/NEON_STAGING_TARGET_OR_TLS_INVALID/);refused++;
}
const runtime=new URL(base);runtime.hostname=NEON_STAGING.host.replace('.ap-','-pooler.ap-');runtime.username=NEON_STAGING.runtimeRole;
const runtimeResult=new URL(normalizeNeonStagingUrl(runtime.toString(),'runtime'));
assert.equal(runtimeResult.searchParams.get('pgbouncer'),'true');
assert.equal(runtimeResult.username,NEON_STAGING.runtimeRole);
assert.equal(runtimeResult.searchParams.get('sslaccept'),'strict');
assert.throws(()=>normalizeNeonStagingUrl(base.toString(),'runtime'),/NEON_STAGING_TARGET_OR_TLS_INVALID/);
console.log(`PASS ${refused+1} wrong-target/role/TLS/option/input rejections and a distinct pooled runtime credential; no network or database used`);

// Exercise the real operator entry point. Invalid input must stop before any
// Prisma client/CLI is constructed and must never echo the supplied credential.
for(const payload of [
  {action:'Migrate',url:base.toString().replace(NEON_STAGING.host,'production.example.invalid')},
  {action:'ProvisionRuntime',url:base.toString(),runtimeUrl:base.toString()},
  {action:'Reset',url:base.toString()},
]){
  const child=spawnSync(process.execPath,[require.resolve('ts-node/dist/bin.js'),'--files',path.join(__dirname,'manage-neon-staging-database.ts')],{
    input:JSON.stringify(payload),encoding:'utf8',timeout:20_000,
  });
  assert.equal(child.status,1);assert.equal(child.stdout,'');
  assert.match(child.stderr,/^NEON_STAGING_OPERATOR_FAILED phase=input code=REDACTED sqlstate=REDACTED\r?\n$/);
  assert.equal(child.stderr.includes('synthetic-not-a-password'),false);
}
console.log('PASS 3 operator entry-point cases reject wrong migration/runtime targets and unapproved actions without echoing connection input');
