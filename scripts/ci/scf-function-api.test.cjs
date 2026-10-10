'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkPreconditions, createDeployer, credentialsFromOidc, CONFIG, UPLOAD } = require('./scf-function-api.cjs');

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
// 只实现 CI 角色被允许的 4 个分片接口；调用其它 COS 接口（含桶级 ListMultipartUploads）直接失败。
function multipartCos(script = {}) {
  const calls = [];
  let partCalls = 0;
  const allowed = {
    multipartInit: (p, cb) => { calls.push(['init', p.Key]); script.init === 'denied' ? cb({ code: 'AccessDenied', message: 'Access Denied.' }) : cb(null, { UploadId: 'u1' }); },
    multipartUpload: (p, cb) => {
      const per = script.byPart && script.byPart[p.PartNumber];
      const step = per ? (per.shift() || 'ok') : ((script.parts || [])[partCalls++] || 'ok');
      calls.push(['part', p.PartNumber, p.Body.length]);
      if (step === 'ok') cb(null, { ETag: `"e${p.PartNumber}"` });
      else if (step === 'fail') cb({ code: 'RequestTimeout', message: 'socket hang up' });
      else if (step === 'denied') cb({ code: 'AccessDenied', message: 'Access Denied.' });
      // 'hang'：不回调
    },
    multipartComplete: (p, cb) => { calls.push(['complete', p.Parts.map((x) => x.PartNumber).join(',')]); cb(null, {}); },
    multipartAbort: (p, cb) => { calls.push(['abort', p.UploadId]); cb(null, {}); }
  };
  return new Proxy({ calls }, { get: (t, n) => {
    if (n === 'calls') return calls;
    if (n in allowed) return allowed[n];
    if (typeof n === 'string' && n !== 'then') throw new Error(`CI 角色没有 COS 接口 ${n} 的权限`);
    return undefined;
  } });
}
const fakeCos = multipartCos();
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


// ---- COS 分片上传：只用 Init/UploadPart/Complete/Abort + 单片超时/重试 + 总超时 ----
const bigZip = (mb) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mp-')), 'big.zip'); fs.writeFileSync(f, Buffer.alloc(Math.round(mb * 1048576), 1)); return f; };
const NO_WRITES = (s) => !s.calls.some((c) => ['UpdateFunctionCode', 'PublishVersion', 'UpdateAlias'].includes(c.name));

test('upload: multipart with 5 MB parts using only Init/UploadPart/Complete (no ListMultipartUploads, no sliceUploadFile)', async () => {
  const s = fakeScf();
  const cos = multipartCos();
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  await d.uploadZip(bigZip(20), 'scf-deploy/ci/x.zip');
  const parts = cos.calls.filter((c) => c[0] === 'part');
  assert.equal(parts.length, 4);
  assert.ok(parts.every((p) => p[2] === 5 * 1048576));
  assert.deepEqual(cos.calls.find((c) => c[0] === 'complete'), ['complete', '1,2,3,4']);
  assert.equal(cos.calls[0][0], 'init');
});

test('upload: deploy uses multipart before any function write', async () => {
  const s = fakeScf();
  const cos = multipartCos();
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  const r = await d.deploy({ zipPath: zip(), sha: 'abc' });
  assert.equal(r.version, '4');
  assert.ok(cos.calls.some((c) => c[0] === 'complete'));
});

test('upload: a failed part is retried and the upload completes', async () => {
  const s = fakeScf();
  const cos = multipartCos({ parts: ['fail', 'ok', 'ok', 'ok'] });
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  await d.uploadZip(bigZip(20), 'scf-deploy/ci/x.zip');
  assert.equal(cos.calls.filter((c) => c[0] === 'part').length, 5);
  assert.ok(cos.calls.some((c) => c[0] === 'complete'));
});

