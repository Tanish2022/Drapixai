import { execFileSync } from 'node:child_process';
import path from 'node:path';

export type NeonMigrationPlan = {
  appliedCount: number; pendingCount: number; pendingMigrations: string[];
  localChecksums: Array<{ name: string; checksum: string }>;
};

// Reuse the canonical ledger verifier rather than a second interpretation of
// Prisma exit codes or migration history. The URL stays in the child env.
export const inspectNeonMigrationHistory = (url: string, execute: typeof execFileSync = execFileSync): NeonMigrationPlan => {
  const root = path.resolve(__dirname, '../../../..');
  const allowed = /^(path|systemroot|windir|comspec|temp|tmp|localappdata|appdata|userprofile|programfiles|programdata|pathext)$/i;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.test(key)));
  const output = execute(process.execPath, [path.join(root, 'deploy/scripts/verify-migration-history.mjs')], {
    cwd: root, env: { ...env, DATABASE_URL: url }, encoding: 'utf8', windowsHide: true,
    timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024,
  });
  return JSON.parse(output.toString()) as NeonMigrationPlan;
};
