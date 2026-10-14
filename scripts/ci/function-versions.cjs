'use strict';

/**
 * 平台函数的 app / runtime 版本规则。
 *
 * 三条轨道：
 * - app：平台函数的业务代码
 * - runtime：SCF 基底（打包、层、内存、超时、入口、环境变量名、触发器）。指纹不含变量值。
 * - user：用户在自己站点上发布的函数。清单里不能出现。
 *
 * 线上状态只认别名 develop / production 指向的版本描述（demox-release 一行）。
 * 描述里没有这行元数据时，调用方必须停下来告警，不能覆盖。
 * 这里不调用云 API。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DESCRIPTION_PREFIX = 'demox-release';
const PLACEHOLDER = 'placeholder';
const BANNED_CODE_PREFIXES = ['src/', 'examples/', 'public/', 'edge-functions/'];
const BANNED_ACCOUNT_IDS = ['100021031865', '1307257815'];
const CODE_IGNORE = /\.test\.(?:c?js|mjs)$|\.md$/;

function repoRoot() {
  return path.resolve(__dirname, '../..');
}

function parseSemver(input) {
  const text = String(input == null ? '' : input);
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text);
  if (!match) {
    const error = new Error(`不是 semver：${text}`);
    error.code = 'bad-semver';
    throw error;
  }
  const parts = [match[1], match[2], match[3]];
  if (parts.some((part) => part.length > 1 && part.startsWith('0'))) {
    throw Object.assign(new Error(`不是 semver：${text}`), { code: 'bad-semver' });
  }
  const pre = match[4] ? match[4].split('.') : null;
  if (pre && pre.some((id) => /^\d+$/.test(id) && id.length > 1 && id.startsWith('0'))) {
    throw Object.assign(new Error(`不是 semver：${text}`), { code: 'bad-semver' });
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre
  };
}

function compareIdent(left, right) {
  const leftNum = /^\d+$/.test(left);
  const rightNum = /^\d+$/.test(right);
  if (leftNum && rightNum) return Math.sign(Number(left) - Number(right));
  if (leftNum && !rightNum) return -1;
  if (!leftNum && rightNum) return 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (a.major !== b.major) return Math.sign(a.major - b.major);
  if (a.minor !== b.minor) return Math.sign(a.minor - b.minor);
  if (a.patch !== b.patch) return Math.sign(a.patch - b.patch);
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  const length = Math.max(a.pre.length, b.pre.length);
  for (let index = 0; index < length; index += 1) {
    if (index >= a.pre.length) return -1;
    if (index >= b.pre.length) return 1;
    const diff = compareIdent(a.pre[index], b.pre[index]);
    if (diff) return diff;
  }
  return 0;
}

function isPlaceholderVersion(version) {
  const pre = parseSemver(version).pre;
  return Boolean(pre && pre.includes(PLACEHOLDER));
}

function canonicalRuntime(runtime) {
  return {
    entry: runtime.entry,
    environmentNames: [...runtime.environmentNames].sort(),
    layers: [...runtime.layers].map(String).sort(),
    memoryMB: runtime.memoryMB,
    timeoutSec: runtime.timeoutSec,
    triggers: [...runtime.triggers].sort()
  };
}

function configFingerprint(runtime) {
  assertRuntime(runtime);
  return crypto.createHash('sha256').update(JSON.stringify(canonicalRuntime(runtime))).digest('hex');
}

function assertRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object') throw Object.assign(new Error('runtime 配置缺失'), { code: 'bad-runtime' });
  for (const key of ['environment', 'env', 'values', 'environmentValues', 'variables']) {
    if (Object.prototype.hasOwnProperty.call(runtime, key)) {
      throw Object.assign(new Error('runtime 配置不能带环境变量值'), { code: 'secret-in-runtime' });
    }
  }
  if (typeof runtime.entry !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(runtime.entry)) {
    throw Object.assign(new Error(`入口不合法：${runtime.entry}`), { code: 'bad-runtime' });
  }
  if (!Number.isInteger(runtime.memoryMB) || runtime.memoryMB < 64 || runtime.memoryMB > 8192) {
    throw Object.assign(new Error(`内存不合法：${runtime.memoryMB}`), { code: 'bad-runtime' });
  }
  if (!Number.isInteger(runtime.timeoutSec) || runtime.timeoutSec < 1 || runtime.timeoutSec > 900) {
    throw Object.assign(new Error(`超时不合法：${runtime.timeoutSec}`), { code: 'bad-runtime' });
  }
  if (!Array.isArray(runtime.layers) || !Array.isArray(runtime.environmentNames) || !Array.isArray(runtime.triggers)) {
    throw Object.assign(new Error('layers、environmentNames、triggers 必须是数组'), { code: 'bad-runtime' });
  }
  for (const name of runtime.environmentNames) {
    if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
      throw Object.assign(new Error(`环境变量名不合法：${name}`), { code: 'bad-runtime' });
    }
  }
  for (const layer of runtime.layers) {
    if (typeof layer !== 'string' || !/^[A-Za-z0-9_.:-]+$/.test(layer)) {
      throw Object.assign(new Error(`层名不合法：${layer}`), { code: 'bad-runtime' });
    }
  }
  for (const trigger of runtime.triggers) {
    if (typeof trigger !== 'string' || !/^[a-z]+:[A-Za-z0-9_.:*-]+$/.test(trigger)) {
      throw Object.assign(new Error(`触发器不合法：${trigger}`), { code: 'bad-runtime' });
    }
  }
}

function formatDescription({ app, runtime, git, sha256, cfg }) {
  parseSemver(app);
  parseSemver(runtime);
  if (!/^[0-9a-f]{40}$/.test(String(git || ''))) {
    throw Object.assign(new Error('git sha 必须是 40 位小写十六进制，拒绝写入版本描述。'), { code: 'bad-git' });
  }
  if (!/^[0-9a-f]{64}$/.test(String(sha256 || '')) || !/^[0-9a-f]{64}$/.test(String(cfg || ''))) {
    throw Object.assign(new Error('sha256 和配置指纹必须是 64 位小写十六进制。'), { code: 'bad-sha' });
  }
  const line = `${DESCRIPTION_PREFIX} app=${app} runtime=${runtime} git=${git} sha256=${sha256} cfg=${cfg}`;
  if (line.length > 900 || /[\r\n]/.test(line)) {
    throw Object.assign(new Error('版本描述过长或含换行。'), { code: 'bad-description' });
  }
  return line;
}

function parseDescription(description) {
  const text = String(description == null ? '' : description).trim();
  const match = /^demox-release app=(\S+) runtime=(\S+) git=([0-9a-f]{40}) sha256=([0-9a-f]{64}) cfg=([0-9a-f]{64})$/.exec(text);
  if (!match) return null;
  try {
    parseSemver(match[1]);
    parseSemver(match[2]);
  } catch {
    return null;
  }
  return { app: match[1], runtime: match[2], git: match[3], sha256: match[4], cfg: match[5] };
}

function assertRelativePath(value, label) {
  const text = String(value || '');
  if (!text || text.startsWith('/') || text.split('/').includes('..') || text.includes('\\')) {
    throw Object.assign(new Error(`${label} 不是仓库内相对路径：${text}`), { code: 'bad-path' });
  }
  return text;
}

function walkAccountIds(value, errors, at) {
  if (typeof value === 'string') {
    if (/^\d{8,}$/.test(value)) errors.push(`${at} 像账号数字，清单里不能写账号`);
    for (const id of BANNED_ACCOUNT_IDS) {
      if (value.includes(id)) errors.push(`${at} 含有账号标识`);
    }
    return;
  }
  if (typeof value === 'number') {
    if (value >= 1e8) errors.push(`${at} 像账号数字，清单里不能写账号`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkAccountIds(item, errors, `${at}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) walkAccountIds(child, errors, `${at}.${key}`);
  }
}

function validateManifest(manifest, { checkPaths = false, root = repoRoot() } = {}) {
  const errors = [];
  if (!manifest || manifest.schemaVersion !== 1) errors.push('schemaVersion 必须是 1');
  if (!manifest || !Array.isArray(manifest.functions) || manifest.functions.length === 0) {
    return { ok: false, errors: errors.concat('functions 必须是非空数组') };
  }
  walkAccountIds(manifest, errors, '$');
  const names = new Set();
  const excluded = new Set((manifest.excluded || []).map((item) => item.name));
  for (const item of manifest.excluded || []) {
    if (item.track !== 'user' && item.track !== 'rollback') errors.push(`排除项 ${item.name} 的 track 只能是 user 或 rollback`);
  }
  if (!(manifest.excluded || []).some((item) => item.track === 'user')) errors.push('清单必须明确排除 user 轨道');
  let deployCount = 0;
  for (const fn of manifest.functions) {
    if (!fn.name || names.has(fn.name)) errors.push(`函数名重复或为空：${fn.name}`);
    names.add(fn.name);
    if (excluded.has(fn.name)) errors.push(`${fn.name} 在排除名单里，不能列入平台函数`);
    if (fn.layer !== 'platform') errors.push(`${fn.name} 的 layer 必须是 platform`);
    if (fn.track === 'user') errors.push(`${fn.name} 是 user 轨道，不能列入平台函数`);
    if (fn.cloud !== 'tencent-scf') errors.push(`${fn.name} 的 cloud 必须是 tencent-scf`);
    if (!/^ap-[a-z0-9-]+$/.test(String(fn.region || ''))) errors.push(`${fn.name} 的 region 不合法`);
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(String(fn.namespace || ''))) errors.push(`${fn.name} 的 namespace 不合法`);
    if (!/^[A-Z][A-Z0-9_]+$/.test(String(fn.accountEnv || ''))) errors.push(`${fn.name} 的 accountEnv 必须是环境变量名，不能是账号`);
    if (fn.releaseVia !== 'deploy-develop' && fn.releaseVia !== 'none') errors.push(`${fn.name} 的 releaseVia 不合法`);
    if (fn.releaseVia === 'deploy-develop') deployCount += 1;
    try {
      parseSemver(fn.appVersion);
      parseSemver(fn.runtimeVersion);
    } catch (error) {
      errors.push(`${fn.name} 的版本 ${error.message}`);
    }
    if (manifest.seed === true) {
      try {
        if (!isPlaceholderVersion(fn.appVersion) || !isPlaceholderVersion(fn.runtimeVersion)) {
          errors.push(`${fn.name} 在 seed 期间必须使用占位版本`);
        }
      } catch { /* 版本格式错误上面已经记了 */ }
    } else {
      try {
        if (isPlaceholderVersion(fn.appVersion) || isPlaceholderVersion(fn.runtimeVersion)) {
          errors.push(`${fn.name} 去掉 seed 之后不能再留占位版本`);
        }
      } catch { /* 同上 */ }
    }
    for (const codePath of fn.codePaths || []) {
      try {
        const rel = assertRelativePath(codePath, `${fn.name} codePath`);
        if (BANNED_CODE_PREFIXES.some((prefix) => rel === prefix.slice(0, -1) || rel.startsWith(prefix))) {
          errors.push(`${fn.name} 的代码路径不能是用户站点或主站前端：${rel}`);
        }
        if (checkPaths && !fs.existsSync(path.join(root, rel))) errors.push(`${fn.name} 的代码路径不存在：${rel}`);
      } catch (error) {
        errors.push(error.message);
      }
    }
    if (!Array.isArray(fn.codePaths) || fn.codePaths.length === 0) errors.push(`${fn.name} 缺少 codePaths`);
    if (!Array.isArray(fn.runtimePaths) || fn.runtimePaths.length === 0) errors.push(`${fn.name} 缺少 runtimePaths`);
    for (const runtimePath of fn.runtimePaths || []) {
      try {
        const rel = assertRelativePath(runtimePath, `${fn.name} runtimePath`);
        if (checkPaths && !fs.existsSync(path.join(root, rel))) errors.push(`${fn.name} 的 runtime 路径不存在：${rel}`);
      } catch (error) {
        errors.push(error.message);
      }
    }
    try {
      assertRuntime(fn.runtime);
    } catch (error) {
      errors.push(`${fn.name} ${error.message}`);
    }
  }
  if (deployCount < 1) errors.push('至少要有一个 releaseVia=deploy-develop 的平台函数');
  return { ok: errors.length === 0, errors };
}

