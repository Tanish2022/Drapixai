import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareComposeEnvFiles } from "./lib/temporary-compose-env.mjs";

const gate = { runner: "docker", args: ["compose", "config"] };
const fixture = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "drapixai-compose-env-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "example"), "PLACEHOLDER=example\n");
  return root;
};

test("returns only newly created files and preserves operator configuration", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "existing.env"), "OPERATOR_VALUE=keep\n");
  const created = prepareComposeEnvFiles(root, gate, [["example", "existing.env"], ["example", "new.env"]]);
  assert.deepEqual(created, [path.join(root, "new.env")]);
  assert.equal(fs.readFileSync(path.join(root, "existing.env"), "utf8"), "OPERATOR_VALUE=keep\n");
  assert.equal(fs.readFileSync(created[0], "utf8"), "PLACEHOLDER=example\n");
});

test("cleans partial setup after a later copy fails without deleting existing files", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "existing.env"), "OPERATOR_VALUE=keep\n");
  assert.throws(() => prepareComposeEnvFiles(root, gate, [
    ["example", "existing.env"], ["example", "new.env"], ["missing", "last.env"],
  ]), { code: "ENOENT" });
  assert.equal(fs.existsSync(path.join(root, "new.env")), false);
  assert.equal(fs.existsSync(path.join(root, "last.env")), false);
  assert.equal(fs.readFileSync(path.join(root, "existing.env"), "utf8"), "OPERATOR_VALUE=keep\n");
});

test("non-Compose gates create no environment files", (t) => {
  const root = fixture(t);
  for (const other of [{ runner: "npm", args: ["build"] }, { runner: "docker", args: ["info"] }]) {
    assert.deepEqual(prepareComposeEnvFiles(root, other, [["example", "new.env"]]), []);
  }
  assert.equal(fs.existsSync(path.join(root, "new.env")), false);
});
