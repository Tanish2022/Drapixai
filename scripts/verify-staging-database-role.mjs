import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const runId = `database-role-${crypto.randomBytes(6).toString("hex")}`;
const evidenceDir = path.join(root, "runtime", "launch-evidence", runId);
fs.mkdirSync(evidenceDir, { recursive: true });
const password = crypto.randomBytes(48).toString("base64url");
const adminPassword = crypto.randomBytes(48).toString("base64url");
const secretPath = path.join(evidenceDir, "api_database_password");
fs.writeFileSync(secretPath, password, { mode: 0o600 });
const name = `drapixai-p0-${runId}`;
const checks = [];
const redact = (text) => String(text || "").replaceAll(password, "[REDACTED]").replaceAll(adminPassword, "[REDACTED]");
const docker = (args, options = {}) => {
  const result = spawnSync("docker", args, {
    encoding: "utf8", windowsHide: true, timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  const output = redact(`${result.stdout || ""}\n${result.stderr || ""}`).trim();
  if (result.status !== 0 || result.error) throw new Error(output || String(result.error || "DOCKER_COMMAND_FAILED"));
  return output;
};
const sql = (input) => docker([
  "exec", "-i", name, "psql", "-X", "-q", "-U", "drapixai_staging",
  "-d", "drapixai_staging", "-v", "ON_ERROR_STOP=1",
], { input });
const inputs = [
  "deploy/staging/provision-database-role.sh",
  "deploy/staging/verify-database-role.sql",
  ...fs.readdirSync(path.join(root, "apps/api/prisma/migrations"))
    .filter((item) => fs.statSync(path.join(root, "apps/api/prisma/migrations", item)).isDirectory())
    .sort().map((item) => `apps/api/prisma/migrations/${item}/migration.sql`),
];
let created = false;
let failure = null;
try {
  docker([
    "run", "-d", "--name", name, "--label", "drapixai.purpose=disposable-certification",
    "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_USER=drapixai_staging", "-e", "POSTGRES_DB=drapixai_staging",
    "-e", "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 --auth-local=trust",
    "--mount", `type=bind,src=${secretPath},dst=/run/secrets/api_database_password,readonly`,
    "--mount", `type=bind,src=${path.join(root, inputs[0])},dst=/opt/drapixai/provision-database-role.sh,readonly`,
    "--mount", `type=bind,src=${path.join(root, inputs[1])},dst=/opt/drapixai/verify-database-role.sql,readonly`,
    "postgres:14",
  ], { env: { ...process.env, POSTGRES_PASSWORD: adminPassword } });
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      // The entrypoint's temporary Unix-socket server accepts pg_isready even
      // before POSTGRES_DB exists. Require the final TCP server and real login.
      const database = docker([
        "exec", "-e", "PGPASSWORD", name, "psql", "-X", "-t", "-A", "-h", "127.0.0.1",
        "-U", "drapixai_staging", "-d", "drapixai_staging", "-c", "SELECT current_database();",
      ], { env: { ...process.env, PGPASSWORD: adminPassword } });
      assert.equal(database, "drapixai_staging");
      ready = true;
      break;
    } catch { await delay(1000); }
  }
  assert.ok(ready, "Disposable database must become ready");
  const provision = () => docker(["exec", name, "bash", "/opt/drapixai/provision-database-role.sh"]);
  assert.throws(provision, /Apply all release migrations/);
  checks.push("provisioning refuses an unmigrated database");
  for (const input of inputs.slice(2)) sql(fs.readFileSync(path.join(root, input), "utf8"));
  sql('CREATE TABLE public._prisma_migrations (id text PRIMARY KEY);');
  provision();
  provision();
  checks.push("all release SQL migrations apply and provisioning is repeatable");
  const loginArgs = [
    "exec", "-e", "PGPASSWORD", name, "psql", "-X", "-t", "-A", "-h", "127.0.0.1",
    "-U", "drapixai_staging_api", "-d", "drapixai_staging", "-c", "SELECT current_user;",
  ];
  assert.throws(() => docker(loginArgs, { env: { ...process.env, PGPASSWORD: adminPassword } }), /password authentication failed/);
  const login = docker(loginArgs, { env: { ...process.env, PGPASSWORD: password } });
  assert.equal(login, "drapixai_staging_api");
  checks.push("separate runtime login authenticates and rejects the bootstrap password");
  const verified = docker([
    "exec", name, "psql", "-X", "-U", "drapixai_staging", "-d", "drapixai_staging",
    "-f", "/opt/drapixai/verify-database-role.sql",
  ]);
  assert.ok(verified.includes("PASS: runtime DML and audit append work"));
  checks.push("runtime DML and audit append succeed; administrative, DDL, audit mutation and truncate operations fail");
  const residue = sql('SELECT count(*) FROM public."SecurityAuditLog"; SELECT to_regclass(\'public.drapixai_role_probe\') IS NULL AS probe_removed;');
  assert.match(residue, /\b0\b/);
  assert.match(residue, /\bt\b/);
  checks.push("verifier rolls back synthetic rows and probe table");
} catch (error) {
  failure = redact(error instanceof Error ? error.message : error);
} finally {
  if (created) {
    try { docker(["rm", "-f", "-v", name]); }
    catch (error) { failure = `${failure || ""}\nDisposable container cleanup failed: ${redact(error.message)}`.trim(); }
  }
  fs.rmSync(secretPath, { force: true });
}
const git = (args) => spawnSync("git", args, { encoding: "utf8", windowsHide: true });
const head = git(["rev-parse", "HEAD"]);
const status = git(["status", "--porcelain"]);
const report = {
  scope: "local-disposable-database-not-live-staging", passed: !failure,
  releaseCommit: head.status === 0 ? head.stdout.trim() : null,
  dirtyEntries: status.status === 0 ? status.stdout.split(/\r?\n/).filter(Boolean).length : null,
  generatedAt: new Date().toISOString(), checks, failure,
  sourceSha256: Object.fromEntries(inputs.map((input) => [input,
    crypto.createHash("sha256").update(fs.readFileSync(path.join(root, input))).digest("hex"),
  ])),
};
const reportPath = path.join(evidenceDir, "report.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`Evidence: ${path.relative(root, reportPath)}`);
if (failure) process.exitCode = 1;
