// v13：管理员操作审计（admin_audit_log，迁移 021）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

Object.assign(process.env, {
  MYSQL_HOST: '127.0.0.1',
  MYSQL_USER: 'test',
  MYSQL_PASSWORD: 'test',
  MYSQL_DATABASE: 'test',
  JWT_SECRET: 'website-api-test-secret-at-least-32-chars',
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret_test'
});

const ADMIN = 'u_admin';
const USER = 'u_plain';
let calls = [];
let extra = async () => undefined;
let failAuditInsert = false;
let auditRows = [];

async function fakeQuery(sql, params = []) {
  calls.push({ sql, params });
  const custom = await extra(sql, params);
  if (custom !== undefined) return custom;
  if (/INSERT INTO admin_audit_log/.test(sql)) {
    if (failAuditInsert) throw Object.assign(new Error('db down'), { code: 'ECONNREFUSED' });
    return { insertId: 1, affectedRows: 1 };
  }
  if (/CREATE TABLE IF NOT EXISTS admin_audit_log/.test(sql)) return {};
  if (/FROM admin_audit_log/.test(sql)) return auditRows;
  if (/FROM access_tokens WHERE jti/.test(sql)) return [{ revoked_at: null, expires_at: null }];
  if (/FROM user_roles WHERE user_id/.test(sql)) {
    return params[0] === ADMIN ? [{ roles: ['admin'], pro_expires_at: null }] : [{ roles: ['user'], pro_expires_at: null }];
  }
  if (/FROM roles WHERE enabled = 1/.test(sql)) return [{ id: 'user', priority: 1 }, { id: 'pro', priority: 2 }, { id: 'admin', priority: 3 }];
  if (/SELECT id FROM users WHERE id = \?/.test(sql)) return [{ id: params[0] }];
  if (/^\s*(ALTER|CREATE|UPDATE|INSERT|DELETE)/i.test(sql)) return { affectedRows: 1 };
  return [];
}

const dbModulePath = require.resolve('./shared/db.js');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: {
    query: (...args) => fakeQuery(...args),
    transaction: async (cb) => cb({ query: async (...args) => [await fakeQuery(...args), []] })
  }
};

const websiteApi = require('./index.js');
const { sign } = require('./shared/jwt.js');
const audit = websiteApi._adminAuditForTest;

function call(action, body = {}, { userId = ADMIN, claims = {} } = {}) {
  const token = sign({ userId, email: `${userId}@demox.example`, ...claims });
  return websiteApi.main({
    path: `/website/${action.replaceAll('_', '-')}`,
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: { action, ...body }
  });
}

function auditInserts() {
  return calls.filter((c) => /INSERT INTO admin_audit_log/.test(c.sql)).map((c) => {
    const [operatorUid, authMethod, action, kind, target, via, statusCode, success] = c.params;
    return { operatorUid, authMethod, action, kind, target, via, statusCode, success };
  });
}

function reset() {
  calls = [];
  extra = async () => undefined;
  failAuditInsert = false;
  auditRows = [];
}

test('an admin write records operator, action, target, auth method and outcome', async () => {
  reset();
  const res = await call('set_user_role', { uid: 'u_target', role: ['user', 'pro'], proDays: 30 });
  assert.equal(JSON.parse(res.body).success, true);
  assert.deepEqual(auditInserts(), [{
    operatorUid: ADMIN,
    authMethod: 'jwt',
    action: 'set_user_role',
    kind: 'write',
    target: 'uid=u_target;role=user,pro;proDays=30',
    via: 'admin_only',
    statusCode: 200,
    success: 1
  }]);
});

test('auth method is pat for personal access tokens and oauth for CLI/MCP tokens', async () => {
  reset();
  await call('list_role_limits', {}, { claims: { jti: 'pat-1', type: 'pat' } });
  await call('list_role_limits', {}, { claims: { scopes: ['website:deploy'] } });
  await call('list_role_limits', {});
  assert.deepEqual(auditInserts().map((r) => [r.authMethod, r.kind]), [['pat', 'read'], ['oauth', 'read'], ['jwt', 'read']]);
});

test('every requireAdmin action is audited (read and write) except aggregate dashboard reads', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const adminHandlers = [...source.matchAll(/async function (handle\w+)\(event\) \{\n  const a = await requireAdmin\(event\);/g)].map((m) => m[1]);
  assert.ok(adminHandlers.length >= 18, `found ${adminHandlers.length}`);
  const map = source.slice(source.indexOf('const actionMap = {'), source.indexOf('};', source.indexOf('const actionMap = {')));
  const actions = adminHandlers.map((h) => {
    const m = map.match(new RegExp(`(\\w+): ${h}\\b`));
    assert.ok(m, `${h} is not reachable from actionMap`);
    return m[1];
  });
  for (const action of actions) {
    reset();
    await call(action, { id: 1, uid: 'u_target', role: ['user'] }).catch(() => {});
    const rows = auditInserts();
    if (audit.adminAuditSkipped(action)) {
      assert.equal(rows.length, 0, `${action} is an aggregate dashboard read and must not be audited`);
      continue;
    }
    assert.equal(rows.length, 1, `${action} should write exactly one audit row`);
    assert.equal(rows[0].action, action);
    assert.equal(rows[0].operatorUid, ADMIN);
  }
});

