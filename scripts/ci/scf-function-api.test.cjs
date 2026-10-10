'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkPreconditions, createDeployer, credentialsFromOidc, CONFIG } = require('./scf-function-api.cjs');

// CI 角色对这些接口是显式 Deny；脚本一次都不能调用。
const FORBIDDEN = ['Invoke', 'GetFunction', 'UpdateFunctionConfiguration', 'UpdateFunction', 'CreateAlias', 'CreateFunction', 'DeleteFunction', 'DeleteAlias', 'CreateTrigger', 'DeleteTrigger', 'UpdateTrigger'];

const endpoints = (q) => ['/', '/*', '/auth/*'].map((p) => ({ Namespace: 'demox', FunctionName: CONFIG.functionName, Qualifier: q, PathMatch: p }));
const timers = (q) => [{ Type: 'timer', TriggerName: 'analytics-rollup-5m', Enable: 1, Qualifier: q }];

const DEV = 'https://develop.example.com';
function fakeScf({ qualifier = 'production', prodVersion = '3', publishStatus = 'Active', aliasNames = ['production', 'develop'] } = {}) {
  const calls = [];
  let versions = Number(prodVersion);
  const aliases = aliasNames.map((Name) => ({ Name, FunctionVersion: prodVersion }));
  const api = new Proxy({}, { get: (_t, name) => async (params) => {
    calls.push({ name, params });
    if (FORBIDDEN.includes(name)) { const e = new Error(`UnauthorizedOperation ${name}`); e.code = 'UnauthorizedOperation'; throw e; }
    switch (name) {
      case 'ListVersionByFunction': {
        const list = [{ Version: '$LATEST', Status: 'Active' }];
        for (let v = versions; v >= 1; v -= 1) list.push({ Version: String(v), Status: v > Number(prodVersion) ? publishStatus : 'Active' });
        return { Versions: list };
      }
      case 'ListTriggers': return { Triggers: [...timers(qualifier), { Type: 'http', TriggerName: 'h', Qualifier: '$LATEST', Enable: 1 }] };
      case 'GetCustomDomain': return { EndpointsConfig: endpoints(qualifier) };
      case 'ListAliases': return { Aliases: aliases };
      case 'UpdateFunctionCode': return {};
      case 'PublishVersion': versions += 1; return { FunctionVersion: String(versions) };
      case 'UpdateAlias': { const a = aliases.find((x) => x.Name === params.Name); a.FunctionVersion = params.FunctionVersion; return {}; }
      default: return {};
    }
  } });
  return { api, calls, aliases };
}

const OK_STATUS = { '/health': 200, '/': 401, '/auth/login': 204 };
// 公网 fake：develop 地址按 devStatus 返回，api.demox.site 按 OK_STATUS；记录所有请求。
function fakeFetch({ devStatus = OK_STATUS, prodStatus = OK_STATUS } = {}) {
  const urls = [];
  const fn = async (url, opts = {}) => {
    urls.push({ url, method: opts.method || 'GET' });
    const u = new URL(url);
    const table = url.startsWith(DEV) ? devStatus : prodStatus;
    return { status: table[u.pathname], ok: true };
  };
  fn.urls = urls;
  return fn;
}
const okFetch = fakeFetch();
const fakeCos = { putObject: (_p, cb) => cb(null, {}) };
const zip = () => { const p = path.join(os.tmpdir(), `t-${process.pid}.zip`); fs.writeFileSync(p, 'zip'); return p; };
const quiet = () => {};

test('preconditions refuse traffic on $LATEST and missing alias', () => {
  const r = checkPreconditions({ fn: { Handler: 'index.main', Runtime: 'Nodejs18.15', Status: 'Active', Triggers: timers('$LATEST') }, domain: { EndpointsConfig: endpoints('$LATEST') }, aliases: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('别名 production 不存在')));
  assert.ok(r.errors.some((e) => e.includes('入口不在别名')));
  assert.ok(r.errors.some((e) => e.includes('定时触发器')));
});

