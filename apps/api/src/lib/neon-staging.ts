export const NEON_STAGING = Object.freeze({
  projectId:'sample-staging-project', branchId:'sample-staging-branch',
  host:'ep-sample-staging.ap-southeast-1.aws.neon.tech',
  database:'drapixai_staging', migrationRole:'neondb_owner', runtimeRole:'drapixai_staging_api',
});

// Deliberately fixed to the console-created staging endpoint. Never infer a
// target from application .env or allow production URLs into this workflow.
export const normalizeNeonStagingUrl = (value: unknown, kind:'migration'|'runtime'='migration') => {
  try {
    if (typeof value!=='string' || value.length>4096) throw new Error();
    const url=new URL(value.trim());
    const expectedHost=kind==='migration'?NEON_STAGING.host:NEON_STAGING.host.replace('.ap-', '-pooler.ap-');
    const expectedRole=kind==='migration'?NEON_STAGING.migrationRole:NEON_STAGING.runtimeRole;
    const keys=[...url.searchParams.keys()];
    const allowed=new Set(['sslmode','sslaccept','channel_binding','schema','connection_limit','connect_timeout','pool_timeout','socket_timeout','pgbouncer']);
    if (!['postgres:','postgresql:'].includes(url.protocol) || url.hostname!==expectedHost
      || (url.port && url.port!=='5432') || decodeURIComponent(url.username)!==expectedRole || !url.password
      || url.pathname!==`/${NEON_STAGING.database}` || url.hash || new Set(keys).size!==keys.length
      || keys.some(key=>!allowed.has(key))
      || !['require','verify-ca','verify-full'].includes(url.searchParams.get('sslmode')||'')
      || (url.searchParams.has('sslaccept') && url.searchParams.get('sslaccept')!=='strict')
      || (url.searchParams.has('schema') && url.searchParams.get('schema')!=='public')) throw new Error();
    // Prisma's native Postgres connector uses sslaccept=strict to reject invalid
    // certificates. Do not depend on sslmode alone or claim channel-binding proof.
    url.search='';
    for (const [name,setting] of Object.entries({sslmode:'require',sslaccept:'strict',schema:'public',connection_limit:'1',connect_timeout:'15',pool_timeout:'10',socket_timeout:'20'})) url.searchParams.set(name,setting);
    if(kind==='runtime')url.searchParams.set('pgbouncer','true');
    return url.toString();
  } catch { throw new Error('NEON_STAGING_TARGET_OR_TLS_INVALID'); }
};
