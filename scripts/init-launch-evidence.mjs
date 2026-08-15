import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const evidenceRoot = path.join(root, 'runtime', 'launch-evidence');
const recordPath = path.join(evidenceRoot, 'approved-evidence.json');
const templatePath = path.join(root, 'deploy', 'launch-evidence.example.json');
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
if (git.status !== 0) throw new Error('GIT_HEAD_UNAVAILABLE');
const releaseCommit = git.stdout.trim();
if (!/^[a-f0-9]{40}$/.test(releaseCommit)) throw new Error('GIT_HEAD_INVALID');

fs.mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
if (fs.existsSync(recordPath)) {
  const existing = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  if (existing.releaseCommit === releaseCommit) {
    console.log(`Launch evidence record already targets ${releaseCommit}.`);
    process.exit(0);
  }
  const archiveDir = path.join(evidenceRoot, 'archive');
  fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
  const oldCommit = /^[a-f0-9]{40}$/.test(existing.releaseCommit || '')
    ? existing.releaseCommit
    : `unknown-${Date.now()}`;
  const archivePath = path.join(archiveDir, `approved-evidence-${oldCommit}.json`);
  if (!fs.existsSync(archivePath)) fs.copyFileSync(recordPath, archivePath, fs.constants.COPYFILE_EXCL);
}

const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
template.releaseCommit = releaseCommit;
const temporaryPath = `${recordPath}.${process.pid}.tmp`;
try {
  fs.writeFileSync(temporaryPath, `${JSON.stringify(template, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, recordPath);
} finally {
  fs.rmSync(temporaryPath, { force: true });
}
console.log(`Initialized launch evidence for ${releaseCommit}.`);
