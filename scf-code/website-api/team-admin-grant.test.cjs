// 023：团队管理员账号授权（ensureTeamAdminGrant）。没配置时不做任何事；幂等；只授一次；有审计。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { randomTestSecret } = require('../../scripts/test-jwt.cjs');
Object.assign(process.env, {
  MYSQL_HOST: '127.0.0.1',
  MYSQL_USER: 'test',
  MYSQL_PASSWORD: 'test',
  MYSQL_DATABASE: 'test',
  JWT_SECRET: randomTestSecret()
});
delete process.env.TEAM_ADMIN_USER_ID;

const TEAM = 'u_team_ops';
let users = new Set();
let userRoles = new Map();
let auditLog = [];
let calls = [];
let failAudit = false;

function fakeQuery(sql, params = [], tx = null) {
  calls.push({ sql, params });
  if (/CREATE TABLE IF NOT EXISTS admin_audit_log/.test(sql)) return {};
  if (/SELECT id FROM admin_audit_log WHERE action = \? AND target = \? AND success = 1/.test(sql)) {
    return auditLog.filter((r) => r.action === params[0] && r.target === params[1] && r.success === 1).map((_, i) => ({ id: i + 1 }));
  }
  if (/SELECT id FROM users WHERE id = \?/.test(sql)) return users.has(params[0]) ? [{ id: params[0] }] : [];
  if (/SELECT roles FROM user_roles WHERE user_id = \?/.test(sql)) {
    const m = tx ? tx.roles : userRoles;
    return m.has(params[0]) ? [{ roles: m.get(params[0]) }] : [];
  }
  if (/INSERT INTO user_roles/.test(sql)) { (tx ? tx.roles : userRoles).set(params[0], JSON.parse(params[1])); return { affectedRows: 1 }; }
  if (/INSERT INTO admin_audit_log/.test(sql)) {
    if (failAudit) throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
    const [operatorUid, authMethod, action, kind, target, via, statusCode, success] = params;
    (tx ? tx.audit : auditLog).push({ operatorUid, authMethod, action, kind, target, via, statusCode, success });
    return { affectedRows: 1 };
  }
  return [];
}

const dbModulePath = require.resolve('./shared/db.js');
require.cache[dbModulePath] = {
  id: dbModulePath, filename: dbModulePath, loaded: true,
  exports: {
    query: async (sql, params) => fakeQuery(sql, params),
    transaction: async (cb) => {
      const tx = { roles: new Map(userRoles), audit: [] };
      const out = await cb({ query: async (sql, params) => [fakeQuery(sql, params, tx), []] });
      userRoles = tx.roles;
      auditLog.push(...tx.audit);
      return out;
    }
  }
};

const websiteApi = require('./index.js');
const { ensureTeamAdminGrant, configuredTeamAdminUserId, TEAM_ADMIN_USER_ID } = websiteApi._teamAdminForTest;
const run = (env) => ensureTeamAdminGrant({ force: true, env });

function reset() {
  users = new Set([TEAM]);
  userRoles = new Map([[TEAM, ['user']]]);
  auditLog = [];
  calls = [];
  failAudit = false;
}

test('placeholder ships empty, so the default is a no-op', async () => {
  assert.equal(TEAM_ADMIN_USER_ID, '');
  reset();
  assert.deepEqual(await run({}), { skipped: true, reason: 'unset' });
  assert.deepEqual(calls, [], 'not even a read when unset');
  assert.deepEqual(userRoles.get(TEAM), ['user']);
});

test('invalid id is ignored without touching the DB', async () => {
  reset();
  assert.equal((await run({ TEAM_ADMIN_USER_ID: "x' OR 1=1" })).reason, 'invalid');
  assert.deepEqual(calls, []);
  assert.deepEqual(configuredTeamAdminUserId({ TEAM_ADMIN_USER_ID: '  u_1 ' }), { userId: 'u_1' });
});

test('grants admin once, keeps existing roles, and writes an audit row in the same transaction', async () => {
  reset();
  userRoles.set(TEAM, ['user', 'pro']);
  const r = await run({ TEAM_ADMIN_USER_ID: TEAM });
  assert.equal(r.granted, true);
  assert.deepEqual(userRoles.get(TEAM), ['user', 'pro', 'admin']);
  assert.deepEqual(auditLog, [{
    operatorUid: 'system:023', authMethod: 'system', action: 'grant_team_admin', kind: 'write',
    target: `uid=${TEAM};role=admin`, via: 'migration', statusCode: 200, success: 1
  }]);
});

test('idempotent: running again writes nothing', async () => {
  reset();
  await run({ TEAM_ADMIN_USER_ID: TEAM });
  calls = [];
  const again = await run({ TEAM_ADMIN_USER_ID: TEAM });
  assert.equal(again.skipped, true);
  assert.equal(auditLog.length, 1);
  assert.ok(!calls.some((c) => /INSERT/.test(c.sql)));
});

test('already admin (granted by hand): no write, no audit', async () => {
  reset();
  userRoles.set(TEAM, ['user', 'admin']);
  assert.equal((await run({ TEAM_ADMIN_USER_ID: TEAM })).reason, 'already_admin');
  assert.deepEqual(auditLog, []);
});

test('grants only once: if admin is later removed by hand, it is not re-added', async () => {
  reset();
  await run({ TEAM_ADMIN_USER_ID: TEAM });
  userRoles.set(TEAM, ['user']);
  assert.equal((await run({ TEAM_ADMIN_USER_ID: TEAM })).reason, 'already_granted_once');
  assert.deepEqual(userRoles.get(TEAM), ['user']);
});

test('user that does not exist yet: no write', async () => {
  reset();
  assert.equal((await run({ TEAM_ADMIN_USER_ID: 'u_not_registered' })).reason, 'user_not_found');
  assert.ok(!userRoles.has('u_not_registered'));
  assert.deepEqual(auditLog, []);
});

test('audit failure rolls back the role change', async () => {
  reset();
  failAudit = true;
  assert.equal((await run({ TEAM_ADMIN_USER_ID: TEAM })).reason, 'error');
  assert.deepEqual(userRoles.get(TEAM), ['user']);
});

test('throttled to once per hour per instance when not forced', async () => {
  reset();
  const t = Date.now() + 10 * 3600 * 1000;
  await ensureTeamAdminGrant({ now: t, env: { TEAM_ADMIN_USER_ID: 'u_not_registered' } });
  assert.equal((await ensureTeamAdminGrant({ now: t + 1000, env: { TEAM_ADMIN_USER_ID: TEAM } })).reason, 'throttled');
});

test('the rollup timer calls the grant; the SQL migration is a no-op placeholder', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.match(source, /if \(isAnalyticsRollupTimerEvent\(event\)\) \{\n\s+await ensureTeamAdminGrant\(\);/);
  const sql = fs.readFileSync(path.join(__dirname, 'migrations/023_grant_team_admin.sql'), 'utf8');
  assert.match(sql, /^SET @team_admin_user_id = '';$/m);
  assert.match(sql, /@team_admin_user_id <> ''/);
  for (const stmt of sql.split(';').filter((x) => /^\s*(INSERT|UPDATE)/m.test(x.replace(/^--.*$/gm, '')))) {
    assert.match(stmt, /WHERE @team_admin_ok/, 'every write is gated');
  }
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\bDELETE\b|\bDROP\b/);
});