test('preconditions pass when domain and timers use the alias', () => {
  const r = checkPreconditions({ fn: { Status: 'Active', Triggers: timers('production') }, domain: { EndpointsConfig: endpoints('production') },
    aliases: [{ Name: 'production', FunctionVersion: '3' }, { Name: 'develop', FunctionVersion: '3' }], developBaseUrl: DEV });
  assert.equal(r.ok, true, r.errors.join('; '));
  const noDev = checkPreconditions({ fn: { Status: 'Active', Triggers: timers('production') }, domain: { EndpointsConfig: endpoints('production') },
    aliases: [{ Name: 'production', FunctionVersion: '3' }, { Name: 'develop', FunctionVersion: '3' }], developBaseUrl: 'https://api.demox.site/' });
  assert.ok(noDev.errors.some((e) => e.includes('不能是 production')));
  assert.equal(r.productionVersion, '3');
});

test('OIDC: exchanges the GitHub token via unsigned AssumeRoleWithWebIdentity', async () => {
  const seen = [];
  const fetchImpl = async (url, opts = {}) => {
    seen.push({ url, opts });
    if (url.startsWith('https://gh.example/')) return { ok: true, json: async () => ({ value: 'id.token.jwt' }) };
    return { ok: true, json: async () => ({ Response: { Credentials: { TmpSecretId: 'AKIDtmp', TmpSecretKey: 'k', Token: 't' }, Expiration: '2026-10-09T10:00:00Z' } }) };
  };
  const env = { TENCENTCLOUD_ROLE_ARN: 'qcs::cam::uin/1:roleName/demox-ci-deploy', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gh.example/token?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'req', GITHUB_RUN_ID: '42' };
  const c = await credentialsFromOidc(env, fetchImpl);
  assert.deepEqual([c.secretId, c.secretKey, c.token], ['AKIDtmp', 'k', 't']);
  assert.ok(seen[0].url.endsWith('&audience=sts.tencentcloudapi.com'));
  assert.equal(seen[1].opts.headers.Authorization, 'SKIP');
  assert.equal(seen[1].opts.headers['X-TC-Action'], 'AssumeRoleWithWebIdentity');
  const body = JSON.parse(seen[1].opts.body);
  assert.equal(body.ProviderId, 'github-actions');
  assert.equal(body.RoleArn, env.TENCENTCLOUD_ROLE_ARN);
  const denied = async (url) => (url.startsWith('https://gh.example/') ? { ok: true, json: async () => ({ value: 'x' }) }
    : { ok: true, json: async () => ({ Response: { Error: { Code: 'UnauthorizedOperation', Message: 'no' } } }) });
  await assert.rejects(credentialsFromOidc(env, denied), /UnauthorizedOperation/);
  await assert.rejects(credentialsFromOidc({ TENCENTCLOUD_ROLE_ARN: 'x' }, denied), /id-token: write/);
});


test('deploy: code only, publish, health check via develop HTTPS, then switch alias', async () => {
  const s = fakeScf();
  const lines = [];
  const f = fakeFetch();
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos: fakeCos, fetchImpl: f, log: (l) => lines.push(l), wait: async () => {} });
  const r = await d.deploy({ zipPath: zip(), sha: 'abc' });
  assert.deepEqual(r, { previous: '3', version: '4' });
  const names = s.calls.map((c) => c.name);
  assert.deepEqual(names.filter((n) => FORBIDDEN.includes(n)), [], 'never calls denied APIs (GetFunction, UpdateFunctionConfiguration, Create*)');
  const update = s.calls.find((c) => c.name === 'UpdateFunctionCode');
  assert.equal(update.params.Environment, undefined);
  assert.ok(!names.includes('Invoke'));
  const aliasCalls = s.calls.filter((c) => c.name === 'UpdateAlias').map((c) => `${c.params.Name}=${c.params.FunctionVersion}`);
  assert.deepEqual(aliasCalls, ['develop=4', 'production=4'], 'develop first, production only after health check');
  assert.ok(f.urls.some((x) => x.url === `${DEV}/health`) && f.urls.some((x) => x.url === `${DEV}/auth/login` && x.method === 'OPTIONS'));
  assert.ok(f.urls.every((x) => x.url.startsWith('https://')));
  assert.equal(s.aliases.find((a) => a.Name === 'production').FunctionVersion, '4');
  assert.ok(!lines.join('\n').includes('xxxx'), 'no env values in output');
});

