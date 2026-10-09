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

let queryImpl = async () => [];
const dbModulePath = require.resolve('./shared/db.js');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: {
    query: (...args) => queryImpl(...args),
    transaction: async (cb) => cb({ query: async (...args) => [await queryImpl(...args), []] })
  }
};

const websiteApi = require('./index.js');
const { sign } = require('./shared/jwt.js');
const statTime = websiteApi._statTimeForTest;
const bi = websiteApi._adminBiLibForTest;

const NOW = Date.parse('2026-10-09T03:00:00.000Z'); // 2026-10-09 11:00 UTC+8

function call(action, body = {}, { userId = 'user_admin', token, headers = {} } = {}) {
  const auth = token || sign({ userId, email: `${userId}@demox.example` });
  return websiteApi.main({
    path: `/website/${action.replaceAll('_', '-')}`,
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${auth}`, ...headers },
    body: { action, ...body }
  });
}

// ── release safety ──────────────────────────────────────────
test('index.js only requires shared modules that already exist in the deployed worker package', () => {
  // `demox functions push` uploads index.js alone; ./shared/* is linked from the live worker package.
  const deployed = new Set([
    'blocked-phrases.json', 'buckets.js', 'content-scan.js', 'crypto.js', 'db.js', 'deploy-upload.js',
    'feishu-directory.js', 'github-directory.js', 'jwt.js', 'membership.js', 'storage.js'
  ]);
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const used = [...source.matchAll(/require\('\.\/shared\/([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const name of used) assert.ok(deployed.has(name), `index.js requires ./shared/${name}, which the live worker does not have`);
});

// ── stat-time ───────────────────────────────────────────────
test('stat dates use UTC+8: 23:30 UTC is already the next day', () => {
  assert.equal(statTime.statDateKey(Date.parse('2026-10-08T23:30:00Z')), '2026-10-09');
  assert.equal(statTime.statDateKey(Date.parse('2026-10-08T15:59:59Z')), '2026-10-08');
  assert.equal(statTime.statDateKey(Date.parse('2026-10-08T16:00:00Z')), '2026-10-09');
});

test('stat day start maps to 16:00 UTC of the previous day', () => {
  assert.equal(statTime.statDayStartUtc('2026-10-09'), '2026-10-08 16:00:00');
  assert.deepEqual(statTime.listStatDateKeys(3, NOW), ['2026-10-07', '2026-10-08', '2026-10-09']);
});

test('sqlStatDate only accepts plain column names', () => {
  assert.equal(statTime.sqlStatDate('created_at'), "DATE(CONVERT_TZ(created_at, '+00:00', '+08:00'))");
  assert.throws(() => statTime.sqlStatDate('created_at); DROP TABLE users; --'));
});

// ── window + deploy aggregation ─────────────────────────────
test('range is clamped to 7/30/90', () => {
  assert.equal(bi.normalizeRange(7), 7);
  assert.equal(bi.normalizeRange('90'), 90);
  assert.equal(bi.normalizeRange(365), 30);
  assert.equal(bi.normalizeRange('1; DROP'), 30);
  const w = bi.buildWindow(7, NOW);
  assert.equal(w.startKey, '2026-10-03');
  assert.equal(w.prevStartKey, '2026-09-26');
  assert.equal(w.startUtc, '2026-10-02 16:00:00');
  assert.equal(w.days.length, 7);
});

test('deploy events: a retried chunked upload counts once, and not as a failure if it later succeeded', () => {
  const win = bi.buildWindow(7, NOW);
  const at = (iso) => new Date(iso);
  const rows = [
    { id: 1, event_name: 'deploy_fail', created_at: at('2026-10-08T02:00:00Z'), props: { server: true, source: 'cli', userId: 'u1', uploadId: 'A', errorCode: 'X' } },
    { id: 2, event_name: 'deploy_fail', created_at: at('2026-10-08T02:01:00Z'), props: { server: true, source: 'cli', userId: 'u1', uploadId: 'A', errorCode: 'X' } },
    { id: 3, event_name: 'deploy_success', created_at: at('2026-10-08T02:02:00Z'), props: { server: true, source: 'cli', userId: 'u1', uploadId: 'A' } },
    { id: 4, event_name: 'deploy_fail', created_at: at('2026-10-08T03:00:00Z'), props: JSON.stringify({ server: true, source: 'web', userId: 'u2', uploadId: 'B', errorCode: 'CONTENT_BLOCKED' }) },
    { id: 5, event_name: 'deploy_fail', created_at: at('2026-10-08T03:05:00Z'), props: { server: true, source: 'web', userId: 'u2', uploadId: 'B', errorCode: 'CONTENT_BLOCKED' } },
    { id: 6, event_name: 'deploy_success', created_at: at('2026-10-09T01:00:00Z'), props: { server: true, source: 'token', userId: 'u3' } },
    { id: 7, event_name: 'deploy_fail', created_at: at('2026-10-09T01:10:00Z'), props: { server: true, source: 'token', userId: 'u3', errorCode: 'HTTP_403' } },
    // previous window
    { id: 8, event_name: 'deploy_success', created_at: at('2026-09-28T01:00:00Z'), props: { server: true, source: 'mcp', userId: 'u4' } }
  ];
  const r = bi.aggregateDeployEvents(rows, win);
  assert.equal(r.cur.success, 2);
  assert.equal(r.cur.fail, 2);
  assert.equal(r.cur.total, 4);
  assert.equal(r.cur.successRate, 0.5);
  assert.equal(r.prev.success, 1);
  assert.deepEqual(r.bySource.map((s) => s.source), ['web', 'cli', 'token']);
  assert.deepEqual(r.topErrors[0], { code: 'CONTENT_BLOCKED', count: 1 });
  assert.deepEqual([...r.deployers7].sort(), ['u1', 'u3']);
  assert.deepEqual([...r.deployersPrev7], ['u4']);
});

// ── computeAdminBi: read-only + parameterized ───────────────
function fakeDb() {
  const calls = [];
  const q = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('FROM users WHERE created_at')) return [{ d: '2026-10-09', c: 3 }, { d: '2026-10-01', c: 1 }, { d: '2026-09-01', c: 2 }];
    if (sql.startsWith('SELECT COUNT(*) AS c FROM users')) return [{ c: 120 }];
    if (sql.includes('FROM websites WHERE created_at >= ?\n')) return [{ d: new Date('2026-10-08T00:00:00Z'), c: 4 }];
    if (sql.includes('COUNT(DISTINCT user_id) AS owners')) return [{ sites: 300, owners: 90, storage: 1234 }];
    if (sql.includes('customSubdomain')) return [{ customSubdomain: 12, hideWatermark: 3 }];
    if (sql.includes("event_name IN ('deploy_success', 'deploy_fail')")) {
      return [{ id: 1, event_name: 'deploy_success', created_at: new Date('2026-10-09T01:00:00Z'), props: { server: true, source: 'web', userId: 'u9' } }];
    }
    if (sql.includes('FROM deploy_upload_sessions') && !sql.includes('updated_at < ?')) return [{ user_id: 'u1' }];
    if (sql.includes('FROM deploy_upload_sessions')) return [{ user_id: 'u5' }];
    if (sql.includes('(created_at >= ?) AS is_cur')) return [{ user_id: 'u1', is_cur: 1 }, { user_id: 'u2', is_cur: 1 }, { user_id: 'u6', is_cur: 0 }];
    if (sql.includes('FROM site_path_daily_stats') && sql.includes('GROUP BY stat_date')) return [{ d: '2026-10-09', c: 50 }, { d: '2026-10-03', c: 10 }, { d: '2026-09-30', c: 7 }];
    if (sql.includes('AS cur,') && sql.includes('site_access_logs')) return [{ cur: 40, prev: 30 }];
    if (sql.includes('site_access_logs')) return [{ d: '2026-10-09', c: 20 }];
    if (sql.includes("IN ('landing_view', 'deploy_click', 'intent_guide_click')")) {
      return [{ event_name: 'landing_view', cur: 100, prev: 80 }, { event_name: 'deploy_click', cur: 20, prev: 10 }, { event_name: 'intent_guide_click', cur: 5, prev: 0 }];
    }
    if (sql.includes('EXISTS')) return [{ c: 4 }];
    if (sql.includes("IN ('landing_view', 'deploy_click') AND")) return [{ d: '2026-10-09', event_name: 'landing_view', c: 30 }];
    if (sql.includes('FROM user_roles')) {
      return [
        { roles: '["pro"]', pro_expires_at: new Date(NOW + 10 * 86400000) },
        { roles: ['pro'], pro_expires_at: null },
        { roles: ['pro'], pro_expires_at: new Date(NOW - 86400000) },
        { roles: ['admin'], pro_expires_at: null }
      ];
    }
    if (sql.includes('FROM site_reports')) return [{ open: 2, recent: 5 }];
    if (sql.includes('site_referrer_daily_stats')) return [{ k: 'direct', v: 900 }, { k: 'github.com', v: 75 }];
    if (sql.includes('site_country_daily_stats')) return [{ k: 'CN', v: 800 }];
    if (sql.includes('website_id = ? AND stat_date')) return [{ k: '/', v: 300 }];
    if (sql.includes('LEFT JOIN websites')) return [{ k: 'MUELLII3', name: 'Demo', v: 500 }];
    if (sql.includes('site_analytics_ingested_events')) return [{ last_ingest: new Date(NOW - 7 * 60000), last_event: null }];
    return [];
  };
  return { q, calls };
}

test('computeAdminBi issues only parameterized SELECTs and assembles KPIs', async () => {
  const { q, calls } = fakeDb();
  const data = await bi.computeAdminBi({ query: q, range: 7, now: NOW, scannerPathPredicate: (c) => `${c} NOT LIKE '/.env%'` });
  assert.ok(calls.length > 10);
  for (const { sql, params } of calls) {
    assert.match(sql.trim(), /^SELECT\b/i, sql);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE)\b/i, sql);
    assert.ok(Array.isArray(params));
    for (const p of params) assert.ok(typeof p === 'string' || typeof p === 'number');
  }
  assert.equal(data.tz, 'Asia/Shanghai');
  assert.deepEqual(data.range, { days: 7, start: '2026-10-03', end: '2026-10-09', prevStart: '2026-09-26' });
  assert.deepEqual(data.kpis.newUsers, { value: 3, prev: 1, total: 120 });
  assert.deepEqual(data.kpis.sites, { value: 4, prev: 0, total: 300 });
  assert.equal(data.kpis.pv.value, 60);
  assert.equal(data.kpis.pv.prev, 7);
  assert.deepEqual(data.kpis.uv, { value: 40, prev: 30, approx: true });
  assert.equal(data.kpis.deploys.value, 1);
  assert.equal(data.kpis.deploys.successRate, 1);
  // u9 (event) + u1 (session) + u1,u2 (new sites) => 3; prev: u5, u6
  assert.deepEqual(data.kpis.activeDeployers7d, { value: 3, prev: 2 });
  assert.equal(data.kpis.funnel.landing, 100);
  assert.equal(data.kpis.funnel.deploySuccess, 4);
  assert.equal(data.kpis.funnel.clickRate, 0.2);
  assert.deepEqual(data.kpis.pro, { active: 2, lifetime: 1, expiring30d: 1, expired: 1 });
  assert.deepEqual(data.kpis.reports, { open: 2, recent: 5 });
  assert.equal(data.series.length, 7);
  assert.equal(data.series.at(-1).date, '2026-10-09');
  assert.equal(data.series.at(-1).newUsers, 3);
  assert.equal(data.series.at(-1).pv, 50);
  assert.equal(data.series.at(-1).landing, 30);
  assert.equal(data.health.analyticsLagMinutes, 7);
  assert.equal(data.tops.referrers[1].key, 'github.com');
  assert.equal(data.tops.sites[0].name, 'Demo');
  assert.deepEqual(data.warnings, []);
});

test('a missing table degrades that KPI to null instead of failing the whole response', async () => {
  const q = async (sql) => {
    if (sql.includes('site_reports')) throw Object.assign(new Error("Table 'site_reports' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' });
    return [];
  };
  const data = await bi.computeAdminBi({ query: q, range: 30, now: NOW });
  assert.equal(data.kpis.reports, null);
  assert.deepEqual(data.warnings, ['reports: ER_NO_SUCH_TABLE']);
  assert.equal(data.series.length, 30);
});

test('BI service caches each range for 60 seconds', async () => {
  let n = 0;
  let t = NOW;
  const svc = bi.createAdminBiService({ query: async () => { n += 1; return []; }, now: () => t });
  const a = await svc.get(30);
  const perCall = n;
  const b = await svc.get(30);
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(n, perCall);
  await svc.get(7);
  assert.equal(n, perCall * 2);
  t += 60001;
  const c = await svc.get(30);
  assert.equal(c.cached, false);
  assert.equal(n, perCall * 3);
});

// ── get_admin_bi action ─────────────────────────────────────
test('get_admin_bi rejects anonymous and non-admin callers', async () => {
  queryImpl = async (sql) => (sql.includes('FROM user_roles WHERE user_id') ? [{ roles: ['user'] }] : []);
  const anon = await websiteApi.main({ path: '/website/get-admin-bi', httpMethod: 'POST', headers: {}, body: { action: 'get_admin_bi' } });
  assert.equal(anon.statusCode, 401);
  const res = await call('get_admin_bi', { range: 30 }, { userId: 'user_plain' });
  assert.equal(res.statusCode, 403);
});

test('get_admin_bi returns data for admins without running DDL or writes', async () => {
  websiteApi._adminBiForTest.clear();
  const seen = [];
  queryImpl = async (sql) => {
    seen.push(sql);
    if (sql.includes('FROM user_roles WHERE user_id')) return [{ roles: ['admin'] }];
    return [];
  };
  const res = await call('get_admin_bi', { range: 7 });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.success, true);
  assert.equal(body.data.range.days, 7);
  assert.equal(body.data.series.length, 7);
  // v13：唯一允许的写是管理员审计（admin_audit_log 只追加），BI 本身仍然是纯读。
  const audit = seen.filter((sql) => /admin_audit_log/.test(sql));
  assert.equal(audit.filter((sql) => /^\s*INSERT INTO admin_audit_log/.test(sql)).length, 1, 'exactly one audit row');
  for (const sql of seen.filter((q) => !/admin_audit_log/.test(q))) assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i, sql);
});

// ── tracking ────────────────────────────────────────────────
function collectFrontendEventNames() {
  const root = path.resolve(__dirname, '../../src');
  const names = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?|mjs)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        for (const m of text.matchAll(/\btrack\(\s*["'`]([a-z_]+)["'`]/g)) names.add(m[1]);
      }
    }
  };
  walk(root);
  return names;
}