test('non-admins and normal user actions write no audit rows', async () => {
  reset();
  const denied = await call('set_user_role', { uid: ADMIN, role: ['user'] }, { userId: USER });
  assert.equal(denied.statusCode, 403);
  await call('list', {}, { userId: USER });
  await call('get_usage', {}, { userId: USER });
  assert.deepEqual(auditInserts(), []);
});

test('an admin acting on someone else\'s site is recorded as an override', async () => {
  reset();
  extra = async (sql) => {
    if (/SELECT \* FROM websites WHERE website_id = \?/.test(sql)) return [{ id: 7, website_id: 'SITE0007', user_id: 'u_owner', visibility: 'public', name: 'x' }];
    return undefined;
  };
  await call('get_site_stats', { websiteId: 'SITE0007', days: 7 });
  const rows = auditInserts();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].via, 'override');
  assert.equal(rows[0].action, 'get_site_stats');
  assert.equal(rows[0].kind, 'read');
  assert.match(rows[0].target, /websiteId=SITE0007/);
});

test('the owner changing their own site is not an admin action even if they are admin', async () => {
  reset();
  extra = async (sql) => {
    if (/SELECT \* FROM websites WHERE website_id = \?/.test(sql)) return [{ id: 8, website_id: 'SITE0008', user_id: ADMIN, visibility: 'public', name: 'mine' }];
    return undefined;
  };
  await call('get_site_stats', { websiteId: 'SITE0008', days: 7 });
  assert.deepEqual(auditInserts(), []);
});

test('failed admin actions are recorded with success=0', async () => {
  reset();
  await call('set_user_role', { uid: 'u_target', role: ['nonexistent'] });
  const rows = auditInserts();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].success, 0);
});

test('an audit write failure never breaks the admin response', async () => {
  reset();
  failAuditInsert = true;
  const res = await call('list_role_limits', {});
  assert.equal(res.statusCode, 200);
});

test('targets never carry emails, tokens or secrets', () => {
  const target = audit.adminAuditTarget({ body: {
    action: 'register_bucket', name: 'ops@demox.example', secretKey: 'S3CR3T', secretId: 'AKID', token: 'eyJ.x.y', id: 3
  } });
  assert.equal(target, 'id=3;name=[email]');
  assert.equal(audit.adminAuditTarget({ body: { userIds: ['a', 'b', 'c'] } }), 'userIds=3');
});

test('list_admin_audit is read-only, parameterized and paginates', async () => {
  reset();
  const createdAt = new Date('2026-10-09T06:00:00.000Z');
  auditRows = [
    { id: 12, operator_uid: ADMIN, auth_method: 'oauth', action: 'set_user_role', kind: 'write', target: 'uid=42', via: 'admin_only', status_code: 200, success: 1, created_at: createdAt },
    { id: 11, operator_uid: ADMIN, auth_method: 'jwt', action: 'get_admin_bi', kind: 'read', target: 'range=7', via: 'admin_only', status_code: 200, success: 1, created_at: createdAt }
  ];
  const res = await call('list_admin_audit', { limit: 2, beforeId: 13, operatorUid: ADMIN, authMethod: 'oauth', auditAction: "x' OR 1=1" });
  const body = JSON.parse(res.body);
  assert.equal(body.success, true);
  assert.equal(body.items.length, 2);
  assert.deepEqual(body.items[0], {
    id: 12, operatorUid: ADMIN, authMethod: 'oauth', action: 'set_user_role', kind: 'write', target: 'uid=42',
    via: 'admin_only', statusCode: 200, success: true, createdAt: '2026-10-09T06:00:00.000Z'
  });
  assert.equal(body.nextBeforeId, 11);
  const select = calls.find((c) => /FROM admin_audit_log/.test(c.sql));
  assert.match(select.sql, /^\s*SELECT/);
  assert.doesNotMatch(select.sql, /OR 1=1/);
  assert.deepEqual(select.params, [13, ADMIN, "x' OR 1=1", 'oauth', 2]);
  const writes = calls.filter((c) => /\b(UPDATE|DELETE|ALTER)\b/i.test(c.sql) && /admin_audit_log/.test(c.sql));
  assert.deepEqual(writes, []);
  // v14：查看审计本身属于看板读，不再记一行（避免“看日志”刷出日志）
  assert.deepEqual(auditInserts(), []);
});