test('deploy refuses before any write when traffic is on $LATEST', async () => {
  const s = fakeScf({ qualifier: '$LATEST' });
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos: fakeCos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  await assert.rejects(d.deploy({ zipPath: zip() }), /前置条件不满足/);
  assert.ok(!s.calls.some((c) => ['UpdateFunctionCode', 'PublishVersion', 'UpdateAlias'].includes(c.name)));
});

test('deploy does not switch when health check fails', async () => {
  const s = fakeScf();
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos: fakeCos, fetchImpl: fakeFetch({ devStatus: { ...OK_STATUS, '/health': 502 } }), log: quiet, wait: async () => {} });
  await assert.rejects(d.deploy({ zipPath: zip() }), /健康检查失败.*production 仍是 v3/);
  assert.equal(s.aliases.find((a) => a.Name === 'production').FunctionVersion, '3');
  assert.equal(s.aliases.find((a) => a.Name === 'develop').FunctionVersion, '3', 'develop restored');
  assert.ok(!s.calls.some((c) => c.name === 'UpdateAlias' && c.params.Name === 'production'));
});

test('deploy stops if the published version fails to become Active', async () => {
  const s = fakeScf({ publishStatus: 'PublishFailed' });
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos: fakeCos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  await assert.rejects(d.deploy({ zipPath: zip() }), /PublishFailed/);
  assert.equal(s.aliases.find((a) => a.Name === 'production').FunctionVersion, '3');
  assert.ok(!s.calls.some((c) => c.name === 'UpdateAlias'));
});

test('deploy never creates the production alias (CI role has no Create*)', async () => {
  const s = fakeScf({ aliasNames: [] });
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos: fakeCos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  await assert.rejects(d.deploy({ zipPath: zip() }), /前置条件不满足/);
  assert.ok(!s.calls.some((c) => ['UpdateFunctionCode', 'CreateAlias'].includes(c.name)));
});

test('deployRuntime and plan avoid GetFunction', async () => {
  const s = fakeScf();
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos: fakeCos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  await d.plan();
  await d.deployRuntime({ key: 'scf-deploy/ci/x.zip' });
  assert.ok(!s.calls.some((c) => FORBIDDEN.includes(c.name)));
  const upd = s.calls.find((c) => c.name === 'UpdateFunctionCode');
  assert.equal(upd.params.Handler, 'runtime-nodejs.main');
  assert.equal(upd.params.Environment, undefined);
});

test('deploy rolls the alias back when the public check fails', async () => {
  const s = fakeScf();
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos: fakeCos, fetchImpl: fakeFetch({ prodStatus: { '/health': 502, '/': 502 } }), log: quiet, wait: async () => {} });
  await assert.rejects(d.deploy({ zipPath: zip() }), /已自动切回 v3/);
  assert.equal(s.aliases.find((a) => a.Name === 'production').FunctionVersion, '3');
});

test('rollback health-checks the target before switching', async () => {
  const s = fakeScf({ prodVersion: '5' });
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos: fakeCos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  const r = await d.rollback({ version: '4' });
  assert.deepEqual(r, { previous: '5', version: '4' });
  await assert.rejects(d.rollback({ version: 'abc' }), /--version/);
});

test('deploy refuses before any write without a develop URL', async () => {
  const s = fakeScf();
  const d = createDeployer({ scf: s.api, cos: fakeCos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  await assert.rejects(d.deploy({ zipPath: zip() }), /前置条件不满足/);
  assert.ok(!s.calls.some((c) => ['UpdateFunctionCode', 'PublishVersion', 'UpdateAlias'].includes(c.name)));
});

test('rollback checks the target through develop before moving production', async () => {
  const s = fakeScf({ prodVersion: '5' });
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos: fakeCos, fetchImpl: fakeFetch({ devStatus: { ...OK_STATUS, '/': 500 } }), log: quiet, wait: async () => {} });
  await assert.rejects(d.rollback({ version: '4' }), /健康检查失败/);
  assert.equal(s.aliases.find((a) => a.Name === 'production').FunctionVersion, '5');
  assert.equal(s.aliases.find((a) => a.Name === 'develop').FunctionVersion, '5');
});