test('every event the frontend emits with track() is on the server allowlist', () => {
  const names = collectFrontendEventNames();
  assert.ok(names.has('intent_guide_click'));
  assert.ok(names.has('landing_view'));
  for (const name of names) assert.ok(websiteApi.PRODUCT_EVENT_NAMES.has(name), `missing ${name}`);
});

test('the frontend no longer reports deploy_success / deploy_fail (server records them)', () => {
  const names = collectFrontendEventNames();
  assert.equal(names.has('deploy_success'), false);
  assert.equal(names.has('deploy_fail'), false);
});

test('track_product_event accepts intent_guide_click and drops client deploy_success', async () => {
  const inserts = [];
  queryImpl = async (sql, params) => {
    if (sql.startsWith('INSERT INTO product_events')) inserts.push(params);
    return [];
  };
  const ok1 = JSON.parse((await call('track_product_event', { eventName: 'intent_guide_click', visitorId: 'v1', page: '/', props: { id: 'x' } })).body);
  assert.equal(ok1.code, 0);
  const dropped = JSON.parse((await call('track_product_event', { eventName: 'deploy_success', visitorId: 'v1', page: '/' })).body);
  assert.equal(dropped.code, 1);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][0], 'intent_guide_click');
});

test('deploy source classification', () => {
  const c = websiteApi.classifyDeploySource;
  assert.equal(c({ body: { deploySource: 'web' } }, {}), 'web');
  assert.equal(c({ body: { deploySource: 'mcp' } }, { scopes: ['deploy'] }), 'mcp');
  assert.equal(c({ body: {}, headers: { 'X-Demox-Client': 'github-actions' } }, { type: 'pat' }), 'github');
  assert.equal(c({ body: {} }, { type: 'pat', jti: 'j' }), 'token');
  assert.equal(c({ body: {} }, { scopes: ['deploy'] }), 'cli');
  assert.equal(c({ body: {}, headers: { 'user-agent': 'Mozilla/5.0' } }, { userId: 'u' }), 'web');
  assert.equal(c({ body: { deploySource: 'evil' }, headers: {} }, { userId: 'u' }), 'api');
});

