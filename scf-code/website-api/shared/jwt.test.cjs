'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jsonwebtoken = require('jsonwebtoken');

const MODULE_PATH = require.resolve('./jwt.js');
const STRONG = 'unit-test-secret-0123456789abcdef-0123456789';

function load(secret) {
  delete require.cache[MODULE_PATH];
  if (secret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = secret;
  return require(MODULE_PATH);
}

test.afterEach(() => { process.env.JWT_SECRET = STRONG; });

test('源码里没有任何 JWT_SECRET 默认值回退', () => {
  const source = fs.readFileSync(path.join(__dirname, 'jwt.js'), 'utf8');
  assert.doesNotMatch(source, /JWT_SECRET\s*\|\|/);
  assert.doesNotMatch(source, /JWT_SECRET\s*\?\?/);
});

test('缺少 JWT_SECRET 时签发和校验都直接报错', () => {
  const jwt = load(undefined);
  assert.throws(() => jwt.sign({ userId: 'u1' }), /JWT_SECRET/);
  assert.throws(() => jwt.verify('a.b.c'), /JWT_SECRET/);
});

test('JWT_SECRET 为空白时报错', () => {
  const jwt = load('   ');
  assert.throws(() => jwt.sign({ userId: 'u1' }), /JWT_SECRET/);
});

test('JWT_SECRET 少于 32 位时报错', () => {
  const jwt = load('x'.repeat(31));
  assert.throws(() => jwt.sign({ userId: 'u1' }), /32/);
  assert.throws(() => jwt.verify('a.b.c'), /32/);
});

test('配置正确时可以签发并校验', () => {
  const jwt = load(STRONG);
  const token = jwt.sign({ userId: 'u1' }, '5m');
  assert.equal(jwt.verify(token).userId, 'u1');
});

test('用其他密钥签的 token 会被拒绝', () => {
  const jwt = load(STRONG);
  const forged = jsonwebtoken.sign({ userId: 'admin' }, 'some-other-secret-that-is-long-enough-123', { expiresIn: '5m' });
  assert.throws(() => jwt.verify(forged), /Token无效/);
});

test('alg=none 的 token 会被拒绝', () => {
  const jwt = load(STRONG);
  const none = jsonwebtoken.sign({ userId: 'admin' }, null, { algorithm: 'none' });
  assert.throws(() => jwt.verify(none));
});