function loadManifest(root = repoRoot()) {
  const file = path.join(root, 'functions.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function deployEntry(manifest) {
  return (manifest.functions || []).find((fn) => fn.name === 'demox-function-api' && fn.releaseVia === 'deploy-develop') || null;
}

function assertNotPlaceholder(entry) {
  if (!entry) {
    throw Object.assign(new Error('清单里没有可走 deploy-develop 的 demox-function-api。已停止，不会发布。'), { code: 'no-entry' });
  }
  if (isPlaceholderVersion(entry.appVersion) || isPlaceholderVersion(entry.runtimeVersion)) {
    throw Object.assign(new Error(`清单里 ${entry.name} 的 app/runtime 仍是占位版本，不是线上版本。已停止，不会发布，也不会覆盖线上函数。`), { code: 'placeholder' });
  }
}

function matchesPath(file, roots) {
  const normalized = String(file || '').split('\\').join('/');
  return (roots || []).some((root) => {
    const rel = String(root).split('\\').join('/');
    return normalized === rel || normalized.startsWith(`${rel}/`);
  });
}

function isIgnoredCodeFile(file) {
  return CODE_IGNORE.test(String(file).split('/').pop());
}

function runtimePlanLines(manifest) {
  const check = validateManifest(manifest);
  if (!check.ok) {
    const error = new Error(check.errors.join('\n'));
    error.code = 'bad-manifest';
    throw error;
  }
  const lines = manifest.functions.map((fn) => `${fn.name} app=${fn.appVersion} runtime=${fn.runtimeVersion} cfg=${configFingerprint(fn.runtime)} release=${fn.releaseVia}`);
  lines.push('runtime-plan 只根据清单重算配置指纹，不读取线上配置，也不部署。runtime 变更需要云架构复核和 Chief 批准。');
  return lines;
}

function versionRow(versions, version) {
  return (versions || []).find((item) => String(item.Version) === String(version)) || null;
}

function decideAppDeploy({ entry, aliases, versions, codeSha256, gitSha, aliasNames = ['develop', 'production'] }) {
  const stop = (reason, message) => ({ allow: false, reason, message, description: null, live: null });
  for (const name of aliasNames) {
    const alias = (aliases || []).find((item) => item.Name === name);
    if (!alias || alias.FunctionVersion === '$LATEST') {
      return stop('missing-alias', `别名 ${name} 不存在或指向 $LATEST。已停止，不会创建别名，也不会发布。`);
    }
  }
  const parsed = [];
  for (const name of aliasNames) {
    const alias = aliases.find((item) => item.Name === name);
    const row = versionRow(versions, alias.FunctionVersion);
    const meta = row && parseDescription(row.Description);
    if (!meta) {
      return stop('missing-metadata', `线上别名 ${name} 的版本描述没有 demox-release 元数据（app、runtime、git、sha256、cfg）。已停止并告警，不会覆盖线上代码或配置。`);
    }
    parsed.push({ alias: name, version: String(alias.FunctionVersion), meta });
  }
  const max = parsed.reduce((best, item) => (compareSemver(item.meta.app, best.meta.app) >= 0 ? item : best));
  const peers = parsed.filter((item) => compareSemver(item.meta.app, max.meta.app) === 0);
  for (const item of peers) {
    if (item.meta.runtime !== max.meta.runtime || item.meta.sha256 !== max.meta.sha256 || item.meta.cfg !== max.meta.cfg) {
      return stop('alias-drift', 'develop 与 production 上较高的 app 版本元数据不一致。已停止，不会覆盖。');
    }
  }
  const live = max.meta;
  let localCfg;
  try {
    localCfg = configFingerprint(entry.runtime);
  } catch (error) {
    return stop('bad-runtime', error.message);
  }
  if (!/^[0-9a-f]{40}$/.test(String(gitSha || ''))) {
    return stop('bad-git', 'git sha 必须是 40 位小写十六进制，拒绝写入版本描述。');
  }
  if (!/^[0-9a-f]{64}$/.test(String(codeSha256 || ''))) {
    return stop('bad-sha', '代码 sha256 必须是 64 位小写十六进制。');
  }
  const appDiff = compareSemver(entry.appVersion, live.app);
  const runtimeDiff = compareSemver(entry.runtimeVersion, live.runtime);
  if (appDiff < 0) {
    return stop('downgrade', `本地 app ${entry.appVersion} 低于线上 app ${live.app}，CI 不会降级。`);
  }
  if (runtimeDiff < 0) {
    return stop('runtime-drift', `本地 runtime ${entry.runtimeVersion} 低于线上 runtime ${live.runtime}。已停止，不会降级 runtime。`);
  }
  if (appDiff === 0 && codeSha256 !== live.sha256) {
    return stop('code-drift', `app 版本同为 ${entry.appVersion}，但代码 sha256 与线上不一致。拒绝发布。`);
  }
  if (localCfg !== live.cfg) {
    return stop('config-drift', `app 发布必须保持配置指纹不变（线上 ${live.cfg}，本地 ${localCfg}）。runtime 变更要走单独路径，本命令不会改配置。`);
  }
  if (runtimeDiff !== 0) {
    return stop('runtime-drift', `本地 runtime ${entry.runtimeVersion} 与线上 runtime ${live.runtime} 不同。runtime 发布需要云架构复核和 Chief 批准，这里不会自动发布。`);
  }
  if (appDiff === 0) {
    return stop('already-published', `app 版本与代码指纹、配置指纹都与线上一致，不需要发布。`);
  }
  const description = formatDescription({
    app: entry.appVersion,
    runtime: entry.runtimeVersion,
    git: gitSha,
    sha256: codeSha256,
    cfg: localCfg
  });
  return { allow: true, reason: 'app-upgrade', message: `允许发布 app ${live.app} → ${entry.appVersion}`, description, live };
}

function parseLiveVersion(versions, version) {
  const row = versionRow(versions, version);
  return row ? parseDescription(row.Description) : null;
}

// seed 占位期间不能升到真实 semver。云架构要求在元数据写入之前先把环境变量名补全，
// 所以只改 environmentNames、其余 runtime 字段不变时，允许版本保持 0.0.0-placeholder。
function seedEnvironmentNameCorrection(baseFn, headFn, { runtimeFilesChanged, configChanged, runtimeCmp, appCmp }) {
  if (!configChanged || runtimeFilesChanged || runtimeCmp !== 0 || appCmp !== 0) return false;
  if (!isPlaceholderVersion(baseFn.appVersion) || !isPlaceholderVersion(baseFn.runtimeVersion)) return false;
  if (!isPlaceholderVersion(headFn.appVersion) || !isPlaceholderVersion(headFn.runtimeVersion)) return false;
  const baseCanon = canonicalRuntime(baseFn.runtime);
  const headCanon = canonicalRuntime(headFn.runtime);
  const baseNames = baseCanon.environmentNames;
  const headNames = headCanon.environmentNames;
  delete baseCanon.environmentNames;
  delete headCanon.environmentNames;
  return JSON.stringify(baseCanon) === JSON.stringify(headCanon)
    && JSON.stringify(baseNames) !== JSON.stringify(headNames);
}

function evaluateChanges({ baseManifest, headManifest, changedFiles }) {
  const errors = [];
  const warnings = [];
  const headCheck = validateManifest(headManifest);
  if (!headCheck.ok) errors.push(...headCheck.errors);
  const introducing = !baseManifest;
  if (introducing) {
    if (!headManifest || headManifest.seed !== true) errors.push('首次加入清单必须标记 seed，并用占位版本');
    return { ok: errors.length === 0, errors, warnings };
  }
  const baseCheck = validateManifest(baseManifest);
  if (!baseCheck.ok) errors.push(...baseCheck.errors.map((item) => `base 清单：${item}`));
  const files = (changedFiles || []).map((file) => String(file).split('\\').join('/'));
  const headByName = new Map((headManifest.functions || []).map((fn) => [fn.name, fn]));
  for (const baseFn of baseManifest.functions || []) {
    const headFn = headByName.get(baseFn.name);
    if (!headFn) {
      warnings.push(`清单移除了 ${baseFn.name}`);
      continue;
    }
    let appCmp = 0;
    let runtimeCmp = 0;
    try {
      appCmp = compareSemver(headFn.appVersion, baseFn.appVersion);
      runtimeCmp = compareSemver(headFn.runtimeVersion, baseFn.runtimeVersion);
    } catch (error) {
      errors.push(`${baseFn.name} ${error.message}`);
      continue;
    }
    if (appCmp < 0) errors.push(`${baseFn.name} 的 app 从 ${baseFn.appVersion} 降到 ${headFn.appVersion}`);
    if (runtimeCmp < 0) errors.push(`${baseFn.name} 的 runtime 从 ${baseFn.runtimeVersion} 降到 ${headFn.runtimeVersion}`);
    const codeChanged = files.filter((file) => matchesPath(file, headFn.codePaths) && !isIgnoredCodeFile(file));
    if (codeChanged.length && appCmp <= 0) {
      errors.push(`${baseFn.name} 的代码变了但 app 仍是 ${headFn.appVersion}：${codeChanged.join(', ')}`);
    }
    let configChanged = false;
    try {
      configChanged = JSON.stringify(canonicalRuntime(headFn.runtime)) !== JSON.stringify(canonicalRuntime(baseFn.runtime));
    } catch (error) {
      errors.push(`${baseFn.name} 的 runtime 配置 ${error.message}`);
    }
    const runtimeChanged = files.filter((file) => matchesPath(file, headFn.runtimePaths));
    if ((runtimeChanged.length || configChanged) && runtimeCmp <= 0) {
      if (seedEnvironmentNameCorrection(baseFn, headFn, {
        runtimeFilesChanged: runtimeChanged.length > 0,
        configChanged,
        runtimeCmp,
        appCmp
      })) {
        warnings.push(`${baseFn.name} 在 seed 占位期间只修正了 environmentNames，runtime 仍是 ${headFn.runtimeVersion}。真实版本留到元数据写入。`);
      } else {
        const why = runtimeChanged.length ? runtimeChanged.join(', ') : 'runtime 配置';
        errors.push(`${baseFn.name} 的 runtime 文件或配置变了但 runtime 仍是 ${headFn.runtimeVersion}：${why}`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

function buildReleaseRecord({ fn, app, runtime, version, commit, sha256, config, approver, at }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(String(approver || ''))) {
    throw Object.assign(new Error('批准人标识不合法。发布记录不能没有批准人。'), { code: 'bad-approver' });
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(String(at || ''))) {
    throw Object.assign(new Error('发布时间必须是 UTC ISO-8601。'), { code: 'bad-time' });
  }
  parseSemver(app);
  parseSemver(runtime);
  if (!/^[0-9a-f]{40}$/.test(String(commit || '')) || !/^[0-9a-f]{64}$/.test(String(sha256 || '')) || !/^[0-9a-f]{64}$/.test(String(config || ''))) {
    throw Object.assign(new Error('发布记录里的 commit / sha256 / config 格式不对。'), { code: 'bad-record' });
  }
  if (!/^\d+$/.test(String(version || ''))) {
    throw Object.assign(new Error('发布记录里的 SCF 版本号必须是数字。'), { code: 'bad-record' });
  }
  return {
    app,
    approver,
    at,
    commit,
    config,
    function: fn,
    runtime,
    sha256,
    version: String(version)
  };
}

function appendReleaseRecord(file, record) {
  const line = `${JSON.stringify(record)}\n`;
  if (line.includes('\n\n') || /JWT_SECRET=|MYSQL_PASSWORD=|SECRET_KEY=/.test(line)) {
    throw Object.assign(new Error('发布记录格式不对。'), { code: 'bad-record' });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line);
  return line.trim();
}

function gitShow(ref, file, cwd = repoRoot()) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

function changedFilesBetween(base, cwd = repoRoot()) {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd, encoding: 'utf8' });
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

module.exports = {
  DESCRIPTION_PREFIX,
  BANNED_ACCOUNT_IDS,
  appendReleaseRecord,
  assertNotPlaceholder,
  buildReleaseRecord,
  changedFilesBetween,
  compareSemver,
  configFingerprint,
  decideAppDeploy,
  deployEntry,
  evaluateChanges,
  formatDescription,
  gitShow,
  isIgnoredCodeFile,
  isPlaceholderVersion,
  loadManifest,
  parseDescription,
  parseLiveVersion,
  parseSemver,
  repoRoot,
  runtimePlanLines,
  validateManifest
};
