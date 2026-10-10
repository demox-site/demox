// 管理员按指纹作废 OAuth 刷新令牌（revoke_oauth_refresh_token）。
// 指纹算法必须和泄露排查脚本 oauth-leak-id.py 一致：sha256(令牌原文) 的 hex 前 12 位。
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { randomTestSecret } = require('../../scripts/test-jwt.cjs');
Object.assign(process.env, {
  MYSQL_HOST: '127.0.0.1',
  MYSQL_USER: 'test',
  MYSQL_PASSWORD: 'test',
  MYSQL_DATABASE: 'test',
  JWT_SECRET: randomTestSecret(),
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret_test'
});

const ADMIN = 'u_admin';
const USER = 'u_plain';
const VICTIM = 'u_victim';
const OTHER = 'u_other';

const fpOf = (token) => crypto.createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 12);
const newToken = () => crypto.randomBytes(32).toString('hex'); // 64 位，和 auth-api 的长度一样

// 内存里的 oauth_refresh_tokens / admin_audit_log
let refreshRows = [];
let auditLog = [];
let calls = [];
let failAuditInsert = false;
let failCount = false;
let txRolledBack = 0;

function fakeQuery(sql, params = [], tx = null) {
  calls.push({ sql, params });
  if (/CREATE TABLE IF NOT EXISTS admin_audit_log/.test(sql)) return {};
  if (/SELECT COUNT\(\*\) AS n FROM admin_audit_log/.test(sql)) {
    if (failCount) throw Object.assign(new Error('db down'), { code: 'ECONNREFUSED' });
    const [uid, action] = params;
    return [{ n: auditLog.filter((r) => r.operatorUid === uid && r.action === action).length }];
  }
  if (/INSERT INTO admin_audit_log/.test(sql)) {
    if (failAuditInsert) throw Object.assign(new Error('db down'), { code: 'ECONNREFUSED' });
    const [operatorUid, authMethod, action, kind, target, via, statusCode, success] = params;
    const row = { operatorUid, authMethod, action, kind, target, via, statusCode, success };
    (tx ? tx.audit : auditLog).push(row);
    return { insertId: auditLog.length, affectedRows: 1 };
  }
  if (/DELETE FROM oauth_refresh_tokens/.test(sql)) {
    // 模拟 MySQL：LEFT(SHA2(token, 256), 12)
    const [uid, fp] = params;
    const keep = [];
    const gone = [];
    for (const r of (tx ? tx.rows : refreshRows)) {
      (r.user_id === uid && fpOf(r.token) === fp ? gone : keep).push(r);
    }
    if (tx) tx.rows = keep; else refreshRows = keep;
    return { affectedRows: gone.length };
  }
  if (/FROM access_tokens WHERE jti/.test(sql)) return [{ revoked_at: null, expires_at: null }];
  if (/FROM user_roles WHERE user_id/.test(sql)) {
    return params[0] === ADMIN ? [{ roles: ['admin'], pro_expires_at: null }] : [{ roles: ['user'], pro_expires_at: null }];
  }
  if (/FROM roles WHERE enabled = 1/.test(sql)) return [{ id: 'user', priority: 1 }, { id: 'pro', priority: 2 }, { id: 'admin', priority: 3 }];
  return [];
}

const dbModulePath = require.resolve('./shared/db.js');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: {
    query: async (sql, params) => fakeQuery(sql, params),
    // 事务：在副本上改，回调成功才提交，抛错就丢弃（= 回滚）
    transaction: async (cb) => {
      const tx = { rows: refreshRows.slice(), audit: [] };
      try {
        const out = await cb({ query: async (sql, params) => [fakeQuery(sql, params, tx), []] });
        refreshRows = tx.rows;
        auditLog.push(...tx.audit);
        return out;
      } catch (e) {
        txRolledBack += 1;
        throw e;
      }
    }
  }
};

const websiteApi = require('./index.js');
const { sign } = require('./shared/jwt.js');

function call(body, { userId = ADMIN, claims = {}, viaPath = false } = {}) {
  const token = sign({ userId, email: `${userId}@demox.example`, ...claims });
  return websiteApi.main({
    path: '/website/revoke-oauth-refresh-token',
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: viaPath ? { ...body } : { action: 'revoke_oauth_refresh_token', ...body }
  });
}

function reset() {
  refreshRows = [];
  auditLog = [];
  calls = [];
  failAuditInsert = false;
  failCount = false;
  txRolledBack = 0;
}

function seed() {
  const leaked = newToken();
  const victimOther = newToken();
  const sameFpOtherUser = leaked; // 同一个原文不可能属于两个用户，这里只用来证明 user_id 也必须匹配
  refreshRows = [
    { token: leaked, user_id: VICTIM },
    { token: victimOther, user_id: VICTIM },
    { token: newToken(), user_id: OTHER }
  ];
  return { leaked, victimOther, sameFpOtherUser };
}

