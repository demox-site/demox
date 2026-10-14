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
    const res = await fetch(`${base}/auth/login?x=1&y=two`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t', 'x-forwarded-for': '1.2.3.4, 10.0.0.1', 'x-scf-request-id': '16de1459-c47a-11f1-89b5-525400551d54' }, body: '{"email":"a@b.co"}' });
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
  assert.equal(seen.requestContext.sourceIp, '1.2.3.4', 'rightmost non-trusted XFF hop (10.0.0.1 is a trusted proxy)');
  assert.equal(seen.requestId, '16de1459-c47a-11f1-89b5-525400551d54');
  assert.equal(seen.headers['x-scf-request-id'], undefined);
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

test('client IP: untrusted x-scf-remote-addr wins over XFF (custom-domain forge = worst case own bucket)', () => {
  const ev = eventFromRequest({ method: 'POST', url: '/auth/login', headers: { 'x-forwarded-for': '6.6.6.6, 1.1.1.1', 'x-scf-remote-addr': '1.2.3.4' }, socket: { remoteAddress: '127.0.0.1' } }, Buffer.alloc(0));
  assert.equal(ev.requestContext.sourceIp, '1.2.3.4', 'valid untrusted remote-addr used; XFF ignored');
  assert.equal(ev.headers['x-forwarded-for'], '6.6.6.6, 1.1.1.1', 'XFF still visible to apps');
  assert.deepEqual(Object.keys(ev.headers).filter((k) => k.startsWith('x-scf-')), [], 'x-scf-* stripped from event headers after IP read');
});

test('client IP: valid x-scf-remote-addr alone is used (function URL path; no XFF)', () => {
  const ev = eventFromRequest({ method: 'GET', url: '/health', headers: { 'X-Scf-Remote-Addr': '203.0.113.50' }, socket: { remoteAddress: '10.9.8.7' } }, Buffer.alloc(0));
  assert.equal(ev.requestContext.sourceIp, '203.0.113.50');
});

test('client IP: trusted x-scf-remote-addr reads XFF (rightmost non-trusted)', () => {
  const ev = eventFromRequest({ method: 'GET', url: '/health', headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.50, 11.163.17.81, 10.132.167.112', 'x-scf-remote-addr': '10.132.167.112' }, socket: { remoteAddress: '10.0.0.1' } }, Buffer.alloc(0));
  assert.equal(ev.requestContext.sourceIp, '203.0.113.50');
});

test('client IP: forged leftmost X-Forwarded-For entries are ignored', () => {
  const { clientIpFrom } = require('./web-server.js');
  assert.equal(clientIpFrom({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 203.0.113.50' }, null), '203.0.113.50');
  const ev = eventFromRequest({ method: 'GET', url: '/', headers: { 'x-forwarded-for': '1.2.3.4,203.0.113.50' }, socket: {} }, Buffer.alloc(0));
  assert.equal(ev.requestContext.sourceIp, '203.0.113.50');
});

test('client IP: x-real-ip is never trusted (no option)', () => {
  const { clientIpFrom } = require('./web-server.js');
  const headers = { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9, 203.0.113.50' };
  assert.equal(clientIpFrom(headers, null), '203.0.113.50');
  assert.equal(clientIpFrom({ 'x-real-ip': '1.2.3.4' }, { remoteAddress: '10.0.0.3' }), '10.0.0.3');
  const ev = eventFromRequest({ method: 'GET', url: '/', headers, socket: {} }, Buffer.alloc(0));
  assert.equal(ev.requestContext.sourceIp, '203.0.113.50');
});

test('IP reads x-scf-remote-addr before strip; invalid remote-addr falls back; secrets still stripped', () => {
  const { clientIpFrom } = require('./web-server.js');
  // helper without third arg: if header still present it is used; after strip, callers pass remote explicitly
  assert.equal(clientIpFrom({ 'x-scf-remote-addr': 'not-an-ip' }, { remoteAddress: '10.0.0.2' }), '10.0.0.2');
  const ev = eventFromRequest({ method: 'GET', url: '/', headers: { 'X-SCF-Remote-Addr': '203.0.113.9', 'x-scf-request-id': 'not-a-uuid' }, socket: { remoteAddress: '10.0.0.2' } }, Buffer.alloc(0));
  assert.equal(ev.requestContext.sourceIp, '203.0.113.9');
  assert.notEqual(ev.requestId, 'not-a-uuid', 'non-UUID x-scf-request-id is not trusted');
  assert.deepEqual(Object.keys(ev.headers).filter((k) => k.startsWith('x-scf-')), []);
});

test('platform X-Scf-* headers (runtime-role temp credentials) never reach the handler', async () => {
  let seen;
  await withServer(async (event) => { seen = event; return { statusCode: 200, body: '{}' }; }, async (base) => {
    await fetch(`${base}/api/x`, { headers: { 'x-scf-secret-id': 'AKIDfake', 'x-scf-secret-key': 'fakekey', 'x-scf-session-token': 'faketoken', 'x-scf-remote-addr': '198.51.100.9', 'x-scf-request-id': '17aa3abd-c47a-11f1-a139-525400ba74cf', 'x-keep': 'yes' } });
  });
  assert.deepEqual(Object.keys(seen.headers).filter((k) => k.startsWith('x-scf-')), []);
  assert.ok(!JSON.stringify(seen).includes('fakekey') && !JSON.stringify(seen).includes('faketoken') && !JSON.stringify(seen).includes('AKIDfake'));
  assert.equal(seen.headers['x-keep'], 'yes');
  assert.equal(seen.requestContext.sourceIp, '198.51.100.9', 'valid remote-addr used for IP (may be forged on custom domain)');
  assert.equal(seen.requestId, '17aa3abd-c47a-11f1-a139-525400ba74cf');
});

test('client IP falls back to the socket address when no proxy headers exist', () => {
  const { clientIpFrom } = require('./web-server.js');
  assert.equal(clientIpFrom({}, { remoteAddress: '9.9.9.9' }), '9.9.9.9');
  assert.equal(clientIpFrom({ 'x-forwarded-for': ' 1.1.1.1 , 2.2.2.2 ' }, null), '2.2.2.2');
});

test('rate limiter keys on the derived IP: forged X-Scf-Remote-Addr / leftmost XFF cannot bypass it', async () => {
  const { InMemoryBundleStore } = require('./bundle-store.js');
  const { InMemoryFunctionRepository } = require('./repository.js');
  const { FunctionService } = require('./service.js');
  const runtime = { async execute() { return { status: 200, headers: {}, body: 'ok' }; } };
  const service = new FunctionService({ repository: new InMemoryFunctionRepository(), bundleStore: new InMemoryBundleStore(), runtime });
  const fn = await service.createFunction({ ownerId: 'owner', websiteId: 'site-a', name: 'Rate', slug: 'rate', limits: { maxInvocationsPerMinute: 1 } });
  await service.createVersion({ ownerId: 'owner', functionId: fn.functionId, source: 'module.exports = () => "ok"' });
  await service.publishVersion({ ownerId: 'owner', functionId: fn.functionId, version: 1 });
  // function-URL style: stable remote-addr; forged XFF must not open a new bucket
  const fromFnUrl = (forgedXff) => eventFromRequest({ method: 'GET', url: '/api/rate', headers: { 'x-forwarded-for': forgedXff, 'x-scf-remote-addr': '203.0.113.50' }, socket: { remoteAddress: '10.0.0.1' } }, Buffer.alloc(0));
  await service.invoke({ functionId: fn.functionId, event: fromFnUrl('1.1.1.1') });
  await assert.rejects(service.invoke({ functionId: fn.functionId, event: fromFnUrl('2.2.2.2') }), (error) => error.code === 'RATE_LIMITED', 'forged XFF must not reset the limit when remote-addr is stable');
  const other = eventFromRequest({ method: 'GET', url: '/api/rate', headers: { 'x-scf-remote-addr': '203.0.113.99' }, socket: {} }, Buffer.alloc(0));
  await service.invoke({ functionId: fn.functionId, event: other });
});

test('Event entry without sourceIp keys the rate limit on the rightmost non-trusted XFF hop (forged leftmost cannot bypass)', async () => {
  const { normalizeInvocationRequest, FunctionService } = require('./service.js');
  const { clientIpFromForwardedFor } = require('./client-ip.js');
  assert.equal(clientIpFromForwardedFor(' 1.1.1.1 , 203.0.113.50 '), '203.0.113.50');
  assert.equal(clientIpFromForwardedFor(''), '');
  assert.equal(normalizeInvocationRequest({ httpMethod: 'GET', headers: { 'x-forwarded-for': '1.1.1.1, 140.248.50.98, 11.163.17.81, 10.132.167.112' } }).clientKey, '140.248.50.98', 'no remote-addr: XFF walk');
  assert.equal(normalizeInvocationRequest({ httpMethod: 'GET', headers: { 'x-scf-remote-addr': '140.248.52.60' } }).clientKey, '140.248.52.60', 'function URL: remote-addr alone (no anonymous)');
  assert.equal(normalizeInvocationRequest({ httpMethod: 'GET', headers: { 'x-scf-remote-addr': '140.248.52.60', 'x-forwarded-for': '203.0.113.7' } }).clientKey, '140.248.52.60', 'untrusted remote ignores forged XFF');
  assert.equal(normalizeInvocationRequest({ httpMethod: 'GET', headers: { 'x-scf-remote-addr': '10.132.167.112', 'x-forwarded-for': '1.1.1.1, 140.248.50.98, 11.163.17.81, 10.132.167.112' } }).clientKey, '140.248.50.98', 'trusted remote reads XFF');
  assert.equal(normalizeInvocationRequest({ httpMethod: 'GET', headers: { 'X-Forwarded-For': '1.2.3.4, 203.0.113.50' } }).clientKey, '203.0.113.50');
  assert.equal(normalizeInvocationRequest({ httpMethod: 'GET', headers: {}, requestContext: { sourceIp: '198.51.100.1' } }).clientKey, '198.51.100.1', 'gateway sourceIp still wins');
  assert.equal(normalizeInvocationRequest({ httpMethod: 'GET', headers: {} }).clientKey, 'anonymous');
  const { InMemoryBundleStore } = require('./bundle-store.js');
  const { InMemoryFunctionRepository } = require('./repository.js');
  const runtime = { async execute() { return { status: 200, headers: {}, body: 'ok' }; } };
  const service = new FunctionService({ repository: new InMemoryFunctionRepository(), bundleStore: new InMemoryBundleStore(), runtime });
  const fn = await service.createFunction({ ownerId: 'owner', websiteId: 'site-a', name: 'RateEv', slug: 'rate-ev', limits: { maxInvocationsPerMinute: 1 } });
  await service.createVersion({ ownerId: 'owner', functionId: fn.functionId, source: 'module.exports = () => "ok"' });
  await service.publishVersion({ ownerId: 'owner', functionId: fn.functionId, version: 1 });
  const ev = (forged) => ({ httpMethod: 'GET', headers: { 'x-forwarded-for': `${forged}, 203.0.113.50` } });
  await service.invoke({ functionId: fn.functionId, event: ev('1.1.1.1') });
  await assert.rejects(service.invoke({ functionId: fn.functionId, event: ev('2.2.2.2') }), (error) => error.code === 'RATE_LIMITED');
});

// ---- 受信任代理网段（client-ip.js）。真实链来自 2026-10-10 api-web 实测（CLS DEBUG client-ip 行）。
const { clientIpFromForwardedFor, isTrustedProxy, normalizeIp, TRUSTED_PROXY_CIDRS } = require('./client-ip.js');

test('trusted list is exactly the 云架构 15:25 list (code constant)', () => {
  assert.deepEqual([...TRUSTED_PROXY_CIDRS], ['10.0.0.0/8', '11.0.0.0/8', '9.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10']);
  assert.ok(Object.isFrozen(TRUSTED_PROXY_CIDRS));
  for (const ip of ['10.132.167.112', '11.163.17.81', '9.1.2.3', '100.64.0.1', '100.127.255.255', '127.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1', 'fc00::1', 'fe80::1']) assert.equal(isTrustedProxy(ip), true, ip);
  for (const ip of ['140.248.50.98', '30.0.0.1', '100.128.0.1', '172.32.0.1', '8.8.8.8', '2001:db8::1', 'unknown', '']) assert.equal(isTrustedProxy(ip), false, ip);
});

test('real function-URL chain → real client (140.248.50.98)', () => {
  assert.equal(clientIpFromForwardedFor('1.1.1.1, 140.248.50.98, 11.163.17.81, 10.132.167.112'), '140.248.50.98');
  // trusted remote-addr → XFF walk; x-real-ip ignored; forged public remote would win instead (worst case)
  const ev = eventFromRequest({ method: 'GET', url: '/health', headers: { 'x-forwarded-for': '1.1.1.1, 140.248.50.98, 11.163.17.81, 10.132.167.112', 'x-real-ip': '11.163.17.81', 'x-scf-remote-addr': '10.132.167.112' }, socket: { remoteAddress: '10.0.0.9' } }, Buffer.alloc(0));
  assert.equal(ev.requestContext.sourceIp, '140.248.50.98');
  const forged = eventFromRequest({ method: 'GET', url: '/health', headers: { 'x-forwarded-for': '1.1.1.1, 140.248.50.98, 11.163.17.81, 10.132.167.112', 'x-scf-remote-addr': '3.3.3.3' }, socket: { remoteAddress: '10.0.0.9' } }, Buffer.alloc(0));
  assert.equal(forged.requestContext.sourceIp, '3.3.3.3', 'untrusted remote-addr may be forged on custom domain; XFF not consulted');
});

test('real api.demox.site domain chains → real client', () => {
  assert.equal(clientIpFromForwardedFor('1.1.1.1, 140.248.50.34, 11.163.15.153, 10.132.167.77'), '140.248.50.34', 'forged');
  assert.equal(clientIpFromForwardedFor('1.1.1.1, 140.248.50.126, 11.163.6.156, 10.132.167.39'), '140.248.50.126', 'forged');
  assert.equal(clientIpFromForwardedFor('140.248.50.15, 11.163.15.87, 10.132.167.71'), '140.248.50.15', 'no forged headers');
});

test('forged entries left of the real client are ignored, including forged private addresses', () => {
  assert.equal(clientIpFromForwardedFor('10.0.0.1, 192.168.0.1, 140.248.50.98, 11.163.17.81, 10.132.167.112'), '140.248.50.98');
  assert.equal(clientIpFromForwardedFor('8.8.8.8, 127.0.0.1, 140.248.50.98, 11.163.17.81, 10.132.167.112'), '140.248.50.98');
});

test('IPv4-mapped IPv6 is normalized before comparing', () => {
  assert.equal(normalizeIp('::ffff:10.1.2.3'), '10.1.2.3');
  assert.equal(isTrustedProxy('::ffff:11.163.17.81'), true);
  assert.equal(clientIpFromForwardedFor('::ffff:140.248.50.98, ::ffff:11.163.17.81, ::ffff:10.132.167.112'), '140.248.50.98');
});

test('IPv6 chains: trusted v6 proxies skipped, public v6 client returned', () => {
  assert.equal(clientIpFromForwardedFor('2001:db8::1, fd12::5, ::1'), '2001:db8::1');
  assert.equal(clientIpFromForwardedFor('2001:db8::1, fe80::1'), '2001:db8::1');
});

test('all-trusted chain falls back to the RIGHTMOST address (never leftmost, never socket)', () => {
  assert.equal(clientIpFromForwardedFor('10.1.1.1, 11.163.17.81, 10.132.167.112'), '10.132.167.112');
  assert.equal(clientIpFromForwardedFor('192.168.1.5, ::ffff:10.0.0.7'), '10.0.0.7');
  const ev = eventFromRequest({ method: 'GET', url: '/', headers: { 'x-forwarded-for': '10.1.1.1, 10.132.167.112' }, socket: { remoteAddress: '127.0.0.1' } }, Buffer.alloc(0));
  assert.equal(ev.requestContext.sourceIp, '10.132.167.112');
});

test('debug client-ip log code is gone', () => {
  const ws = require('./web-server.js');
  assert.equal(ws.debugClientIpEnabled, undefined);
  assert.ok(!require('fs').readFileSync(require('path').join(__dirname, 'web-server.js'), 'utf8').includes('DEMOX_DEBUG_CLIENT_IP'));
});
