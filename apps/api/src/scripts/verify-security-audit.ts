import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { verifySecurityAuditChain } from '../lib/audit-log';
import { formatLogError } from '../lib/security';

const prisma = new PrismaClient();

verifySecurityAuditChain(prisma)
  .then((result) => {
    console.log(JSON.stringify(result));
    if (!result.valid) process.exitCode = 2;
  })
  .catch((error) => {
    console.error(formatLogError(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