test('fingerprint matches oauth-leak-id.py: sha256 hex, first 12 chars', () => {
  // python: hashlib.sha256(b'abc').hexdigest()[:12]
  assert.equal(fpOf('abc'), 'ba7816bf8f01');
});

test('non-admin gets 403, nothing is deleted, no audit row', async () => {
  reset();
  const { leaked } = seed();
  const res = await call({ userId: VICTIM, fingerprint: fpOf(leaked) }, { userId: USER });
  assert.equal(res.statusCode, 403);
  assert.equal(refreshRows.length, 3);
  assert.deepEqual(auditLog, []);
  assert.ok(!calls.some((c) => /DELETE FROM oauth_refresh_tokens/.test(c.sql)));
});

test('missing login gets 401', async () => {
  reset();
  const res = await websiteApi.main({ path: '/website/revoke-oauth-refresh-token', httpMethod: 'POST', headers: {}, body: { action: 'revoke_oauth_refresh_token', userId: VICTIM, fingerprint: 'aaaaaaaaaaaa' } });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(auditLog, []);
});

test('bad fingerprint format is 400 and deletes nothing', async () => {
  for (const fingerprint of ['', 'xyz', '47b1d21fe56', '47b1d21fe5677', 'zzzzzzzzzzzz', 12345, null, ['47b1d21fe567'], "47b1d21fe56' OR 1=1"]) {
    reset();
    seed();
    const res = await call({ userId: VICTIM, fingerprint });
    assert.equal(res.statusCode, 400, `fingerprint=${JSON.stringify(fingerprint)}`);
    assert.equal(refreshRows.length, 3);
    assert.ok(!calls.some((c) => /DELETE FROM oauth_refresh_tokens/.test(c.sql)));
    assert.equal(auditLog.length, 1);
    assert.deepEqual([auditLog[0].statusCode, auditLog[0].success, auditLog[0].target], [400, 0, 'invalid_input']);
  }
});

test('bad userId is 400', async () => {
  for (const userId of ['', 'a b', 'x'.repeat(65), 7, "u' OR '1'='1"]) {
    reset();
    seed();
    const res = await call({ userId, fingerprint: 'aaaaaaaaaaaa' });
    assert.equal(res.statusCode, 400, `userId=${JSON.stringify(userId)}`);
    assert.equal(refreshRows.length, 3);
  }
});

test('raw token is rejected in any field, and never echoed back', async () => {
  const raw = newToken();
  const bodies = [
    { userId: VICTIM, fingerprint: raw },
    { userId: VICTIM, fingerprint: fpOf(raw), refresh_token: raw },
    { userId: VICTIM, fingerprint: fpOf(raw), refreshToken: raw },
    { userId: VICTIM, fingerprint: fpOf(raw), token: raw },
    { userId: VICTIM, fingerprint: fpOf(raw), access_token: raw },
    { userId: VICTIM, fingerprint: fpOf(raw), extra: raw }
  ];
  for (const body of bodies) {
    reset();
    refreshRows = [{ token: raw, user_id: VICTIM }];
    const res = await call(body);
    assert.equal(res.statusCode, 400, JSON.stringify(Object.keys(body)));
    assert.equal(refreshRows.length, 1, 'nothing deleted');
    assert.ok(!res.body.includes(raw));
    assert.ok(!res.body.includes(raw.slice(0, 16)));
    assert.ok(!JSON.stringify(auditLog).includes(raw.slice(0, 16)), 'raw token never reaches the audit table');
  }
});

test('matching fp revokes only that user\'s token and writes one audit row with who/target/fp/rows', async () => {
  reset();
  const { leaked, victimOther } = seed();
  const fp = fpOf(leaked);
  const res = await call({ userId: VICTIM, fingerprint: fp.toUpperCase() });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { success: true, revoked: 1 });
  assert.deepEqual(refreshRows.map((r) => r.token).sort(), [victimOther, refreshRows.find((r) => r.user_id === OTHER).token].sort());
  // 指纹在库里算，SQL 参数里只有 userId 和指纹，没有令牌原文
  const del = calls.find((c) => /DELETE FROM oauth_refresh_tokens/.test(c.sql));
  assert.match(del.sql, /WHERE user_id = \? AND LEFT\(SHA2\(token, 256\), 12\) = \?/);
  assert.deepEqual(del.params, [VICTIM, fp]);
  assert.deepEqual(auditLog, [{
    operatorUid: ADMIN,
    authMethod: 'jwt',
    action: 'revoke_oauth_refresh_token',
    kind: 'write',
    target: `userId=${VICTIM};fp=${fp};revoked=1`,
    via: 'admin_only',
    statusCode: 200,
    success: 1
  }]);
});

