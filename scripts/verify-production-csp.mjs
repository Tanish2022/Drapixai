import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const proxyPath = path.join(root, "apps", "web", "proxy.ts");
const nextConfigPath = path.join(root, "apps", "web", "next.config.js");
const proxySource = fs.readFileSync(proxyPath, "utf8");
const nextConfigSource = fs.readFileSync(nextConfigPath, "utf8");

const checks = [
  ["proxy generates a cryptographically random request nonce", /(?:randomBytes|randomUUID)\s*\(/.test(proxySource)],
  ["CSP uses the request nonce", /nonce-\$\{nonce\}/.test(proxySource)],
  ["proxy forwards the nonce to Next.js", /x-nonce/.test(proxySource)],
  ["CSP blocks framing", /frame-ancestors\s+'none'/.test(proxySource)],
  ["CSP does not allow unsafe-inline", !/unsafe-inline/.test(proxySource)],
  ["next.config.js does not install a conflicting CSP", !/Content-Security-Policy/i.test(nextConfigSource)]
];

const failed = checks.filter(([, passed]) => !passed);
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
}

if (failed.length > 0) {
  process.exitCode = 1;
}