test('list_admin_audit rejects non-admins and degrades to empty when the table is missing', async () => {
  reset();
  const denied = await call('list_admin_audit', {}, { userId: USER });
  assert.equal(denied.statusCode, 403);
  reset();
  extra = async (sql) => {
    if (/SELECT id, operator_uid/.test(sql)) throw Object.assign(new Error("Table 'admin_audit_log' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' });
    return undefined;
  };
  const res = JSON.parse((await call('list_admin_audit', {})).body);
  assert.deepEqual(res, { success: true, items: [], nextBeforeId: null, tableMissing: true });
  const limit = calls.find((c) => /SELECT id, operator_uid/.test(c.sql)).params.at(-1);
  assert.equal(limit, 50);
});

test('migration 021 and the inline DDL define the same columns', () => {
  const migration = fs.readFileSync(path.join(__dirname, 'migrations/021_add_admin_audit_log.sql'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const inline = source.slice(source.indexOf('CREATE TABLE IF NOT EXISTS admin_audit_log'), source.indexOf("COMMENT='管理员操作审计'`"));
  const cols = (text) => [...text.matchAll(/^\s+(\w+) (BIGINT|VARCHAR\(\d+\)|SMALLINT|TINYINT\(1\)|TIMESTAMP\(3\))/gm)].map((m) => `${m[1]} ${m[2]}`);
  assert.ok(cols(migration).length >= 10);
  assert.deepEqual(cols(inline), cols(migration));
  const numbers = fs.readdirSync(path.join(__dirname, 'migrations')).map((f) => Number(f.slice(0, 3)));
  assert.equal(Math.max(...numbers), 21);
});

// ── v14：保留期 + 看板读不记 ──────────────────────────────────────────────

test('aggregate dashboard reads are not audited; per-user reads and writes still are', async () => {
  reset();
  await call('get_admin_bi', { range: 7 });
  await call('list_admin_audit', {});
  await call('get_platform_overview', {});
  assert.deepEqual(auditInserts(), []);
  await call('get_user_overview', { uid: 'u_target' });
  await call('list_role_limits', {});
  assert.deepEqual(auditInserts().map((r) => r.action), ['get_user_overview', 'list_role_limits']);
  for (const a of ['get_admin_bi', 'get_platform_overview', 'get_product_funnel', 'list_admin_audit']) assert.equal(audit.adminAuditSkipped(a), true);
  for (const a of ['get_user_overview', 'resolve_user_emails', 'set_user_role', 'list_user_roles']) assert.equal(audit.adminAuditSkipped(a), false);
});

test('retention defaults to 180 days and is configurable within 7..3650', () => {
  assert.equal(audit.adminAuditRetentionDays({}), 180);
  assert.equal(audit.adminAuditRetentionDays({ ADMIN_AUDIT_RETENTION_DAYS: '90' }), 90);
  assert.equal(audit.adminAuditRetentionDays({ ADMIN_AUDIT_RETENTION_DAYS: '1' }), 7);
  assert.equal(audit.adminAuditRetentionDays({ ADMIN_AUDIT_RETENTION_DAYS: '99999' }), 3650);
  assert.equal(audit.adminAuditRetentionDays({ ADMIN_AUDIT_RETENTION_DAYS: 'abc' }), 180);
});

test('prune only DELETEs old rows from admin_audit_log, in batches, at most hourly', async () => {
  reset();
  let batches = [5000, 5000, 12];
  extra = async (sql) => (/^DELETE FROM admin_audit_log/.test(sql) ? { affectedRows: batches.shift() } : undefined);
  const r = await audit.pruneAdminAuditLog({ force: true });
  assert.deepEqual(r, { skipped: false, deleted: 10012, days: 180 });
  const sqls = calls.map((c) => c.sql);
  assert.equal(sqls.length, 3);
  for (const c of calls) {
    assert.match(c.sql, /^DELETE FROM admin_audit_log WHERE created_at < \(CURRENT_TIMESTAMP\(3\) - INTERVAL \? DAY\) ORDER BY created_at LIMIT \?$/);
    assert.deepEqual(c.params, [180, 5000]);
  }
  calls = [];
  const again = await audit.pruneAdminAuditLog({ now: Date.now() + 1000 });
  assert.equal(again.skipped, true);
  assert.equal(calls.length, 0);
});

test('prune failure is swallowed and a missing table is fine', async () => {
  reset();
  extra = async (sql) => { if (/^DELETE/.test(sql)) throw Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' }); };
  assert.equal((await audit.pruneAdminAuditLog({ force: true })).tableMissing, true);
  extra = async (sql) => { if (/^DELETE/.test(sql)) throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); };
  assert.equal((await audit.pruneAdminAuditLog({ force: true })).error, true);
});

test('the analytics rollup timer runs the prune; HTTP calls do not', async () => {
  reset();
  await websiteApi.main({ Type: 'Timer', TriggerName: 'analytics-rollup-5m', Time: new Date().toISOString() });
  // prune may be throttled from an earlier test in this process; force a fresh window by checking the source wiring too
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.match(source, /if \(isAnalyticsRollupTimerEvent\(event\)\) \{[\s\S]{0,200}await pruneAdminAuditLog\(\);[\s\S]{0,80}handleRollupSiteAnalytics/);
  reset();
  await call('get_usage', {}, { userId: USER });
  assert.ok(!calls.some((c) => /^DELETE FROM admin_audit_log/.test(c.sql)));
});
