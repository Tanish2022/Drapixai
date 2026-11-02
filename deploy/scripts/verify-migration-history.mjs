import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function readMigrationFiles(directory = path.join(root, 'apps/api/prisma/migrations')) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  if (entries.some(entry => entry.isSymbolicLink())) throw Error('MIGRATION_SYMLINK_REJECTED');
  return entries.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
    if (!/^\d{14}_[a-z0-9_]+$/.test(entry.name)) throw Error('INVALID_MIGRATION_NAME');
    const file = path.join(directory, entry.name, 'migration.sql');
    if (!fs.lstatSync(file).isFile()) throw Error('REGULAR_MIGRATION_FILE_REQUIRED');
    return { name: entry.name, checksum: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
  });
}
export function verifyMigrationHistory(local, history) {
  if (!local.length || !Array.isArray(history)) throw Error('INVALID_MIGRATION_HISTORY');
  const active = history.filter(row => row.rolledBackAt === null);
  if (active.some(row => !row.finishedAt)) throw Error('FAILED_OR_IN_PROGRESS_MIGRATION');
  const applied = active.map(row => row.name).sort();
  if (new Set(applied).size !== applied.length) throw Error('DUPLICATE_MIGRATION_HISTORY');
  for (let i = 0; i < applied.length; i++) {
    const expected = local[i], actual = active.find(row => row.name === applied[i]);
    if (!expected || expected.name !== applied[i] || actual.checksum !== expected.checksum) throw Error('MIGRATION_HISTORY_DIVERGED');
  }
  return { appliedCount: applied.length, pendingCount: local.length - applied.length, pendingMigrations: local.slice(applied.length).map(row => row.name), localChecksums: local };
}
export async function inspectMigrationHistory(prisma, local = readMigrationFiles()) {
  const table = await prisma.$queryRaw`SELECT to_regclass('public._prisma_migrations')::text AS name`;
  let history = [];
  if (table[0]?.name) history = await prisma.$queryRaw`SELECT migration_name AS name, checksum, finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt" FROM public._prisma_migrations`;
  else {
    const relations = await prisma.$queryRaw`SELECT count(*)::integer AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')`;
    if (relations[0]?.count !== 0) throw Error('EXISTING_DATABASE_REQUIRES_MIGRATION_BASELINE');
  }
  return verifyMigrationHistory(local, history);
}
async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['public', null].includes(url.searchParams.get('schema'))) throw Error('PUBLIC_POSTGRES_DATABASE_REQUIRED');
  const require = createRequire(path.join(root, 'apps/api/package.json'));
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try { console.log(JSON.stringify(await inspectMigrationHistory(prisma))); }
  finally { await prisma.$disconnect(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error('MIGRATION_HISTORY_VERIFICATION_FAILED'); process.exitCode = 1;
});
