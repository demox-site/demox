#!/usr/bin/env node
'use strict';

/**
 * demox-function-api（统一 SCF 路由）CI 发布 / 回滚。
 *
 * 规则（不要放宽）：
 * - 只更新代码，绝不调用 UpdateFunctionConfiguration / GetFunction：函数环境变量里有 JWT_SECRET、
 *   MYSQL_PASSWORD 等，CI 既不读也不写。CAM 角色 demox-ci-deploy 对这两个接口是显式 Deny，
 *   UpdateFunctionCode 也不带 Environment，所以环境变量由权限保证不变，不再靠读取比对。
 * - 先 PublishVersion 生成不可变版本，把别名 develop 指向 N，通过 develop 的公网 HTTPS 地址
 *   （FUNCTION_API_DEVELOP_URL）做健康检查；绝不调用 Invoke（CI 角色对 scf:Invoke 显式 Deny），
 *   通过后才把别名 production 指向新版本。公网复查每个探测最多 3 次（间隔 5 秒，单次超时 15 秒），
 *   三次都失败才自动切回上一个版本。
 * - 只有 api.demox.site 的所有入口和定时触发器都已绑定到别名 production 时才允许发布
 *   （否则更新 $LATEST 就等于直接切流量）。一次性迁移见 docs/function-api-ci.md。
 * - 任何输出都不包含密钥值、环境变量值或接口返回体。
 *
 * 用法：
 *   node scripts/ci/scf-function-api.cjs plan                    只读：检查前置条件
 *   node scripts/ci/scf-function-api.cjs runtime-plan            只根据 functions.json 重算配置指纹，不部署
 *   node scripts/ci/scf-function-api.cjs deploy --zip <zip>      受 app 版本门禁；--with-runtime 直接拒绝
 *   node scripts/ci/scf-function-api.cjs deploy-develop --key scf-deploy/ci/<x>.zip --sha256 <hex>   只发 develop，不动 production
 *   node scripts/ci/scf-function-api.cjs promote --version <N>     production → N（N 必须是 develop 当前版本）
 *   node scripts/ci/scf-function-api.cjs rollback --version <N>    只切别名（app），不改 runtime 配置
 *
 * deploy-develop / promote 仍是原来的发布动作。前面多一道门禁：清单是占位版本时停。
 * develop 与 production 指向的版本都没有 demox-release 时，deploy-develop 可以做一次 bootstrap
 * （只写版本描述，不调用 UpdateFunctionConfiguration，不切 production）。
 * 只有一边有元数据，或这次之后再缺元数据，停下来告警，不做任何写操作。
 * action=deploy 在两边都没有元数据时仍停，避免顺带切换 production。
 * 凭证（优先级从高到低）：
 *   1. GitHub Actions OIDC：TENCENTCLOUD_ROLE_ARN + ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN（job 需 id-token: write
 *      且在 environment function-api-production 里），换取 1 小时临时密钥，只留在本进程内存里；
 *   2. 本地调试：TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY（可选 TENCENTCLOUD_SESSIONTOKEN）。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const versions = require('./function-versions.cjs');

/**
 * DEMOX_COS_ACCELERATE：只影响 CI 上传部署包走的 COS 域名（默认关）。
 * 空 / false / 0 / off / no = 关；true / 1 / on / yes = 开；其它值直接报错，免得写错了静默不生效。
 */
function parseCosAccelerate(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (['', 'false', '0', 'off', 'no'].includes(v)) return false;
  if (['true', '1', 'on', 'yes'].includes(v)) return true;
  throw new Error(`DEMOX_COS_ACCELERATE 取值不合法：${value}（只接受 true / false）`);
}

const CONFIG = Object.freeze({
  functionName: 'demox-function-api',
  runtimeFunctionName: 'demox-user-nodejs',
  namespace: 'demox',
  region: 'ap-guangzhou',
  alias: 'production',
  stagingAlias: 'develop',
  handler: 'index.main',
  runtimeHandler: 'runtime-nodejs.main',
  runtime: 'Nodejs18.15',
  domain: 'api.demox.site',
  // 部署包 COS 桶：默认仍是成都老桶；workflow 用 inputs.cos_bucket / vars.DEMOX_COS_BUCKET 覆盖（同理 region）。
  cosBucket: process.env.DEMOX_COS_BUCKET || 'demox-analytics-raw-1307257815',
  cosRegion: process.env.DEMOX_COS_REGION || 'ap-chengdu',
  // 上传是否走 COS 全球加速域名（<bucket>.cos.accelerate.myqcloud.com）。只影响上传；
  // UpdateFunctionCode 里的 CosBucketRegion 仍是上面的地域（SCF 从同地域内网拉包）。取值在 cli() 里校验。
  cosAccelerateRaw: process.env.DEMOX_COS_ACCELERATE || '',
  cosPrefix: 'scf-deploy/ci/',
  publicBaseUrl: 'https://api.demox.site',
  // 双账号发布（REQ-7 双发）：同一脚本分别对 磷（custom-domain：api.demox.site 走 SCF 自定义域名）
  // 和 易点（http-trigger：EO 主源站直连函数 HTTP 触发器）各跑一遍。target 只用于日志/summary。
  target: process.env.DEMOX_TARGET || 'lin',
  entryMode: process.env.DEMOX_ENTRY_MODE || 'custom-domain',
  // 只接受这两个账号的 APPID 作为部署桶后缀（磷 1307257815 / 易点 1490780430）。
  cosAppids: ['1307257815', '1490780430'],
  // =1 时 promote/rollback 不做 api.demox.site 公网复查（双发时先切的备源站账号用；复查放在主源站切完之后）。
  skipPublicCheck: ['1', 'true'].includes(String(process.env.DEMOX_SKIP_PUBLIC_CHECK || '').toLowerCase()),
  oidcProviderId: 'github-actions',
  oidcAudience: 'sts.tencentcloudapi.com'
});

