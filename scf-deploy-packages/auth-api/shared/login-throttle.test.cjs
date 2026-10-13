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

test('fail-open emits warning and inserts sibling-table row (op + code + ms; no email/hash/SQL)', async () => {
  const lines = [];
  const inserts = [];
  const log = { warn: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push('ERROR ' + a.join(' ')) };
  const email = 'victim@example.com';
  const err = Object.assign(new Error(`boom ${email} ${lib.emailKey(email)} SELECT * FROM login_throttle`), { code: 'ER_NO_SUCH_TABLE' });
  const t0 = 1_700_000_000_000;
  const query = async (sql, params = []) => {
    if (/CREATE TABLE IF NOT EXISTS/i.test(sql)) return;
    if (/INSERT INTO login_throttle_fail_open/i.test(sql)) {
      inserts.push({ sql, params: [...params] });
      return { affectedRows: 1 };
    }
    throw err;
  };
  const th = lib.createLoginThrottle({ query, now: () => t0, log });
  assert.equal((await th.reserve(email)).allowed, true);
  await th.clear(email);
  const weird = lib.createLoginThrottle({
    query: async (sql, params = []) => {
      if (/CREATE TABLE IF NOT EXISTS/i.test(sql)) return;
      if (/INSERT INTO login_throttle_fail_open/i.test(sql)) {
        inserts.push({ sql, params: [...params] });
        return { affectedRows: 1 };
      }
      throw Object.assign(new Error('x'), { code: `bad ${email}` });
    },
    now: () => t0 + 1,
    log
  });
  await weird.reserve(email);
  assert.deepEqual(lines, [
    '[login-throttle] FAIL_OPEN op=reserve code=ER_NO_SUCH_TABLE',
    '[login-throttle] FAIL_OPEN op=clear code=ER_NO_SUCH_TABLE',
    '[login-throttle] FAIL_OPEN op=reserve code=UNKNOWN'
  ]);
  for (const l of lines) {
    assert.ok(!l.includes('victim') && !l.includes(lib.emailKey(email)) && !/select/i.test(l));
  }
  assert.equal(inserts.length, 3);
  assert.deepEqual(inserts[0].params, ['reserve', 'ER_NO_SUCH_TABLE', t0]);
  assert.deepEqual(inserts[1].params, ['clear', 'ER_NO_SUCH_TABLE', t0]);
  assert.deepEqual(inserts[2].params, ['reserve', 'UNKNOWN', t0 + 1]);
  for (const row of inserts) {
    const blob = JSON.stringify(row);
    assert.ok(!blob.includes('victim') && !blob.includes(lib.emailKey(email)));
  }
});

test('migration SQL creates both login_throttle and login_throttle_fail_open', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/004_login_throttle.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS login_throttle\b/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS login_throttle_fail_open\b/);
  assert.match(sql, /\bop VARCHAR\(16\)/);
  assert.match(sql, /\bcode VARCHAR\(64\)/);
  assert.match(sql, /\bcreated_at_ms BIGINT/);
  assert.equal(lib.CREATE_FAIL_OPEN_TABLE_SQL.includes('login_throttle_fail_open'), true);
});

