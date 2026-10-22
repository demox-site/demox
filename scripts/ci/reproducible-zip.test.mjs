import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, chmodSync, rmSync, utimesSync, symlinkSync } from "node:fs";
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

function writeTree(dir) {
  mkdirSync(path.join(dir, "nested"));
  writeFileSync(path.join(dir, "Z.txt"), "zed\n");
  writeFileSync(path.join(dir, "b.txt"), "beta\n");
  writeFileSync(path.join(dir, "nested", "a.txt"), "alpha\n");
  writeFileSync(path.join(dir, "scf_bootstrap"), "#!/bin/bash\nexec node\n");
  symlinkSync("b.txt", path.join(dir, "link.txt"));
}

function zipListing(file) {
  const script = [
    "import zipfile, sys",
    "z = zipfile.ZipFile(sys.argv[1])",
    "for info in z.infolist():",
    "    mode = (info.external_attr >> 16) & 0o777",
    "    stamp = ','.join(str(part) for part in info.date_time)",
    "    print(f'{info.filename}\\t{mode:o}\\t{stamp}')"
  ].join("\n");
  return execFileSync("python3", ["-c", script, file], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
}

test("the same tree zips to the same sha256 twice, ignoring mtime and mode", async () => {
  const out = mkdtempSync(path.join(tmpdir(), "zip-out-"));
  const first = mkdtempSync(path.join(tmpdir(), "zip-src-a-"));
  const second = mkdtempSync(path.join(tmpdir(), "zip-src-b-"));
  writeTree(second);
  writeTree(first);
  chmodSync(path.join(first, "scf_bootstrap"), 0o755);
  chmodSync(path.join(first, "b.txt"), 0o664);
  chmodSync(path.join(second, "scf_bootstrap"), 0o644);
  chmodSync(path.join(second, "b.txt"), 0o600);
  chmodSync(path.join(second, "Z.txt"), 0o666);
  const early = new Date(2020, 0, 2, 3, 4, 5);
  const late = new Date(2024, 5, 7, 8, 9, 10);
  for (const file of ["Z.txt", "b.txt", "scf_bootstrap", "nested/a.txt"]) {
    utimesSync(path.join(first, file), early, early);
    utimesSync(path.join(second, file), late, late);
  }
  const left = path.join(out, "left.zip");
  const right = path.join(out, "right.zip");
  await writeDeterministicZip(first, left);
  await writeDeterministicZip(second, right);
  assert.equal(sha256(left), sha256(right));
  const listing = zipListing(left);
  const names = listing.map((line) => line.split("\t")[0]);
  assert.deepEqual(names, ["Z.txt", "b.txt", "nested/a.txt", "scf_bootstrap"]);
  assert.deepEqual(names, [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  const modes = Object.fromEntries(listing.map((line) => {
    const [name, mode] = line.split("\t");
    return [name, mode];
  }));
  assert.equal(modes["b.txt"], "644");
  assert.equal(modes["scf_bootstrap"], "755");
  assert.equal(modes["Z.txt"], "644");
  for (const line of listing) assert.match(line, /\t1980,1,1,0,0,0$/);
  assert.equal(zipListing(left).join("\n"), zipListing(right).join("\n"));
  rmSync(first, { recursive: true, force: true });
  rmSync(second, { recursive: true, force: true });
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
