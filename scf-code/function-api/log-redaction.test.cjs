'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const logGuard = require('../../scripts/log-leak-guard.cjs').installLogLeakGuard();
const { redactLogText, redactLogValue, installLogRedaction } = require('./log-redact.js');
const { createResponseSeal, sealPayload, openSealedPayload } = require('./response-seal.js');
const { createScfNodeInvoker, createHttpNodeInvoker, NodeWorkerPool } = require('./runtime-nodejs.js');
const { main: runtimeMain } = require('./runtime-nodejs-handler.js');
const { findLeaks } = require('../../scripts/log-leak-guard.cjs');

const { signTestJwt } = require('../../scripts/test-jwt.cjs');

// 运行时用随机密钥签出来的 JWT，源码里没有 token 字面量。
const JWT = signTestJwt({ userId: 'user-1', email: 'a@b.co' });
const REFRESH = 'Ab3'.repeat(21) + 'x';
const EMAIL = 'someone.real+tag@example.com';

test('redactLogText masks JWT, PAT, OAuth code, refresh token, bearer header and email', () => {
  const cases = [
    `user ${EMAIL} logged in`,
    `Authorization: Bearer ${JWT}`,
    `{"access_token":"${JWT}","refresh_token":"${REFRESH}","token_type":"Bearer"}`,
    `https://localhost:39897/callback?code=${REFRESH}&state=s`,
    `pat ghp_${'a1B2'.repeat(9)}`,
    '验证码已生成: x -> 482913',
    `"code":"482913"`
  ];
  for (const raw of cases) {
    const safe = redactLogText(raw);
    assert.deepEqual(findLeaks(safe), [], `still leaks: ${safe}`);
    assert.notEqual(safe, raw);
  }
});

test('redactLogText keeps ordinary diagnostics readable', () => {
  assert.equal(redactLogText('函数接口请求失败: FUNCTION_EXECUTION_ERROR'), '函数接口请求失败: FUNCTION_EXECUTION_ERROR');
  assert.equal(redactLogText('{"code":0,"msg":"ok"}'), '{"code":0,"msg":"ok"}');
  assert.equal(redactLogText('website EPX2UU43 v12 took 152ms'), 'website EPX2UU43 v12 took 152ms');
});

test('redactLogValue masks sensitive keys and nested strings without mutating input', () => {
  const input = { email: EMAIL, body: { token: 'abcd1234', note: `mail ${EMAIL}` }, ok: true, code: 'E_FAIL', list: [JWT] };
  const out = redactLogValue(input);
  assert.equal(out.email, '[redacted]');
  assert.equal(out.body.token, '[redacted]');
  assert.equal(out.body.note, 'mail [email]');
  assert.equal(out.code, 'E_FAIL');
  assert.deepEqual(out.list, ['[jwt]']);
  assert.equal(input.email, EMAIL);
  const circular = { a: 1 }; circular.self = circular;
  assert.equal(redactLogValue(circular).self, '[circular]');
  const err = Object.assign(new Error(`bad token ${JWT} for ${EMAIL}`), { code: 'X' });
  assert.deepEqual(findLeaks(redactLogValue(err)), []);
});

test('installLogRedaction wraps every console method once', () => {
  const seen = [];
  const fake = {};
  for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace']) fake[m] = (...args) => seen.push([m, ...args]);
  installLogRedaction(fake);
  installLogRedaction(fake);
  fake.log('login', EMAIL);
  fake.error({ refresh_token: REFRESH });
  fake.warn(`Bearer ${JWT}`);
  assert.deepEqual(seen[0], ['log', 'login', '[email]']);
  assert.deepEqual(seen[1], ['error', { refresh_token: '[redacted]' }]);
  assert.deepEqual(seen[2], ['warn', 'Bearer [jwt]']);
});