test('reserve runs cleanup DELETE with 1% probability (ms window, not NOW()-INTERVAL)', async () => {
  const calls = [];
  const th = lib.createLoginThrottle({
    query: async (sql, params = []) => {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params: [...params] });
      if (/CREATE TABLE/i.test(sql)) return;
      if (/INSERT IGNORE/i.test(sql)) return { affectedRows: 1 };
      if (/^UPDATE login_throttle/i.test(sql)) return { affectedRows: 1 };
      if (/^SELECT/i.test(sql)) return [{ failures: 1, locked_until: 0 }];
      if (/^DELETE FROM login_throttle/i.test(sql)) return { affectedRows: 0 };
      return;
    },
    now: () => 1_800_000_000_000,
    random: () => 0, // force cleanup
    log: { warn() {}, error() {} }
  });
  await th.reserve('a@b.co');
  const del = calls.find((c) => /^DELETE FROM login_throttle WHERE/i.test(c.sql));
  assert.ok(del, 'cleanup DELETE should run when random() < 0.01');
  assert.match(del.sql, /GREATEST\(last_failed_at, locked_until\) < \?/);
  assert.ok(!/NOW\(\)/i.test(del.sql), 'must not use NOW()-INTERVAL against BIGINT ms columns');
  assert.deepEqual(del.params, [1_800_000_000_000 - lib.WINDOW_MS]);

  const calls2 = [];
  const thSkip = lib.createLoginThrottle({
    query: async (sql, params = []) => {
      calls2.push(sql);
      if (/CREATE TABLE/i.test(sql)) return;
      if (/INSERT IGNORE/i.test(sql)) return { affectedRows: 1 };
      if (/^UPDATE/i.test(sql)) return { affectedRows: 1 };
      if (/^SELECT/i.test(sql)) return [{ failures: 1, locked_until: 0 }];
      return;
    },
    now: () => 1_800_000_000_000,
    random: () => 0.5, // skip cleanup
    log: { warn() {}, error() {} }
  });
  await thSkip.reserve('a@b.co');
  assert.equal(calls2.some((s) => /^DELETE FROM login_throttle/i.test(String(s))), false);
});

// 真实 SQL：设置 LOGIN_THROTTLE_TEST_MYSQL=mysql://user:pass@host:port/db 才跑（CI 默认跳过）。
const url = process.env.LOGIN_THROTTLE_TEST_MYSQL;
test('real SQL: progressive wait, refusal during wait, window reset, clear, and no extra attempts under concurrency', { skip: !url && 'LOGIN_THROTTLE_TEST_MYSQL not set' }, async () => {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({ uri: url, connectionLimit: 20 });
  const query = async (sql, params = []) => (await pool.execute(sql, params))[0];
  try {
    await query('DROP TABLE IF EXISTS login_throttle_fail_open');
    await query('DROP TABLE IF EXISTS login_throttle');
    let t = 1_760_000_000_000;
    const th = lib.createLoginThrottle({ query, now: () => t, log: { error() {}, warn() {} }, random: () => 1 });
    const email = 'someone@example.com';
    const fail = async () => th.reserve(email);
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
      t = lockedUntil;
      r = await fail();
      assert.equal(r.allowed, true); assert.equal(r.lockedUntil - t, want); lockedUntil = r.lockedUntil;
    }
    t = lockedUntil + lib.WINDOW_MS;
    r = await fail();
    assert.equal(r.allowed, true); assert.equal(r.failures, 1); assert.equal(r.lockedUntil, lockedUntil, 'old lock kept but already past');
    await fail(); await fail();
    await th.clear(email);
    r = await fail();
    assert.equal(r.failures, 1);
    await th.clear(email);
    const results = await Promise.all(Array.from({ length: 20 }, () => th.reserve(email)));
    assert.equal(results.filter((x) => x.allowed).length, 5);
    assert.ok(results.filter((x) => !x.allowed).every((x) => x.retryAfterMs === 60e3));
    assert.equal((await th.reserve('other@example.com')).allowed, true);
    const rows = await query('SELECT email_hash FROM login_throttle');
    assert.ok(rows.every((row) => /^[0-9a-f]{64}$/.test(row.email_hash)));
    // fail-open sibling table exists and accepts a row
    await query('INSERT INTO login_throttle_fail_open (op, code, created_at_ms) VALUES (?, ?, ?)', ['reserve', 'ER_TEST', t]);
    const fo = await query('SELECT op, code FROM login_throttle_fail_open');
    assert.equal(fo.length, 1);
  } finally {
    await query('DROP TABLE IF EXISTS login_throttle_fail_open').catch(() => {});
    await query('DROP TABLE IF EXISTS login_throttle').catch(() => {});
    await pool.end();
  }
});
