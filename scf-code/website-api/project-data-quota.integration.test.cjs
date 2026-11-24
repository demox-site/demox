// Isolated local MySQL only. Never consumes the application's MYSQL_* credentials.
// DEMOX_QUOTA_TEST_MYSQL_PORT=13387 node --test .../project-data-quota.integration.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { createProjectData } = require('./project-data');
const { createProjectDataQuota, policy } = require('./project-data-quota');

test('quota policy is 50 MiB / 500 MiB, and missing enforcement fails closed', async () => {
  assert.equal(policy.userBytes, 50 * 1024 * 1024);
  assert.equal(policy.proBytes, 500 * 1024 * 1024);
  await assert.rejects(createProjectData(async () => []).putRow(1, 'notes', {}), { code: 'quota_unavailable' });
});

test('real MySQL: account quotas across Node and Python writers', {
  skip: !process.env.DEMOX_QUOTA_TEST_MYSQL_PORT,
  timeout: 90000
}, async (t) => {
  const mysql = require('mysql2/promise');
  const port = Number(process.env.DEMOX_QUOTA_TEST_MYSQL_PORT);
  const pool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', password: '', database: 'demox_quota_test', connectionLimit: 8 });
  const query = async (sql, params = []) => (await pool.query(sql, params))[0];
  const withConnection = async (cb) => {
    const conn = await pool.getConnection();
    try { return await cb(conn); } finally { conn.release(); }
  };
  // Smaller injectable caps exercise the same real SQL boundary without large fixtures.
  const limits = { userBytes: 120, proBytes: 1200 };
  const data = createProjectData(query, createProjectDataQuota(withConnection, limits));
  const columns = [{ name: 'id', type: 'text', primary: true }, { name: 'v', type: 'text' }];
  const seed = async () => {
    for (const name of ['project_rows', 'project_tables', 'user_roles', 'roles', 'projects', 'users']) await query(`DROP TABLE IF EXISTS ${name}`);
    await query('CREATE TABLE users (id VARCHAR(64) PRIMARY KEY) ENGINE=InnoDB');
    await query('CREATE TABLE projects (id BIGINT PRIMARY KEY, user_id VARCHAR(64), archived BOOLEAN DEFAULT 0, KEY(user_id)) ENGINE=InnoDB');
    await query('CREATE TABLE roles (id VARCHAR(64) PRIMARY KEY, enabled BOOLEAN) ENGINE=InnoDB');
    await query('CREATE TABLE user_roles (user_id VARCHAR(64) PRIMARY KEY, roles JSON, pro_expires_at DATETIME NULL) ENGINE=InnoDB');
    await query('CREATE TABLE project_tables (id BIGINT AUTO_INCREMENT PRIMARY KEY, project_id BIGINT, name VARCHAR(64), columns_json JSON, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB');
    await query('CREATE TABLE project_rows (project_id BIGINT, table_id BIGINT, pk VARCHAR(255), doc JSON, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(project_id,table_id,pk)) ENGINE=InnoDB CHARSET=utf8mb4');
    await query("INSERT INTO users VALUES ('owner'),('other')");
    await query("INSERT INTO projects(id,user_id,archived) VALUES (1,'owner',0),(2,'owner',1),(3,'other',0)");
    await query("INSERT INTO roles VALUES ('user',1),('pro',1),('admin',1)");
    await query("INSERT INTO user_roles VALUES ('owner', '[\"user\"]', NULL)");
    for (const projectId of [1, 2, 3]) await data.createTable(projectId, { name: 'notes', columns });
  };
  const usage = async () => Number((await query(policy.usageSql, ['owner']))[0].used_bytes);
  const python = (projectId, rows, customLimits = limits) => new Promise((resolve, reject) => {
    const child = spawn('python3', ['-c', `
import sys, json, os
sys.path.insert(0, sys.argv[1])
import store, quota
request = json.load(sys.stdin)
quota.POLICY.update(request['limits'])
try:
    store.put_rows(request['projectId'], 'notes', request['rows'])
    print(json.dumps({'ok': True}))
except quota.QuotaExceeded:
    print(json.dumps({'ok': False, 'code': 'quota'}))
`, path.resolve(__dirname, '../../scripts/mysql-protocol-gateway')], {
      env: { ...process.env, MYSQL_HOST: '127.0.0.1', MYSQL_PORT: String(port), MYSQL_USER: 'root', MYSQL_PASSWORD: '', MYSQL_DATABASE: 'demox_quota_test' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let out = '', err = '';
    child.stdout.on('data', (s) => { out += s; });
    child.stderr.on('data', (s) => { err += s; });
    child.on('error', reject);
    child.on('exit', (code) => code ? reject(new Error(err)) : resolve(JSON.parse(out)));
    child.stdin.end(JSON.stringify({ projectId, rows, limits: customLimits }));
  });
  try {
    await t.test('exact boundary, UTF-8 accounting, archived projects and independent owners', async () => {
      await seed();
      const doc = { id: 'a', v: '汉字🙂' };
      const bytes = Number((await query(policy.sizeSql, [JSON.stringify(doc)]))[0].row_bytes);
      const exact = createProjectData(query, createProjectDataQuota(withConnection, { userBytes: bytes, proBytes: bytes }));
      await exact.putRow(2, 'notes', doc);
      assert.equal(await usage(), bytes);
      await assert.rejects(exact.putRow(1, 'notes', { id: 'b', v: '' }), { code: 'quota' });
      await exact.putRow(3, 'notes', doc);
      await exact.putRow(2, 'notes', doc); // idempotent replacement at cap
      await exact.deleteRow(2, 'notes', 'a');
      await exact.putRow(1, 'notes', doc);
    });
    await t.test('member 10x allowance, expired/disabled membership, no-role fallback', async () => {
      await seed();
      const row = { id: 'a', v: 'x'.repeat(200) };
      await assert.rejects(data.putRow(1, 'notes', row), { code: 'quota' });
      await query("UPDATE user_roles SET roles='[\"pro\"]', pro_expires_at=UTC_TIMESTAMP()+INTERVAL 1 DAY");
      await data.putRow(1, 'notes', row);
      await query('UPDATE user_roles SET pro_expires_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND');
      await assert.rejects(data.putRow(2, 'notes', { id: 'b', v: '' }), { code: 'quota' });
      await data.putRow(1, 'notes', { id: 'a', v: 'x'.repeat(199) }); // shrinking while over cap
      assert.deepEqual(await python(1, [{ id: 'a', v: 'x'.repeat(198) }]), { ok: true });
      await query('UPDATE user_roles SET pro_expires_at=NULL');
      assert.deepEqual(await python(2, [{ id: 'b', v: 'x'.repeat(200) }]), { ok: true });
      await query("UPDATE roles SET enabled=0 WHERE id='pro'");
      assert.deepEqual(await python(2, [{ id: 'c', v: '' }]), { ok: false, code: 'quota' });
      await query('DELETE FROM user_roles');
      await assert.rejects(data.putRow(1, 'notes', { id: 'd', v: '' }), { code: 'quota' });
    });
    await t.test('Python batch failure rolls back every row; retry does not double count', async () => {
      await seed();
      const rows = [{ id: 'a', v: 'x'.repeat(50) }, { id: 'b', v: 'x'.repeat(50) }];
      assert.deepEqual(await python(1, rows), { ok: false, code: 'quota' });
      assert.equal(await usage(), 0);
      assert.deepEqual(await python(1, rows.slice(0, 1)), { ok: true });
      const before = await usage();
      assert.deepEqual(await python(1, rows.slice(0, 1)), { ok: true });
      assert.equal(await usage(), before);
      await data.deleteTable(1, 'notes');
      assert.equal(await usage(), 0);
    });
    await t.test('blocked Node and Python writers see committed usage after owner lock', async () => {
      await seed();
      // Queue both runtimes behind an independently held owner lock.
      const blocker = await pool.getConnection();
      await blocker.beginTransaction();
      await blocker.query(policy.lockOwnerSql, ['owner']);
      const nodeWrite = data.putRow(1, 'notes', { id: 'a', v: 'x'.repeat(50) }).then(() => true, (e) => {
        assert.equal(e.code, 'quota'); return false;
      });
      const pyWrite = python(2, [{ id: 'b', v: 'x'.repeat(50) }]);
      let waiting = 0;
      try {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          waiting = Number((await query("SELECT COUNT(DISTINCT REQUESTING_ENGINE_TRANSACTION_ID) AS n FROM performance_schema.data_lock_waits"))[0].n);
          if (waiting >= 2) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        await blocker.commit(); blocker.release();
      }
      const [nodeOk, pyResult] = await Promise.all([nodeWrite, pyWrite]);
      assert.equal(waiting, 2, 'both runtimes must actually wait on the same owner lock');
      assert.equal(Number(nodeOk) + Number(pyResult.ok), 1);
      assert.ok(await usage() <= limits.userBytes);
    });
    await t.test('failure rolls back and releases owner lock; missing project fails closed', async () => {
      await seed();
      await assert.rejects(data.putRow(999, 'notes', { id: 'a', v: '' }), { code: 'not_found' });
      const quota = createProjectDataQuota(withConnection, limits);
      await assert.rejects(quota(1, async ({ query: exec }) => {
        await exec("INSERT INTO project_rows VALUES(1,1,'bad','{}',NOW())");
        throw new Error('injected write failure');
      }), /injected write failure/);
      assert.equal(await usage(), 0);
      await data.putRow(1, 'notes', { id: 'a', v: '' });
    });
    await t.test('role lookup errors reject writes instead of bypassing quota', async () => {
      await seed();
      await query('DROP TABLE user_roles');
      await assert.rejects(data.putRow(1, 'notes', { id: 'a', v: '' }), { code: 'ER_NO_SUCH_TABLE' });
      assert.equal(await usage(), 0);
    });
  } finally {
    await pool.end();
  }
});
