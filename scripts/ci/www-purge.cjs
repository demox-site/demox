#!/usr/bin/env node
'use strict';

/**
 * www（EPX2UU43）发布成功后刷新 EdgeOne 缓存。
 *
 * 只走 GitHub OIDC → sts:AssumeRoleWithWebIdentity（不签名，与 scripts/ci/scf-function-api.cjs 相同），
 * 再用临时密钥调 teo:CreatePurgeTask / teo:DescribePurgeTasks。不读长期密钥，日志里也不出现凭证。
 *
 * 环境变量来自 GitHub environment `www` 的 vars：
 *   TENCENT_WWW_PURGE_ROLE_ARN、TENCENT_OIDC_PROVIDER_ID、EO_ZONE_ID、WWW_ORIGIN_PURGE_PREFIX
 * job 需要 environment: www 且 permissions: id-token: write，否则 sub 对不上、也拿不到 OIDC token。
 *
 * 顺序：purge_prefix（回源前缀）→ purge_url（https://www.demox.site/index.html）→ 按时间窗口轮询到 success。
 * 超时或失败只让这一步失败；站点发布已经完成，这里不回滚。
 */

const crypto = require('crypto');

const OIDC_AUDIENCE = 'sts.tencentcloudapi.com';
const STS_HOST = 'sts.tencentcloudapi.com';
const STS_VERSION = '2018-08-13';
const REGION = 'ap-guangzhou';
const TEO_HOST = 'teo.tencentcloudapi.com';
const TEO_SERVICE = 'teo';
const TEO_VERSION = '2022-09-01';
const INDEX_URL = 'https://www.demox.site/index.html';
const DURATION_SECONDS = 3600;
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const WINDOW_BEFORE_MS = 30 * 60 * 1000;
const WINDOW_AFTER_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20000;
const FAIL_STATUSES = new Set(['failed', 'timeout', 'canceled', 'invalid']);

