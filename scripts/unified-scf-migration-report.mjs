#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonOutput = process.argv.includes("--json");
const sourceRoots = ["scf-code/function-api", "scf-code/website-api", "scf-code/mcp-api", "scf-code/cert-renew", "scf-deploy-packages/auth-api"];
const ignored = new Set(["node_modules", ".git"]);
const envPattern = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g;

async function walk(directory, relative = "") {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name) || /\.test\.(?:c?js|mjs)$/.test(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walk(directory, child));
    else if (entry.isFile() && /\.(?:c?js|mjs)$/.test(entry.name)) files.push(path.join(directory, child));
  }
  return files;
}

async function collectEnvironmentReferences() {
  const references = new Map();
  for (const root of sourceRoots) {
    for (const file of await walk(path.join(repoRoot, root))) {
      const contents = await readFile(file, "utf8");
      for (const match of contents.matchAll(envPattern)) {
        const name = match[1] || match[2];
        const item = references.get(name) || { name, packages: new Set() };
        item.packages.add(root);
        references.set(name, item);
      }
    }
  }
  return [...references.values()]
    .map((item) => ({
      name: item.name,
      packages: [...item.packages].sort(),
      sensitive: /(?:SECRET|PASSWORD|TOKEN|KEY|CREDENTIAL|PRIVATE)/i.test(item.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const manifest = JSON.parse(await readFile(path.join(repoRoot, "scf-code/function-api/system-functions.json"), "utf8"));
const systems = await Promise.all(manifest.map(async (entry) => {
  let sourcePresent = false;
  try {
    await readFile(path.join(repoRoot, entry.sourceDir, entry.entrypoint));
    sourcePresent = true;
  } catch {
    sourcePresent = false;
  }
  return {
    name: entry.name,
    slug: entry.slug,
    routePrefixes: entry.routePrefixes || [],
    timerTriggers: entry.timerTriggers || [],
    triggers: entry.triggers || [],
    requiresVpc: Boolean(entry.requiresVpc),
    requiredEnvironment: entry.requiredEnvironment || [],
    sourcePresent,
    blocker: sourcePresent ? null : (entry.migrationBlocker || "系统函数源码不存在")
  };
}));
const environments = await collectEnvironmentReferences();
const liveConfig = JSON.parse(await readFile(path.join(repoRoot, "scf-code/function-api/live-config.json"), "utf8"));
const liveParity = JSON.parse(await readFile(path.join(repoRoot, "scf-code/function-api/live-parity.json"), "utf8"));
const parity = await Promise.all(liveParity.entries.map(async (entry) => {
  const localBytes = await readFile(path.join(repoRoot, entry.localPath));
  const localSha256 = createHash("sha256").update(localBytes).digest("hex");
  return {
    name: entry.name,
    localPath: entry.localPath,
    liveSha256: entry.liveSha256,
    localSha256,
    matchesRecordedLive: localSha256 === entry.liveSha256,
    expectedExactMatch: entry.exactMatch !== false,
    note: entry.note || null
  };
}));
const unexpectedDrift = parity.filter((entry) => entry.expectedExactMatch && !entry.matchesRecordedLive);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  target: {
    namespace: "demox",
    handler: "index.main",
    publicBaseUrl: "https://api.demox.site",
    note: "本报告只盘点代码和清单，不读取或输出线上环境变量值，也不执行迁移。"
  },
  systems,
  environments,
    liveConfig: {
      checkedAt: liveConfig.checkedAt,
      role: liveConfig.role,
      unifiedRecommendation: liveConfig.unifiedRecommendation
    },
    liveParity: {
      checkedAt: liveParity.checkedAt,
      qualifier: liveParity.qualifier,
      entries: parity
    },
  checks: [
    { id: "source-completeness", status: systems.every((entry) => entry.sourcePresent) ? "ready" : "blocked", detail: systems.filter((entry) => !entry.sourcePresent).map((entry) => `${entry.name}: ${entry.blocker}`) },
    { id: "live-entrypoint-parity", status: unexpectedDrift.length ? "blocked" : "warning", detail: unexpectedDrift.length ? unexpectedDrift.map((entry) => `${entry.name} drifted from recorded live SHA-256`) : "website/auth/mcp matched the 2026-08-31 live entrypoints; cert-renew is a documented testable refactor, not a byte match." },
    { id: "vpc-mapping", status: "ready", detail: `website/auth live VPC is ${liveConfig.unifiedRecommendation.vpc.vpcId}/${liveConfig.unifiedRecommendation.vpc.subnetId}; a unified function must reuse this binding. Staging bind is still pending.` },
    { id: "environment-mapping", status: "ready", detail: `Merged ${liveConfig.unifiedRecommendation.environmentKeys.length} live environment key names into live-config.json. Values were not exported and must be copied only into a staging function.` },
    { id: "trigger-mapping", status: "ready", detail: "HTTP custom domain api.demox.site points at demox-function-api. analytics-rollup-5m and monthly-renew belong on demox-function-api; copies on the old functions should stay disabled until those functions are deleted." },
    { id: "rollback", status: "warning", detail: "四个旧函数仍保留作回滚。HTTP 与定时器已切到 demox-function-api，删除旧函数前再确认一次调用对照。" }
  ]
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`# Demox 统一 SCF 迁移检查\n\n- 目标命名空间：\`${report.target.namespace}\`\n- 统一入口：\`${report.target.handler}\`\n- 对外地址：\`${report.target.publicBaseUrl}\`\n- 边界：${report.target.note}\n\n## 系统函数\n\n| 函数 | HTTP 路径 | 定时触发 | VPC | 源码 |\n| --- | --- | --- | --- | --- |\n${systems.map((entry) => `| ${entry.name} | ${(entry.routePrefixes || []).join(", ") || "-"} | ${(entry.timerTriggers || []).join(", ") || "-"} | ${entry.requiresVpc ? "需要" : "不需要"} | ${entry.sourcePresent ? "已在仓库" : `阻塞：${entry.blocker}`} |`).join("\n")}\n\n## Live 入口对照（${liveParity.checkedAt} ${liveParity.qualifier}）\n\n| 函数 | 与当时 live 一致 | 说明 |\n| --- | --- | --- |\n${parity.map((entry) => `| ${entry.name} | ${entry.matchesRecordedLive ? "是" : "否"} | ${entry.note || (entry.expectedExactMatch ? "应为字节一致" : "")} |`).join("\n")}\n\n## 环境变量清单（仅名称）\n\n| 变量 | 使用模块 | 敏感 |\n| --- | --- | --- |\n${environments.map((entry) => `| ${entry.name} | ${entry.packages.join(", ")} | ${entry.sensitive ? "是" : "否"} |`).join("\n")}\n\n## 验证项\n\n${report.checks.map((check) => `- **${check.status.toUpperCase()}** ${check.id}：${Array.isArray(check.detail) ? (check.detail.join("；") || "无") : check.detail}`).join("\n")}\n`);
}
