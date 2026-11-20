import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tracked = spawnSync('git', ['ls-files', '-z', '--', '*.sh', 'apps/api/prisma/migrations/*/migration.sql'], {
  cwd: root,
  encoding: 'buffer',
  windowsHide: true,
});

if (tracked.status !== 0 || tracked.error) {
  throw new Error('TRACKED_RELEASE_FILE_LIST_UNAVAILABLE');
}

const files = tracked.stdout
  .toString('utf8')
  .split('\0')
  .filter(Boolean);
const invalid = [];

for (const relative of files) {
  const contents = fs.readFileSync(path.join(root, relative));
  if (contents.includes(0x0d)) invalid.push(relative);
}

if (invalid.length > 0) {
  console.error('Shell scripts and checksum-bound Prisma migrations must use LF:');
  for (const file of invalid) console.error(`- ${file}`);
  process.exitCode = 1;
} else {
  console.log(`Release line-ending validation passed for ${files.length} tracked scripts and migrations.`);
}
