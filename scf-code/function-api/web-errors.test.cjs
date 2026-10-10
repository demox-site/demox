'use strict';
// 已知 4xx（RATE_LIMITED 等）在 Web 入口和事件入口返回同样的状态码和 body，不再冒泡成 500。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFunctionHttpHandler, createPlatformHandler } = require('./index.js');
const { InMemoryBundleStore } = require('./bundle-store.js');
const { InMemoryFunctionRepository } = require('./repository.js');
const { createWebServer } = require('./web-server.js');
const { badRequest, unauthorized, forbidden, notFound, tooManyRequests, internalError, FunctionApiError } = require('./errors.js');

async function withServer(handler, fn) {
  const logs = [];
  const server = createWebServer({ handler, logger: { error: (...a) => logs.push(a.join(' ')) } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`, logs); } finally { server.close(); }
}

async function makePlatform() {
  const runtime = { async execute() { return { status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' }; } };
  const user = createFunctionHttpHandler({
    repository: new InMemoryFunctionRepository(), bundleStore: new InMemoryBundleStore(), runtime,
    authenticate: () => ({ userId: 'owner' }), publicBaseUrl: 'https://functions.test'
  });
  const req = (path, method, body) => ({ path, httpMethod: method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const fn = JSON.parse((await user(req('/functions', 'POST', { websiteId: 'site-a', name: 'Rate', slug: 'rate', limits: { maxInvocationsPerMinute: 1 } }))).body).function;
  await user(req(`/functions/${fn.functionId}/versions`, 'POST', { source: 'module.exports = () => "ok"' }));
  await user(req(`/functions/${fn.functionId}/publish`, 'POST', { version: 1 }));
  const logs = [];
  const platform = createPlatformHandler({
    userHandler: user,
    systemEntries: [],
    systemHandler: async () => ({ statusCode: 599, body: 'system' }),
    logger: { warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) }
  });
  return { platform, logs };
}

const strip = (body) => { const { requestId, ...rest } = body; assert.ok(requestId); return rest; };

test('event path: user-function rate limit returns 429 with the usual error shape (not a throw)', async () => {
  const { platform, logs } = await makePlatform();
  const ev = { httpMethod: 'GET', path: '/site-a/production/api/rate', headers: { 'x-forwarded-for': '203.0.113.7' }, requestContext: { requestId: 'req-ev' } };
  assert.equal((await platform(ev)).statusCode, 200);
  const limited = await platform(ev);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['access-control-allow-origin'], '*');
  assert.equal(limited.headers['x-demox-request-id'], 'req-ev');
  assert.deepEqual(JSON.parse(limited.body), { success: false, error: 'RATE_LIMITED', message: '函数调用超过每分钟配额', requestId: 'req-ev' });
  assert.ok(logs.some((l) => l.includes('RATE_LIMITED')));
});

test('web path: same function, same 429 status and body as the event path (forged headers do not bypass)', async () => {
  const { platform } = await makePlatform();
  const evLimited = await (async () => {
    const p = (await makePlatform()).platform;
    const ev = { httpMethod: 'GET', path: '/site-a/production/api/rate', headers: { 'x-forwarded-for': '203.0.113.7' } };
    await p(ev); return p(ev);
  })();
  await withServer(platform, async (base, logs) => {
    const send = (i) => fetch(`${base}/site-a/production/api/rate`, { headers: { 'x-forwarded-for': `1.1.1.${i}, 203.0.113.7`, 'x-scf-remote-addr': `3.3.3.${i}` } });
    assert.equal((await send(1)).status, 200);
    const res = await send(2);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.ok(res.headers.get('x-demox-request-id'));
    const body = await res.json();
    assert.equal(body.requestId, res.headers.get('x-demox-request-id'));
    assert.deepEqual(strip(body), strip(JSON.parse(evLimited.body)));
    assert.equal(evLimited.statusCode, 429);
    assert.ok(!logs.some((l) => l.includes('Web 入口处理失败')), 'typed 4xx must not hit the generic 500 path');
  });
});

test('web entry maps every known typed 4xx thrown by the handler to its own status and shape', async () => {
  const cases = [
    [badRequest('请求体超过大小限制', 'REQUEST_TOO_LARGE'), 400],
    [unauthorized(), 401],
    [forbidden(), 403],
    [notFound(), 404],
    [tooManyRequests(), 429],
    [new FunctionApiError('x', 'CONFLICT', 409), 409]
  ];
  for (const [error, status] of cases) {
    await withServer(async () => { throw error; }, async (base, logs) => {
      const res = await fetch(`${base}/x`);
      assert.equal(res.status, status, error.code);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.error, error.code);
      assert.equal(body.message, error.message);
      assert.ok(body.requestId);
      assert.equal(logs.length, 0);
    });
  }
});

test('web entry: untyped errors and typed 5xx still return the generic 500 and log only the code', async () => {
  for (const error of [Object.assign(new Error('token eyJ.x a@b.co'), { code: 'BOOM' }), internalError('函数代码读取失败', { code: 'BUNDLE_MISSING' })]) {
    await withServer(async () => { throw error; }, async (base, logs) => {
      const res = await fetch(`${base}/x`, { method: 'POST', body: 'secret a@b.co' });
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.error, 'INTERNAL_ERROR');
      assert.equal(body.message, undefined);
      assert.ok(logs.join('\n').includes(error.code));
      assert.ok(!logs.join('\n').includes('a@b.co'));
    });
  }
});

test('event path: untyped errors still propagate (behaviour unchanged)', async () => {
  const platform = createPlatformHandler({
    systemEntries: [], systemHandler: async () => ({ statusCode: 200 }),
    userHandler: Object.assign(async () => { throw new Error('boom'); }, { tryInvokeUserRoute: async () => null }),
    logger: { warn() {}, error() {} }
  });
  await assert.rejects(platform({ httpMethod: 'GET', path: '/x', headers: {} }), /boom/);
});

test('Event entry: client-supplied x-scf-* headers never reach the user function (any case)', async () => {
  const { normalizeInvocationRequest } = require('./service.js');
  const req = normalizeInvocationRequest({ httpMethod: 'GET', path: '/api/x', headers: {
    'X-Scf-Remote-Addr': '3.3.3.3', 'x-scf-secret-key': 'fake', 'X-SCF-Session-Token': 'fake', 'x-scf-request-id': 'r', 'X-Forwarded-For': '1.1.1.1, 203.0.113.9', 'user-agent': 'ua'
  } });
  assert.deepEqual(Object.keys(req.value.headers).filter((k) => k.startsWith('x-scf-')), []);
  assert.equal(req.value.headers['user-agent'], 'ua');
  assert.equal(req.clientKey, '203.0.113.9');

  let seen;
  const runtime = { async execute(input) { seen = input; return { status: 200, headers: {}, body: 'ok' }; } };
  const user = createFunctionHttpHandler({ repository: new InMemoryFunctionRepository(), bundleStore: new InMemoryBundleStore(), runtime, authenticate: () => ({ userId: 'owner' }), publicBaseUrl: 'https://functions.test' });
  const mk = (path, method, body) => ({ path, httpMethod: method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const fn = JSON.parse((await user(mk('/functions', 'POST', { websiteId: 'site-a', name: 'Echo', slug: 'echo' }))).body).function;
  await user(mk(`/functions/${fn.functionId}/versions`, 'POST', { source: 'module.exports = () => "ok"' }));
  await user(mk(`/functions/${fn.functionId}/publish`, 'POST', { version: 1 }));
  const platform = createPlatformHandler({ userHandler: user, systemEntries: [], systemHandler: async () => ({ statusCode: 599 }), logger: { warn() {}, error() {} } });
  const res = await platform({ httpMethod: 'GET', path: '/site-a/production/api/echo', headers: { 'X-Scf-Remote-Addr': '3.3.3.3', 'X-Scf-Secret-Key': 'fake', 'x-forwarded-for': '203.0.113.9' } });
  assert.equal(res.statusCode, 200);
  const text = JSON.stringify(seen);
  assert.ok(!/x-scf-/i.test(text), 'user function input must contain no x-scf-* header');
  assert.ok(!text.includes('3.3.3.3'));
});
