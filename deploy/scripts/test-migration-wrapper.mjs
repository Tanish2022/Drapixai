import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
const work = path.join(root, 'runtime/launch-evidence', `migration-wrapper-${crypto.randomBytes(6).toString('hex')}`);
const bash = process.env.DRAPIXAI_TEST_BASH || (process.platform === 'win32' ? 'D:/Git/Git/bin/bash.exe' : 'bash');
const script = fs.readFileSync('deploy/scripts/migrate-with-evidence.sh');
const results = [];
for (const scenario of ['pending', 'ready', 'bad-history', 'changed-history', 'bad-status', 'status1-ready', 'dirty', 'wrong-release']) {
  const dir = path.join(work, scenario), bin = path.join(dir, 'bin'), repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'deploy/scripts'), { recursive: true }); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(repo, 'deploy/scripts/migrate-with-evidence.sh'), script);
  fs.copyFileSync('deploy/scripts/private-libpq.sh', path.join(repo, 'deploy/scripts/private-libpq.sh'));
  const stub = (name, body) => { const file = path.join(bin, name); fs.writeFileSync(file, '#!/usr/bin/env bash\nset -euo pipefail\n' + body); fs.chmodSync(file, 0o700); };
  stub('git', `case "$*" in *status*) [[ "$MOCK_SCENARIO" != dirty ]] || echo modified;; *) printf '%s\\n' "$MOCK_COMMIT";; esac\n`);
  stub('psql', 'echo fixture_database\n');
  // Synthetic adapter tests only; actual POSIX permissions/native clients are
  // checked separately in the owned Linux PostgreSQL fixture.
  stub('uname', 'echo Linux\n');
  stub('pg_dump', 'for arg in "$@"; do case "$arg" in --file=*) printf synthetic-backup > "${arg#--file=}";; esac; done\n');
  stub('pg_restore', 'echo synthetic-catalog\n');
  stub('npm', `case "$*" in
  *"migrate status"*)
    [[ -f "$MOCK_DIR/deployed" ]] && exit 0
    [[ "$MOCK_SCENARIO" != bad-status ]] || exit 2
    [[ "$MOCK_SCENARIO" == ready ]] && exit 0
    exit 1;;
  *"prisma:migrate:deploy"*) touch "$MOCK_DIR/deployed";;
  *) exit 99;;
esac\n`);
  stub('node', `case "$1" in
  *verify-migration-history.mjs)
    [[ "$MOCK_SCENARIO" != bad-history ]] || exit 1
    count=0; [[ ! -f "$MOCK_DIR/history-count" ]] || read -r count < "$MOCK_DIR/history-count"
    count=$((count+1)); echo "$count" > "$MOCK_DIR/history-count"
    pending=1; hash=stable
    if [[ "$MOCK_SCENARIO" == ready || "$MOCK_SCENARIO" == status1-ready || -f "$MOCK_DIR/deployed" ]]; then pending=0; fi
    if [[ "$MOCK_SCENARIO" == changed-history && "$count" -eq 2 ]]; then hash=changed; fi
    printf '{"pendingCount":%s,"localChecksums":["%s"]}\\n' "$pending" "$hash";;
  *) exec "$MOCK_NODE" "$@";;
esac\n`);
  const slash = value => value.replaceAll('\\', '/');
  const env = { ...process.env, MOCK_DIR: slash(dir), MOCK_BIN: slash(bin), MOCK_COMMIT: 'a'.repeat(40), MOCK_SCENARIO: scenario,
    MOCK_NODE: slash(process.execPath), DRAPIXAI_DEPLOY_ENV: 'sandbox', DATABASE_URL: 'postgresql://fixture:synthetic-only@invalid/fixture_database?sslmode=verify-full',
    DRAPIXAI_EXPECTED_DATABASE_NAME: 'fixture_database', DRAPIXAI_CHANGE_APPROVAL_ID: 'owned-offline-fixture',
    DRAPIXAI_EXPECTED_GIT_REF: (scenario === 'wrong-release' ? 'b' : 'a').repeat(40),
    DRAPIXAI_BACKUP_DIR: slash(path.join(dir, 'backups')), DRAPIXAI_MIGRATION_EVIDENCE_DIR: slash(path.join(dir, 'evidence')) };
  const result = spawnSync(bash, ['-c', 'bin="$MOCK_BIN"; if command -v cygpath >/dev/null 2>&1; then bin="$(cygpath -u "$bin")"; fi; export PATH="$bin:$PATH"; exec bash "$1"', 'owned-migration-wrapper', slash(path.join(repo, 'deploy/scripts/migrate-with-evidence.sh'))], { env, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  fs.writeFileSync(path.join(dir, 'execution.log'), `${result.stdout || ''}\n${result.stderr || ''}`);
  const success = ['pending', 'ready'].includes(scenario);
  assert.equal(result.status === 0, success, `${scenario}: wrapper status`);
  assert.equal(fs.existsSync(path.join(dir, 'deployed')), success, `${scenario}: unsafe migration command reached`);
  if (success) {
    const recordDir = fs.readdirSync(path.join(dir, 'evidence'))[0];
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'evidence', recordDir, 'evidence.json')));
    assert.equal(record.history_checksum_verified, true); assert.equal(record.status_before_exit_code, scenario === 'pending' ? 1 : 0);
  }
  results.push({ scenario, passed: true });
}
console.log(JSON.stringify({ passed: true, scope: 'Actual migration shell wrapper with owned local tool adapters; not database or production execution', cases: results }));
