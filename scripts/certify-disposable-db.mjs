import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
const parsed = new URL(databaseUrl);
const databaseName = parsed.pathname.replace(/^\//, '');
const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
if (!allowedHosts.has(parsed.hostname)) throw new Error('DISPOSABLE_DB_MUST_USE_LOOPBACK_HOST');
if (!/(?:^|[_-])(p0|test|disposable)(?:$|[_-])/i.test(databaseName)) {
  throw new Error('DISPOSABLE_DB_NAME_MUST_INCLUDE_P0_TEST_OR_DISPOSABLE');
}
if (process.env.DRAPIXAI_DISPOSABLE_DB_APPROVAL !== 'I_ACKNOWLEDGE_DISPOSABLE_DATABASE') {
  throw new Error('DISPOSABLE_DB_APPROVAL_REQUIRED');
}

const commandFor = (args) => process.platform === 'win32'
  ? { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`] }
  : { command: 'npm', args };
const run = (label, args) => {
  const invocation = commandFor(args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (result.status !== 0 || result.error) {
    throw new Error(`${label}_FAILED\n${output.slice(-4000)}`);
  }
  return output
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[redacted]')
    .replace(/Environment variables loaded from \.env\r?\n?/g, '');
};

const commitResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
if (commitResult.status !== 0) throw new Error('GIT_HEAD_UNAVAILABLE');
const releaseCommit = commitResult.stdout.trim();
const startedAt = new Date().toISOString();
const migrationOutput = run('MIGRATION', ['--prefix', 'apps/api', 'run', 'prisma:migrate:deploy']);
const auditOutput = run('AUDIT_IMMUTABILITY', ['--prefix', 'apps/api', 'run', 'test:audit-immutability']);
const completedAt = new Date().toISOString();
const artifactDir = path.join(root, 'runtime', 'launch-evidence', 'release-record');
const artifactPath = path.join(artifactDir, 'migrations.md');
fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
const markdown = `# Disposable Database Certification\n\n- Release commit: \`${releaseCommit}\`\n- Started: ${startedAt}\n- Completed: ${completedAt}\n- Database host: loopback only\n- Database name: \`${databaseName}\`\n- Migration result: **PASS**\n- Immutable audit UPDATE: **REJECTED**\n- Immutable audit DELETE: **REJECTED**\n\n## Migration Output\n\n\`\`\`text\n${migrationOutput}\n\`\`\`\n\n## Audit Immutability Output\n\n\`\`\`text\n${auditOutput}\n\`\`\`\n`;
fs.writeFileSync(artifactPath, markdown, { encoding: 'utf8', mode: 0o600 });
console.log(path.relative(root, artifactPath));
