const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { afterEach, before, mock, test } = require('node:test');

process.env.AUTH_API_URL = 'https://auth.example.test';
process.env.WEBSITE_API_URL = 'https://website.example.test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-proxy-tests';

let api;
let sign;

before(() => {
  api = require('./index.js');
  sign = require('./shared/jwt.js').sign;
});

afterEach(() => mock.restoreAll());

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
    assert.equal(upstream.options().path, '/upload');
    assert.deepEqual(upstream.body(), payload);
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
    websiteId: 'LEGACY01'
  });
});

test('rejects unrelated actions sent to /deploy', async () => {
  const result = await api.main(deployEvent({ action: 'delete', websiteId: 'HF4ODMTF' }));
  assert.equal(result.statusCode, 400);
  assert.equal(JSON.parse(result.body).error.code, 'INVALID_DEPLOY_ACTION');
});