// ---- COS 上传：只用 PutObject（CI 角色权限）+ 重试 + 超时 ----
function scriptedCos(script) {
  const calls = [];
  return {
    calls,
    putObject: (p, cb) => {
      const step = script[calls.length] || 'ok';
      calls.push({ Key: p.Key });
      if (step === 'ok') cb(null, {});
      else if (step === 'fail') cb({ code: 'RequestTimeout', message: 'socket hang up' });
      else if (step === 'denied') cb({ code: 'AccessDenied', message: 'Access Denied.' });
      // 'hang'：永不回调
    }
  };
}
const NO_MULTIPART = ['sliceUploadFile', 'multipartInit', 'multipartUpload', 'multipartComplete', 'uploadFile'];
const strictCos = (inner) => new Proxy(inner, { get: (t, n) => { if (NO_MULTIPART.includes(n)) throw new Error(`CI 角色不允许 ${String(n)}`); return t[n]; } });

test('upload: single PutObject only (CI role has no multipart permissions)', async () => {
  const s = fakeScf();
  const cos = scriptedCos(['ok']);
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos: strictCos(cos), fetchImpl: okFetch, log: quiet, wait: async () => {} });
  await d.deploy({ zipPath: zip(), sha: 'abc' });
  assert.equal(cos.calls.length, 1);
  assert.match(cos.calls[0].Key, /^scf-deploy\/ci\/demox-unified-scf-/);
});

test('upload: retries after a failed attempt, then deploys', async () => {
  const s = fakeScf();
  const cos = scriptedCos(['fail', 'ok']);
  const lines = [];
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos, fetchImpl: okFetch, log: (l) => lines.push(l), wait: async () => {} });
  const r = await d.deploy({ zipPath: zip(), sha: 'abc' });
  assert.equal(cos.calls.length, 2);
  assert.equal(r.version, '4');
  assert.ok(lines.some((l) => l.includes('::warning::上传 COS 第 1 次失败')));
});

test('upload: Access Denied fails fast without retry, no function writes', async () => {
  const s = fakeScf();
  const cos = scriptedCos(['denied', 'ok']);
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  await assert.rejects(d.deploy({ zipPath: zip(), sha: 'abc' }), /上传 COS 失败.*Access Denied/);
  assert.equal(cos.calls.length, 1);
  assert.ok(!s.calls.some((c) => ['UpdateFunctionCode', 'PublishVersion', 'UpdateAlias'].includes(c.name)));
});

test('upload: 3 failures → loud error, no function writes', async () => {
  const s = fakeScf();
  const cos = scriptedCos(['fail', 'fail', 'fail', 'ok']);
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  await assert.rejects(d.deploy({ zipPath: zip(), sha: 'abc' }), /上传 COS 失败.*未做任何函数修改/);
  assert.equal(cos.calls.length, 3);
  assert.ok(!s.calls.some((c) => ['UpdateFunctionCode', 'PublishVersion', 'UpdateAlias'].includes(c.name)));
});

test('upload: hung attempts time out at 4 min each, whole upload capped at 10 min, no function writes', async () => {
  const s = fakeScf();
  const cos = scriptedCos(['hang', 'hang', 'hang']);
  let clock = 0;
  const timeouts = [];
  const d = createDeployer({
    developBaseUrl: DEV, scf: s.api, cos, fetchImpl: okFetch, log: quiet,
    wait: async (ms) => { clock += ms; },
    now: () => clock,
    setTimer: (fn, ms) => { timeouts.push(ms); setImmediate(() => { clock += ms; fn(); }); return ms; },
    clearTimer: () => {}
  });
  await assert.rejects(d.deploy({ zipPath: zip(), sha: 'abc' }), /上传 COS 失败.*10 分钟/);
  assert.deepEqual(timeouts.slice(0, 2), [240000, 240000]);
  assert.ok(timeouts.reduce((a, b) => a + b, 0) <= 10 * 60 * 1000, 'never exceeds the 10-minute budget');
  assert.equal(cos.calls.length, 3);
  assert.ok(!s.calls.some((c) => ['UpdateFunctionCode', 'PublishVersion', 'UpdateAlias'].includes(c.name)));
});