// 健康检查：只走公网 HTTPS，不带凭证，只看状态码，不读返回体。
const HEALTH_CHECKS = Object.freeze([
  { name: 'GET /health', method: 'GET', path: '/health', headers: {}, expect: [200] },
  { name: 'GET / (401)', method: 'GET', path: '/', headers: {}, expect: [401] },
  {
    name: 'OPTIONS /auth/login',
    method: 'OPTIONS',
    path: '/auth/login',
    headers: { origin: 'https://www.demox.site', 'access-control-request-method': 'POST' },
    expect: [200, 204]
  }
]);
const PUBLIC_CHECKS = Object.freeze([
  { name: 'GET /health', path: '/health', expect: [200] },
  { name: 'GET / (401)', path: '/', expect: [401] }
]);
// 公网复查：每个探测单独重试。状态码门槛仍是上面的 expect，不把 522 / 5xx / 超时当成通过。
const PUBLIC_PROBE = Object.freeze({
  attempts: 3,
  gapMs: 5000,
  timeoutMs: 15000
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function credentialsFromEnv(env = process.env) {
  const secretId = env.TENCENTCLOUD_SECRETID || env.TENCENTCLOUD_SECRET_ID || '';
  const secretKey = env.TENCENTCLOUD_SECRETKEY || env.TENCENTCLOUD_SECRET_KEY || '';
  const token = env.TENCENTCLOUD_SESSIONTOKEN || env.TENCENTCLOUD_SESSION_TOKEN || '';
  if (!secretId || !secretKey) throw new Error('缺少凭证：CI 里应设置 TENCENTCLOUD_ROLE_ARN 走 OIDC；本地调试才用 TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY');
  return { secretId, secretKey, token, region: env.TENCENTCLOUD_REGION || CONFIG.region };
}

/** GitHub OIDC token → sts:AssumeRoleWithWebIdentity（该接口不签名）→ 临时密钥。不打印 token 和密钥。 */
async function credentialsFromOidc(env = process.env, fetchImpl = globalThis.fetch) {
  const roleArn = env.TENCENTCLOUD_ROLE_ARN;
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error('设置了 TENCENTCLOUD_ROLE_ARN，但拿不到 GitHub OIDC token（job 需要 permissions: id-token: write）');
  }
  const sep = env.ACTIONS_ID_TOKEN_REQUEST_URL.includes('?') ? '&' : '?';
  const idRes = await fetchImpl(`${env.ACTIONS_ID_TOKEN_REQUEST_URL}${sep}audience=${encodeURIComponent(CONFIG.oidcAudience)}`, {
    headers: { Authorization: `bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }
  });
  if (!idRes.ok) throw new Error(`获取 GitHub OIDC token 失败：HTTP ${idRes.status}`);
  const idToken = (await idRes.json()).value;
  const res = await fetchImpl('https://sts.tencentcloudapi.com/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'SKIP',
      'X-TC-Action': 'AssumeRoleWithWebIdentity',
      'X-TC-Version': '2018-08-13',
      'X-TC-Region': CONFIG.region,
      'X-TC-Timestamp': String(Math.floor(Date.now() / 1000))
    },
    body: JSON.stringify({
      ProviderId: CONFIG.oidcProviderId,
      WebIdentityToken: idToken,
      RoleArn: roleArn,
      RoleSessionName: `gha-${env.GITHUB_RUN_ID || 'local'}`.slice(0, 64),
      DurationSeconds: 3600
    })
  });
  const body = (await res.json()).Response || {};
  if (body.Error) throw new Error(`AssumeRoleWithWebIdentity 失败：${body.Error.Code} ${body.Error.Message}`);
  const c = body.Credentials || {};
  if (!c.TmpSecretId || !c.TmpSecretKey || !c.Token) throw new Error('AssumeRoleWithWebIdentity 没有返回临时密钥');
  return { secretId: c.TmpSecretId, secretKey: c.TmpSecretKey, token: c.Token, region: env.TENCENTCLOUD_REGION || CONFIG.region, expiration: body.Expiration };
}

/** 只读前置检查。fn = { Status, Triggers }（来自 ListVersionByFunction + ListTriggers，不用 GetFunction）。 */
function checkPreconditions({ fn, domain, aliases, developBaseUrl, entryMode = CONFIG.entryMode }) {
  const errors = [];
  const warnings = [];
  if (!fn) errors.push(`${CONFIG.functionName} 不存在`);
  if (!(aliases || []).some((item) => item.Name === CONFIG.stagingAlias)) errors.push(`别名 ${CONFIG.stagingAlias} 不存在（健康检查要通过它访问新版本）`);
  if (!/^https:\/\/[^/]+/.test(String(developBaseUrl || ''))) errors.push('没有配置 FUNCTION_API_DEVELOP_URL（别名 develop 的公网 HTTPS 地址）');
  else if (String(developBaseUrl).replace(/\/+$/, '') === CONFIG.publicBaseUrl) errors.push('FUNCTION_API_DEVELOP_URL 不能是 production 地址');
  if (fn && !['Active'].includes(fn.Status)) errors.push(`函数状态 ${fn.Status}，不是 Active`);

  const production = (aliases || []).find((item) => item.Name === CONFIG.alias);
  if (!production) errors.push(`别名 ${CONFIG.alias} 不存在（需先做一次性迁移）`);
  else if (production.FunctionVersion === '$LATEST') errors.push(`别名 ${CONFIG.alias} 指向 $LATEST，必须指向固定版本`);

  if (entryMode === 'http-trigger') {
    // 易点：EO 主源站直接打函数 HTTP 触发器。所有启用的 HTTP 触发器都必须在别名 production 上，
    // 否则 UpdateFunctionCode 会让主源站立刻拿到新代码（不经 develop 验证）。
    const http = ((fn && fn.Triggers) || []).filter((t) => t.Type === 'http' && Number(t.Enable) === 1);
    if (!http.length) errors.push(`${CONFIG.functionName} 没有启用的 HTTP 触发器（EO 源站入口）`);
    const off = http.filter((t) => t.Qualifier !== CONFIG.alias && t.Qualifier !== CONFIG.stagingAlias);
    if (off.length) errors.push(`HTTP 触发器 ${off[0].TriggerName} 绑定在 ${off[0].Qualifier}，不在别名 ${CONFIG.alias}/${CONFIG.stagingAlias} 上；更新代码会直接切 EO 主源站流量（需先做一次性迁移）`);
  } else if (entryMode === 'custom-domain') {
    const endpoints = ((domain && domain.EndpointsConfig) || []).filter((item) => item.FunctionName === CONFIG.functionName);
    if (!endpoints.length) errors.push(`${CONFIG.domain} 上没有指向 ${CONFIG.functionName} 的入口`);
    const onLatest = endpoints.filter((item) => item.Qualifier !== CONFIG.alias);
    if (onLatest.length) {
      errors.push(`${CONFIG.domain} 有 ${onLatest.length} 个入口不在别名 ${CONFIG.alias} 上（如 ${onLatest[0].PathMatch} → ${onLatest[0].Qualifier}）；更新代码会直接切流量`);
    }
  } else {
    errors.push(`DEMOX_ENTRY_MODE 不合法：${entryMode}（只接受 custom-domain / http-trigger）`);
  }
  for (const trigger of (fn && fn.Triggers) || []) {
    if (trigger.Type === 'timer' && Number(trigger.Enable) === 1 && trigger.Qualifier !== CONFIG.alias) {
      errors.push(`定时触发器 ${trigger.TriggerName} 绑定在 ${trigger.Qualifier}，不在别名 ${CONFIG.alias} 上`);
    }
    if (entryMode !== 'http-trigger' && trigger.Type === 'http' && trigger.Qualifier === '$LATEST') {
      warnings.push(`HTTP 触发器 ${trigger.TriggerName} 在 $LATEST 上：直接请求触发器地址会先拿到新代码（api.demox.site 不受影响）`);
    }
  }
  return { ok: errors.length === 0, errors, warnings, productionVersion: production ? production.FunctionVersion : null };
}

// COS 上传：分片（5 MB，3 片并发，每片 60 秒超时、最多 8 次；整次重试沿用同一个 UploadId，只补缺的片）+ 整次最多 3 次 + 总 35 分钟。
// 只用 InitiateMultipartUpload / UploadPart / CompleteMultipartUpload / AbortMultipartUpload（云架构 2026-10-10 11:14 为
// demox-ci-deploy 在 scf-deploy/ci/* 上加的权限）；不用 SDK 的 sliceUploadFile，它会先调桶级 ListMultipartUploads（没有权限）。
// 历史：run 38017096251 单流 putObject 挂 18 分钟；run 38018842590 单次 PutObject 三次都超时（westus3 → ap-chengdu）。
const UPLOAD = Object.freeze({
  partSize: 5 * 1024 * 1024,
  concurrency: 3,
  partAttempts: 8,
  partTimeoutMs: 60 * 1000,
  attempts: 3,
  retryGapMs: 10000,
  totalTimeoutMs: 35 * 60 * 1000,
  firstPartTimeoutMs: 3 * 60 * 1000 // 上传开始 3 分钟内一片都没完成（0%）→ 立刻放弃，别空等 35 分钟
});

/** 桶名必须带 APPID 后缀，地域必须是 ap-xxx；不合法直接拒绝（防止 vars 写错把包传到别处）。 */
function validateCosTarget(bucket = CONFIG.cosBucket, region = CONFIG.cosRegion) {
  const m = /^[a-z0-9][a-z0-9-]{0,48}-(\d+)$/.exec(String(bucket));
  if (!m || !CONFIG.cosAppids.includes(m[1])) throw new Error(`COS 桶名不合法：${bucket}（只接受 磷 1307257815 / 易点 1490780430 的桶：<name>-<APPID>）`);
  if (!/^ap-[a-z]+(?:-[a-z]+)*$/.test(String(region))) throw new Error(`COS 地域不合法：${region}`);
  return { bucket, region };
}

/**
 * deploy-develop 用的已有部署包 key：只接受 scf-deploy/ci/ 下一层的 .zip 文件名
 * （不允许 ..、子目录、反斜杠、%、空白或其它前缀），防止输入把函数指到别的对象。
 */
function validateStagedKey(key) {
  const k = String(key == null ? '' : key);
  if (!k.startsWith(CONFIG.cosPrefix)) throw new Error(`部署包 key 必须在 ${CONFIG.cosPrefix} 下：${k}`);
  const name = k.slice(CONFIG.cosPrefix.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.zip$/.test(name) || name.includes('..')) throw new Error(`部署包 key 不合法：${k}（只接受 ${CONFIG.cosPrefix}<文件名>.zip，不能有子目录或 ..）`);
  return k;
}

/** GITHUB_OUTPUT 的键可以带数字（sha256），值只允许路径和十六进制，避免换行注入。 */
function acceptGithubOutput(key, value) {
  return /^[a-z][a-z0-9_]*$/.test(String(key)) && /^[\w./$-]+$/.test(String(value));
}

/** 期望的 sha256：必须是 64 位小写十六进制。 */
function validateSha256(value) {
  const v = String(value == null ? '' : value);
  if (!/^[0-9a-f]{64}$/.test(v)) throw new Error('expected sha256 必须是 64 位小写十六进制');
  return v;
}

/** 上传用的 COS 域名（只用于日志；实际域名由 SDK 按 UseAccelerate 拼）。不含任何密钥。 */
function cosUploadEndpoint({ bucket = CONFIG.cosBucket, region = CONFIG.cosRegion, accelerate = false } = {}) {
  return accelerate ? `${bucket}.cos.accelerate.myqcloud.com` : `${bucket}.cos.${region}.myqcloud.com`;
}

/**
 * cos-nodejs-sdk-v5 客户端参数。关闭加速时与原来完全一致；开启时只多一个 UseAccelerate: true
 * （SDK 2.15.x / 3.0.x 都支持：请求地域被替换成 accelerate，域名变成 <bucket>.cos.accelerate.myqcloud.com）。
 */
function cosClientOptions(cred, { accelerate = false } = {}) {
  // 单个请求（一片 5 MB）2 分钟超时。
  const options = { SecretId: cred.secretId, SecretKey: cred.secretKey, ...(cred.token ? { SecurityToken: cred.token } : {}), Timeout: 120000 };
  if (accelerate) options.UseAccelerate = true;
  return options;
}

function createDeployer({ scf, cos = null, fetchImpl = globalThis.fetch, log = console.log, wait = sleep, summary = () => {}, output = () => {}, developBaseUrl = '', uploadOptions = {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const upload = { ...UPLOAD, ...uploadOptions };
  const developUrl = String(developBaseUrl || '').replace(/\/+$/, '');
  const base = { FunctionName: CONFIG.functionName, Namespace: CONFIG.namespace };

  async function versionStatus(name, qualifier = '$LATEST') {
    const res = await scf.ListVersionByFunction({ FunctionName: name, Namespace: CONFIG.namespace, Order: 'DESC', OrderBy: 'AddTime', Limit: 50 });
    const hit = (res.Versions || []).find((item) => String(item.Version) === String(qualifier));
    return hit ? String(hit.Status || '') : null;
  }

  async function readState() {
    const [status, triggerList, domain, aliasList] = await Promise.all([
      versionStatus(CONFIG.functionName),
      scf.ListTriggers({ ...base, Limit: 100 }),
      CONFIG.entryMode === 'custom-domain' ? scf.GetCustomDomain({ Domain: CONFIG.domain }) : Promise.resolve(null),
      scf.ListAliases({ ...base })
    ]);
    const fn = status === null ? null : { Status: status, Triggers: triggerList.Triggers || [] };
    return { fn, domain, aliases: aliasList.Aliases || [], developBaseUrl: developUrl };
  }

  async function plan() {
    const state = await readState();
    const result = checkPreconditions(state);
    log(`[${CONFIG.target}] 函数 ${CONFIG.functionName}: $LATEST ${state.fn ? state.fn.Status : '不存在'}，触发器 ${state.fn ? state.fn.Triggers.length : 0} 个`);
    log(`别名 ${CONFIG.alias}: ${result.productionVersion || '（不存在）'}`);
    for (const w of result.warnings) log(`::warning::${w}`);
    for (const e of result.errors) log(`::error::${e}`);
    return { ...result, state };
  }

  async function waitActive(name, qualifier) {
    for (let i = 0; i < 100; i += 1) {
      const status = await versionStatus(name, qualifier || '$LATEST');
      if (status === 'Active') return status;
      if (/Failed$/.test(String(status))) throw new Error(`${name}${qualifier ? `:${qualifier}` : ''} 状态 ${status}`);
      await wait(3000);
    }
    throw new Error(`等待 ${name} Active 超时`);
  }

  async function httpStatus(url, { method = 'GET', headers = {} } = {}) {
    try {
      const res = await fetchImpl(url, { method, headers, redirect: 'manual' });
      return res.status;
    } catch (error) {
      return `ERR ${error.code || error.message}`;
    }
  }

  /** 把 develop 指向 version 后，经 develop 的公网地址做健康检查（重试几轮，等别名生效）。返回失败项。 */
  async function healthCheckDevelop(version, { rounds = 4, gapMs = 10000 } = {}) {
    let failures = [];
    for (let round = 0; round < rounds; round += 1) {
      if (round) await wait(gapMs);
      failures = [];
      for (const check of HEALTH_CHECKS) {
        const code = await httpStatus(`${developUrl}${check.path}`, { method: check.method, headers: check.headers });
        const ok = check.expect.includes(code);
        log(`  健康检查 develop→v${version} #${round + 1} ${check.name}: ${code} ${ok ? 'OK' : 'FAIL'}`);
        if (!ok) failures.push(check.name);
      }
      if (!failures.length) return [];
    }
    return failures;
  }

  async function aliasVersion(name) {
    const aliases = (await scf.ListAliases({ ...base })).Aliases || [];
    const hit = aliases.find((item) => item.Name === name);
    return hit ? String(hit.FunctionVersion) : null;
  }

  // 网络错误只留短错误码。error.message 可能带上 URL，不写进日志。
  function publicProbeErrorStatus(error) {
    const code = error && error.code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(code)) return `ERR ${code}`;
    return 'ERR';
  }

  async function probeOnce(url, { method = 'GET', headers = {}, timeoutMs = 0 } = {}) {
    const started = now();
    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timer = controller ? setTimer(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(url, {
        method,
        headers,
        redirect: 'manual',
        ...(controller ? { signal: controller.signal } : {})
      });
      return { status: res.status, elapsedMs: Math.max(0, Math.round(now() - started)) };
    } catch (error) {
      const aborted = Boolean(controller && controller.signal.aborted)
        || Boolean(error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
      return {
        status: aborted ? 'TIMEOUT' : publicProbeErrorStatus(error),
        elapsedMs: Math.max(0, Math.round(now() - started))
      };
    } finally {
      if (timer !== null) clearTimer(timer);
    }
  }

  /**
   * production 切换后的公网复查。每个探测最多 attempts 次，间隔 gapMs，单次超时 timeoutMs。
   * 任何一次状态码落在该探测原来的 expect 里即通过，不再打后续次数；三次都失败才返回 false。
   * 日志一行：探测名、第几次、状态码、耗时。不打响应体、请求头、cookie、token 或 uid。
   */
  async function publicCheck({ attempts = PUBLIC_PROBE.attempts, gapMs = PUBLIC_PROBE.gapMs, timeoutMs = PUBLIC_PROBE.timeoutMs, skip = CONFIG.skipPublicCheck } = {}) {
    if (skip) { log(`[${CONFIG.target}] 跳过 ${CONFIG.publicBaseUrl} 公网复查（DEMOX_SKIP_PUBLIC_CHECK=1：主源站账号切完后统一复查）`); return true; }
    for (const check of PUBLIC_CHECKS) {
      let passed = false;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (attempt > 1) await wait(gapMs);
        const { status, elapsedMs } = await probeOnce(`${CONFIG.publicBaseUrl}${check.path}`, { timeoutMs });
        const ok = check.expect.includes(status);
        log(`  公网复查 ${check.name} 第 ${attempt}/${attempts} 次: ${status} ${elapsedMs}ms ${ok ? 'OK' : 'FAIL'}`);
        if (ok) { passed = true; break; }
      }
      if (!passed) return false;
    }
    return true;
  }

  async function pointAlias(name, version) {
    const aliases = (await scf.ListAliases({ ...base })).Aliases || [];
    const params = { ...base, Name: name, FunctionVersion: String(version), RoutingConfig: { AdditionalVersionWeights: [] } };
    // CI 角色没有 CreateAlias（scf:Create* 显式 Deny）；别名由一次性迁移创建。
    if (!aliases.some((item) => item.Name === name)) {
      if (name === CONFIG.alias) throw new Error(`别名 ${name} 不存在，CI 不能创建别名（见 docs/function-api-ci.md 一次性迁移）`);
      log(`::warning::别名 ${name} 不存在，跳过`);
      return;
    }
    await scf.UpdateAlias(params);
  }

  const isDenied = (error) => /AccessDenied|Access Denied/i.test(`${error && error.code} ${error && error.message}`);
  const cosCall = (name, params) => new Promise((resolve, reject) => {
    cos[name](params, (error, data) => (error ? reject(Object.assign(new Error(error.message || error.code || String(error)), { code: error.code })) : resolve(data)));
  });

  /**
   * 分片上传到 COS；任何 SCF 写操作之前执行，失败时函数和别名都不动。
   * 总时长超过 totalTimeoutMs 直接报错（并 Abort 掉未完成的分片任务）；Access Denied 不重试。
   */
  async function uploadZip(zipPath, key) {
    if (!cos) throw new Error('缺少 COS 客户端');
    const size = fs.statSync(zipPath).size;
    const deadline = now() + upload.totalTimeoutMs;
    const state = { uploadId: null, parts: [] }; // 跨次续传：同一个 UploadId，已传好的片不重传
    let lastError;
    // 0% 看门狗：上传开始 firstPartTimeoutMs 内一片都没完成 → 停掉当前轮、不再重试
    let zeroProgress = false;
    let current = null;
    let watchReject;
    const watch = new Promise((_, reject) => { watchReject = reject; });
    watch.catch(() => {});
    const minutesZero = Math.round(upload.firstPartTimeoutMs / 60000);
    const watchdog = upload.firstPartTimeoutMs > 0 ? setTimer(() => {
      if (!state.parts.some(Boolean)) {
        zeroProgress = true;
        if (current && current.stop) current.stop();
        watchReject(new Error(`${minutesZero} 分钟内一片都没传完（0%）`));
      }
    }, upload.firstPartTimeoutMs) : null;
    try {
      for (let attempt = 1; attempt <= upload.attempts; attempt += 1) {
        if (zeroProgress) break;
        const remaining = deadline - now();
        if (remaining <= 0) break;
        // 给后面的续传留预算：本轮最多用掉剩余时间的 (attempts-attempt+1) 等分，至少 3 分钟
        const slicesLeft = upload.attempts - attempt + 1;
        const slice = Math.max(3 * 60 * 1000, Math.floor(remaining / slicesLeft));
        const have = state.parts.filter(Boolean).length;
        log(`上传 COS 第 ${attempt}/${upload.attempts} 次（${(size / 1048576).toFixed(1)} MB，${Math.ceil(size / upload.partSize)} 片 × ${upload.partSize / 1048576} MB${have ? `，续传：已有 ${have} 片` : ''}，本轮 ≤${Math.round(slice / 1000)}s）→ cos://${CONFIG.cosBucket}（${CONFIG.cosRegion}）`);
        try {
          current = multipartOnce(zipPath, key, size, state);
          await Promise.race([withTimeout(current, Math.min(slice, remaining)), watch]);
          log('上传 COS 完成');
          return;
        } catch (error) {
          lastError = error;
          log(`::warning::上传 COS 第 ${attempt} 次失败：${error.message}`);
          if (zeroProgress || isDenied(error)) break; // 0% 或权限问题：重试无用
          if (attempt < upload.attempts && deadline - now() > upload.retryGapMs) await wait(upload.retryGapMs);
        }
      }
    } finally {
      if (watchdog !== null) clearTimer(watchdog);
    }
    if (state.uploadId) cosCall('multipartAbort', { Bucket: CONFIG.cosBucket, Region: CONFIG.cosRegion, Key: key, UploadId: state.uploadId }).catch(() => {});
    if (zeroProgress) {
      throw new Error(`上传 COS 失败：${minutesZero} 分钟内 0%（一片都没传完），已停止，未做任何函数修改。runner → ${CONFIG.cosRegion} 的 COS 链路可能不通`);
    }
    const minutes = Math.round(upload.totalTimeoutMs / 60000);
    throw new Error(`上传 COS 失败（${upload.attempts} 次内或 ${minutes} 分钟内未完成），未做任何函数修改：${lastError ? lastError.message : '超时'}`);
  }

  function withTimeout(task, timeoutMs) {
    return new Promise((resolve, reject) => {
      let done = false;
      // 软取消：只停 worker，不 Abort / 不清 UploadId，下一轮可续传已完成的片
      const timer = setTimer(() => { if (!done) { done = true; task.stop && task.stop(); reject(new Error(`超时 ${Math.round(timeoutMs / 1000)}s`)); } }, timeoutMs);
      task.promise.then((v) => { if (!done) { done = true; clearTimer(timer); resolve(v); } },
        (e) => { if (!done) { done = true; clearTimer(timer); reject(e); } });
    });
  }

  // 单片超时用真实定时器（与总超时分开）：卡住的分片 60 秒后重试，不会把整次预算全部耗在一片上。
  function partWithTimeout(promise, partNumber) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`分片 ${partNumber} 超时 ${Math.round(upload.partTimeoutMs / 1000)}s`)), upload.partTimeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function multipartOnce(zipPath, key, size, state) {
    const base = { Bucket: CONFIG.cosBucket, Region: CONFIG.cosRegion, Key: key };
    let stopped = false;
    const stop = () => { stopped = true; }; // 软取消：保留 UploadId 和已完成片，供续传
    const abort = () => { // 硬取消：最终失败才 Abort
      stopped = true;
      if (state.uploadId) cosCall('multipartAbort', { ...base, UploadId: state.uploadId }).catch(() => {});
      state.uploadId = null; state.parts = [];
    };
    const promise = (async () => {
      if (!state.uploadId) {
        const init = await cosCall('multipartInit', base);
        if (!init.UploadId) throw new Error('InitiateMultipartUpload 没有返回 UploadId');
        state.uploadId = init.UploadId;
        state.parts = [];
      }
      const uploadId = state.uploadId;
      const count = Math.max(1, Math.ceil(size / upload.partSize));
      const todo = [];
      for (let i = 0; i < count; i += 1) if (!state.parts[i]) todo.push(i);
      let lastPct = -1;
      const report = () => {
        const pct = Math.floor((state.parts.filter(Boolean).length / count) * 5) * 20;
        if (pct > lastPct) { lastPct = pct; log(`上传进度 ${pct}%`); }
      };
      let failure = null;
      const fd = fs.openSync(zipPath, 'r');
      try {
        const worker = async () => {
          while (!stopped && !failure && todo.length) {
            const index = todo.shift();
            const start = index * upload.partSize;
            const length = Math.min(upload.partSize, size - start);
            const body = Buffer.alloc(length);
            fs.readSync(fd, body, 0, length, start);
            let partError;
            for (let tryNo = 1; tryNo <= upload.partAttempts && !stopped; tryNo += 1) {
              try {
                const res = await partWithTimeout(cosCall('multipartUpload', { ...base, UploadId: uploadId, PartNumber: index + 1, Body: body, ContentLength: length }), index + 1);
                state.parts[index] = { PartNumber: index + 1, ETag: res.ETag };
                partError = null;
                break;
              } catch (error) {
                partError = error;
                if (isDenied(error)) break;
              }
            }
            if (partError) { failure = partError; break; }
            report();
          }
        };
        await Promise.all(Array.from({ length: Math.min(upload.concurrency, count) }, worker));
      } finally {
        fs.closeSync(fd);
      }
      if (failure) throw failure;
      if (stopped) throw new Error('已取消');
      await cosCall('multipartComplete', { ...base, UploadId: uploadId, Parts: state.parts.slice(0, count) });
    })();
    return { promise, abort, stop };
  }

  function cosCode(key) {
    return { CosBucketName: CONFIG.cosBucket.replace(/-\d+$/, ''), CosObjectName: key, CosBucketRegion: CONFIG.cosRegion };
  }

  /** 只把统一包传到 COS（给 demox-api-web 等其它函数用），不做任何 SCF 调用。 */
  async function stage({ zipPath, sha = 'local' }) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
    const key = `${CONFIG.cosPrefix}demox-unified-scf-${String(sha).slice(0, 12)}-${hash.slice(0, 12)}.zip`;
    log(`stage：包 sha256:${hash} → cos://${CONFIG.cosBucket}/${key}`);
    await uploadZip(zipPath, key);
    output('key', key);
    output('cos_key', key);
    output('sha256', hash);
    summary(`- stage 完成：\`cos://${CONFIG.cosBucket}/${key}\`（sha256 ${hash}），没有改任何函数`);
    return { key, sha256: hash };
  }

  async function listVersions(name) {
    const all = [];
    for (let offset = 0, page = 0; page < 20; page += 1, offset += 50) {
      const res = await scf.ListVersionByFunction({
        FunctionName: name,
        Namespace: CONFIG.namespace,
        Order: 'DESC',
        OrderBy: 'AddTime',
        Limit: 50,
        Offset: offset
      });
      const batch = res.Versions || [];
      if (!batch.length) break;
      if (offset > 0 && all.some((item) => String(item.Version) === String(batch[0].Version))) break;
      all.push(...batch);
      if (batch.length < 50) break;
    }
    return all;
  }

  async function readReleaseState() {
    const [aliasList, listed] = await Promise.all([
      scf.ListAliases({ ...base }),
      listVersions(CONFIG.functionName)
    ]);
    return { aliases: aliasList.Aliases || [], versions: listed };
  }

  async function deploy({ zipPath, sha = 'local', runId = '', withRuntime = false, description = '' }) {
    const pre = await plan();
    if (!pre.ok) throw new Error('前置条件不满足，未做任何修改');
    const previous = pre.productionVersion;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
    const key = `${CONFIG.cosPrefix}demox-unified-scf-${String(sha).slice(0, 12)}-${hash.slice(0, 12)}.zip`;
    log(`包 sha256:${hash.slice(0, 16)} → cos://${CONFIG.cosBucket}/${key}`);
    summary(`- 上一个 production 版本：**${previous}**（回滚：workflow_dispatch action=rollback version=${previous}）`);

    await uploadZip(zipPath, key);
    // 只更新代码（Handler 固定）；不传 Environment / 其它配置。环境变量不读不写，由 CAM 显式 Deny 保证。
    await scf.UpdateFunctionCode({ ...base, Handler: CONFIG.handler, ...cosCode(key) });
    await waitActive(CONFIG.functionName);

    const published = await scf.PublishVersion({ ...base, Description: description || `ci ${String(sha).slice(0, 12)} run ${runId}`.trim() });
    const version = String(published.FunctionVersion);
    await waitActive(CONFIG.functionName, version);
    log(`已发布 v${version}`);

    const developBefore = await aliasVersion(CONFIG.stagingAlias);
    await pointAlias(CONFIG.stagingAlias, version);
    const failures = await healthCheckDevelop(version);
    if (failures.length) {
      if (developBefore) await pointAlias(CONFIG.stagingAlias, developBefore);
      throw new Error(`v${version} 健康检查失败（${failures.join(', ')}），未切流量，production 仍是 v${previous}`);
    }

    await pointAlias(CONFIG.alias, version);
    log(`别名 ${CONFIG.alias}: v${previous} → v${version}`);
    if (!(await publicCheck())) {
      await pointAlias(CONFIG.alias, previous);
      throw new Error(`公网复查失败，已自动切回 v${previous}`);
    }
    summary(`- 新 production 版本：**${version}**（健康检查 + 公网复查通过）`);

    if (withRuntime) await deployRuntime({ key });
    return { previous, version };
  }

  /** demox-user-nodejs：路由按它的 $LATEST 触发器地址调用，没有别名可切；先发快照版本作为回滚点。 */
  async function deployRuntime({ key }) {
    const rbase = { FunctionName: CONFIG.runtimeFunctionName, Namespace: CONFIG.namespace };
    await waitActive(CONFIG.runtimeFunctionName);
    const snap = await scf.PublishVersion({ ...rbase, Description: 'ci pre-deploy snapshot' });
    const snapshotVersion = String(snap.FunctionVersion);
    summary(`- ${CONFIG.runtimeFunctionName} 发布前快照：v${snapshotVersion}`);
    await scf.UpdateFunctionCode({ ...rbase, Handler: CONFIG.runtimeHandler, ...cosCode(key) });
    await waitActive(CONFIG.runtimeFunctionName);
    if (!(await publicCheck())) {
      await restoreRuntime(snapshotVersion);
      throw new Error(`${CONFIG.runtimeFunctionName} 更新后公网复查失败，已恢复快照 v${snapshotVersion} 的代码`);
    }
    log(`${CONFIG.runtimeFunctionName} 已更新（回滚点 v${snapshotVersion}）`);
  }

  async function restoreRuntime(version) {
    const rbase = { FunctionName: CONFIG.runtimeFunctionName, Namespace: CONFIG.namespace };
    const addr = await scf.GetFunctionAddress({ ...rbase, Qualifier: String(version) });
    const res = await fetchImpl(addr.Url);
    if (!res.ok) throw new Error(`下载 v${version} 代码失败：${res.status}`);
    const tmp = path.join(require('os').tmpdir(), `runtime-v${version}.zip`);
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    const key = `${CONFIG.cosPrefix}rollback-${CONFIG.runtimeFunctionName}-v${version}.zip`;
    await uploadZip(tmp, key);
    await scf.UpdateFunctionCode({ ...rbase, Handler: CONFIG.runtimeHandler, ...cosCode(key) });
    await waitActive(CONFIG.runtimeFunctionName);
  }

  async function rollback({ version }) {
    if (!/^\d+$/.test(String(version || ''))) throw new Error('rollback 需要 --version <数字>');
    const pre = await plan();
    const current = pre.productionVersion;
    if (!pre.ok) throw new Error('前置条件不满足，未做任何修改');
    const developBefore = await aliasVersion(CONFIG.stagingAlias);
    await pointAlias(CONFIG.stagingAlias, version);
    const failures = await healthCheckDevelop(version);
    if (failures.length) {
      if (developBefore) await pointAlias(CONFIG.stagingAlias, developBefore);
      throw new Error(`v${version} 健康检查失败，不切换`);
    }
    await pointAlias(CONFIG.alias, version);
    log(`别名 ${CONFIG.alias}: v${current} → v${version}`);
    if (!(await publicCheck())) throw new Error('回滚后公网复查失败，请人工检查');
    summary(`- [${CONFIG.target}] 已回滚 production：v${current} → v${version}`);
    return { previous: current, version: String(version) };
  }

  /** 只把 develop 指回指定版本。不碰 production。 */
  async function rollbackDevelop({ version }) {
    if (!/^\d+$/.test(String(version || ''))) throw new Error('rollback-develop 需要 --version <数字>');
    const pre = await plan();
    if (!pre.ok) throw new Error('前置条件不满足，未做任何修改');
    await pointAlias(CONFIG.stagingAlias, version);
    const failures = await healthCheckDevelop(version);
    if (failures.length) {
      throw new Error(`develop 切回 v${version} 后健康检查失败（${failures.join(', ')}）；production 仍是 v${pre.productionVersion}`);
    }
    summary(`- [${CONFIG.target}] develop 已切回 v${version}；production 仍是 v${pre.productionVersion}`);
    return { version: String(version), production: pre.productionVersion };
  }

  /**
   * 下载 COS 上已有的部署包（stage 产出），算 sha256 与期望值严格比对。
   * 不一致直接报错；此时还没有任何 SCF 写操作。只用 getObject。
   */
  async function verifyStagedZip({ key, sha256 }) {
    validateStagedKey(key);
    validateSha256(sha256);
    if (!cos) throw new Error('缺少 COS 客户端');
    const data = await cosCall('getObject', { Bucket: CONFIG.cosBucket, Region: CONFIG.cosRegion, Key: key });
    const body = data && data.Body;
    if (!body || !body.length) throw new Error(`下载部署包失败或为空：${key}`);
    const actual = crypto.createHash('sha256').update(body).digest('hex');
    log(`部署包 ${key} sha256:${actual}（期望 ${sha256}）`);
    if (actual !== sha256) throw new Error(`部署包 sha256 不一致：实际 ${actual}，期望 ${sha256}；未做任何函数修改`);
    return { key, sha256: actual, size: body.length };
  }

  /**
   * 只发到 develop：用 COS 上已有的包（sha256 校验通过）→ UpdateFunctionCode → PublishVersion → develop 指向新版本
   * → develop 健康检查。绝不改 production 别名；健康检查失败把 develop 切回原版本。
   */
  async function deployDevelop({ key, sha256, sha = 'local', runId = '', description = '' }) {
    validateStagedKey(key);
    validateSha256(sha256);
    const pre = await plan();
    if (!pre.ok) throw new Error('前置条件不满足，未做任何修改');
    await verifyStagedZip({ key, sha256 });
    await scf.UpdateFunctionCode({ ...base, Handler: CONFIG.handler, ...cosCode(key) });
    await waitActive(CONFIG.functionName);
    const published = await scf.PublishVersion({ ...base, Description: description || `ci develop ${String(sha).slice(0, 12)} pkg ${sha256.slice(0, 12)} run ${runId}`.trim() });
    const version = String(published.FunctionVersion);
    await waitActive(CONFIG.functionName, version);
    log(`已发布 v${version}`);
    const developBefore = await aliasVersion(CONFIG.stagingAlias);
    await pointAlias(CONFIG.stagingAlias, version);
    const failures = await healthCheckDevelop(version);
    if (failures.length) {
      if (developBefore) await pointAlias(CONFIG.stagingAlias, developBefore);
      throw new Error(`v${version} 健康检查失败（${failures.join(', ')}），develop 已切回 v${developBefore}，production 未动`);
    }
    log(`别名 ${CONFIG.stagingAlias}: v${developBefore} → v${version}；production 仍是 v${pre.productionVersion}（未改动）`);
    output('version', version);
    if (developBefore) output('develop_previous', developBefore);
    output('production', pre.productionVersion);
    summary(`- [${CONFIG.target}] develop → **v${version}**（包 \`${key}\` sha256 ${sha256}）；production 仍是 v${pre.productionVersion}。上线：action=promote version=${version}`);
    return { version, developBefore, production: pre.productionVersion };
  }

  /** 把 production 指向一个已发布、且 develop 当前正指向的版本（即已在 develop 验证过）。公网复查失败自动切回。 */
  async function promote({ version }) {
    if (!/^\d+$/.test(String(version || ''))) throw new Error('promote 需要 --version <数字>');
    const v = String(version);
    const pre = await plan();
    if (!pre.ok) throw new Error('前置条件不满足，未做任何修改');
    const previous = pre.productionVersion;
    const dev = await aliasVersion(CONFIG.stagingAlias);
    if (dev !== v) throw new Error(`develop 当前是 v${dev}，不是 v${v}；只能 promote 已在 develop 上验证的版本`);
    if ((await versionStatus(CONFIG.functionName, v)) !== 'Active') throw new Error(`v${v} 不存在或不是 Active`);
    output('previous', previous);
    output('version', v);
    if (previous === v) { log(`production 已是 v${v}，不用切`); return { previous, version: v }; }
    await pointAlias(CONFIG.alias, v);
    log(`别名 ${CONFIG.alias}: v${previous} → v${v}`);
    if (!(await publicCheck())) {
      await pointAlias(CONFIG.alias, previous);
      throw new Error(`公网复查失败，已自动切回 v${previous}`);
    }
    summary(`- [${CONFIG.target}] production：v${previous} → **v${v}**（回滚：action=rollback version=${previous}）`);
    return { previous, version: v };
  }

  return { verifyStagedZip, deployDevelop, promote, plan, stage, deploy, rollback, rollbackDevelop, deployRuntime, restoreRuntime, healthCheckDevelop, publicCheck, readState, readReleaseState, uploadZip };
}