test('upload: a second attempt resumes the same UploadId and only re-sends missing parts', async () => {
  const s = fakeScf();
  // 片 2 前 8 次都失败 → 第 1 次失败（其它片已传好）；第 2 次只补片 2
  const cos = multipartCos({ byPart: { 2: Array(8).fill('fail') } });
  const lines = [];
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos, fetchImpl: okFetch, log: (l) => lines.push(l), wait: async () => {} });
  await d.uploadZip(bigZip(20), 'scf-deploy/ci/x.zip');
  assert.equal(cos.calls.filter((c) => c[0] === 'init').length, 1);
  assert.deepEqual(cos.calls.find((c) => c[0] === 'complete'), ['complete', '1,2,3,4']);
  assert.ok(lines.some((l) => l.includes('续传：已有')), 'second attempt logs resume');
  assert.ok(!cos.calls.some((c) => c[0] === 'abort'));
  assert.equal(cos.calls.filter((c) => c[0] === 'part' && c[1] !== 2).length, 3, 'parts 1,3,4 sent once only');
});

test('upload: a stalled part times out on its own and is retried', async () => {
  const s = fakeScf();
  const cos = multipartCos({ parts: ['hang', 'ok', 'ok', 'ok', 'ok'] });
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos, fetchImpl: okFetch, log: quiet, wait: async () => {}, uploadOptions: { partTimeoutMs: 30 } });
  await d.uploadZip(bigZip(20), 'scf-deploy/ci/x.zip');
  assert.equal(cos.calls.filter((c) => c[0] === 'part').length, 5);
  assert.deepEqual(cos.calls.find((c) => c[0] === 'complete'), ['complete', '1,2,3,4']);
});

test('upload: Access Denied fails fast (no retry), aborts, no function writes', async () => {
  const s = fakeScf();
  const cos = multipartCos({ parts: ['denied'] });
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  await assert.rejects(d.deploy({ zipPath: zip(), sha: 'abc' }), /上传 COS 失败.*Access Denied/);
  assert.equal(cos.calls.filter((c) => c[0] === 'init').length, 1);
  assert.equal(cos.calls.filter((c) => c[0] === 'part').length, 1);
  await new Promise((r) => setImmediate(r));
  assert.ok(cos.calls.some((c) => c[0] === 'abort'));
  assert.ok(NO_WRITES(s));
});

test('upload: parts failing every time → 3 whole attempts then a loud error, no function writes', async () => {
  const s = fakeScf();
  const cos = multipartCos({ parts: Array(40).fill('fail') });
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  await assert.rejects(d.deploy({ zipPath: zip(), sha: 'abc' }), /上传 COS 失败.*未做任何函数修改/);
  assert.equal(cos.calls.filter((c) => c[0] === 'init').length, 1, 'one UploadId reused across attempts');
  assert.equal(cos.calls.filter((c) => c[0] === 'part').length, 24, '8 tries per part × 3 attempts');
  assert.ok(cos.calls.some((c) => c[0] === 'abort'), 'final failure aborts the multipart upload');
  assert.ok(NO_WRITES(s));
});

test('upload: a hung part hits the totalTimeoutMs cap, aborts, no function writes', async () => {
  const s = fakeScf();
  const cos = multipartCos({ parts: Array(20).fill('hang') });
  let clock = 0;
  const timeouts = [];
  const d = createDeployer({
    developBaseUrl: DEV, scf: s.api, cos, fetchImpl: okFetch, log: quiet, uploadOptions: { partTimeoutMs: 20 },
    wait: async (ms) => { clock += ms; },
    now: () => clock,
    setTimer: (fn, ms) => { timeouts.push(ms); setImmediate(() => { clock += ms; fn(); }); return ms; },
    clearTimer: () => {}
  });
  await assert.rejects(d.deploy({ zipPath: zip(), sha: 'abc' }), /上传 COS 失败.*\d+ 分钟/);
  // 先挂 0% 看门狗，再按轮次等分预算
  assert.equal(timeouts[0], UPLOAD.firstPartTimeoutMs);
  assert.ok(timeouts.includes(Math.max(3 * 60 * 1000, Math.floor(UPLOAD.totalTimeoutMs / 3))));
  assert.equal(cos.calls.filter((c) => c[0] === 'init').length, 1);
  assert.ok(cos.calls.some((c) => c[0] === 'abort'), '最终失败才 Abort');
  assert.ok(NO_WRITES(s));
});

