#!/usr/bin/env node
'use strict';

/**
 * demox-function-api（统一 SCF 路由）CI 发布 / 回滚。
 *
 * 规则（不要放宽）：
 * - 只更新代码，绝不调用 UpdateFunctionConfiguration / GetFunction：函数环境变量里有 JWT_SECRET、
 *   MYSQL_PASSWORD 等，CI 既不读也不写。CAM 角色 demox-ci-deploy 对这两个接口是显式 Deny，
 *   UpdateFunctionCode 也不带 Environment，所以环境变量由权限保证不变，不再靠读取比对。
 * - 先 PublishVersion 生成不可变版本，用 Invoke(Qualifier=N) 做健康检查，
 *   通过后才把别名 production 指向新版本；公网复查失败自动切回上一个版本。
 * - 只有 api.demox.site 的所有入口和定时触发器都已绑定到别名 production 时才允许发布
 *   （否则更新 $LATEST 就等于直接切流量）。一次性迁移见 docs/function-api-ci.md。
 * - 任何输出都不包含密钥值、环境变量值或接口返回体。
 *
 * 用法：
 *   node scripts/ci/scf-function-api.cjs plan                    只读：检查前置条件
 *   node scripts/ci/scf-function-api.cjs deploy --zip <zip> [--with-runtime]
 *   node scripts/ci/scf-function-api.cjs rollback --version <N>
 * 凭证（优先级从高到低）：
 *   1. GitHub Actions OIDC：TENCENTCLOUD_ROLE_ARN + ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN（job 需 id-token: write
 *      且在 environment function-api-production 里），换取 1 小时临时密钥，只留在本进程内存里；
 *   2. 本地调试：TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY（可选 TENCENTCLOUD_SESSIONTOKEN）。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
  cosBucket: 'demox-analytics-raw-1307257815',
  cosRegion: 'ap-chengdu',
  cosPrefix: 'scf-deploy/ci/',
  publicBaseUrl: 'https://api.demox.site',
  oidcProviderId: 'github-actions',
  oidcAudience: 'sts.tencentcloudapi.com'
});

// 健康检查：都不带凭证，返回体里没有用户数据。
const HEALTH_CHECKS = Object.freeze([
  { name: 'mcp health', event: { httpMethod: 'GET', path: '/health', headers: {} }, expect: [200] },
  { name: 'api root requires login', event: { httpMethod: 'GET', path: '/', headers: {} }, expect: [401] },
  {
    name: 'auth preflight',
    event: { httpMethod: 'OPTIONS', path: '/auth/login', headers: { origin: 'https://www.demox.site', 'access-control-request-method': 'POST' } },
    expect: [200, 204]
  }
]);
const PUBLIC_CHECKS = Object.freeze([
  { name: 'GET /health', path: '/health', expect: [200] },
  { name: 'GET / (401)', path: '/', expect: [401] }
]);

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
function checkPreconditions({ fn, domain, aliases }) {
  const errors = [];
  const warnings = [];
  if (!fn) errors.push(`${CONFIG.functionName} 不存在`);
  if (fn && !['Active'].includes(fn.Status)) errors.push(`函数状态 ${fn.Status}，不是 Active`);

  const production = (aliases || []).find((item) => item.Name === CONFIG.alias);
  if (!production) errors.push(`别名 ${CONFIG.alias} 不存在（需先做一次性迁移）`);
  else if (production.FunctionVersion === '$LATEST') errors.push(`别名 ${CONFIG.alias} 指向 $LATEST，必须指向固定版本`);

  const endpoints = ((domain && domain.EndpointsConfig) || []).filter((item) => item.FunctionName === CONFIG.functionName);
  if (!endpoints.length) errors.push(`${CONFIG.domain} 上没有指向 ${CONFIG.functionName} 的入口`);
  const onLatest = endpoints.filter((item) => item.Qualifier !== CONFIG.alias);
  if (onLatest.length) {
    errors.push(`${CONFIG.domain} 有 ${onLatest.length} 个入口不在别名 ${CONFIG.alias} 上（如 ${onLatest[0].PathMatch} → ${onLatest[0].Qualifier}）；更新代码会直接切流量`);
  }
  for (const trigger of (fn && fn.Triggers) || []) {
    if (trigger.Type === 'timer' && Number(trigger.Enable) === 1 && trigger.Qualifier !== CONFIG.alias) {
      errors.push(`定时触发器 ${trigger.TriggerName} 绑定在 ${trigger.Qualifier}，不在别名 ${CONFIG.alias} 上`);
    }
    if (trigger.Type === 'http' && trigger.Qualifier === '$LATEST') {
      warnings.push(`HTTP 触发器 ${trigger.TriggerName} 在 $LATEST 上：直接请求触发器地址会先拿到新代码（api.demox.site 不受影响）`);
    }
  }
  return { ok: errors.length === 0, errors, warnings, productionVersion: production ? production.FunctionVersion : null };
}

function parseInvokeStatus(result) {
  const r = (result && (result.Result || result)) || {};
  if (Number(r.InvokeResult || 0) !== 0) return { statusCode: null, error: `InvokeResult=${r.InvokeResult}` };
  try {
    const payload = JSON.parse(r.RetMsg || '{}');
    return { statusCode: Number(payload.statusCode) || null };
  } catch {
    return { statusCode: null, error: 'RetMsg 不是 JSON' };
  }
}

function createDeployer({ scf, cos = null, fetchImpl = globalThis.fetch, log = console.log, wait = sleep, summary = () => {} }) {
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
      scf.GetCustomDomain({ Domain: CONFIG.domain }),
      scf.ListAliases({ ...base })
    ]);
    const fn = status === null ? null : { Status: status, Triggers: triggerList.Triggers || [] };
    return { fn, domain, aliases: aliasList.Aliases || [] };
  }

  async function plan() {
    const state = await readState();
    const result = checkPreconditions(state);
    log(`函数 ${CONFIG.functionName}: $LATEST ${state.fn ? state.fn.Status : '不存在'}，触发器 ${state.fn ? state.fn.Triggers.length : 0} 个`);
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

  async function healthCheckVersion(version) {
    const failures = [];
    for (const check of HEALTH_CHECKS) {
      let status;
      try {
        status = parseInvokeStatus(await scf.Invoke({
          ...base,
          Qualifier: String(version),
          InvocationType: 'RequestResponse',
          ClientContext: JSON.stringify(check.event)
        }));
      } catch (error) {
        status = { statusCode: null, error: error.code || error.message };
      }
      const ok = check.expect.includes(status.statusCode);
      log(`  健康检查 v${version} ${check.name}: ${status.statusCode ?? status.error} ${ok ? 'OK' : 'FAIL'}`);
      if (!ok) failures.push(check.name);
    }
    return failures;
  }

  async function publicCheck({ rounds = 3, gapMs = 20000 } = {}) {
    for (let round = 0; round < rounds; round += 1) {
      if (round) await wait(gapMs);
      for (const check of PUBLIC_CHECKS) {
        let code = null;
        try {
          const res = await fetchImpl(`${CONFIG.publicBaseUrl}${check.path}`, { method: 'GET', redirect: 'manual' });
          code = res.status;
        } catch (error) {
          code = `ERR ${error.code || error.message}`;
        }
        const ok = check.expect.includes(code);
        log(`  公网复查 #${round + 1} ${check.name}: ${code} ${ok ? 'OK' : 'FAIL'}`);
        if (!ok) return false;
      }
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

  async function uploadZip(zipPath, key) {
    if (!cos) throw new Error('缺少 COS 客户端');
    await new Promise((resolve, reject) => {
      cos.putObject({ Bucket: CONFIG.cosBucket, Region: CONFIG.cosRegion, Key: key, Body: fs.createReadStream(zipPath) },
        (error, data) => (error ? reject(error) : resolve(data)));
    });
  }

  function cosCode(key) {
    return { CosBucketName: CONFIG.cosBucket.replace(/-\d+$/, ''), CosObjectName: key, CosBucketRegion: CONFIG.cosRegion };
  }

  async function deploy({ zipPath, sha = 'local', runId = '', withRuntime = false }) {
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

    const published = await scf.PublishVersion({ ...base, Description: `ci ${String(sha).slice(0, 12)} run ${runId}`.trim() });
    const version = String(published.FunctionVersion);
    await waitActive(CONFIG.functionName, version);
    log(`已发布 v${version}`);

    const failures = await healthCheckVersion(version);
    if (failures.length) throw new Error(`v${version} 健康检查失败（${failures.join(', ')}），未切流量，production 仍是 v${previous}`);

    await pointAlias(CONFIG.stagingAlias, version);
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
    const failures = await healthCheckVersion(version);
    if (failures.length) throw new Error(`v${version} 健康检查失败，不切换`);
    await pointAlias(CONFIG.alias, version);
    log(`别名 ${CONFIG.alias}: v${current} → v${version}`);
    if (!(await publicCheck())) throw new Error('回滚后公网复查失败，请人工检查');
    summary(`- 已回滚 production：v${current} → v${version}`);
    return { previous: current, version: String(version) };
  }

  return { plan, deploy, rollback, deployRuntime, restoreRuntime, healthCheckVersion, publicCheck, readState };
}

async function createClients(env = process.env) {
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
  const cos = new COS({ SecretId: cred.secretId, SecretKey: cred.secretKey, ...(cred.token ? { SecurityToken: cred.token } : {}) });
  return { scf, cos };
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function cli(argv = process.argv.slice(2)) {
  const command = argv[0];
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  const summary = (line) => { if (summaryFile) fs.appendFileSync(summaryFile, `${line}\n`); };
  const deployer = createDeployer({ ...(await createClients()), summary });
  if (command === 'plan') {
    const result = await deployer.plan();
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'deploy') {
    const zipPath = argValue(argv, '--zip');
    if (!zipPath || !fs.existsSync(zipPath)) throw new Error('deploy 需要 --zip <统一包 zip>');
    await deployer.deploy({ zipPath, sha: process.env.GITHUB_SHA || 'local', runId: process.env.GITHUB_RUN_ID || '', withRuntime: argv.includes('--with-runtime') });
    return;
  }
  if (command === 'rollback') {
    await deployer.rollback({ version: argValue(argv, '--version') });
    return;
  }
  throw new Error('用法: scf-function-api.cjs plan | deploy --zip <zip> [--with-runtime] | rollback --version <N>');
}

if (require.main === module) {
  cli().catch((error) => {
    // 只打印消息，不打印 SDK 原始错误对象（可能带请求参数）。
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}

module.exports = { CONFIG, HEALTH_CHECKS, checkPreconditions, parseInvokeStatus, createDeployer, credentialsFromEnv, credentialsFromOidc };
