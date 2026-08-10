import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const evidenceRoot = path.join(root, "runtime", "launch-evidence");
const config = JSON.parse(fs.readFileSync(path.join(root, "deploy", "launch-gates.json"), "utf8"));
const args = new Map();

for (let index = 2; index < process.argv.length; index += 1) {
  const current = process.argv[index];
  if (!current.startsWith("--")) continue;
  const [name, inline] = current.slice(2).split("=", 2);
  args.set(name, inline ?? process.argv[++index]);
}

const usage = () => console.error(
  "Usage: node scripts/record-launch-evidence.mjs --gate <gate-id> --status PASS|FAIL --verified-by <operator> --artifact runtime/launch-evidence/<artifact> [--record runtime/launch-evidence/approved-evidence.json]",
);
const required = (name) => {
  const value = String(args.get(name) || "").trim();
  if (!value) throw new Error(`MISSING_${name.toUpperCase().replaceAll("-", "_")}`);
  return value;
};
const isDescendant = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const resolveEvidenceFile = (reference, label) => {
  if (!fs.existsSync(evidenceRoot)) throw new Error("LAUNCH_EVIDENCE_DIRECTORY_MISSING");
  const candidate = path.resolve(root, reference);
  if (!fs.existsSync(candidate)) throw new Error(`${label}_MISSING`);
  const evidenceRootReal = fs.realpathSync(evidenceRoot);
  const candidateReal = fs.realpathSync(candidate);
  if (!isDescendant(evidenceRootReal, candidateReal)) throw new Error(`${label}_MUST_REMAIN_UNDER_RUNTIME_LAUNCH_EVIDENCE`);
  if (!fs.statSync(candidateReal).isFile()) throw new Error(`${label}_MUST_BE_A_FILE`);
  return candidateReal;
};
const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
if (git.status !== 0) throw new Error("GIT_HEAD_UNAVAILABLE");
const commit = git.stdout.trim();

try {
  if (args.has("help")) {
    usage();
    process.exit(0);
  }
  const gate = required("gate");
  const status = required("status").toUpperCase();
  const verifiedBy = required("verified-by");
  const artifact = required("artifact");
  const record = String(args.get("record") || path.join("runtime", "launch-evidence", "approved-evidence.json"));

  if (!["PASS", "FAIL"].includes(status)) throw new Error("STATUS_MUST_BE_PASS_OR_FAIL");
  if (verifiedBy.length > 256 || /[\r\n]/.test(verifiedBy)) throw new Error("VERIFIED_BY_INVALID");
  const allowedGates = new Set(config.releaseEvidence.map((item) => item.id));
  allowedGates.delete("clean-release-commit");
  if (!allowedGates.has(gate)) throw new Error("UNKNOWN_RELEASE_EVIDENCE_GATE");

  const recordPath = resolveEvidenceFile(record, "EVIDENCE_RECORD");
  const artifactPath = resolveEvidenceFile(artifact, "EVIDENCE_ARTIFACT");
  if (recordPath === artifactPath) throw new Error("EVIDENCE_ARTIFACT_CANNOT_BE_RELEASE_RECORD");
  const recordJson = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  if (recordJson.schemaVersion !== 1 || !recordJson.gates || typeof recordJson.gates !== "object") throw new Error("EVIDENCE_RECORD_SCHEMA_INVALID");
  if (recordJson.releaseCommit !== commit) throw new Error("EVIDENCE_RECORD_COMMIT_MISMATCH");
  if (!recordJson.gates[gate] || typeof recordJson.gates[gate] !== "object") throw new Error("EVIDENCE_RECORD_GATE_MISSING");

  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex");
  recordJson.gates[gate] = {
    ...recordJson.gates[gate],
    status,
    evidence: path.relative(root, artifactPath),
    sha256,
    verifiedAt: new Date().toISOString(),
    verifiedBy,
  };

  const temporaryRecord = path.join(path.dirname(recordPath), `.${path.basename(recordPath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(temporaryRecord, `${JSON.stringify(recordJson, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryRecord, recordPath);
  } finally {
    fs.rmSync(temporaryRecord, { force: true });
  }
  console.log(JSON.stringify({ status: "RECORDED", gate, result: status, releaseCommit: commit, artifact: path.relative(root, artifactPath), sha256 }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "RECORD_LAUNCH_EVIDENCE_FAILED");
  usage();
  process.exitCode = 1;
}
