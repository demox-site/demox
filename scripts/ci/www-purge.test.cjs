'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  INDEX_URL,
  DURATION_SECONDS,
  WINDOW_BEFORE_MS,
  WINDOW_AFTER_MS,
  REGION,
  readSettings,
  roleSessionName,
  formatTcTime,
  purgeTasks,
  buildDescribePurgePayload,
  buildOidcTokenRequest,
  buildAssumeRoleRequest,
  buildSignedTeoRequest,
  headersForFetch,
  createRedactor,
  summarizePurgeTasks,
  pollUntilSuccess,
  runPurge
} = require('./www-purge.cjs');

const PREFIX = 'https://sites.demox.site/sites/1985655011013808129/EPX2UU43/';
const ZONE = 'zone-3kplfkbflnd6';
const ROLE = 'qcs::cam::uin/100021031865:roleName/demox-ci-www-purge';
const ID_TOKEN = 'web-identity-token-fixture';
const SECRET_ID = 'AKIDtmpFixture';
const SECRET_KEY = 'tmp-secret-key-fixture';
const SESSION = 'session-token-fixture';
const REQUEST_TOKEN = 'github-oidc-request-token';
const T0 = Date.UTC(2026, 9, 22, 5, 40, 0);
const SIGN_AT = 1700000000;
const PREFIX_PAYLOAD = {
  ZoneId: ZONE,
  Type: 'purge_prefix',
  Targets: [PREFIX]
};

function baseEnv(extra = {}) {
  return {
    TENCENT_WWW_PURGE_ROLE_ARN: ROLE,
    TENCENT_OIDC_PROVIDER_ID: 'github-actions',
    EO_ZONE_ID: ZONE,
    WWW_ORIGIN_PURGE_PREFIX: PREFIX,
    GITHUB_RUN_ID: '42',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gh.example/token?x=1',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: REQUEST_TOKEN,
    ...extra
  };
}

function scriptedFetch(steps) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts, body: opts.body });
    const step = steps.shift();
    if (!step) throw new Error(`unexpected fetch ${url}`);
    if (step.throw) throw step.throw;
    return {
      ok: (step.status || 200) < 400,
      status: step.status || 200,
      json: async () => step.json
    };
  };
  fn.calls = calls;
  return fn;
}

function stsOk(extra = {}) {
  return {
    json: {
      Response: {
        Credentials: { TmpSecretId: SECRET_ID, TmpSecretKey: SECRET_KEY, Token: SESSION },
        Expiration: extra.expiration || '2026-10-22T06:40:00Z'
      }
    }
  };
}

function createOk(jobId, requestId) {
  return { json: { Response: { JobId: jobId, RequestId: requestId, FailedList: [] } } };
}

function describeOk(jobId, status) {
  return { json: { Response: { Tasks: [{ JobId: jobId, Status: status, Target: 'https://example.invalid/' }], TotalCount: 1, RequestId: 'req-d' } } };
}

function assertNoCredentials(text) {
  assert.equal(text.includes(ID_TOKEN), false);
  assert.equal(text.includes(SECRET_ID), false);
  assert.equal(text.includes(SECRET_KEY), false);
  assert.equal(text.includes(SESSION), false);
  assert.equal(text.includes(REQUEST_TOKEN), false);
  assert.equal(text.includes('Authorization'), false);
}

test('readSettings accepts the www environment vars and rejects anything else', () => {
  const settings = readSettings(baseEnv());
  assert.equal(settings.roleArn, ROLE);
  assert.equal(settings.providerId, 'github-actions');
  assert.equal(settings.zoneId, ZONE);
  assert.equal(settings.originPrefix, PREFIX);
  assert.equal(settings.indexUrl, INDEX_URL);
  assert.equal(settings.runId, '42');
  assert.deepEqual(purgeTasks(settings).map((task) => task.type), ['purge_prefix', 'purge_url']);
  assert.deepEqual(purgeTasks(settings)[1].targets, [INDEX_URL]);

  const drop = (name) => {
    const env = baseEnv();
    delete env[name];
    assert.throws(() => readSettings(env), new RegExp(name));
  };
  for (const name of ['TENCENT_WWW_PURGE_ROLE_ARN', 'TENCENT_OIDC_PROVIDER_ID', 'EO_ZONE_ID', 'WWW_ORIGIN_PURGE_PREFIX']) drop(name);
  for (const bad of [
    'http://sites.demox.site/sites/1/EPX2UU43/',
    'https://www.demox.site/',
    'https://sites.demox.site/sites/1/EPX2UU43',
    'https://sites.demox.site/sites/1/EPX2UU43/?x=1',
    'https://user:pw@sites.demox.site/sites/1/EPX2UU43/',
    'https://sites.demox.site/'
  ]) {
    assert.throws(() => readSettings(baseEnv({ WWW_ORIGIN_PURGE_PREFIX: bad })), /WWW_ORIGIN_PURGE_PREFIX/, bad);
  }
  assert.throws(() => readSettings(baseEnv({ EO_ZONE_ID: '*' })), /EO_ZONE_ID/);
  assert.throws(() => readSettings(baseEnv({ TENCENT_WWW_PURGE_ROLE_ARN: 'arn:aws:iam::1:role/x' })), /ROLE_ARN/);
});

