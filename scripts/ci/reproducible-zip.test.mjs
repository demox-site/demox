import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCKFILE_INSTALL_ARGS, writeDeterministicZip, zipMode } from "./reproducible-zip.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

test("zip mode is only 0644 or 0755", () => {
  assert.equal(zipMode("scf_bootstrap", 0o644), 0o755);
  assert.equal(zipMode("dir/scf_bootstrap", 0o644), 0o755);
  assert.equal(zipMode("index.js", 0o664), 0o644);
  assert.equal(zipMode("node_modules/.bin/acme", 0o755), 0o755);
});

test("the same tree zips to the same sha256", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "zip-src-"));
  const out = mkdtempSync(path.join(tmpdir(), "zip-out-"));
  mkdirSync(path.join(dir, "nested"));
  writeFileSync(path.join(dir, "b.txt"), "beta\n");
  writeFileSync(path.join(dir, "nested", "a.txt"), "alpha\n");
  writeFileSync(path.join(dir, "scf_bootstrap"), "#!/bin/bash\nexec node\n");
  chmodSync(path.join(dir, "scf_bootstrap"), 0o755);
  chmodSync(path.join(dir, "b.txt"), 0o664);
  const left = path.join(out, "left.zip");
  const right = path.join(out, "right.zip");
  await writeDeterministicZip(dir, left);
  await writeDeterministicZip(dir, right);
  assert.equal(sha256(left), sha256(right));
  rmSync(dir, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
});

test("packaging installs from the unified lockfile, not npm install", () => {
  assert.deepEqual([...LOCKFILE_INSTALL_ARGS], ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]);
  const source = readFileSync(path.join(root, "scripts/package-unified-scf.mjs"), "utf8");
  assert.match(source, /LOCKFILE_INSTALL_ARGS/);
  assert.doesNotMatch(source, /\["install"/);
  const inventory = JSON.parse(execFileSync(process.execPath, ["scripts/package-unified-scf.mjs"], { cwd: root, encoding: "utf8" }));
  const specs = Object.fromEntries(inventory.dependencies.map((item) => [item.name, item.installSpec]));
  const lock = JSON.parse(readFileSync(path.join(root, "scripts/ci/unified-scf-package-lock.json"), "utf8"));
  assert.deepEqual(lock.packages[""].dependencies, specs);
});
