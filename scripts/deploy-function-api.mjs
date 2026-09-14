#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tencentcloud = require("tencentcloud-sdk-nodejs");
const { createClient } = require("/Users/phosa/.codex/skills/devops/scripts/providers/tencent/index.js");
const COS = require("../scf-code/function-api/node_modules/cos-nodejs-sdk-v5");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apply = process.argv.includes("--apply");
const unified = process.argv.includes("--unified");
const disableLegacyTimers = process.argv.includes("--disable-legacy-timers");
const functionName = "demox-function-api";
const nodeRuntimeName = "demox-user-nodejs";
const namespace = "demox";
const region = "ap-guangzhou";
const cosBucket = "demox-analytics-raw-1307257815";
const cosRegion = "ap-chengdu";
const cosKey = unified ? "scf-deploy/demox-unified-scf.zip" : "scf-deploy/demox-function-api.zip";
const vpcId = "vpc-bwtrj6fb";
const subnetId = "subnet-nzrl3bbq";
const role = "demox-runtime-role";
const fallbackPublicBaseUrl = "https://1307257815-3imzoal5x9.ap-guangzhou.tencentscf.com";
const sourceRoot = path.join(repoRoot, "scf-code/function-api");
const zipPath = unified
  ? path.join(repoRoot, ".artifacts/unified-scf/demox-unified-scf.zip")
  : path.join(repoRoot, ".artifacts/function-api/demox-function-api.zip");

const ignored = (name) => (
  name === "node_modules" ? false : (
    name === ".git" ||
    /\.test\.(?:c?js|mjs)$/.test(name) ||
    name === "SOURCE.md"
  )
);

async function listFiles(directory, relative = "") {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (relative === "" && ignored(entry.name) && entry.name !== "node_modules") continue;
    if (entry.name === ".bin") continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(directory, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function writeZip() {
  if (unified) {
    const fileStat = await stat(zipPath);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(zipPath)) hash.update(chunk);
    return { zipPath, sizeBytes: fileStat.size, sha256: hash.digest("hex") };
  }
  const archiver = (await import("archiver")).default;
  await mkdir(path.dirname(zipPath), { recursive: true });
  await rm(zipPath, { force: true });
  const archive = archiver("zip", { zlib: { level: 9 } });
  const output = createWriteStream(zipPath);
  const done = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
  });
  archive.pipe(output);
  for (const relative of await listFiles(sourceRoot)) {
    archive.file(path.join(sourceRoot, relative), { name: relative.split(path.sep).join("/") });
  }
  await archive.finalize();
  await done;
  const bytes = createReadStream(zipPath);
  const hash = createHash("sha256");
  for await (const chunk of bytes) hash.update(chunk);
  const fileStat = await stat(zipPath);
  return { zipPath, sizeBytes: fileStat.size, sha256: hash.digest("hex") };
}

function envMap(fn) {
  return Object.fromEntries((fn.Environment?.Variables || []).map((item) => [item.Key, item.Value]));
}