test('stage: uploads the package to COS and makes no SCF calls at all', async () => {
  const s = fakeScf();
  const cos = multipartCos({});
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos, fetchImpl: okFetch, log: () => {}, wait: async () => {} });
  const r = await d.stage({ zipPath: bigZip(12), sha: '892ca5dcbffe231365' });
  assert.match(r.key, /^scf-deploy\/ci\/demox-unified-scf-892ca5dcbffe-[0-9a-f]{12}\.zip$/);
  assert.equal(s.calls.length, 0, 'no SCF API calls');
  assert.ok(cos.calls.some((c) => c[0] === 'complete'));
});

test('stray socket errors from abandoned part requests are recognised (not fatal); others are', () => {
  const { isStraySocketError } = require('./scf-function-api.cjs');
  for (const code of ['EPIPE', 'ECONNRESET', 'ETIMEDOUT']) assert.ok(isStraySocketError(Object.assign(new Error('x'), { code })));
  assert.ok(!isStraySocketError(new Error('AccessDenied')));
  assert.ok(!isStraySocketError(Object.assign(new Error('x'), { code: 'ERR_ASSERTION' })));
});


test('upload: 0% after firstPartTimeoutMs → stop immediately, abort, clear message, no retries, no function writes', async () => {
  const s = fakeScf();
  const cos = multipartCos({ parts: Array(50).fill('hang') });
  const lines = [];
  const d = createDeployer({
    developBaseUrl: DEV, scf: s.api, cos, fetchImpl: okFetch, log: (l) => lines.push(l), wait: async () => {},
    uploadOptions: { firstPartTimeoutMs: 40, partTimeoutMs: 1000, attempts: 3 }
  });
  const started = Date.now();
  await assert.rejects(d.deploy({ zipPath: bigZip(12), sha: 'abc' }), /0%（一片都没传完）.*未做任何函数修改/);
  assert.ok(Date.now() - started < 1000, 'gave up quickly, did not wait for part timeouts / other attempts');
  assert.equal(lines.filter((l) => l.includes('上传 COS 第')).filter((l) => !l.includes('失败')).length, 1, 'no second attempt');
  assert.ok(cos.calls.some((c) => c[0] === 'abort'));
  assert.ok(NO_WRITES(s));
});

test('upload: progress before firstPartTimeoutMs → watchdog does not fire', async () => {
  const s = fakeScf();
  const cos = multipartCos({});
  const d = createDeployer({ developBaseUrl: DEV, scf: s.api, cos, fetchImpl: okFetch, log: () => {}, wait: async () => {}, uploadOptions: { firstPartTimeoutMs: 5000 } });
  await d.uploadZip(bigZip(12), 'scf-deploy/ci/x.zip');
  assert.ok(cos.calls.some((c) => c[0] === 'complete'));
  assert.ok(!cos.calls.some((c) => c[0] === 'abort'));
});

test('COS bucket/region come from env (default Chengdu) and are validated', () => {
  const { execFileSync } = require('node:child_process');
  const run = (env) => execFileSync(process.execPath, ['-e', "const m=require('./scripts/ci/scf-function-api.cjs');console.log(m.CONFIG.cosBucket+' '+m.CONFIG.cosRegion)"], { cwd: require('node:path').join(__dirname, '..', '..'), env: { PATH: process.env.PATH, ...env } }).toString().trim();
  assert.equal(run({}), 'demox-analytics-raw-1307257815 ap-chengdu');
  assert.equal(run({ DEMOX_COS_BUCKET: 'demox-scf-deploy-1307257815', DEMOX_COS_REGION: 'ap-guangzhou' }), 'demox-scf-deploy-1307257815 ap-guangzhou');
  const { validateCosTarget } = require('./scf-function-api.cjs');
  assert.doesNotThrow(() => validateCosTarget('demox-scf-deploy-1307257815', 'ap-guangzhou'));
  assert.throws(() => validateCosTarget('no-appid', 'ap-guangzhou'), /桶名不合法/);
  assert.throws(() => validateCosTarget('demox-x-1307257815', 'guangzhou'), /地域不合法/);
});
