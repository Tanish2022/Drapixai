import { PrismaClient } from '@prisma/client';
import { NEON_STAGING, normalizeNeonStagingUrl } from '../lib/neon-staging';

// Owner credential arrives through a private stdin pipe, never command arguments
// or dotenv. This command performs read-only identity/schema checks only.
const main=async()=>{
  let raw='';for await(const chunk of process.stdin){raw+=chunk.toString();if(Buffer.byteLength(raw)>8192)throw new Error('INPUT_INVALID');}
  const input=JSON.parse(raw) as {url?:unknown};
  const url=normalizeNeonStagingUrl(input.url);raw='';input.url=undefined;
  const prisma=new PrismaClient({datasources:{db:{url}},log:[]});
  try {
    const rows=await prisma.$queryRaw<Array<{database_name:string;role_name:string;public_tables:bigint}>>`
      SELECT current_database() AS database_name,current_user AS role_name,
        (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS public_tables`;
    if(rows.length!==1 || rows[0].database_name!==NEON_STAGING.database || rows[0].role_name!==NEON_STAGING.migrationRole)throw new Error('IDENTITY_MISMATCH');
    console.log(JSON.stringify({passed:true,branchId:NEON_STAGING.branchId,database:rows[0].database_name,role:rows[0].role_name,
      publicTables:Number(rows[0].public_tables),clientTlsPolicy:'require + sslaccept=strict',dataModified:false,applicationConnected:false}));
  }finally{await prisma.$disconnect();}
};
if(require.main===module)main().catch(()=>{console.error('NEON_STAGING_DATABASE_VERIFICATION_FAILED');process.exitCode=1;});
