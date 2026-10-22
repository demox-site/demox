#!/usr/bin/env node
'use strict';

/**
 * 把 master 的 edge-functions/subdomain-router.js 写到 ef-1281msyw。
 * 只调用 teo:DescribeFunctions、teo:ModifyFunction、teo:DescribeFunctionRuntimeEnvironment。
 * FunctionId 来自 EO_FUNCTION_ID，并且必须等于字面量 ef-1281msyw，否则在 ModifyFunction 之前失败。
 * ZoneId 必须等于字面量 zone-3kplfkbflnd6。
 * 写完读回，sha256 必须等于仓库文件。不一致或冒烟失败都把上一份 Content 写回去。
 * `node scripts/ci/edge-deploy.cjs restore` 只按 EDGE_PREVIOUS_PATH 写回，不跑探针，不开 issue。
 * dry-run 只读，不 ModifyFunction，也不跑会发布站点的冒烟。
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  DURATION_SECONDS,
  buildOidcTokenRequest,
  buildAssumeRoleRequest,
  buildSignedTeoRequest,
  headersForFetch,
  createRedactor
} = require('./www-purge.cjs');

const EXPECTED_FUNCTION_ID = 'ef-1281msyw';
const EXPECTED_ZONE_ID = 'zone-3kplfkbflnd6';
const PROBE_ENV_KEYS = [
  'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'CI',
  'EDGE_BASELINE',
  'DEMOX_SMOKE_EK_BASE', 'DEMOX_SMOKE_LIN_BASE',
  'DEMOX_SMOKE_EMAIL', 'DEMOX_SMOKE_PASSWORD',
  'DEMOX_SMOKE_WEBSITE_ID', 'DEMOX_SMOKE_WWW_MIRROR_URL',
  'DEMOX_SMOKE_PRIVATE_SITE_URL',
  'GITHUB_RUN_ID', 'GITHUB_SHA', 'GITHUB_REPOSITORY',
  'GITHUB_SERVER_URL', 'GITHUB_API_URL', 'GITHUB_WORKSPACE',
  'EXPECT_BUNDLE', 'WWW_URL'
];
const ISSUE_ENV_KEYS = [
  'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL',
  'GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_RUN_ID',
  'GITHUB_SERVER_URL', 'GITHUB_API_URL'
];
const ALLOWED_ACTIONS = new Set(['DescribeFunctions', 'ModifyFunction', 'DescribeFunctionRuntimeEnvironment']);
const OIDC_AUDIENCE = 'sts.tencentcloudapi.com';
const REQUEST_TIMEOUT_MS = 20000;

const REAL_REQUIRED = [
  'GITHUB_TOKEN',
  'GITHUB_REPOSITORY',
  'DEMOX_SMOKE_LIN_BASE',
  'DEMOX_SMOKE_EMAIL',
  'DEMOX_SMOKE_PASSWORD',
  'DEMOX_SMOKE_WEBSITE_ID',
  'DEMOX_SMOKE_PRIVATE_SITE_URL'
];

function mustEnv(env, name) {
  const value = String(env[name] == null ? '' : env[name]).trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function assertAllowed(action) {
  if (!ALLOWED_ACTIONS.has(action)) throw new Error(`拒绝调用 teo:${action}`);
  return action;
}

function readSettings(env) {
  const roleArn = mustEnv(env, 'TENCENT_EDGE_WRITE_ROLE_ARN');
  const providerId = mustEnv(env, 'TENCENT_OIDC_PROVIDER_ID');
  const zoneId = mustEnv(env, 'EO_ZONE_ID');
  const functionId = mustEnv(env, 'EO_FUNCTION_ID');
  if (!/^qcs::cam::uin\/\d+:roleName\/[A-Za-z0-9_-]+$/.test(roleArn)) {
    throw new Error('TENCENT_EDGE_WRITE_ROLE_ARN 格式不正确');
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(providerId)) throw new Error('TENCENT_OIDC_PROVIDER_ID 格式不正确');
  if (zoneId !== EXPECTED_ZONE_ID) {
    throw new Error(`EO_ZONE_ID 必须是 ${EXPECTED_ZONE_ID}，拒绝写入`);
  }
  if (functionId !== EXPECTED_FUNCTION_ID) {
    throw new Error(`EO_FUNCTION_ID 必须是 ${EXPECTED_FUNCTION_ID}，拒绝写入`);
  }
  if (String(env.DEMOX_TEST_HOST_MAP || '').trim()) {
    throw new Error('DEMOX_TEST_HOST_MAP 非空，拒绝写入 ef-1281msyw');
  }
  return { roleArn, providerId, zoneId, functionId, runId: String(env.GITHUB_RUN_ID || 'local') };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readMaster(masterPath, liveShaPath) {
  const body = fs.readFileSync(masterPath);
  const digest = sha256(body);
  const pinned = fs.readFileSync(liveShaPath, 'utf8').trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(pinned)) throw new Error('LIVE.sha256 不是 64 位小写十六进制');
  if (digest !== pinned) throw new Error('边缘文件 sha256 与 LIVE.sha256 不一致，未写入');
  return { body: body.toString('utf8'), sha256: digest };
}

function functionContent(response, functionId) {
  const list = (response && (response.Functions || response.FunctionList)) || [];
  const found = list.find((item) => item && item.FunctionId === functionId);
  if (!found || typeof found.Content !== 'string' || !found.Content) {
    throw new Error(`DescribeFunctions 没有返回 ${functionId} 的 Content`);
  }
  return found.Content;
}

function maskSecret(log, secrets, value) {
  if (typeof value !== 'string' || value.length === 0) return;
  secrets.push(value);
  log(`::add-mask::${value}`);
}

function networkFailure(label, error) {
  const aborted = Boolean(error && (error.name === 'TimeoutError' || error.name === 'AbortError'));
  if (aborted) return new Error(`${label} 请求超时`);
  const code = error && error.cause && error.cause.code;
  const safe = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(code) ? ` ${code}` : '';
  return new Error(`${label} 网络错误${safe}`);
}

async function postJson(fetchImpl, request, hide) {
  const label = request.headers['X-TC-Action'] || 'HTTP';
  let res;
  try {
    res = await fetchImpl(request.url, {
      method: request.method || 'POST',
      headers: headersForFetch(request.headers),
      body: request.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw networkFailure(label, error);
  }
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  const response = parsed && parsed.Response;
  if (response && response.Error) {
    const code = String(response.Error.Code || 'Error');
    const message = String(response.Error.Message || '').replace(/[\r\n]/g, ' ').slice(0, 300);
    throw new Error(hide(`${label} 失败：${code} ${message}`.trim()));
  }
  if (!res.ok || !response) throw new Error(`${label} 失败：HTTP ${res.status}`);
  return response;
}

async function assumeRole({ env, settings, fetchImpl, now, secrets, hide, log }) {
  const tokenRequest = buildOidcTokenRequest({
    requestUrl: env.ACTIONS_ID_TOKEN_REQUEST_URL,
    requestToken: env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    audience: OIDC_AUDIENCE
  });
  let idRes;
  try {
    idRes = await fetchImpl(tokenRequest.url, {
      method: tokenRequest.method,
      headers: tokenRequest.headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw networkFailure('获取 GitHub OIDC token', error);
  }
  if (!idRes.ok) throw new Error(`获取 GitHub OIDC token 失败：HTTP ${idRes.status}`);
  const idJson = await idRes.json();
  const idToken = idJson && idJson.value;
  if (!idToken || typeof idToken !== 'string') throw new Error('获取 GitHub OIDC token 失败：响应没有 value');
  maskSecret(log, secrets, idToken);
  const response = await postJson(fetchImpl, buildAssumeRoleRequest({
    providerId: settings.providerId,
    roleArn: settings.roleArn,
    webIdentityToken: idToken,
    roleSessionName: `edge-deploy-${String(settings.runId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'local'}`.slice(0, 64),
    timestamp: Math.floor(now() / 1000)
  }), hide);
  const credentials = response.Credentials || {};
  maskSecret(log, secrets, credentials.TmpSecretId);
  maskSecret(log, secrets, credentials.TmpSecretKey);
  maskSecret(log, secrets, credentials.Token);
  if (!credentials.TmpSecretId || !credentials.TmpSecretKey || !credentials.Token) {
    throw new Error('AssumeRoleWithWebIdentity 没有返回临时密钥');
  }
  return {
    secretId: credentials.TmpSecretId,
    secretKey: credentials.TmpSecretKey,
    token: credentials.Token,
    expiration: response.Expiration || ''
  };
}

function signed(cred, action, payload, now) {
  assertAllowed(action);
  return buildSignedTeoRequest({
    secretId: cred.secretId,
    secretKey: cred.secretKey,
    token: cred.token,
    action,
    payload,
    timestamp: Math.floor(now() / 1000)
  });
}

async function describeContent(fetchImpl, cred, settings, hide, now) {
  const response = await postJson(fetchImpl, signed(cred, 'DescribeFunctions', { ZoneId: settings.zoneId }, now), hide);
  return functionContent(response, settings.functionId);
}

async function runChecks(probe, env, attempts, gapMs, wait) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await probe('check', env);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(gapMs);
    }
  }
  throw lastError || new Error('边缘冒烟失败');
}

function pickEnv(source, keys) {
  const out = {};
  for (const key of keys) {
    if (key.startsWith('ACTIONS_ID_TOKEN_REQUEST_') || key.startsWith('TENCENTCLOUD_') || key === 'DEMOX_TOKEN') continue;
    const value = source && source[key];
    if (typeof value === 'string' && value.length > 0) out[key] = value;
  }
  return out;
}

function probeChildEnv(source) {
  return pickEnv(source, PROBE_ENV_KEYS);
}

function issueChildEnv(source, note) {
  return {
    ...pickEnv(source, ISSUE_ENV_KEYS),
    RELEASE_STAGE: '边缘函数冒烟未通过，已写回上一版',
    RELEASE_ROLLBACK_NOTE: String(note || '')
  };
}

function spawnProbe(phase, env) {
  const script = path.join(__dirname, 'edge-release-probes.sh');
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [script, phase], {
      env: probeChildEnv({ ...process.env, ...env }),
      stdio: ['ignore', 'inherit', 'inherit']
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`边缘探针 ${phase} 失败（退出码 ${code == null ? 1 : code}）`));
    });
  });
}

function spawnIssue(env, note) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'open-release-issue.cjs')], {
      env: issueChildEnv({ ...process.env, ...env }, note),
      stdio: ['ignore', 'inherit', 'inherit']
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('创建 release-failure issue 失败'));
    });
  });
}

function requireRealEnv(env) {
  for (const name of REAL_REQUIRED) {
    if (!String(env[name] || '').trim()) throw new Error(`缺少 ${name}`);
  }
}

async function runEdgeDeploy({
  env = process.env,
  fetchImpl = globalThis.fetch,
  log = console.log,
  probe = spawnProbe,
  openIssue = spawnIssue,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  masterPath = path.join(process.cwd(), 'edge-functions/subdomain-router.js'),
  liveShaPath = path.join(process.cwd(), 'edge-functions/LIVE.sha256'),
  previousPath = env.EDGE_PREVIOUS_PATH || path.join(process.cwd(), '.artifacts/edge-previous.js'),
  attempts = Number(env.EDGE_PROBE_ATTEMPTS || 6),
  gapMs = Number(env.EDGE_PROBE_GAP_MS || 20000),
  dryRun = String(env.EDGE_DRY_RUN || '') === 'true'
} = {}) {
  const secrets = [];
  maskSecret(log, secrets, env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
  maskSecret(log, secrets, env.DEMOX_SMOKE_PASSWORD);
  maskSecret(log, secrets, env.DEMOX_SMOKE_EMAIL);
  const settings = readSettings(env);
  const master = readMaster(masterPath, liveShaPath);
  if (!dryRun) requireRealEnv(env);
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error('拿不到 GitHub OIDC token（job 需要 permissions: id-token: write）');
  }
  const hide = (text) => createRedactor(secrets)(text);
  const safeLog = (line) => log(hide(line));
  let wrote = false;
  let previous = '';
  try {
    const cred = await assumeRole({ env, settings, fetchImpl, now, secrets, hide, log });
    safeLog(`已通过 OIDC 扮演 ${settings.roleArn}（临时密钥到期 ${cred.expiration || '未知'}，${DURATION_SECONDS}s）`);
    previous = await describeContent(fetchImpl, cred, settings, hide, now);
    fs.mkdirSync(path.dirname(previousPath), { recursive: true });
    fs.writeFileSync(previousPath, previous);
    await postJson(fetchImpl, signed(cred, 'DescribeFunctionRuntimeEnvironment', {
      ZoneId: settings.zoneId,
      FunctionId: settings.functionId
    }, now), hide);
    const liveSha = sha256(previous);
    safeLog(`当前线上 sha256 ${liveSha}`);
    safeLog(`master sha256 ${master.sha256}`);
    if (dryRun) {
      safeLog(liveSha === master.sha256 ? 'dry-run：线上与 master 一致，未调用 ModifyFunction' : 'dry-run：线上与 master 不同，未调用 ModifyFunction');
      return { dryRun: true, liveSha, masterSha: master.sha256, previousPath };
    }
    await probe('baseline', probeChildEnv(env));
    if (settings.functionId !== EXPECTED_FUNCTION_ID || settings.zoneId !== EXPECTED_ZONE_ID) {
      throw new Error(`拒绝 ModifyFunction：FunctionId 必须是 ${EXPECTED_FUNCTION_ID}，ZoneId 必须是 ${EXPECTED_ZONE_ID}`);
    }
    wrote = true;
    await postJson(fetchImpl, signed(cred, 'ModifyFunction', {
      ZoneId: settings.zoneId,
      FunctionId: settings.functionId,
      Content: master.body
    }, now), hide);
    const readBack = await describeContent(fetchImpl, cred, settings, hide, now);
    if (sha256(readBack) !== master.sha256) {
      throw new Error(`读回 sha256 ${sha256(readBack)} 与 master ${master.sha256} 不一致`);
    }
    safeLog('读回 sha256 与 master 一致');
    await runChecks(probe, probeChildEnv(env), attempts, gapMs, wait);
    safeLog('边缘冒烟通过');
    return { dryRun: false, versionSha: master.sha256, previousPath };
  } catch (error) {
    if (error && error.message) error.message = hide(error.message);
    if (!dryRun) {
      let note = wrote ? '已尝试把上一份边缘代码写回去。' : '没有调用 ModifyFunction。';
      if (previous) try {
        const cred = await assumeRole({ env, settings, fetchImpl, now, secrets, hide, log });
        let liveChanged = false;
        try {
          const live = await describeContent(fetchImpl, cred, settings, hide, now);
          liveChanged = sha256(live) !== sha256(previous);
        } catch (describeError) {
          liveChanged = wrote;
          safeLog(`写回前无法确认线上内容：${hide(describeError.message)}`);
        }
        if (wrote || liveChanged) {
          await postJson(fetchImpl, signed(cred, 'ModifyFunction', {
            ZoneId: settings.zoneId,
            FunctionId: settings.functionId,
            Content: previous
          }, now), hide);
          const restored = await describeContent(fetchImpl, cred, settings, hide, now);
          if (sha256(restored) !== sha256(previous)) throw new Error('写回后读回的 sha256 与上一份不一致');
          note = '已把上一份边缘代码写回去。';
          try {
            await probe('check', probeChildEnv(env));
            note += '写回后复核已跑完，发布仍然失败。';
          } catch (probeError) {
            note += `写回后复核失败：${hide(probeError.message)}`;
          }
        }
      } catch (rollbackError) {
        note = `写回未完成：${hide(rollbackError.message)}`;
      }
      const safeNote = hide(note);
      try {
        await openIssue(issueChildEnv(env, safeNote), safeNote);
      } catch (issueError) {
        error.message = `${error.message}；${hide(issueError.message)}`;
      }
      error.message = `${error.message} ${safeNote}`;
    }
    throw error;
  }
}

async function restorePrevious({
  env = process.env,
  fetchImpl = globalThis.fetch,
  log = console.log,
  now = Date.now,
  previousPath = env.EDGE_PREVIOUS_PATH || ''
} = {}) {
  if (!previousPath || !fs.existsSync(previousPath)) {
    log('没有上一份边缘代码文件，跳过写回');
    return { restored: false, reason: 'missing' };
  }
  const previous = fs.readFileSync(previousPath, 'utf8');
  if (!previous) {
    log('上一份边缘代码为空，跳过写回');
    return { restored: false, reason: 'empty' };
  }
  const secrets = [];
  maskSecret(log, secrets, env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
  const settings = readSettings(env);
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error('拿不到 GitHub OIDC token（job 需要 permissions: id-token: write）');
  }
  const hide = (text) => createRedactor(secrets)(text);
  const safeLog = (line) => log(hide(line));
  const cred = await assumeRole({ env, settings, fetchImpl, now, secrets, hide, log });
  const live = await describeContent(fetchImpl, cred, settings, hide, now);
  if (sha256(live) === sha256(previous)) {
    safeLog(`线上与保存的上一份一致（sha256 ${sha256(previous)}），未调用 ModifyFunction`);
    return { restored: false, reason: 'unchanged', sha256: sha256(previous) };
  }
  await postJson(fetchImpl, signed(cred, 'ModifyFunction', {
    ZoneId: settings.zoneId,
    FunctionId: settings.functionId,
    Content: previous
  }, now), hide);
  const restored = await describeContent(fetchImpl, cred, settings, hide, now);
  if (sha256(restored) !== sha256(previous)) throw new Error('写回后读回的 sha256 与上一份不一致');
  safeLog(`已写回保存的上一份边缘代码 sha256 ${sha256(previous)}`);
  return { restored: true, sha256: sha256(previous) };
}

async function main(env = process.env) {
  try {
    if (process.argv[2] === 'restore') await restorePrevious({ env });
    else await runEdgeDeploy({ env });
  } catch (error) {
    console.error(`::error::${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  EXPECTED_FUNCTION_ID,
  EXPECTED_ZONE_ID,
  ALLOWED_ACTIONS,
  assertAllowed,
  readSettings,
  readMaster,
  functionContent,
  probeChildEnv,
  issueChildEnv,
  runEdgeDeploy,
  restorePrevious
};