function mustEnv(env, name) {
  const value = String(env[name] == null ? '' : env[name]).trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function readSettings(env) {
  const roleArn = mustEnv(env, 'TENCENT_WWW_PURGE_ROLE_ARN');
  const providerId = mustEnv(env, 'TENCENT_OIDC_PROVIDER_ID');
  const zoneId = mustEnv(env, 'EO_ZONE_ID');
  const originPrefix = mustEnv(env, 'WWW_ORIGIN_PURGE_PREFIX');
  if (!/^qcs::cam::uin\/\d+:roleName\/[A-Za-z0-9_-]+$/.test(roleArn)) {
    throw new Error('TENCENT_WWW_PURGE_ROLE_ARN 格式不正确');
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(providerId)) throw new Error('TENCENT_OIDC_PROVIDER_ID 格式不正确');
  if (!/^zone-[a-z0-9]+$/.test(zoneId)) throw new Error('EO_ZONE_ID 格式不正确');
  let parsed;
  try {
    parsed = new URL(originPrefix);
  } catch {
    throw new Error('WWW_ORIGIN_PURGE_PREFIX 不是 URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('WWW_ORIGIN_PURGE_PREFIX 必须是不带查询串的 https URL');
  }
  if (!originPrefix.endsWith('/')) throw new Error('WWW_ORIGIN_PURGE_PREFIX 必须以 / 结尾');
  if (parsed.hostname !== 'sites.demox.site' || !/^\/sites\/[0-9]+\/[A-Za-z0-9]+\/$/.test(parsed.pathname)) {
    throw new Error('WWW_ORIGIN_PURGE_PREFIX 必须是 sites.demox.site/sites/<ownerId>/<websiteId>/');
  }
  return {
    roleArn,
    providerId,
    zoneId,
    originPrefix,
    indexUrl: INDEX_URL,
    runId: String(env.GITHUB_RUN_ID || 'local')
  };
}

function roleSessionName(runId) {
  const safe = String(runId || 'local').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'local';
  return `www-purge-${safe}`.slice(0, 64);
}

function formatTcTime(ms) {
  return new Date(ms).toISOString().slice(0, 19) + '+00:00';
}

function purgeTasks(settings) {
  return [
    { type: 'purge_prefix', targets: [settings.originPrefix] },
    { type: 'purge_url', targets: [settings.indexUrl] }
  ];
}

function buildCreatePurgePayload({ zoneId, type, targets }) {
  return { ZoneId: zoneId, Type: type, Targets: targets };
}

function buildDescribePurgePayload({ zoneId, startTime, endTime, jobId }) {
  return {
    ZoneId: zoneId,
    StartTime: startTime,
    EndTime: endTime,
    Filters: [{ Name: 'job-id', Values: [jobId] }],
    Limit: 100
  };
}

function buildOidcTokenRequest({ requestUrl, requestToken, audience = OIDC_AUDIENCE }) {
  const sep = String(requestUrl).includes('?') ? '&' : '?';
  return {
    url: `${requestUrl}${sep}audience=${encodeURIComponent(audience)}`,
    method: 'GET',
    headers: { Authorization: `bearer ${requestToken}` }
  };
}

function buildAssumeRoleRequest({ providerId, roleArn, webIdentityToken, roleSessionName: sessionName, timestamp, region = REGION }) {
  return {
    url: `https://${STS_HOST}/`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'SKIP',
      'X-TC-Action': 'AssumeRoleWithWebIdentity',
      'X-TC-Version': STS_VERSION,
      'X-TC-Region': region,
      'X-TC-Timestamp': String(timestamp)
    },
    body: JSON.stringify({
      ProviderId: providerId,
      WebIdentityToken: webIdentityToken,
      RoleArn: roleArn,
      RoleSessionName: sessionName,
      DurationSeconds: DURATION_SECONDS
    })
  };
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, message, encoding) {
  return crypto.createHmac('sha256', key).update(message).digest(encoding);
}

function buildSignedTeoRequest({ secretId, secretKey, token, action, payload, timestamp, region = REGION, host = TEO_HOST, service = TEO_SERVICE, version = TEO_VERSION }) {
  const body = JSON.stringify(payload);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = 'application/json; charset=utf-8';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${String(action).toLowerCase()}\n`;
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256Hex(body)].join('\n');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(hmac(hmac(hmac(`TC3${secretKey}`, date), service), 'tc3_request'), stringToSign, 'hex');
  const headers = {
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType,
    Host: host,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': version,
    'X-TC-Region': region
  };
  if (token) headers['X-TC-Token'] = token;
  return { url: `https://${host}/`, method: 'POST', headers, body, canonicalRequest, stringToSign, signature };
}

/** fetch 会自己写 Host；显式带上会在部分 Node 版本被拒绝。签名里的 host 仍是 TEO_HOST。 */
function headersForFetch(headers) {
  const copy = { ...headers };
  delete copy.Host;
  delete copy.host;
  return copy;
}

function createRedactor(secrets) {
  const values = [...new Set((secrets || []).filter((item) => typeof item === 'string' && item.length >= 8))];
  values.sort((a, b) => b.length - a.length);
  return (text) => {
    let out = String(text == null ? '' : text);
    for (const value of values) out = out.split(value).join('[redacted]');
    return out;
  };
}

function summarizePurgeTasks(tasks, jobId) {
  const mine = (tasks || []).filter((task) => !task || !task.JobId || task.JobId === jobId);
  if (!mine.length) return { state: 'pending', status: 'missing' };
  const statuses = mine.map((task) => String(task.Status || '').toLowerCase());
  const failed = statuses.find((status) => FAIL_STATUSES.has(status));
  if (failed) return { state: 'failed', status: failed };
  if (statuses.every((status) => status === 'success')) return { state: 'success', status: 'success' };
  const other = statuses.find((status) => status !== 'processing' && status !== 'success');
  if (other) return { state: 'pending', status: other };
  return { state: 'pending', status: 'processing' };
}

function networkFailure(label, error) {
  const aborted = Boolean(error && (error.name === 'TimeoutError' || error.name === 'AbortError'));
  if (aborted) return new Error(`${label} 请求超时`);
  const code = error && error.cause && error.cause.code;
  const safe = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(code) ? ` ${code}` : '';
  return new Error(`${label} 网络错误${safe}`);
}

async function postJson(fetchImpl, request, hide = (text) => text) {
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

async function pollUntilSuccess({ jobs, describe, timeoutMs, intervalMs, now, wait, log = () => {} }) {
  if (!jobs.length) throw new Error('没有可查询的刷新任务');
  const deadline = now() + timeoutMs;
  const state = new Map(jobs.map((job) => [job.jobId, 'missing']));
  for (;;) {
    for (const job of jobs) {
      if (state.get(job.jobId) === 'success') continue;
      const summary = summarizePurgeTasks(await describe(job), job.jobId);
      state.set(job.jobId, summary.status);
      log(`DescribePurgeTasks ${job.type} job=${job.jobId} ${summary.state} ${summary.status}`);
      if (summary.state === 'failed') {
        throw new Error(`刷新缓存失败：${job.type} job=${job.jobId} 状态 ${summary.status}`);
      }
    }
    if (jobs.every((job) => state.get(job.jobId) === 'success')) return jobs.map((job) => job.jobId);
    if (now() >= deadline) {
      const stuck = jobs
        .filter((job) => state.get(job.jobId) !== 'success')
        .map((job) => `${job.type} job=${job.jobId} 状态 ${state.get(job.jobId)}`)
        .join('，');
      throw new Error(`刷新缓存超时（${Math.round(timeoutMs / 1000)}s）：${stuck}`);
    }
    await wait(intervalMs);
  }
}

async function assumeRole({ env, settings, fetchImpl, now, secrets, hide }) {
  const tokenRequest = buildOidcTokenRequest({
    requestUrl: env.ACTIONS_ID_TOKEN_REQUEST_URL,
    requestToken: env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
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
  let idJson;
  try {
    idJson = await idRes.json();
  } catch {
    throw new Error('获取 GitHub OIDC token 失败：响应不是 JSON');
  }
  const idToken = idJson && idJson.value;
  if (!idToken || typeof idToken !== 'string') throw new Error('获取 GitHub OIDC token 失败：响应没有 value');
  secrets.push(idToken);
  const response = await postJson(fetchImpl, buildAssumeRoleRequest({
    providerId: settings.providerId,
    roleArn: settings.roleArn,
    webIdentityToken: idToken,
    roleSessionName: roleSessionName(settings.runId),
    timestamp: Math.floor(now() / 1000)
  }), hide);
  const credentials = response.Credentials || {};
  if (!credentials.TmpSecretId || !credentials.TmpSecretKey || !credentials.Token) {
    throw new Error('AssumeRoleWithWebIdentity 没有返回临时密钥');
  }
  secrets.push(credentials.TmpSecretId, credentials.TmpSecretKey, credentials.Token);
  return {
    secretId: credentials.TmpSecretId,
    secretKey: credentials.TmpSecretKey,
    token: credentials.Token,
    expiration: response.Expiration || ''
  };
}

async function runPurge({ env = process.env, fetchImpl = globalThis.fetch, log = console.log, now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), timeoutMs = POLL_TIMEOUT_MS, intervalMs = POLL_INTERVAL_MS } = {}) {
  const settings = readSettings(env);
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error('拿不到 GitHub OIDC token（job 需要 permissions: id-token: write）');
  }
  const secrets = [env.ACTIONS_ID_TOKEN_REQUEST_TOKEN];
  const hide = (text) => createRedactor(secrets)(text);
  const safeLog = (line) => log(hide(line));
  try {
    const cred = await assumeRole({ env, settings, fetchImpl, now, secrets, hide });
    safeLog(`已通过 OIDC 扮演 ${settings.roleArn}（临时密钥到期 ${cred.expiration || '未知'}）`);
    const createdAt = now();
    const jobs = [];
    for (const task of purgeTasks(settings)) {
      const response = await postJson(fetchImpl, buildSignedTeoRequest({
        secretId: cred.secretId,
        secretKey: cred.secretKey,
        token: cred.token,
        action: 'CreatePurgeTask',
        payload: buildCreatePurgePayload({ zoneId: settings.zoneId, type: task.type, targets: task.targets }),
        timestamp: Math.floor(now() / 1000)
      }), hide);
      const failed = Array.isArray(response.FailedList) ? response.FailedList : [];
      if (failed.length) {
        const reason = failed.map((item) => String((item && item.Reason) || 'unknown').replace(/[\r\n]/g, ' ').slice(0, 200)).join('; ');
        throw new Error(`CreatePurgeTask ${task.type} 被拒绝：${reason}`);
      }
      if (!response.JobId) throw new Error(`CreatePurgeTask ${task.type} 没有返回 JobId`);
      const jobId = String(response.JobId);
      safeLog(`CreatePurgeTask ${task.type} JobId=${jobId} RequestId=${response.RequestId || ''}`);
      jobs.push({ type: task.type, jobId });
    }
    await pollUntilSuccess({
      jobs,
      timeoutMs,
      intervalMs,
      now,
      wait,
      log: safeLog,
      describe: async (job) => {
        const at = now();
        const response = await postJson(fetchImpl, buildSignedTeoRequest({
          secretId: cred.secretId,
          secretKey: cred.secretKey,
          token: cred.token,
          action: 'DescribePurgeTasks',
          payload: buildDescribePurgePayload({
            zoneId: settings.zoneId,
            jobId: job.jobId,
            startTime: formatTcTime(createdAt - WINDOW_BEFORE_MS),
            endTime: formatTcTime(at + WINDOW_AFTER_MS)
          }),
          timestamp: Math.floor(at / 1000)
        }), hide);
        return response.Tasks || [];
      }
    });
    safeLog(`EdgeOne 缓存已刷新：${jobs.map((job) => `${job.type} ${job.jobId}`).join('，')}`);
    return { jobs };
  } catch (error) {
    if (error && error.message) error.message = hide(error.message);
    throw error;
  }
}

async function main(env = process.env) {
  await runPurge({ env });
}

if (require.main === module) {
  main().catch((error) => {
    const message = error && error.message ? error.message : String(error);
    console.error(`::error::${message}`);
    process.exit(1);
  });
}

module.exports = {
  INDEX_URL,
  DURATION_SECONDS,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  WINDOW_BEFORE_MS,
  WINDOW_AFTER_MS,
  REGION,
  readSettings,
  roleSessionName,
  formatTcTime,
  purgeTasks,
  buildCreatePurgePayload,
  buildDescribePurgePayload,
  buildOidcTokenRequest,
  buildAssumeRoleRequest,
  buildSignedTeoRequest,
  headersForFetch,
  createRedactor,
  summarizePurgeTasks,
  pollUntilSuccess,
  runPurge
};
