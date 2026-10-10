const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('./login-throttle.cjs');

test('delay doubles from 1 minute at the 5th failure and caps at 15 minutes', () => {
  assert.deepEqual([1, 4, 5, 6, 7, 8, 9, 12].map(lib.delayForFailures), [0, 0, 60e3, 120e3, 240e3, 480e3, 900e3, 900e3]);
});

test('message states how long to wait, rounded up to whole minutes', () => {
  assert.equal(lib.throttledMessage(60e3), '登录尝试次数过多，请 1 分钟后再试。');
  assert.equal(lib.throttledMessage(10e3), '登录尝试次数过多，请 1 分钟后再试。');
  assert.equal(lib.throttledMessage(61e3), '登录尝试次数过多，请 2 分钟后再试。');
  assert.equal(lib.throttledMessage(900e3), '登录尝试次数过多，请 15 分钟后再试。');
});

test('key is sha256 of the normalized email (no plaintext stored)', () => {
  assert.match(lib.emailKey('a@b.co'), /^[0-9a-f]{64}$/);
  assert.notEqual(lib.emailKey('a@b.co'), lib.emailKey('a@b.com'));
});

// 真实 SQL：设置 LOGIN_THROTTLE_TEST_MYSQL=mysql://user:pass@host:port/db 才跑（CI 默认跳过）。
const url = process.env.LOGIN_THROTTLE_TEST_MYSQL;
test('real SQL: progressive wait, refusal during wait, window reset, clear, and no extra attempts under concurrency', { skip: !url && 'LOGIN_THROTTLE_TEST_MYSQL not set' }, async () => {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({ uri: url, connectionLimit: 20 });
  const query = async (sql, params = []) => (await pool.execute(sql, params))[0];
  try {
    await query('DROP TABLE IF EXISTS login_throttle');
    let t = 1_760_000_000_000;
    const th = lib.createLoginThrottle({ query, now: () => t, log: { error() {} } });
    const email = 'someone@example.com';
    const fail = async () => th.reserve(email); // 占名额 = 记一次失败（登录成功才 clear）
    for (let i = 1; i <= 4; i += 1) {
      const r = await fail();
      assert.equal(r.allowed, true); assert.equal(r.failures, i); assert.equal(r.lockedUntil, 0);
    }
    let r = await fail();
    assert.equal(r.allowed, true); assert.equal(r.failures, 5); assert.equal(r.lockedUntil - t, 60e3);
    t += 30e3;
    r = await fail();
    assert.deepEqual(r, { allowed: false, retryAfterMs: 30e3 }, 'refused during wait (even if the password were right)');
    const steps = [120e3, 240e3, 480e3, 900e3, 900e3];
    let lockedUntil = t + 30e3;
    for (const want of steps) {
      t = lockedUntil; // 等待刚结束
      r = await fail();
      assert.equal(r.allowed, true); assert.equal(r.lockedUntil - t, want); lockedUntil = r.lockedUntil;
    }
    // 窗口：等待结束后又安静 15 分钟 → 清零，从 1 重新数
    t = lockedUntil + lib.WINDOW_MS;
    r = await fail();
    assert.equal(r.allowed, true); assert.equal(r.failures, 1); assert.equal(r.lockedUntil, lockedUntil, 'old lock kept but already past');
    // 登录成功清零
    await fail(); await fail();
    await th.clear(email);
    r = await fail();
    assert.equal(r.failures, 1);
    // 并发：同一账号 20 个请求同时到，只放 5 个进去（第 5 个占名额时就上了锁）
    await th.clear(email);
    const results = await Promise.all(Array.from({ length: 20 }, () => th.reserve(email)));
    assert.equal(results.filter((x) => x.allowed).length, 5);
    assert.ok(results.filter((x) => !x.allowed).every((x) => x.retryAfterMs === 60e3));
    // 不同账号互不影响
    assert.equal((await th.reserve('other@example.com')).allowed, true);
    const rows = await query('SELECT email_hash FROM login_throttle');
    assert.ok(rows.every((row) => /^[0-9a-f]{64}$/.test(row.email_hash)));
  } finally {
    await query('DROP TABLE IF EXISTS login_throttle').catch(() => {});
    await pool.end();
  }
});
