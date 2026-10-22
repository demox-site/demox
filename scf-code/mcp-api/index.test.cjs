const assert = require('node:assert/strict');
const logGuard = require('../../scripts/log-leak-guard.cjs').installLogLeakGuard();
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { afterEach, before, mock, test } = require('node:test');

process.env.AUTH_API_URL = 'https://auth.example.test';
process.env.WEBSITE_API_URL = 'https://website.example.test';
const { randomTestSecret, signTestJwt } = require('../../scripts/test-jwt.cjs');

process.env.JWT_SECRET = randomTestSecret();

let api;
let sign;

before(() => {
  api = require('./index.js');
  sign = require('./shared/jwt.js').sign;
});

afterEach(() => {
  mock.restoreAll();
  api.setBackendInvoker(null);
});

function mockUpstream(body = { success: true }) {
  let requestOptions;
  let requestBody = '';
  mock.method(https, 'request', (options, callback) => {
    requestOptions = options;
    const req = new EventEmitter();
    req.write = (chunk) => { requestBody += chunk; };
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      process.nextTick(() => {
        res.emit('data', JSON.stringify(body));
        res.emit('end');
      });
    };
    req.destroy = (error) => req.emit('error', error);
    return req;
  });
  return {
    options: () => requestOptions,
    body: () => JSON.parse(requestBody)
  };
}

function deployEvent(payload) {
  return {
    httpMethod: 'POST',
    path: '/deploy',
    headers: { Authorization: `Bearer ${sign({ userId: 'user-1' })}` },
    body: JSON.stringify(payload)
  };
}

test('forwards every chunked deploy action without dropping fields', async () => {
  const cases = [
    {
      action: 'init_deploy_upload', fileName: 'site.zip', websiteId: 'HF4ODMTF',
      totalSize: 9050929, sha256: 'a'.repeat(64), requestId: 'request-1'
    },
    {
      action: 'upload_deploy_chunk', uploadId: 'upload-1', chunkIndex: 2,
      chunkSha256: 'b'.repeat(64), chunkBase64: 'Y2h1bms='
    },
    { action: 'complete_deploy_upload', uploadId: 'upload-1' },
    { action: 'abort_deploy_upload', uploadId: 'upload-1' }
  ];

  for (const payload of cases) {
    const upstream = mockUpstream();
    const result = await api.main(deployEvent(payload));
    assert.equal(result.statusCode, 200);
    assert.equal(upstream.options().path, '/website/upload');
    // mcp-api 只额外加 deploySource: 'mcp'（website-api 用它统计部署渠道）
    assert.deepEqual(upstream.body(), { ...payload, deploySource: 'mcp' });
    mock.restoreAll();
  }
});

test('keeps the legacy deploy request compatible', async () => {
  const upstream = mockUpstream();
  const result = await api.main(deployEvent({
    action: 'deploy',
    fileContentBase64: 'UEsDBAo=',
    fileName: 'legacy.zip',
    websiteId: 'LEGACY01'
  }));

  assert.equal(result.statusCode, 200);
  assert.deepEqual(upstream.body(), {
    action: 'upload_and_deploy',
    fileContentBase64: 'UEsDBAo=',
    fileName: 'legacy.zip',
    websiteId: 'LEGACY01',
    deploySource: 'mcp'
  });
});

test('rejects unrelated actions sent to /deploy', async () => {
  const result = await api.main(deployEvent({ action: 'delete', websiteId: 'HF4ODMTF' }));
  assert.equal(result.statusCode, 400);
  assert.equal(JSON.parse(result.body).error.code, 'INVALID_DEPLOY_ACTION');
});