test('OIDC and AssumeRoleWithWebIdentity requests match the unsigned STS call', () => {
  const oidc = buildOidcTokenRequest({ requestUrl: 'https://gh.example/token?x=1', requestToken: REQUEST_TOKEN });
  assert.equal(oidc.url, 'https://gh.example/token?x=1&audience=sts.tencentcloudapi.com');
  assert.equal(oidc.headers.Authorization, `bearer ${REQUEST_TOKEN}`);
  const bare = buildOidcTokenRequest({ requestUrl: 'https://gh.example/token', requestToken: REQUEST_TOKEN });
  assert.equal(bare.url, 'https://gh.example/token?audience=sts.tencentcloudapi.com');

  assert.equal(roleSessionName('42'), 'www-purge-42');
  assert.equal(roleSessionName('run/99'), 'www-purge-run99');
  const request = buildAssumeRoleRequest({
    providerId: 'github-actions',
    roleArn: ROLE,
    webIdentityToken: ID_TOKEN,
    roleSessionName: roleSessionName('42'),
    timestamp: SIGN_AT
  });
  assert.equal(request.url, 'https://sts.tencentcloudapi.com/');
  assert.equal(request.headers.Authorization, 'SKIP');
  assert.equal(request.headers['X-TC-Action'], 'AssumeRoleWithWebIdentity');
  assert.equal(request.headers['X-TC-Version'], '2018-08-13');
  assert.equal(request.headers['X-TC-Region'], REGION);
  assert.equal(request.headers['X-TC-Timestamp'], String(SIGN_AT));
  assert.equal(request.headers['Content-Type'], 'application/json');
  const body = JSON.parse(request.body);
  assert.deepEqual(body, {
    ProviderId: 'github-actions',
    WebIdentityToken: ID_TOKEN,
    RoleArn: ROLE,
    RoleSessionName: 'www-purge-42',
    DurationSeconds: DURATION_SECONDS
  });
  assert.equal(DURATION_SECONDS, 3600);
  assert.equal(JSON.stringify(request).includes(SECRET_KEY), false);
});

