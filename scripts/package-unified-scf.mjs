#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const allowBlocked = args.has("--allow-blocked");
const outputArg = process.argv.slice(2).find((value) => value.startsWith("--output="));
const outputDir = path.resolve(repoRoot, outputArg ? outputArg.slice("--output=".length) : ".artifacts/unified-scf");
const SCF_INLINE_LIMIT_BYTES = 50 * 1024 * 1024;

const sourcePackages = [
  { id: "function-api", root: "scf-code/function-api", packageJson: "scf-code/function-api/package.json" },
  { id: "website-api", root: "scf-code/website-api", packageJson: "scf-code/website-api/package.json" },
  { id: "auth-api", root: "scf-deploy-packages/auth-api", packageJson: "scf-deploy-packages/auth-api/package.json" },
  { id: "mcp-api", root: "scf-code/mcp-api", packageJson: "scf-code/mcp-api/package.json" },
  { id: "cert-renew", root: "scf-code/cert-renew", packageJson: "scf-code/cert-renew/package.json" }
];
const ignoredFile = (name) => name === "node_modules" || /\.test\.(?:c?js|mjs|ts|tsx)$/.test(name) || name === "package-lock.json";

async function listFiles(directory, relative = "") {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignoredFile(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(directory, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function listAllFiles(directory, relative = "") {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listAllFiles(directory, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function resolveDependencyVersion(packageName, packageInfo, packageRoot) {
  try {
    const lock = await readJson(path.join(repoRoot, packageRoot, "package-lock.json"));
    const lockEntry = lock.packages?.[`node_modules/${packageName}`];
    if (lockEntry?.version) return lockEntry.version;
  } catch {
    // A lockfile is recommended but not required for the dry-run inventory.
  }
  return packageInfo;
}

async function collectDependencies() {
  const byName = new Map();
  for (const source of sourcePackages) {
    const packageJson = await readJson(path.join(repoRoot, source.packageJson));
    const dependencies = { ...packageJson.dependencies, ...packageJson.optionalDependencies };
    for (const [name, range] of Object.entries(dependencies)) {
      const version = await resolveDependencyVersion(name, range, source.root);
      const item = byName.get(name) || { name, versions: new Set(), packages: [] };
      item.versions.add(version);
      item.packages.push({ id: source.id, declared: range, resolved: version });
      byName.set(name, item);
    }
  }
  return [...byName.values()]
    .map((item) => {
      const normalized = { ...item, versions: [...item.versions].sort(), packages: item.packages.sort((a, b) => a.id.localeCompare(b.id)) };
      return { ...normalized, installSpec: dependencySpec(normalized) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function inspectSources() {
  const sources = [];
  for (const source of sourcePackages) {
    const sourceRoot = path.join(repoRoot, source.root);
    const files = await listFiles(sourceRoot);
    for (const relative of files) {
      const absolute = path.join(sourceRoot, relative);
      const fileStat = await stat(absolute);
      sources.push({ package: source.id, path: path.join(source.root, relative).split(path.sep).join("/"), sizeBytes: fileStat.size, sha256: await sha256File(absolute) });
    }
  }
  return sources.sort((a, b) => a.path.localeCompare(b.path));
}

async function inspectSystemManifest() {
  const manifest = await readJson(path.join(repoRoot, "scf-code/function-api/system-functions.json"));
  return Promise.all(manifest.map(async (entry) => {
    const sourcePath = path.join(repoRoot, entry.sourceDir, entry.entrypoint);
    let sourcePresent = false;
    try {
      await stat(sourcePath);
      sourcePresent = true;
    } catch {
      sourcePresent = false;
    }
    return {
      name: entry.name,
      slug: entry.slug,
      sourceDir: entry.sourceDir,
      entrypoint: entry.entrypoint,
      triggers: [...(entry.triggers || [])],
      timerTriggers: [...(entry.timerTriggers || [])],
      requiresVpc: Boolean(entry.requiresVpc),
      requiredEnvironment: [...(entry.requiredEnvironment || [])],
      sourcePresent,
      migrationBlocker: sourcePresent ? null : (entry.migrationBlocker || "系统函数源码不存在")
    };
  }));
}

async function buildInventory() {
  const [sources, dependencies] = await Promise.all([inspectSources(), collectDependencies()]);
  const systems = await inspectSystemManifest();
  const blockers = systems.filter((entry) => !entry.sourcePresent).map((entry) => `${entry.name}: ${entry.migrationBlocker}`);
  return {
    schemaVersion: 1,
    mode: apply ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(),
    entrypoint: "index.js:main",
    sources,
    dependencies,
    systemFunctions: systems,
    blockers
  };
}

async function copySourcePackage(source, stageDir) {
  const sourceRoot = path.join(repoRoot, source.root);
  const files = await listFiles(sourceRoot);
  for (const relative of files) {
    const destination = path.join(stageDir, source.root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(sourceRoot, relative), destination);
  }
}

async function installDependencies(stageDir, dependencies) {
  const packageJson = {
    name: "demox-unified-scf",
    version: "0.1.0",
    private: true,
    type: "commonjs",
    dependencies: Object.fromEntries(dependencies.map((item) => [item.name, dependencySpec(item)]))
  };
  await writeFile(path.join(stageDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: stageDir, maxBuffer: 4 * 1024 * 1024 });
}

function dependencySpec(item) {
  const exactVersions = item.versions.filter((value) => /^\d+(?:\.\d+){2}(?:[-+][0-9A-Za-z.-]+)?$/.test(value));
  if (!exactVersions.length) return item.versions[0] || item.packages[0]?.declared;
  return exactVersions.sort((a, b) => compareVersions(a, b)).at(-1);
}

function compareVersions(left, right) {
  const parse = (value) => String(value).split(/[+-]/, 1)[0].split(".").map((part) => Number(part));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return String(left).localeCompare(String(right));
}

async function writeZip(stageDir, zipPath) {
  const archiver = (await import("archiver")).default;
  const { createWriteStream } = await import("node:fs");
  const archive = archiver("zip", { zlib: { level: 9 } });
  const output = createWriteStream(zipPath);
  const completion = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
  });
  archive.pipe(output);
  const files = await listAllFiles(stageDir);
  for (const relative of files) {
    archive.file(path.join(stageDir, relative), { name: relative.split(path.sep).join("/"), date: new Date(0) });
  }
  await archive.finalize();
  await completion;
}

async function applyBundle(inventory) {
  if (inventory.blockers.length && !allowBlocked) {
    throw new Error(`迁移清单存在阻塞项，拒绝打包：${inventory.blockers.join("；")}（需要 --allow-blocked 才能生成不完整包）`);
  }
  await mkdir(outputDir, { recursive: true });
  const stageDir = path.join(outputDir, "stage");
  const zipPath = path.join(outputDir, "demox-unified-scf.zip");
  try {
    await stat(stageDir);
    throw new Error(`输出目录已包含 stage：${stageDir}；为避免混入旧文件，请先移走它`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const rootFiles = { "index.js": "module.exports = require('./scf-code/function-api/index.js');\n" };
  for (const [relative, contents] of Object.entries(rootFiles)) {
    await mkdir(path.join(stageDir, path.dirname(relative)), { recursive: true });
    await writeFile(path.join(stageDir, relative), contents);
  }
  for (const source of sourcePackages) await copySourcePackage(source, stageDir);
  await installDependencies(stageDir, inventory.dependencies);
  await writeZip(stageDir, zipPath);
  const zipStat = await stat(zipPath);
  inventory.artifact = {
    directory: path.relative(repoRoot, outputDir),
    zip: path.relative(repoRoot, zipPath),
    sizeBytes: zipStat.size,
    sha256: await sha256File(zipPath),
    inlineLimitBytes: SCF_INLINE_LIMIT_BYTES,
    delivery: zipStat.size > SCF_INLINE_LIMIT_BYTES ? "cos-upload-or-layer" : "scf-inline-or-cos"
  };
  await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(inventory, null, 2)}\n`);
  return inventory;
}

const inventory = await buildInventory();
const result = apply ? await applyBundle(inventory) : inventory;
if (apply) await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
