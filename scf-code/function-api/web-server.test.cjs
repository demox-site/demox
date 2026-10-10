'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebServer, eventFromRequest } = require('./web-server.js');

async function withServer(handler, fn) {
  const logs = [];
  const server = createWebServer({ handler, logger: { error: (...a) => logs.push(a.join(' ')) } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base, logs); } finally { server.close(); }
}

test('HTTP request becomes an API-gateway style event and the result is written back', async () => {
  let seen;
  await withServer(async (event) => {
    seen = event;
    return { statusCode: 201, headers: { 'content-type': 'application/json', 'x-a': '1' }, body: JSON.stringify({ ok: true, path: event.path }) };
  }, async (base) => {
    const res = await fetch(`${base}/auth/login?x=1&y=two`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t', 'x-forwarded-for': '1.2.3.4, 10.0.0.1', 'x-scf-request-id': 'rid-1' }, body: '{"email":"a@b.co"}' });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('x-a'), '1');
    assert.deepEqual(await res.json(), { ok: true, path: '/auth/login' });
  });
  assert.equal(seen.httpMethod, 'POST');
  assert.equal(seen.path, '/auth/login');
  assert.deepEqual(seen.queryStringParameters, { x: '1', y: 'two' });
  assert.equal(seen.headers.authorization, 'Bearer t');
  assert.equal(seen.body, '{"email":"a@b.co"}');
  assert.equal(seen.isBase64Encoded, false);
  assert.equal(seen.requestContext.sourceIp, '1.2.3.4');
  assert.equal(seen.requestId, 'rid-1');
});

test('binary bodies round-trip via base64 both ways', async () => {
  const bytes = Buffer.from([0, 1, 2, 250, 255]);
  await withServer(async (event) => {
    assert.equal(event.isBase64Encoded, true);
    assert.deepEqual(Buffer.from(event.body, 'base64'), bytes);
    return { statusCode: 200, headers: { 'content-type': 'application/zip' }, body: bytes.toString('base64'), isBase64Encoded: true };
  }, async (base) => {
    const res = await fetch(`${base}/upload`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes });
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
  });
});

test('multi-value headers (e.g. several Set-Cookie) are preserved', async () => {
  await withServer(async () => ({ statusCode: 200, headers: {}, multiValueHeaders: { 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] }, body: '' }), async (base) => {
    const res = await fetch(`${base}/`);
    assert.deepEqual(res.headers.getSetCookie(), ['a=1; Path=/', 'b=2; Path=/']);
  });
});

test('handler errors return a generic 500 and log no request content', async () => {
  await withServer(async () => { throw Object.assign(new Error('token eyJ.secret leaked a@b.co'), { code: 'BOOM' }); }, async (base, logs) => {
    const res = await fetch(`${base}/x`, { method: 'POST', body: 'secret-body a@b.co' });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, 'INTERNAL_ERROR');
    assert.ok(!logs.join('\n').includes('a@b.co'));
    assert.ok(!logs.join('\n').includes('eyJ'));
  });
});

test('OPTIONS preflight passes through to the platform handler', async () => {
  await withServer(async (event) => ({ statusCode: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type, Authorization' }, body: '', _m: event.httpMethod }), async (base) => {
    const res = await fetch(`${base}/auth/login`, { method: 'OPTIONS' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});

test('eventFromRequest handles empty bodies', () => {
  const ev = eventFromRequest({ method: 'GET', url: '/health', headers: {}, socket: { remoteAddress: '9.9.9.9' } }, Buffer.alloc(0));
  assert.equal(ev.body, '');
  assert.equal(ev.isBase64Encoded, false);
  assert.equal(ev.requestContext.sourceIp, '9.9.9.9');
});
