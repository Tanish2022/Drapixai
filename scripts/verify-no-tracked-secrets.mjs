import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const ignoredExtensions = new Set(['.avif', '.gif', '.ico', '.jpg', '.jpeg', '.pdf', '.png', '.pptx', '.webp', '.woff', '.woff2']);
const excludedPaths = new Set(['scripts/verify-no-tracked-secrets.mjs']);
const detections = [];
const rules = [
  ['PRIVATE_KEY', /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/],
  ['AWS_ACCESS_KEY', /\bAKIA[0-9A-Z]{16}\b/],
  ['GITHUB_TOKEN', /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
  ['SLACK_TOKEN', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['GOOGLE_API_KEY', /\bAIza[0-9A-Za-z_-]{30,}\b/],
];

for (const relativePath of tracked) {
  if (excludedPaths.has(relativePath) || ignoredExtensions.has(path.extname(relativePath).toLowerCase())) continue;
  const absolutePath = path.join(root, relativePath);
  const buffer = fs.readFileSync(absolutePath);
  if (buffer.includes(0)) continue;
  const lines = buffer.toString('utf8').split(/\r?\n/);
  for (const [kind, expression] of rules) {
    const lineIndex = lines.findIndex((line) => expression.test(line));
    if (lineIndex >= 0) detections.push({ relativePath, line: lineIndex + 1, kind });
  }
}

if (detections.length > 0) {
  for (const detection of detections) {
    console.error(`TRACKED_SECRET_DETECTED:${detection.kind}:${detection.relativePath}:${detection.line}`);
  }
  process.exit(1);
}

console.log(`Tracked-secret scan passed (${tracked.length} tracked paths inspected).`);