async function releaseDeployDevelop(deployer, { manifest, key, sha256, gitSha, runId = '', reusePublished = false, output = () => {}, summary = () => {}, log = console.log }) {
  const entry = versions.deployEntry(manifest);
  versions.assertNotPlaceholder(entry);
  const state = await deployer.readReleaseState();
  const decision = versions.decideAppDeploy({
    entry,
    aliases: state.aliases,
    versions: state.versions,
    codeSha256: sha256,
    gitSha
  });
  // 双账号模式（DEMOX_REUSE_PUBLISHED=1，只给先发的 磷 用）：同一包已发布 → 复用该版本号，不报错，让 workflow 继续发易点。
  // 单账号模式不设此变量，行为不变（already-published 仍然停止）。
  if (!decision.allow && decision.reason === 'already-published' && reusePublished && /^\d+$/.test(String(decision.version || ''))) {
    log(`[${CONFIG.target}] 同一包已发布在 v${decision.version}（别名 ${decision.alias}），复用该版本，不重新发布`);
    const aliasVersion = (name) => {
      const found = state.aliases.find((item) => item.Name === name);
      return found ? String(found.FunctionVersion) : '';
    };
    output('version', decision.version);
    const developNow = aliasVersion(CONFIG.stagingAlias);
    const productionNow = aliasVersion(CONFIG.alias);
    if (developNow) output('develop_previous', developNow);
    if (productionNow) output('production', productionNow);
    summary(`- [${CONFIG.target}] 复用已发布的 v${decision.version}（包 sha256 ${sha256}），未改函数`);
    return { version: String(decision.version), reused: true, developPrevious: developNow, production: productionNow };
  }
  if (!decision.allow) {
    const error = new Error(decision.message);
    error.code = decision.reason;
    throw error;
  }
  return deployer.deployDevelop({ key, sha256, sha: gitSha, runId, description: decision.description });
}

