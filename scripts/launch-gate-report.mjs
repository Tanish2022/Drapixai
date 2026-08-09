import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "deploy", "launch-gates.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const requestedScope = process.argv.find((arg) => arg.startsWith("--scope="))?.split("=")[1] ?? "all";
const requestedEvidencePath = process.argv.find((arg) => arg.startsWith("--evidence="))?.slice("--evidence=".length);
const evidencePath = path.resolve(root, requestedEvidencePath || path.join("runtime", "launch-evidence", "approved-evidence.json"));
const validScopes = new Set(["repository", "all"]);

if (!validScopes.has(requestedScope)) {
  console.error("Usage: node scripts/launch-gate-report.mjs [--scope=repository|all]");
  process.exit(2);
}

const commandFor = (runner, args) => {
  if (runner === "npm" && process.platform === "win32") {
    const quote = (arg) => /^[A-Za-z0-9_./:=@-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '\\"')}"`;
    return {
      command: process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", `npm.cmd ${args.map(quote).join(" ")}`]
    };
  }
  if (runner === "npm") return { command: "npm", args };
  if (runner === "python") {
    return {
      command: process.env.DRAPIXAI_PYTHON || (process.platform === "win32" ? "python.exe" : "python3"),
      args
    };
  }
  return {
    command: process.platform === "win32" && runner === "node" ? process.execPath : runner,
    args
  };
};

const redact = (value) => value
  .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)[A-Z0-9_]*\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]")
  .replace(/(postgres(?:ql)?|redis|https?):\/\/[^\s/@:]+:[^\s/@]+@/gi, "$1://[REDACTED]@")
  .replace(/\b(?:dpx|dpxsf|dpxst)_[A-Za-z0-9_-]+\b/g, "[REDACTED_KEY]")
  .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]");

const tail = (value, lineCount = 12) => redact(value || "")
  .split(/\r?\n/)
  .filter(Boolean)
  .slice(-lineCount)
  .join("\n");

const productionEnvTemplates = [
  ["deploy/env/api.production.example", "deploy/env/api.production.env"],
  ["deploy/env/web.production.example", "deploy/env/web.production.env"],
  ["deploy/env/ai.production.example", "deploy/env/ai.production.env"]
];

const prepareComposeEnvFiles = (gate) => {
  if (gate.runner !== "docker" || gate.args[0] !== "compose") return [];

  const created = [];
  for (const [template, destination] of productionEnvTemplates) {
    const templatePath = path.join(root, template);
    const destinationPath = path.join(root, destination);
    if (fs.existsSync(destinationPath)) continue;
    fs.copyFileSync(templatePath, destinationPath, fs.constants.COPYFILE_EXCL);
    created.push(destinationPath);
  }
  return created;
};

const run = (gate) => {
  const startedAt = new Date();
  const started = Date.now();
  const invocation = commandFor(gate.runner, gate.args);
  const temporaryEnvFiles = prepareComposeEnvFiles(gate);
  let result;
  try {
    result = spawnSync(invocation.command, invocation.args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    });
  } finally {
    for (const temporaryEnvFile of temporaryEnvFiles) {
      fs.rmSync(temporaryEnvFile, { force: true });
    }
  }
  const durationMs = Date.now() - started;
  const passed = result.status === 0 && !result.error;
  const failure = passed ? null : tail(`${result.error?.message ?? ""}\n${result.stderr ?? ""}\n${result.stdout ?? ""}`);

  console.log(`${passed ? "PASS" : "FAIL"} ${gate.id} (${(durationMs / 1000).toFixed(1)}s)`);
  if (failure) console.log(failure);

  return {
    id: gate.id,
    label: gate.label,
    status: passed ? "PASS" : "FAIL",
    startedAt: startedAt.toISOString(),
    durationMs,
    exitCode: result.status,
    failure
  };
};

const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
const head = git(["rev-parse", "HEAD"]);
const status = git(["status", "--porcelain"]);
const commit = head.status === 0 ? head.stdout.trim() : "unknown";
const dirtyEntries = status.status === 0 ? status.stdout.split(/\r?\n/).filter(Boolean).length : null;
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;

console.log(`DrapixAI launch gates: ${requestedScope}`);
console.log(`Commit: ${commit}${dirtyEntries ? ` (${dirtyEntries} uncommitted entries)` : ""}`);

const repository = config.repository.map(run);
const releaseEvidence = requestedScope === "all"
  ? config.releaseEvidence.map((gate) => ({ ...gate, status: "PENDING" }))
  : [];

