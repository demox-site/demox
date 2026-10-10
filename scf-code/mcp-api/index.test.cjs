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

// ── 日志脱敏守卫（v13）：上面所有测试打出的日志里都不能出现 token、JWT、OAuth code 或邮箱 ──
test('no token, JWT, OAuth code or email reached any console log in this suite', () => {
  logGuard.assertNoLeaks();
});