test('upload_and_deploy records exactly one server-side deploy event with its source', async () => {
  const inserts = [];
  queryImpl = async (sql, params) => {
    if (sql.startsWith('INSERT INTO product_events')) inserts.push(params);
    if (sql.includes('FROM access_tokens WHERE jti')) return [{ revoked_at: null, expires_at: null }];
    return [];
  };
  const pat = sign({ userId: 'user_ci', jti: 'jti-1', type: 'pat' });
  const res = await call('upload_and_deploy', {
    fileName: 'site.zip',
    fileContentBase64: Buffer.from('not a zip').toString('base64')
  }, { token: pat });
  assert.equal(JSON.parse(res.body).success, false);
  assert.equal(inserts.length, 1);
  const [eventName, visitorId, page, props] = inserts[0];
  assert.equal(eventName, 'deploy_fail');
  assert.equal(visitorId, 'user:user_ci');
  assert.equal(page, 'server:token');
  const p = JSON.parse(props);
  assert.equal(p.server, true);
  assert.equal(p.source, 'token');
  assert.equal(p.userId, 'user_ci');
  assert.equal(typeof p.durationMs, 'number');
});

test('web deploys carry the browser visitor id so the homepage funnel can join them', async () => {
  const inserts = [];
  queryImpl = async (sql, params) => {
    if (sql.startsWith('INSERT INTO product_events')) inserts.push(params);
    return [];
  };
  await call('upload_and_deploy', {
    fileName: 'site.zip',
    fileContentBase64: Buffer.from('nope').toString('base64'),
    deploySource: 'web',
    visitorId: 'lx9abc12def'
  });
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][1], 'lx9abc12def');
  assert.equal(inserts[0][2], 'server:web');
});