test('prefers in-process backend invoker over HTTP', async () => {
  const calls = [];
  api.setBackendInvoker(async (url, data, token) => {
    calls.push({ url, data, token });
    return { statusCode: 201, body: JSON.stringify({ inProcess: true }) };
  });
  mock.method(https, 'request', () => {
    throw new Error('http should not be used');
  });
  const payload = {
    action: 'init_deploy_upload',
    fileName: 'site.zip',
    websiteId: 'HF4ODMTF',
    totalSize: 1,
    sha256: 'a'.repeat(64),
    requestId: 'r1'
  };
  const result = await api.main(deployEvent(payload));
  assert.equal(result.statusCode, 201);
  assert.deepEqual(JSON.parse(result.body), { inProcess: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://website.example.test/website/upload');
  assert.deepEqual(calls[0].data, { ...payload, deploySource: 'mcp' });
});

test('normalizes WEBSITE_API_URL so MCP never targets system-mcp routes', () => {
  const { normalizeWebsiteApiUrl } = api.__private;
  assert.equal(normalizeWebsiteApiUrl('https://api.demox.site'), 'https://api.demox.site/website');
  assert.equal(normalizeWebsiteApiUrl('https://api.demox.site/'), 'https://api.demox.site/website');
  assert.equal(normalizeWebsiteApiUrl('https://api.demox.site///'), 'https://api.demox.site/website');
  assert.equal(normalizeWebsiteApiUrl('https://api.demox.site/website'), 'https://api.demox.site/website');
  assert.equal(normalizeWebsiteApiUrl('https://api.demox.site/website/'), 'https://api.demox.site/website');
  assert.equal(normalizeWebsiteApiUrl(' https://x.tencentscf.com/release '), 'https://x.tencentscf.com/release/website');
});

test('normalizes AUTH_API_URL so a bare host becomes /auth and an existing /auth is kept', () => {
  const { normalizeAuthApiUrl } = api.__private;
  assert.equal(normalizeAuthApiUrl('https://host.tencentscf.com'), 'https://host.tencentscf.com/auth');
  assert.equal(normalizeAuthApiUrl('https://host.tencentscf.com/'), 'https://host.tencentscf.com/auth');
  assert.equal(normalizeAuthApiUrl('https://host.tencentscf.com///'), 'https://host.tencentscf.com/auth');
  assert.equal(normalizeAuthApiUrl('https://api.demox.site/auth'), 'https://api.demox.site/auth');
  assert.equal(normalizeAuthApiUrl('https://api.demox.site/auth/'), 'https://api.demox.site/auth');
  assert.equal(normalizeAuthApiUrl(' https://api.demox.site/auth/ '), 'https://api.demox.site/auth');
  assert.equal(normalizeAuthApiUrl('https://api.demox.site/auth/login'), 'https://api.demox.site/auth/login');
  assert.equal(normalizeAuthApiUrl('https://api.demox.site/auth/login/'), 'https://api.demox.site/auth/login');
  assert.equal(normalizeAuthApiUrl('https://x.tencentscf.com/release'), 'https://x.tencentscf.com/release');
  assert.equal(normalizeAuthApiUrl('https://x.tencentscf.com/release/'), 'https://x.tencentscf.com/release');
  assert.equal(normalizeAuthApiUrl('https://host.tencentscf.com?x=1'), 'https://host.tencentscf.com/auth');
  assert.equal(new URL(normalizeAuthApiUrl('https://host.tencentscf.com')).pathname, '/auth');
  assert.equal(new URL(normalizeAuthApiUrl('https://api.demox.site/auth/')).pathname, '/auth');
});

const AUTH_MISSING = {
  '/login': { action: 'login', error: '缺少必要参数: email 和 password' },
  '/login-code': { action: 'login_code', error: '缺少必要参数: email 和 code' },
  '/send-code': { action: 'send_code', error: '缺少必要参数: email' },
  '/register': { action: 'register', error: '缺少必要参数: email 和 password' }
};

function authMissingMessage(data) {
  if (data.action === 'send_code') return data.email ? null : AUTH_MISSING['/send-code'].error;
  if (data.action === 'login_code') return data.email && data.code ? null : AUTH_MISSING['/login-code'].error;
  if (data.action === 'login' || data.action === 'register') {
    return data.email && data.password ? null : AUTH_MISSING[data.action === 'login' ? '/login' : '/register'].error;
  }
  return null;
}

test('reads AUTH_API_URL at point of use and empty auth posts keep the auth missing-param messages', async () => {
  const previous = process.env.AUTH_API_URL;
  const calls = [];
  api.setBackendInvoker(async (url, data) => {
    calls.push({ url, data, pathname: new URL(url).pathname });
    const message = authMissingMessage(data);
    if (message) return { statusCode: 400, body: JSON.stringify({ error: message }) };
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  });
  try {
    for (const [value, expected] of [
      ['https://host.tencentscf.com', 'https://host.tencentscf.com/auth'],
      ['https://host.tencentscf.com/', 'https://host.tencentscf.com/auth'],
      ['https://api.demox.site/auth', 'https://api.demox.site/auth'],
      ['https://api.demox.site/auth/', 'https://api.demox.site/auth']
    ]) {
      process.env.AUTH_API_URL = value;
      calls.length = 0;
      const bodies = [];
      for (const path of Object.keys(AUTH_MISSING)) {
        const result = await api.main({ httpMethod: 'POST', path, body: '{}' });
        assert.equal(result.statusCode, 400, `${value} ${path}`);
        bodies.push(JSON.parse(result.body).error);
      }
      assert.deepEqual(bodies, Object.values(AUTH_MISSING).map((item) => item.error), value);
      assert.deepEqual(calls.map((call) => call.url), Array(4).fill(expected), value);
      assert.deepEqual(calls.map((call) => call.pathname), Array(4).fill('/auth'), value);
      assert.deepEqual(calls.map((call) => call.data.action), Object.values(AUTH_MISSING).map((item) => item.action), value);
    }
  } finally {
    process.env.AUTH_API_URL = previous;
  }
});

test('/me without a token stays 401 and does not call the auth backend', async () => {
  const previous = process.env.AUTH_API_URL;
  process.env.AUTH_API_URL = 'https://host.tencentscf.com';
  let calls = 0;
  api.setBackendInvoker(async () => {
    calls += 1;
    return { statusCode: 200, body: '{}' };
  });
  try {
    const result = await api.main({ httpMethod: 'POST', path: '/me', body: '{}' });
    assert.equal(result.statusCode, 401);
    assert.equal(JSON.parse(result.body).error.message, '未登录');
    assert.equal(calls, 0);
  } finally {
    process.env.AUTH_API_URL = previous;
  }
});

test('reads WEBSITE_API_URL at point of use for upload / list / delete', async () => {
  const previous = process.env.WEBSITE_API_URL;
  const calls = [];
  api.setBackendInvoker(async (url, data) => {
    calls.push({ url, data });
    return { statusCode: 200, body: '{"success":true}' };
  });
  const auth = { Authorization: `Bearer ${sign({ userId: 'user-1' })}` };
  try {
    for (const [value, expected] of [
      ['https://api.demox.site', 'https://api.demox.site/website'],
      ['https://api.demox.site/', 'https://api.demox.site/website'],
      ['https://api.demox.site/website', 'https://api.demox.site/website']
    ]) {
      process.env.WEBSITE_API_URL = value;
      calls.length = 0;
      await api.main(deployEvent({ action: 'abort_deploy_upload', uploadId: 'u1' }));
      await api.main({ httpMethod: 'POST', path: '/websites', headers: auth, body: JSON.stringify({ action: 'list' }) });
      await api.main({ httpMethod: 'POST', path: '/delete', headers: auth, body: JSON.stringify({ action: 'delete', websiteId: 'UWR3PJ2L' }) });
      assert.deepEqual(calls.map((c) => c.url), [`${expected}/upload`, `${expected}/list`, `${expected}/delete`], value);
      assert.deepEqual(calls[2].data, { action: 'delete', websiteId: 'UWR3PJ2L' });
    }
  } finally {
    process.env.WEBSITE_API_URL = previous;
  }
});

test('mcp request logs never carry the bearer token or email (v13)', async () => {
  const before = logGuard.lines.length;
  const token = sign({ userId: 'u-mail', email: 'mcp.user@example.com' });
  await api.main({ httpMethod: 'POST', path: '/deploy', headers: { Authorization: `Bearer ${token}` }, body: 'not json {' }).catch(() => {});
  await api.main({ httpMethod: 'POST', path: '/deploy', headers: { Authorization: `Bearer ${signTestJwt({ userId: 'u-bad' })}` }, body: '{}' }).catch(() => {});
  assert.ok(logGuard.lines.length > before);
});

test('a site access ticket cannot call MCP as the account', async () => {
  const upstream = mockUpstream();
  const ticket = sign({
    purpose: 'site_access',
    userId: 'user-1',
    websiteId: 'BOTCAMP1',
    host: 'botcamp.demox.site'
  }, 3600);
  const result = await api.main({
    httpMethod: 'POST',
    path: '/deploy',
    headers: { Authorization: `Bearer ${ticket}` },
    body: JSON.stringify({ action: 'abort_deploy_upload', uploadId: 'u1' })
  });
  assert.equal(result.statusCode, 401);
  assert.equal(upstream.options(), undefined);
});

// ── 日志脱敏守卫（v13）：上面所有测试打出的日志里都不能出现 token、JWT、OAuth code 或邮箱 ──
test('no token, JWT, OAuth code or email reached any console log in this suite', () => {
  logGuard.assertNoLeaks();
});