async function releasePromote(deployer, { version, approver, at = new Date().toISOString(), releaseLog = '', summary = () => {}, log = console.log }) {
  if (!/^\d+$/.test(String(version || ''))) throw new Error('promote 需要 --version <数字>');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(String(approver || ''))) {
    throw Object.assign(new Error('promote 需要批准人（RELEASE_APPROVER 或 GITHUB_ACTOR）。已停止，不会切换 production。'), { code: 'bad-approver' });
  }
  const state = await deployer.readReleaseState();
  const meta = versions.parseLiveVersion(state.versions, version);
  if (!meta) {
    throw Object.assign(new Error(`v${version} 没有 demox-release 元数据。已停止并告警，不会覆盖，也不会切换 production。`), { code: 'missing-metadata' });
  }
  const result = await deployer.promote({ version });
  const record = versions.buildReleaseRecord({
    fn: CONFIG.functionName,
    app: meta.app,
    runtime: meta.runtime,
    version: result.version,
    commit: meta.git,
    sha256: meta.sha256,
    config: meta.cfg,
    approver,
    at
  });
  if (releaseLog) versions.appendReleaseRecord(releaseLog, record);
  const line = `release-record ${JSON.stringify(record)}`;
  summary(`- ${line}`);
  log(line);
  return { ...result, record };
}

