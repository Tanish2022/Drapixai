// Policy for the installed native Prisma PostgreSQL connector. libpq's
// verify-full string alone is not a substitute for Prisma's sslaccept=strict.
export const hasStrictDatabaseTransport=(value:unknown):boolean=>{
  try{
    if(typeof value!=='string'||value.length>8192)return false;
    const url=new URL(value);
    const keys=[...url.searchParams.keys()];
    return ['postgres:','postgresql:'].includes(url.protocol)&&Boolean(url.hostname&&url.username&&url.password)
      &&url.pathname.length>1&&!url.hash&&!url.searchParams.has('host')
      &&new Set(keys).size===keys.length
      &&url.searchParams.get('sslmode')==='require'&&url.searchParams.get('sslaccept')==='strict';
  }catch{return false;}
};