let suppliedEvidence = null;
if (requestedScope === "all" && fs.existsSync(evidencePath)) {
  suppliedEvidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  if (suppliedEvidence.schemaVersion !== 1) {
    throw new Error(`Unsupported launch evidence schema in ${path.relative(root, evidencePath)}`);
  }
  if (suppliedEvidence.releaseCommit !== commit) {
    console.log(`PENDING supplied evidence targets ${suppliedEvidence.releaseCommit || "no commit"}, not ${commit}`);
  } else {
    for (const gate of releaseEvidence) {
      if (gate.id === "clean-release-commit") continue;
      const evidence = suppliedEvidence.gates?.[gate.id];
      if (!evidence || !["PASS", "FAIL"].includes(evidence.status)) continue;
      const complete = typeof evidence.evidence === "string" && evidence.evidence.trim().length > 0
        && typeof evidence.verifiedBy === "string" && evidence.verifiedBy.trim().length > 0
        && !Number.isNaN(Date.parse(evidence.verifiedAt));
      if (!complete) {
        console.log(`PENDING ${gate.id} has incomplete evidence metadata`);
        continue;
      }
      gate.status = evidence.status;
      gate.evidence = evidence.evidence.trim();
      gate.verifiedAt = new Date(evidence.verifiedAt).toISOString();
      gate.verifiedBy = evidence.verifiedBy.trim();
    }
  }
}

if (requestedScope === "all") {
  const cleanGate = releaseEvidence.find((gate) => gate.id === "clean-release-commit");
  if (cleanGate && dirtyEntries === 0 && commit !== "unknown") {
    cleanGate.status = "PASS";
    cleanGate.evidence = commit;
  }
}

const counts = [...repository, ...releaseEvidence].reduce((summary, gate) => {
  summary[gate.status] = (summary[gate.status] ?? 0) + 1;
  return summary;
}, { PASS: 0, FAIL: 0, PENDING: 0 });
const repositoryGatesPassed = repository.every((gate) => gate.status === "PASS");
const readyForPublicLaunch = requestedScope === "all"
  ? counts.FAIL === 0 && counts.PENDING === 0
  : null;
const report = {
  schemaVersion: 1,
  runId,
  generatedAt: new Date().toISOString(),
  scope: requestedScope,
  commit,
  dirtyEntries,
  evidenceSource: requestedScope === "all" && suppliedEvidence ? path.relative(root, evidencePath) : null,
  repositoryGatesPassed,
  readyForPublicLaunch,
  counts,
  repository,
  releaseEvidence
};

const evidenceDir = path.join(root, "runtime", "launch-evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
const jsonPath = path.join(evidenceDir, `${runId}.json`);
const markdownPath = path.join(evidenceDir, `${runId}.md`);
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const rows = [...repository, ...releaseEvidence]
  .map((gate) => `| ${gate.status} | ${gate.id} | ${gate.label} | ${gate.durationMs == null ? "-" : `${(gate.durationMs / 1000).toFixed(1)}s`} |`)
  .join("\n");
const publicDecision = readyForPublicLaunch == null ? "NOT EVALUATED (run the complete report)" : readyForPublicLaunch ? "YES" : "NO";
const markdown = `# DrapixAI Launch Gate Report\n\n- Run: \`${runId}\`\n- Commit: \`${commit}\`\n- Uncommitted entries: ${dirtyEntries ?? "unknown"}\n- Repository gates passed: **${repositoryGatesPassed ? "YES" : "NO"}**\n- Public launch ready: **${publicDecision}**\n- PASS: ${counts.PASS}; FAIL: ${counts.FAIL}; PENDING: ${counts.PENDING}\n\n| Status | Gate | Requirement | Duration |\n| --- | --- | --- | --- |\n${rows}\n`;
fs.writeFileSync(markdownPath, markdown, "utf8");

console.log(`Evidence: ${path.relative(root, markdownPath)}`);
console.log(`Summary: PASS=${counts.PASS} FAIL=${counts.FAIL} PENDING=${counts.PENDING}`);
console.log(`Repository gates passed: ${repositoryGatesPassed ? "YES" : "NO"}`);
console.log(`Public launch ready: ${publicDecision}`);

if (counts.FAIL > 0) process.exitCode = 1;
else if (requestedScope === "all" && counts.PENDING > 0) process.exitCode = 3;