async function createClients(env = process.env, { accelerate = false } = {}) {
  const cred = env.TENCENTCLOUD_ROLE_ARN ? await credentialsFromOidc(env) : credentialsFromEnv(env);
  if (cred.expiration) console.log(`已通过 OIDC 扮演 ${env.TENCENTCLOUD_ROLE_ARN}（临时密钥到期 ${cred.expiration}）`);
  const tencentcloud = require('tencentcloud-sdk-nodejs');
  const scf = new tencentcloud.scf.v20180416.Client({
    credential: { secretId: cred.secretId, secretKey: cred.secretKey, ...(cred.token ? { token: cred.token } : {}) },
    region: cred.region,
    profile: { httpProfile: { reqTimeout: 120 } }
  });
  let COS;
  try { COS = require('cos-nodejs-sdk-v5'); } catch { COS = require(path.join(__dirname, '../../scf-code/function-api/node_modules/cos-nodejs-sdk-v5')); }
  const cos = new COS(cosClientOptions(cred, { accelerate }));
  return { scf, cos };
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function cli(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (command === 'runtime-plan') {
    const manifest = versions.loadManifest();
    for (const line of versions.runtimePlanLines(manifest)) console.log(line);
    return;
  }
  if (argv.includes('--with-runtime')) {
    throw new Error('runtime 不会在这里自动发布。需要云架构复核和 Chief 批准；本命令不会更新 demox-user-nodejs，也不会改内存、超时、层、环境变量或触发器。');
  }
  let manifest = null;
  if (command === 'deploy' || command === 'deploy-develop' || command === 'promote') {
    manifest = versions.loadManifest();
    const check = versions.validateManifest(manifest, { checkPaths: true });
    if (!check.ok) throw new Error(check.errors.join('\n'));
  }
  if (command === 'deploy' || command === 'deploy-develop') versions.assertNotPlaceholder(versions.deployEntry(manifest));
  validateCosTarget();
  const accelerate = parseCosAccelerate(CONFIG.cosAccelerateRaw);
  console.log(`COS 部署桶：${CONFIG.cosBucket}（${CONFIG.cosRegion}）`);
  console.log(`COS 上传端点：${cosUploadEndpoint({ accelerate })}（${accelerate ? '全球加速，DEMOX_COS_ACCELERATE=true' : '地域直连'}）；函数拉包仍用 ${CONFIG.cosRegion}`);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  const summary = (line) => { if (summaryFile) fs.appendFileSync(summaryFile, `${line}\n`); };
  if (accelerate) summary(`- COS 上传走全球加速：\`${cosUploadEndpoint({ accelerate })}\``);
  const outputFile = process.env.GITHUB_OUTPUT;
  const output = (k, v) => { if (outputFile && acceptGithubOutput(k, v)) fs.appendFileSync(outputFile, `${k}=${v}\n`); };
  console.log(`发布目标：${CONFIG.target}（入口 ${CONFIG.entryMode}）`);
  const deployer = createDeployer({ ...(await createClients(process.env, { accelerate })), summary, output, developBaseUrl: process.env.FUNCTION_API_DEVELOP_URL || '' });
  if (command === 'plan') {
    const result = await deployer.plan();
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'deploy') {
    const zipPath = argValue(argv, '--zip');
    if (!zipPath || !fs.existsSync(zipPath)) throw new Error('deploy 需要 --zip <统一包 zip>');
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
    const gitSha = process.env.GITHUB_SHA || '';
    const state = await deployer.readReleaseState();
    const decision = versions.decideAppDeploy({
      entry: versions.deployEntry(manifest),
      aliases: state.aliases,
      versions: state.versions,
      codeSha256: sha256,
      gitSha
    });
    if (!decision.allow) throw new Error(decision.message);
    if (decision.reason === 'bootstrap-metadata') {
      throw Object.assign(new Error('第一次写入 demox-release 只能走 deploy-develop，不会切换 production。'), { code: 'bootstrap-develop-only' });
    }
    await deployer.deploy({ zipPath, sha: gitSha, runId: process.env.GITHUB_RUN_ID || '', withRuntime: false, description: decision.description });
    return;
  }
  if (command === 'stage') {
    const zipPath = argValue(argv, '--zip');
    if (!zipPath || !fs.existsSync(zipPath)) throw new Error('stage 需要 --zip <统一包 zip>');
    await deployer.stage({ zipPath, sha: process.env.GITHUB_SHA || 'local' });
    return;
  }
  if (command === 'deploy-develop') {
    await releaseDeployDevelop(deployer, {
      manifest,
      key: argValue(argv, '--key'),
      sha256: argValue(argv, '--sha256'),
      gitSha: process.env.GITHUB_SHA || '',
      runId: process.env.GITHUB_RUN_ID || '',
      reusePublished: ['1', 'true'].includes(String(process.env.DEMOX_REUSE_PUBLISHED || '').toLowerCase()),
      output,
      summary
    });
    return;
  }
  if (command === 'promote') {
    await releasePromote(deployer, {
      version: argValue(argv, '--version'),
      approver: process.env.RELEASE_APPROVER || process.env.GITHUB_ACTOR || '',
      releaseLog: process.env.RELEASE_LOG || '',
      summary
    });
    return;
  }
  if (command === 'rollback') {
    await deployer.rollback({ version: argValue(argv, '--version') });
    return;
  }
  if (command === 'rollback-develop') {
    await deployer.rollbackDevelop({ version: argValue(argv, '--version') });
    return;
  }
  throw new Error('用法: scf-function-api.cjs plan | runtime-plan | stage --zip <zip> | deploy --zip <zip> | deploy-develop --key <scf-deploy/ci/x.zip> --sha256 <hex> | promote --version <N> | rollback --version <N> | rollback-develop --version <N>');
}

// 超时放弃的分片请求，底层 socket 之后还可能报 EPIPE/ECONNRESET；它已经被重试替代，不能让它把整个进程打死。
const STRAY_SOCKET_ERRORS = new Set(['EPIPE', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ERR_STREAM_DESTROYED']);
function isStraySocketError(error) {
  return Boolean(error && STRAY_SOCKET_ERRORS.has(error.code));
}

if (require.main === module) {
  process.on('uncaughtException', (error) => {
    if (isStraySocketError(error)) { console.log(`::warning::忽略已放弃请求的 socket 错误：${error.code}`); return; }
    console.error(`::error::${error && error.message}`);
    process.exit(1);
  });
  cli().catch((error) => {
    // 只打印消息，不打印 SDK 原始错误对象（可能带请求参数）。
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}

module.exports = { validateStagedKey, validateSha256, acceptGithubOutput, CONFIG, HEALTH_CHECKS, PUBLIC_CHECKS, PUBLIC_PROBE, UPLOAD, isStraySocketError, validateCosTarget, parseCosAccelerate, cosClientOptions, cosUploadEndpoint, checkPreconditions, createDeployer, credentialsFromEnv, credentialsFromOidc, releaseDeployDevelop, releasePromote };