test('CreatePurgeTask signature is TC3 over the exact body', () => {
  const request = buildSignedTeoRequest({
    secretId: SECRET_ID,
    secretKey: SECRET_KEY,
    token: SESSION,
    action: 'CreatePurgeTask',
    payload: PREFIX_PAYLOAD,
    timestamp: SIGN_AT
  });
  const canonical = [
    'POST',
    '/',
    '',
    'content-type:application/json; charset=utf-8',
    'host:teo.tencentcloudapi.com',
    'x-tc-action:createpurgetask',
    '',
    'content-type;host;x-tc-action',
    crypto.createHash('sha256').update(request.body).digest('hex')
  ].join('\n');
  assert.equal(request.canonicalRequest, canonical);
  assert.equal(request.body, JSON.stringify(PREFIX_PAYLOAD));
  assert.equal(request.url, 'https://teo.tencentcloudapi.com/');
  assert.equal(request.headers['X-TC-Action'], 'CreatePurgeTask');
  assert.equal(request.headers['X-TC-Version'], '2022-09-01');
  assert.equal(request.headers['X-TC-Region'], 'ap-guangzhou');
  assert.equal(request.headers['X-TC-Timestamp'], String(SIGN_AT));
  assert.equal(request.headers['X-TC-Token'], SESSION);
  const date = '2023-11-14';
  const scope = `${date}/teo/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(SIGN_AT), scope, crypto.createHash('sha256').update(canonical).digest('hex')].join('\n');
  const hmac = (key, message) => crypto.createHmac('sha256', key).update(message).digest();
  const signing = hmac(hmac(hmac(Buffer.from(`TC3${SECRET_KEY}`), date), 'teo'), 'tc3_request');
  const expected = crypto.createHmac('sha256', signing).update(stringToSign).digest('hex');
  assert.equal(expected, '52685004ed82d0fad7d2e135658369098d2a55c6ca0cc65032d7dcb4e4f2948e');
  assert.equal(request.signature, expected);
  assert.equal(request.headers.Authorization, `TC3-HMAC-SHA256 Credential=${SECRET_ID}/${scope}, SignedHeaders=content-type;host;x-tc-action, Signature=${expected}`);
  const packed = JSON.stringify({ url: request.url, body: request.body, canonicalRequest: request.canonicalRequest, stringToSign: request.stringToSign, signature: request.signature });
  assert.equal(packed.includes(SECRET_KEY), false);
  const changed = buildSignedTeoRequest({
    secretId: SECRET_ID,
    secretKey: SECRET_KEY,
    token: SESSION,
    action: 'CreatePurgeTask',
    payload: { ...PREFIX_PAYLOAD, Type: 'purge_url', Targets: [INDEX_URL] },
    timestamp: SIGN_AT
  });
  assert.notEqual(changed.signature, request.signature);
  const sent = headersForFetch(request.headers);
  assert.equal(sent.Host, undefined);
  assert.equal(sent['X-TC-Token'], SESSION);
  assert.equal(sent.Authorization, request.headers.Authorization);
});

test('DescribePurgeTasks payload is the zone, a time window, and one job id', () => {
  const payload = buildDescribePurgePayload({
    zoneId: ZONE,
    startTime: '2026-10-22T05:10:00+00:00',
    endTime: '2026-10-22T05:45:00+00:00',
    jobId: 'job-prefix'
  });
  assert.deepEqual(payload, {
    ZoneId: ZONE,
    StartTime: '2026-10-22T05:10:00+00:00',
    EndTime: '2026-10-22T05:45:00+00:00',
    Filters: [{ Name: 'job-id', Values: ['job-prefix'] }],
    Limit: 100
  });
  assert.equal(payload.Filters[0].Values.length, 1);
  assert.equal(formatTcTime(Date.UTC(2022, 1, 9, 0, 0, 0)), '2022-02-09T00:00:00+00:00');
});

test('summarizePurgeTasks ignores other jobs and treats failed statuses as terminal', () => {
  assert.deepEqual(summarizePurgeTasks([], 'a'), { state: 'pending', status: 'missing' });
  assert.deepEqual(summarizePurgeTasks([{ JobId: 'other', Status: 'failed' }, { JobId: 'a', Status: 'success' }], 'a'), { state: 'success', status: 'success' });
  assert.equal(summarizePurgeTasks([{ JobId: 'a', Status: 'success' }, { JobId: 'a', Status: 'processing' }], 'a').state, 'pending');
  for (const status of ['failed', 'timeout', 'canceled', 'invalid']) {
    assert.equal(summarizePurgeTasks([{ JobId: 'a', Status: status }], 'a').state, 'failed', status);
  }
  assert.deepEqual(summarizePurgeTasks([{ JobId: 'a', Status: 'queued' }], 'a'), { state: 'pending', status: 'queued' });
});

test('pollUntilSuccess returns after every job is success and stops early on failure', async () => {
  let clock = 0;
  const waits = [];
  const seen = [];
  const rounds = { a: 0 };
  const ids = await pollUntilSuccess({
    jobs: [{ type: 'purge_prefix', jobId: 'a' }, { type: 'purge_url', jobId: 'b' }],
    describe: async (job) => {
      seen.push(job.jobId);
      if (job.jobId === 'a') {
        rounds.a += 1;
        return [{ JobId: 'a', Status: rounds.a < 2 ? 'processing' : 'success' }];
      }
      return [{ JobId: 'b', Status: 'success' }];
    },
    timeoutMs: 10000,
    intervalMs: 5000,
    now: () => clock,
    wait: async (ms) => { waits.push(ms); clock += ms; }
  });
  assert.deepEqual(ids, ['a', 'b']);
  assert.deepEqual(waits, [5000]);
  assert.deepEqual(seen, ['a', 'b', 'a']);

  const failedWaits = [];
  let failedCalls = 0;
  await assert.rejects(pollUntilSuccess({
    jobs: [{ type: 'purge_prefix', jobId: 'a' }, { type: 'purge_url', jobId: 'b' }],
    describe: async () => { failedCalls += 1; return [{ JobId: 'a', Status: 'failed' }]; },
    timeoutMs: 10000,
    intervalMs: 5000,
    now: () => 0,
    wait: async (ms) => { failedWaits.push(ms); }
  }), /刷新缓存失败：purge_prefix job=a 状态 failed/);
  assert.equal(failedCalls, 1);
  assert.deepEqual(failedWaits, []);
});

test('pollUntilSuccess fails loudly when the deadline passes still processing', async () => {
  let clock = 0;
  const waits = [];
  await assert.rejects(pollUntilSuccess({
    jobs: [{ type: 'purge_prefix', jobId: 'a' }, { type: 'purge_url', jobId: 'b' }],
    describe: async (job) => [{ JobId: job.jobId, Status: job.jobId === 'b' ? 'queued' : 'processing' }],
    timeoutMs: 10000,
    intervalMs: 5000,
    now: () => clock,
    wait: async (ms) => { waits.push(ms); clock += ms; }
  }), /刷新缓存超时（10s）：purge_prefix job=a 状态 processing，purge_url job=b 状态 queued/);
  assert.deepEqual(waits, [5000, 5000]);
});

test('runPurge submits prefix then url and polls both job ids inside the time window', async () => {
  const fetchImpl = scriptedFetch([
    { json: { value: ID_TOKEN } },
    stsOk({ expiration: `2026-10-22T06:40:00Z ${SECRET_KEY}` }),
    createOk('job-prefix', 'req-prefix'),
    createOk('job-url', 'req-url'),
    describeOk('job-prefix', 'processing'),
    describeOk('job-url', 'processing'),
    describeOk('job-prefix', 'success'),
    describeOk('job-url', 'success')
  ]);
  const lines = [];
  let clock = T0;
  const result = await runPurge({
    env: baseEnv(),
    fetchImpl,
    log: (line) => lines.push(line),
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    timeoutMs: 20000,
    intervalMs: 5000
  });
  assert.deepEqual(result.jobs.map((job) => `${job.type}:${job.jobId}`), ['purge_prefix:job-prefix', 'purge_url:job-url']);
  const actions = fetchImpl.calls.map((call) => call.opts.headers['X-TC-Action'] || 'oidc');
  assert.deepEqual(actions, [
    'oidc',
    'AssumeRoleWithWebIdentity',
    'CreatePurgeTask',
    'CreatePurgeTask',
    'DescribePurgeTasks',
    'DescribePurgeTasks',
    'DescribePurgeTasks',
    'DescribePurgeTasks'
  ]);
  assert.equal(fetchImpl.calls[0].url, 'https://gh.example/token?x=1&audience=sts.tencentcloudapi.com');
  assert.equal(fetchImpl.calls[1].opts.headers.Authorization, 'SKIP');
  assert.equal(JSON.parse(fetchImpl.calls[1].body).RoleSessionName, 'www-purge-42');
  assert.equal(JSON.parse(fetchImpl.calls[1].body).ProviderId, 'github-actions');
  assert.deepEqual(JSON.parse(fetchImpl.calls[2].body), PREFIX_PAYLOAD);
  assert.deepEqual(JSON.parse(fetchImpl.calls[3].body), { ZoneId: ZONE, Type: 'purge_url', Targets: [INDEX_URL] });
  for (const [index, jobId] of [[4, 'job-prefix'], [5, 'job-url'], [6, 'job-prefix'], [7, 'job-url']]) {
    const payload = JSON.parse(fetchImpl.calls[index].body);
    assert.equal(payload.ZoneId, ZONE);
    assert.deepEqual(payload.Filters, [{ Name: 'job-id', Values: [jobId] }]);
    assert.equal(payload.StartTime, formatTcTime(T0 - WINDOW_BEFORE_MS));
    assert.equal(payload.EndTime, formatTcTime((index < 6 ? T0 : T0 + 5000) + WINDOW_AFTER_MS));
  }
  assert.equal(fetchImpl.calls[4].opts.headers.Host, undefined);
  assert.equal(fetchImpl.calls[4].opts.headers['X-TC-Token'], SESSION);
  assert.match(lines.join('\n'), /EdgeOne 缓存已刷新：purge_prefix job-prefix，purge_url job-url/);
  assertNoCredentials(lines.join('\n'));
});

test('runPurge redacts credentials from API errors and does not poll after a rejected task', async () => {
  const denied = scriptedFetch([
    { json: { value: ID_TOKEN } },
    { json: { Response: { Error: { Code: 'AccessDenied', Message: `denied ${ID_TOKEN}` } } } }
  ]);
  await assert.rejects(runPurge({
    env: baseEnv(),
    fetchImpl: denied,
    log: () => {},
    now: () => T0,
    wait: async () => {}
  }), (error) => {
    assert.match(error.message, /AssumeRoleWithWebIdentity 失败：AccessDenied/);
    assert.equal(error.message.includes(ID_TOKEN), false);
    assert.equal(error.message.includes('[redacted]'), true);
    return true;
  });

  const rejected = scriptedFetch([
    { json: { value: ID_TOKEN } },
    stsOk(),
    { json: { Response: { JobId: 'job-prefix', FailedList: [{ Reason: `bad ${SECRET_KEY}`, Target: PREFIX }] } } }
  ]);
  const lines = [];
  await assert.rejects(runPurge({
    env: baseEnv(),
    fetchImpl: rejected,
    log: (line) => lines.push(line),
    now: () => T0,
    wait: async () => {}
  }), (error) => {
    assert.match(error.message, /CreatePurgeTask purge_prefix 被拒绝/);
    assert.equal(error.message.includes(SECRET_KEY), false);
    return true;
  });
  assert.equal(rejected.calls.length, 3);
  assertNoCredentials(lines.join('\n'));

  let calls = 0;
  await assert.rejects(runPurge({
    env: baseEnv({ ACTIONS_ID_TOKEN_REQUEST_URL: '' }),
    fetchImpl: async () => { calls += 1; return { ok: true, status: 200, json: async () => ({}) }; },
    log: () => {},
    now: () => T0,
    wait: async () => {}
  }), /id-token: write/);
  assert.equal(calls, 0);
});

test('runPurge times out loudly when DescribePurgeTasks stays processing', async () => {
  const fetchImpl = scriptedFetch([
    { json: { value: ID_TOKEN } },
    stsOk(),
    createOk('job-prefix', 'req-prefix'),
    createOk('job-url', 'req-url'),
    describeOk('job-prefix', 'processing'),
    describeOk('job-url', 'success'),
    describeOk('job-prefix', 'processing')
  ]);
  let clock = T0;
  await assert.rejects(runPurge({
    env: baseEnv(),
    fetchImpl,
    log: () => {},
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    timeoutMs: 5000,
    intervalMs: 5000
  }), /刷新缓存超时（5s）：purge_prefix job=job-prefix 状态 processing/);
});

test('redactor removes credential material and leaves the surrounding text', () => {
  const hide = createRedactor([SECRET_KEY, SESSION, 'short']);
  assert.equal(hide(`key ${SECRET_KEY} token ${SESSION}`), 'key [redacted] token [redacted]');
  assert.equal(hide('short stays'), 'short stays');
});

test('deploy workflow purges after the www deploy using the www OIDC environment', () => {
  const yaml = fs.readFileSync(path.join(__dirname, '../../.github/workflows/deploy.yml'), 'utf8');
  const deployAt = yaml.indexOf('demox deploy ./dist');
  const purgeAt = yaml.indexOf('node scripts/ci/www-purge.cjs');
  assert.ok(deployAt > 0 && purgeAt > deployAt);
  assert.match(yaml, /environment:\s*www/);
  assert.match(yaml, /id-token:\s*write/);
  assert.match(yaml, /contents:\s*read/);
  for (const name of ['TENCENT_WWW_PURGE_ROLE_ARN', 'TENCENT_OIDC_PROVIDER_ID', 'EO_ZONE_ID', 'WWW_ORIGIN_PURGE_PREFIX']) {
    assert.match(yaml, new RegExp(`${name}:\\s*\\$\\{\\{\\s*vars\\.${name}\\s*\\}\\}`));
  }
  assert.doesNotMatch(yaml, /TENCENTCLOUD_SECRET|secrets\.TENCENT|secrets\.EO_|secrets\.WWW_/);
});