function pickCopiedEnv(source) {
  const keys = ["JWT_SECRET", "MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_PORT", "MYSQL_DATABASE"];
  const missing = keys.filter((key) => !source[key]);
  if (missing.length) throw new Error(`website-api 缺少复制所需环境变量: ${missing.join(", ")}`);
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

async function mergeLiveEnv() {
  const merged = {};
  for (const name of ["demox-website-api", "demox-auth-api", "demox-mcp-api", "demox-cert-renew"]) {
    Object.assign(merged, envMap(await scf.GetFunction({ FunctionName: name, Namespace: namespace })));
  }
  return merged;
}

function parseHttpTriggerDesc(trigger) {
  try {
    return JSON.parse(trigger.TriggerDesc || "{}");
  } catch {
    return {};
  }
}

function httpTriggerUrl(fn) {
  for (const trigger of fn.Triggers || []) {
    if (trigger.Type !== "http") continue;
    const desc = parseHttpTriggerDesc(trigger);
    const url = desc.NetConfig?.ExtranetUrl || desc.NetConfig?.Url || "";
    if (url) return String(url).replace(/\/+$/, "");
  }
  return fallbackPublicBaseUrl;
}

function intranetTriggerUrl(fn) {
  for (const trigger of fn.Triggers || []) {
    if (trigger.Type !== "http") continue;
    const net = parseHttpTriggerDesc(trigger).NetConfig || {};
    const intranet = String(net.IntranetUrl || net.InternalUrl || "").replace(/\/+$/, "");
    if (intranet) return intranet;
    const url = String(net.Url || "").replace(/\/+$/, "");
    if (url && (/\.in\./i.test(url) || net.EnableExtranet === false)) return url;
  }
  return "";
}

async function resolveInvokeSecret() {
  const [router, runtime] = await Promise.all([
    scf.GetFunction({ FunctionName: functionName, Namespace: namespace }).catch(() => null),
    scf.GetFunction({ FunctionName: nodeRuntimeName, Namespace: namespace }).catch(() => null)
  ]);
  return envMap(router || {}).RUNTIME_INVOKE_SECRET
    || envMap(runtime || {}).RUNTIME_INVOKE_SECRET
    || randomBytes(32).toString("hex");
}

async function uploadZip(artifact) {
  const copied = unified ? await mergeLiveEnv() : pickCopiedEnv(envMap(await scf.GetFunction({ FunctionName: "demox-website-api", Namespace: namespace })));
  const { loadCredentials } = require("/Users/phosa/.codex/skills/devops/scripts/lib/credentials.js");
  const cred = loadCredentials("tencent");
  const cos = new COS({
    SecretId: cred.secretId,
    SecretKey: cred.secretKey
  });
  await new Promise((resolve, reject) => {
    cos.putObject({
      Bucket: cosBucket,
      Region: cosRegion,
      Key: cosKey,
      Body: createReadStream(artifact.zipPath)
    }, (error, data) => (error ? reject(error) : resolve(data)));
  });
  return copied;
}

const scf = createClient(tencentcloud.scf.v20180416.Client, region);

function routerEnvironment(copied, current, { secret, runtimeUrl } = {}) {
  const publicBaseUrl = current ? httpTriggerUrl(current) : fallbackPublicBaseUrl;
  const environment = {
    ...copied,
    FUNCTIONS_COS_BUCKET: cosBucket,
    FUNCTIONS_COS_REGION: cosRegion,
    FUNCTION_PUBLIC_BASE_URL: unified ? "https://api.demox.site" : publicBaseUrl,
    AUTH_API_URL: unified ? "https://api.demox.site/auth" : `${publicBaseUrl}/auth`,
    WEBSITE_API_URL: unified ? "https://api.demox.site" : publicBaseUrl,
    DEMOX_SITE_WEBSITE_ID: "EPX2UU43",
    DEMOX_PLATFORM_WEBSITE_ID: "EPX2UU43",
    FUNCTION_ENV: "production",
    FUNCTIONS_NODE_RUNTIME: nodeRuntimeName,
    FUNCTIONS_RUNTIME_NAMESPACE: namespace,
    RUNTIME_INVOKE_SECRET: secret
  };
  if (runtimeUrl) environment.FUNCTIONS_NODE_RUNTIME_URL = runtimeUrl;
  return environment;
}

async function ensureFunction(copied, hop = {}) {
  const current = await scf.GetFunction({ FunctionName: functionName, Namespace: namespace }).catch(() => null);
  const environment = routerEnvironment(copied, current, hop);
  const exists = Boolean(current);
  const cosBucketName = cosBucket.replace(/-\d+$/, "");
  if (!exists) {
    await scf.CreateFunction({
      FunctionName: functionName,
      Runtime: "Nodejs18.15",
      Handler: "index.main",
      Description: "Demox user functions runtime; parallel to the original four backends",
      MemorySize: 512,
      Timeout: unified ? 300 : 90,
      Namespace: namespace,
      Role: role,
      Type: "Event",
      Code: {
        CosBucketName: cosBucketName,
        CosObjectName: cosKey,
        CosBucketRegion: cosRegion
      },
      VpcConfig: { VpcId: vpcId, SubnetId: subnetId },
      PublicNetConfig: { PublicNetStatus: "ENABLE", EipConfig: { EipStatus: "DISABLE" } },
      Environment: { Variables: Object.entries(environment).map(([Key, Value]) => ({ Key, Value })) },
      Tags: [{ Key: "codename", Value: "demox" }]
    });
  } else {
    await scf.UpdateFunctionCode({
      FunctionName: functionName,
      Namespace: namespace,
      Handler: "index.main",
      CosBucketName: cosBucketName,
      CosObjectName: cosKey,
      CosBucketRegion: cosRegion
    });
    await waitActive();
    await scf.UpdateFunctionConfiguration({
      FunctionName: functionName,
      Namespace: namespace,
      MemorySize: 512,
      Timeout: unified ? 300 : 90,
      Role: role,
      VpcConfig: { VpcId: vpcId, SubnetId: subnetId },
      PublicNetConfig: { PublicNetStatus: "ENABLE", EipConfig: { EipStatus: "DISABLE" } },
      Environment: { Variables: Object.entries(environment).map(([Key, Value]) => ({ Key, Value })) }
    });
  }
  return { exists, environmentKeys: Object.keys(environment).sort() };
}

async function waitActive(name = functionName) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const current = await scf.GetFunction({ FunctionName: name, Namespace: namespace });
    if (current.Status === "Active") return current;
    if (current.Status === "CreateFailed" || current.Status === "UpdateFailed") {
      throw new Error(`函数状态失败: ${name} ${current.Status} ${current.StatusDesc || ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`等待 ${name} Active 超时`);
}

async function applyRouterHop(copied, hop) {
  const current = await scf.GetFunction({ FunctionName: functionName, Namespace: namespace });
  const environment = routerEnvironment(copied, current, hop);
  await scf.UpdateFunctionConfiguration({
    FunctionName: functionName,
    Namespace: namespace,
    Environment: { Variables: Object.entries(environment).map(([Key, Value]) => ({ Key, Value })) }
  });
  return { environmentKeys: Object.keys(environment).sort() };
}

async function ensureNodeRuntime({ secret } = {}) {
  const handler = unified ? "runtime-nodejs.main" : "runtime-nodejs-handler.main";
  const current = await scf.GetFunction({ FunctionName: nodeRuntimeName, Namespace: namespace }).catch(() => null);
  const cosBucketName = cosBucket.replace(/-\d+$/, "");
  const code = {
    CosBucketName: cosBucketName,
    CosObjectName: cosKey,
    CosBucketRegion: cosRegion
  };
  const environment = {
    Variables: [
      { Key: "FUNCTION_RUNTIME", Value: "nodejs" },
      { Key: "RUNTIME_INVOKE_SECRET", Value: secret }
    ]
  };
  if (!current) {
    await scf.CreateFunction({
      FunctionName: nodeRuntimeName,
      Runtime: "Nodejs18.15",
      Handler: handler,
      Description: "Demox user Node.js runtime pool; invoked only by demox-function-api",
      MemorySize: 512,
      Timeout: 300,
      Namespace: namespace,
      Type: "Event",
      Code: code,
      VpcConfig: { VpcId: vpcId, SubnetId: subnetId },
      PublicNetConfig: { PublicNetStatus: "ENABLE", EipConfig: { EipStatus: "DISABLE" } },
      Environment: environment,
      Tags: [{ Key: "codename", Value: "demox" }]
    });
  } else {
    await scf.UpdateFunctionCode({
      FunctionName: nodeRuntimeName,
      Namespace: namespace,
      Handler: handler,
      CosBucketName: cosBucketName,
      CosObjectName: cosKey,
      CosBucketRegion: cosRegion
    });
    await waitActive(nodeRuntimeName);
    await scf.UpdateFunctionConfiguration({
      FunctionName: nodeRuntimeName,
      Namespace: namespace,
      MemorySize: 512,
      Timeout: 300,
      VpcConfig: { VpcId: vpcId, SubnetId: subnetId },
      PublicNetConfig: { PublicNetStatus: "ENABLE", EipConfig: { EipStatus: "DISABLE" } },
      Environment: environment
    });
  }
  return waitActive(nodeRuntimeName);
}

async function ensureNodeRuntimeHttpTrigger() {
  let current = await scf.GetFunction({ FunctionName: nodeRuntimeName, Namespace: namespace });
  const existing = (current.Triggers || []).some((item) => item.Type === "http");
  if (!existing) {
    await scf.CreateTrigger({
      FunctionName: nodeRuntimeName,
      Namespace: namespace,
      TriggerName: "runtime-http",
      Type: "http",
      Qualifier: "$LATEST",
      Enable: "OPEN",
      TriggerDesc: JSON.stringify({
        AuthType: "NONE",
        NetConfig: { EnableExtranet: false, EnableIntranet: true }
      })
    });
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    current = await scf.GetFunction({ FunctionName: nodeRuntimeName, Namespace: namespace });
    const url = intranetTriggerUrl(current);
    if (url) return { created: !existing, url };
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { created: !existing, url: "" };
}

async function ensureHttpTrigger() {
  const current = await scf.GetFunction({ FunctionName: functionName, Namespace: namespace });
  if ((current.Triggers || []).some((item) => item.Type === "http")) {
    return { created: false };
  }
  await scf.CreateTrigger({
    FunctionName: functionName,
    Namespace: namespace,
    TriggerName: "function-api-http",
    Type: "http",
    Qualifier: "$LATEST",
    Enable: "OPEN",
    TriggerDesc: JSON.stringify({
      AuthType: "NONE",
      NetConfig: { EnableExtranet: true, EnableIntranet: true }
    })
  });
  return { created: true };
}

const TIMER_TRIGGERS = [
  { name: "analytics-rollup-5m", triggerDesc: "0 */5 * * * * *" },
  { name: "monthly-renew", triggerDesc: "0 17 3 1 * * *" }
];

async function ensureTimerTriggers() {
  const current = await scf.GetFunction({ FunctionName: functionName, Namespace: namespace });
  const existing = new Set((current.Triggers || []).filter((item) => item.Type === "timer").map((item) => item.TriggerName));
  const created = [];
  for (const trigger of TIMER_TRIGGERS) {
    if (existing.has(trigger.name)) continue;
    await scf.CreateTrigger({
      FunctionName: functionName,
      Namespace: namespace,
      TriggerName: trigger.name,
      Type: "timer",
      Qualifier: "$LATEST",
      Enable: "OPEN",
      TriggerDesc: trigger.triggerDesc
    });
    created.push(trigger.name);
  }
  return { created, existing: [...existing] };
}

async function closeLegacyTimerTriggers() {
  const legacy = [
    { functionName: "demox-website-api", triggerName: "analytics-rollup-5m", triggerDesc: "0 */5 * * * * *" },
    { functionName: "demox-cert-renew", triggerName: "monthly-renew", triggerDesc: "0 17 3 1 * * *" }
  ];
  const disabled = [];
  for (const trigger of legacy) {
    const current = await scf.GetFunction({ FunctionName: trigger.functionName, Namespace: namespace });
    const live = (current.Triggers || []).find((item) => item.Type === "timer" && item.TriggerName === trigger.triggerName);
    if (!live || Number(live.Enable) === 0 || String(live.Enable).toUpperCase() === "CLOSE") continue;
    await scf.UpdateTrigger({
      FunctionName: trigger.functionName,
      Namespace: namespace,
      TriggerName: trigger.triggerName,
      Type: "timer",
      Qualifier: live.Qualifier || "$LATEST",
      Enable: "CLOSE",
      TriggerDesc: live.TriggerDesc || trigger.triggerDesc
    });
    disabled.push(`${trigger.functionName}:${trigger.triggerName}`);
  }
  return { disabled };
}

async function ensureCustomDomain() {
  const domain = await scf.GetCustomDomain({ Domain: "api.demox.site" });
  const endpoints = (domain.EndpointsConfig || []).map((item) => ({
    Namespace: item.Namespace,
    FunctionName: item.FunctionName,
    Qualifier: item.Qualifier,
    PathMatch: item.PathMatch,
    ...(item.PathRewrite ? { PathRewrite: item.PathRewrite } : {})
  }));
  const needed = ["/", "/*", "/functions", "/functions/*", "/EPX2UU43", "/EPX2UU43/*"];
  const missing = needed.filter((pathMatch) => !endpoints.some((item) => item.PathMatch === pathMatch));
  if (!missing.length) return { updated: false, added: [] };
  for (const pathMatch of missing) {
    endpoints.push({
      Namespace: namespace,
      FunctionName: functionName,
      Qualifier: "$LATEST",
      PathMatch: pathMatch
    });
  }
  await scf.UpdateCustomDomain({
    Domain: "api.demox.site",
    Protocol: domain.Protocol || "HTTPS",
    CertConfig: domain.CertConfig?.CertificateId ? { CertificateId: domain.CertConfig.CertificateId } : undefined,
    EndpointsConfig: endpoints
  });
  return { updated: true, added: missing };
}

async function migrate() {
  const jwt = require("jsonwebtoken");
  const website = await scf.GetFunction({ FunctionName: "demox-website-api", Namespace: namespace });
  const secret = envMap(website).JWT_SECRET;
  const token = jwt.sign({ userId: "deploy-bootstrap" }, secret, { expiresIn: "5m" });
  const invoked = await scf.Invoke({
    FunctionName: functionName,
    Namespace: namespace,
    Qualifier: "$LATEST",
    InvocationType: "RequestResponse",
    ClientContext: JSON.stringify({
      httpMethod: "GET",
      path: "/functions",
      queryStringParameters: { kind: "system", host: "www.demox.site" },
      headers: { authorization: `Bearer ${token}` }
    })
  });
  const payload = JSON.parse(invoked.Result?.RetMsg || invoked.RetMsg || "{}");
  return { statusCode: payload.statusCode || invoked.Result?.FunctionError || null, error: payload.body ? safeError(payload.body) : null };
}

function safeError(body) {
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    return parsed.error || parsed.message || null;
  } catch {
    return "unparsed";
  }
}

const artifact = await writeZip();
const inventory = {
  functionName,
  namespace,
  unified,
  publicBaseUrl: fallbackPublicBaseUrl,
  artifact,
  cos: { bucket: cosBucket, region: cosRegion, key: cosKey },
  vpc: { vpcId, subnetId },
  role,
  apply
};
if (!apply) {
  console.log(JSON.stringify({ ...inventory, note: "dry-run; pass --apply to create the parallel function" }, null, 2));
  process.exit(0);
}

const copied = await uploadZip(artifact);
const secret = await resolveInvokeSecret();
let runtimeUrl = intranetTriggerUrl(
  await scf.GetFunction({ FunctionName: nodeRuntimeName, Namespace: namespace }).catch(() => ({ Triggers: [] }))
);
const created = await ensureFunction(copied, { secret, runtimeUrl });
const active = await waitActive();
const nodeRuntime = await ensureNodeRuntime({ secret });
const runtimeHttp = await ensureNodeRuntimeHttpTrigger();
if (runtimeHttp.url && runtimeHttp.url !== runtimeUrl) {
  runtimeUrl = runtimeHttp.url;
  const hop = await applyRouterHop(copied, { secret, runtimeUrl });
  created.environmentKeys = hop.environmentKeys;
  await waitActive();
}
const trigger = await ensureHttpTrigger();
const timers = unified ? await ensureTimerTriggers() : { created: [], existing: [] };
const domain = await ensureCustomDomain();
const migrated = await migrate();
const legacyTimers = unified && disableLegacyTimers ? await closeLegacyTimerTriggers() : { disabled: [] };
console.log(JSON.stringify({
  ...inventory,
  existed: created.exists,
  environmentKeys: created.environmentKeys,
  status: active.Status,
  nodeRuntime: { name: nodeRuntimeName, status: nodeRuntime.Status, handler: nodeRuntime.Handler },
  runtimeHop: { url: runtimeUrl || null, secretSet: Boolean(secret), created: runtimeHttp.created },
  trigger,
  timers,
  domain,
  migrated,
  legacyTimers
}, null, 2));