test('the same fp under a different userId revokes nothing (one user per call)', async () => {
  reset();
  const { leaked } = seed();
  const res = await call({ userId: OTHER, fingerprint: fpOf(leaked) });
  assert.deepEqual(JSON.parse(res.body), { success: true, revoked: 0 });
  assert.equal(refreshRows.length, 3);
  assert.equal(auditLog.length, 1);
  assert.match(auditLog[0].target, /revoked=0$/);
});

test('works through the path fallback too and records auth method for CLI tokens', async () => {
  reset();
  const { leaked } = seed();
  const res = await call({ userId: VICTIM, fingerprint: fpOf(leaked) }, { viaPath: true, claims: { scopes: ['website:deploy'] } });
  assert.deepEqual(JSON.parse(res.body), { success: true, revoked: 1 });
  assert.equal(auditLog.length, 1, 'exactly one audit row (generic audit is skipped for this action)');
  assert.equal(auditLog[0].authMethod, 'oauth');
});

test('if the audit row cannot be written, the delete is rolled back', async () => {
  reset();
  const { leaked } = seed();
  failAuditInsert = true;
  const res = await call({ userId: VICTIM, fingerprint: fpOf(leaked) });
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.parse(res.body).success, false);
  assert.equal(refreshRows.length, 3, 'nothing deleted');
  assert.equal(txRolledBack, 1);
});

test('more than the max rows matched rolls the whole delete back (409)', async () => {
  reset();
  // 构造多行同指纹：直接改 fpOf 不现实，这里放 6 行相同原文（真实表是主键，不会发生）
  const t = newToken();
  refreshRows = Array.from({ length: websiteApi._revokeRtForTest.REVOKE_RT_MAX_ROWS + 1 }, () => ({ token: t, user_id: VICTIM }));
  const before = refreshRows.length;
  const res = await call({ userId: VICTIM, fingerprint: fpOf(t) });
  assert.equal(res.statusCode, 409);
  assert.equal(refreshRows.length, before);
  assert.equal(auditLog.length, 1);
  assert.deepEqual([auditLog[0].statusCode, auditLog[0].success], [409, 0]);
});

test('rate limit: per admin, N calls per minute, then 429 without touching the table', async () => {
  reset();
  const limit = websiteApi._revokeRtForTest.REVOKE_RT_RATE_LIMIT;
  const tokens = Array.from({ length: limit + 2 }, newToken);
  refreshRows = tokens.map((token) => ({ token, user_id: VICTIM }));
  for (let i = 0; i < limit; i += 1) {
    const res = await call({ userId: VICTIM, fingerprint: fpOf(tokens[i]) });
    assert.equal(res.statusCode, 200, `call ${i + 1}`);
  }
  const blocked = await call({ userId: VICTIM, fingerprint: fpOf(tokens[limit]) });
  assert.equal(blocked.statusCode, 429);
  assert.equal(JSON.parse(blocked.body).success, false);
  assert.equal(refreshRows.length, 2, 'the blocked call deleted nothing');
  assert.deepEqual(auditLog.at(-1).statusCode, 429);
  // 窗口是按 created_at 的 60 秒
  const countSql = calls.find((c) => /SELECT COUNT\(\*\) AS n FROM admin_audit_log/.test(c.sql));
  assert.match(countSql.sql, /operator_uid = \? AND action = \? AND created_at > \(CURRENT_TIMESTAMP\(3\) - INTERVAL \? SECOND\)/);
  assert.deepEqual(countSql.params, [ADMIN, 'revoke_oauth_refresh_token', 60]);
});

test('rate limit check failing fails closed (503, nothing deleted)', async () => {
  reset();
  const { leaked } = seed();
  failCount = true;
  const res = await call({ userId: VICTIM, fingerprint: fpOf(leaked) });
  assert.equal(res.statusCode, 503);
  assert.equal(refreshRows.length, 3);
});

test('responses never contain token content', async () => {
  reset();
  const { leaked, victimOther } = seed();
  const outputs = [];
  outputs.push(await call({ userId: VICTIM, fingerprint: fpOf(leaked) }));
  outputs.push(await call({ userId: VICTIM, fingerprint: leaked }));
  outputs.push(await call({ userId: VICTIM, fingerprint: 'zz' }));
  for (const res of outputs) {
    const parsed = JSON.parse(res.body);
    const allowed = res.statusCode === 200 ? ['revoked', 'success'] : ['error', 'success'];
    assert.deepEqual(Object.keys(parsed).sort(), allowed);
    for (const t of [leaked, victimOther]) {
      assert.ok(!res.body.includes(t));
      assert.ok(!res.body.includes(t.slice(0, 12)));
    }
  }
});