test('sealed runtime responses round-trip and reject a wrong key or tampering', () => {
  const seal = createResponseSeal();
  const payload = { ok: true, result: { status: 200, body: JSON.stringify({ access_token: JWT, email: EMAIL }) } };
  const sealed = sealPayload(payload, seal.descriptor);
  const wire = JSON.stringify(sealed);
  // 密文本身是 base64，会命中「长随机串」规则；这里检查的是明文一个都不在。
  assert.deepEqual(findLeaks(wire).filter((kind) => kind !== 'opaque-token'), []);
  for (const secret of [JWT, EMAIL, 'access_token']) assert.equal(wire.includes(secret), false);
  assert.deepEqual(openSealedPayload(sealed, seal), payload);
  assert.throws(() => openSealedPayload(sealed, createResponseSeal()), /无法解密/);
  const tampered = JSON.parse(wire);
  tampered.sealed.data = Buffer.from('{"ok":true}').toString('base64');
  assert.throws(() => openSealedPayload(tampered, seal), /无法解密/);
  assert.deepEqual(sealPayload(payload, undefined), payload, 'no key => plaintext (old router)');
  assert.deepEqual(openSealedPayload(payload, seal), payload, 'plaintext accepted (old runtime)');
});

const ECHO_SECRET_SOURCE = `module.exports = async function handler(request) {
  console.error('debug token', request.headers && request.headers.authorization, 'for', '${EMAIL}');
  return { status: 200, headers: {}, body: JSON.stringify({ access_token: '${JWT}', email: '${EMAIL}' }) };
};`;

test('runtime handler seals its return value (what SCF writes to RetMsg) when the router sends a key', async () => {
  const seal = createResponseSeal();
  const ret = await runtimeMain({
    type: 'demox.runtime.execute',
    runtime: 'nodejs',
    source: ECHO_SECRET_SOURCE,
    request: { method: 'GET', path: '/x', headers: { authorization: `Bearer ${JWT}` } },
    env: {},
    limits: { timeoutMs: 5000 },
    responseSeal: seal.descriptor
  });
  const retMsg = JSON.stringify(ret);
  assert.ok(ret.sealed, 'return value must be sealed');
  assert.deepEqual(findLeaks(retMsg).filter((kind) => kind !== 'opaque-token'), [], 'RetMsg must not contain tokens or emails');
  for (const secret of [JWT, EMAIL, 'access_token']) assert.equal(retMsg.includes(secret), false);
  const opened = openSealedPayload(ret, seal);
  assert.equal(opened.ok, true);
  assert.equal(JSON.parse(opened.result.body).access_token, JWT);
});

test('SCF and HTTP invokers send a one-time key and open the sealed reply', async () => {
  const fakeRuntime = async ({ payload }) => sealPayload({ ok: true, result: { status: 200, body: EMAIL } }, payload.responseSeal);
  const keys = [];
  const scf = createScfNodeInvoker({ functionName: 'demox-user-nodejs', namespace: 'demox', invoke: async (req) => { keys.push(req.payload.responseSeal.key); return fakeRuntime(req); } });
  assert.equal((await scf({ source: 'x', request: {}, limits: { timeoutMs: 1000 } })).body, EMAIL);
  assert.equal((await scf({ source: 'x', request: {}, limits: { timeoutMs: 1000 } })).body, EMAIL);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1], 'a fresh key per invocation');
  const http = createHttpNodeInvoker({ url: 'http://runtime.internal', secret: 's', post: fakeRuntime });
  assert.equal((await http({ source: 'x', request: {}, limits: { timeoutMs: 1000 } })).body, EMAIL);
});

test('stderr from any user function is redacted before the router logs it', async () => {
  const lines = [];
  const pool = new NodeWorkerPool({ logger: { warn: (...args) => lines.push(args.join(' ')) } });
  await pool.execute({ source: ECHO_SECRET_SOURCE, request: { method: 'GET', path: '/', headers: { authorization: `Bearer ${JWT}` } }, env: {}, limits: { timeoutMs: 5000 } });
  await new Promise((resolve) => setTimeout(resolve, 200));
  for (const slot of pool.slots.values()) slot.child.kill();
  assert.ok(lines.some((line) => line.includes('debug token')), 'stderr line was relayed');
  for (const line of lines) assert.deepEqual(findLeaks(line), [], line);
});

test('no token, JWT, OAuth code or email reached any console log in this suite', () => {
  logGuard.assertNoLeaks();
});
