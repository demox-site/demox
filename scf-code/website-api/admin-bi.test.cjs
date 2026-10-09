const test = require('node:test');
const assert = require('node:assert/strict');
const logGuard = require('../../scripts/log-leak-guard.cjs').installLogLeakGuard();
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
    if (sql.includes('MIN(created_at) AS t')) {
      // 服务端部署埋点 10-09 13:25 (UTC+8) 开始；首页漏斗事件早就有
      return [
        { event_name: 'deploy_success', t: new Date('2026-10-09T05:25:00Z') },
        { event_name: 'deploy_fail', t: '2026-10-09 05:40:00' },
        { event_name: 'landing_view', t: new Date('2026-07-13T08:00:00Z') },
        { event_name: 'deploy_click', t: new Date('2026-07-13T08:00:00Z') }
      ];
    }
    if (sql.includes('SELECT DISTINCT') && sql.includes('FROM websites WHERE created_at >= ? AND created_at < ?')) {
      return [{ d: '2026-10-08', website_id: 'aaa11111' }, { d: '2026-10-08', website_id: 'BBB22222' }, { d: '2026-10-05', website_id: 'CCC33333' }, { d: '2026-10-09', website_id: 'DDD44444' }];
    }
    if (sql.includes('FROM deploy_daily_backfill')) {
      // 日志回填：10-06 日志比站点记录多；10-08 比站点记录少；10-09 开始前有 26 次
      return [{ d: '2026-10-06', total: 7 }, { d: new Date('2026-10-08T00:00:00Z'), total: 1 }, { d: '2026-10-09', total: 26 }];
    }
    if (sql.includes('SELECT DISTINCT') && sql.includes('FROM deploy_upload_sessions WHERE status')) {
      // AAA11111 同一天又走了一次分块上传：同站同日只算 1 次
      return [{ d: new Date('2026-10-08T00:00:00Z'), website_id: 'AAA11111' }, { d: '2026-10-06', website_id: 'EEE55555' }];
    }
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
  // 本期 / 上期都没被服务端埋点完整覆盖：上期为 null（前端不画涨跌箭头），不是 0
  assert.equal(data.kpis.deploys.prev, null);
  assert.equal(data.kpis.deploys.prevSuccessRate, null);
  assert.equal(data.kpis.deploys.trackedSince, '2026-10-09');
  assert.equal(data.kpis.deploys.complete, false);
  // 10-05 站点 1 + 10-06 max(站点 1, 日志 7) + 10-08 max(站点 2, 日志 1) + 10-09 开始那天 max(埋点 1, 补算 26)
  assert.equal(data.kpis.deploys.derivedTotal, 1 + 7 + 2 + 26);
  assert.equal(data.kpis.funnel.deploySuccessSince, '2026-10-09');
  assert.equal(data.kpis.funnel.prevLanding, 80);
  assert.equal(data.tracking.deploys, '2026-10-09');
  assert.equal(data.tracking.deploysAt, '2026-10-09T05:25:00.000Z');
  const day = (d) => data.series.find((p) => p.date === d);
  // 没有任何记录：null，不是 0
  assert.deepEqual(
    ['deploySuccess', 'deployFail', 'deployDerived', 'deploySource', 'deploySplitKnown'].map((k) => day('2026-10-03')[k]),
    [null, null, null, 'none', false]
  );
  // 埋点前：只有补算总数，不拆成功 / 失败；站点记录和日志取较大值，不相加
  assert.deepEqual(
    ['deploySuccess', 'deployFail', 'deployDerived', 'deploySource', 'deploySplitKnown', 'deployDerivedFrom'].map((k) => day('2026-10-08')[k]),
    [null, null, 2, 'derived', false, 'sites']
  );
  assert.equal(day('2026-10-06').deployDerived, 7);
  assert.equal(day('2026-10-06').deployDerivedFrom, 'logs');
  assert.equal(day('2026-10-05').deployDerived, 1);
  // 开始那天：埋点 1 < 补算 26，只画补算总数（不叠加埋点），埋点数放在 deployLiveTotal 给提示用
  assert.deepEqual(
    ['deploySuccess', 'deployFail', 'deployDerived', 'deploySource', 'deploySplitKnown', 'deployLiveTotal'].map((k) => day('2026-10-09')[k]),
    [null, null, 26, 'mixed', false, 1]
  );
  const logCall = calls.find((c) => c.sql.includes('FROM deploy_daily_backfill'));
  assert.deepEqual(logCall.params, ['2026-09-26', '2026-10-09']);
  // 补算只读埋点开始之前的记录
  const derivedCall = calls.find((c) => c.sql.includes('FROM websites WHERE created_at >= ? AND created_at < ?'));
  assert.deepEqual(derivedCall.params, ['2026-09-25 16:00:00', '2026-10-09 05:25:00']);
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

test('deploy days: live days keep real zeros, untracked days are null', () => {
  const live = new Map([['2026-10-10', { success: 0, fail: 0 }]]);
  const derived = new Map([['2026-10-07', 3]]);
  assert.deepEqual(bi.buildDeployDay('2026-10-10', '2026-10-09', live, derived),
    { deploySuccess: 0, deployFail: 0, deployDerived: null, deploySource: 'events', deploySplitKnown: true, deployDerivedFrom: null, deployLiveTotal: 0 });
  assert.deepEqual(bi.buildDeployDay('2026-10-07', '2026-10-09', live, derived),
    { deploySuccess: null, deployFail: null, deployDerived: 3, deploySource: 'derived', deploySplitKnown: false, deployDerivedFrom: 'sites', deployLiveTotal: null });
  assert.deepEqual(bi.buildDeployDay('2026-10-01', '2026-10-09', live, derived),
    { deploySuccess: null, deployFail: null, deployDerived: null, deploySource: 'none', deploySplitKnown: false, deployDerivedFrom: null, deployLiveTotal: null });
  // 从来没有服务端埋点：全部不是 events
  assert.equal(bi.buildDeployDay('2026-10-10', null, live, derived).deploySource, 'none');
});

test('boundary day draws only one kind: live when live >= derived, else derived; never the sum', () => {
  const start = '2026-10-09';
  // 埋点 9（8 成功 1 失败）≥ 补算 5：画埋点，不画补算
  let d = bi.buildDeployDay(start, start, new Map([[start, { success: 8, fail: 1 }]]), new Map([[start, { total: 5, from: 'logs' }]]));
  assert.deepEqual([d.deploySuccess, d.deployFail, d.deployDerived, d.deploySource, d.deploySplitKnown], [8, 1, null, 'mixed', false]);
  // 相等也画埋点
  d = bi.buildDeployDay(start, start, new Map([[start, { success: 5, fail: 0 }]]), new Map([[start, 5]]));
  assert.deepEqual([d.deploySuccess, d.deployDerived], [5, null]);
  // 埋点 9 < 补算 26：只画补算总数 26（不是 35），埋点数留给提示
  d = bi.buildDeployDay(start, start, new Map([[start, { success: 8, fail: 1 }]]), new Map([[start, { total: 26, from: 'logs' }]]));
  assert.deepEqual([d.deploySuccess, d.deployFail, d.deployDerived, d.deployDerivedFrom, d.deployLiveTotal], [null, null, 26, 'logs', 9]);
  // 开始那天没有补算：就是普通的埋点日
  d = bi.buildDeployDay(start, start, new Map([[start, { success: 2, fail: 0 }]]), new Map());
  assert.deepEqual([d.deploySource, d.deploySplitKnown, d.deployDerived], ['events', true, null]);
});

test('site-derived and log-backfilled totals merge by max per day, never by sum', () => {
  const m = bi.mergeDerived(
    new Map([['2026-10-06', 1], ['2026-10-07', 10], ['2026-10-08', 4]]),
    new Map([['2026-10-06', 22], ['2026-10-07', 3], ['2026-10-03', 0], ['2026-10-09', 26]])
  );
  assert.deepEqual([...m.entries()].sort(), [
    ['2026-10-06', { total: 22, from: 'logs' }],
    ['2026-10-07', { total: 10, from: 'sites' }],
    ['2026-10-08', { total: 4, from: 'sites' }],
    ['2026-10-09', { total: 26, from: 'logs' }]
  ]);
  // 两边都是 0：不出现（图上留空）
  assert.equal(m.has('2026-10-03'), false);
});

test('a missing deploy_daily_backfill table is skipped silently; other errors become warnings', async () => {
  const mk = (err) => async (sql) => {
    if (sql.includes('MIN(created_at) AS t')) return [{ event_name: 'deploy_success', t: new Date('2026-10-09T05:25:00Z') }];
    if (sql.includes('FROM deploy_daily_backfill')) throw err;
    if (sql.includes('SELECT DISTINCT') && sql.includes('FROM websites WHERE created_at >= ? AND created_at < ?')) return [{ d: '2026-10-07', website_id: 'A' }];
    return [];
  };
  let data = await bi.computeAdminBi({ query: mk(Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE', errno: 1146 })), range: 7, now: NOW });
  assert.deepEqual(data.warnings, []);
  assert.equal(data.series.find((p) => p.date === '2026-10-07').deployDerived, 1);
  data = await bi.computeAdminBi({ query: mk(Object.assign(new Error('denied'), { code: 'ER_TABLEACCESS_DENIED_ERROR' })), range: 7, now: NOW });
  assert.deepEqual(data.warnings, ['logBackfill: ER_TABLEACCESS_DENIED_ERROR']);
});

test('derived deploys count each site once per day across sources', () => {
  const byDay = bi.aggregateDerivedDeploys(
    [{ d: '2026-10-01', website_id: 'abc' }, { d: '2026-10-01', website_id: 'XYZ' }],
    [{ d: new Date('2026-10-01T00:00:00Z'), website_id: 'ABC' }, { d: '2026-10-02', website_id: 'ABC' }, { d: '2026-10-02', website_id: null }]
  );
  assert.deepEqual([...byDay.entries()], [['2026-10-01', 2], ['2026-10-02', 1]]);
});

test('when the window is fully tracked, no derived query runs and deltas are kept', async () => {
  const later = Date.parse('2026-10-30T03:00:00.000Z');
  const calls = [];
  const q = async (sql, params = []) => {
    calls.push(sql);
    if (sql.includes('MIN(created_at) AS t')) return [{ event_name: 'deploy_success', t: new Date('2026-10-09T05:25:00Z') }, { event_name: 'landing_view', t: new Date('2026-07-13T08:00:00Z') }, { event_name: 'deploy_click', t: new Date('2026-07-13T08:00:00Z') }];
    if (sql.includes("event_name IN ('deploy_success', 'deploy_fail')")) {
      return [
        { id: 1, event_name: 'deploy_success', created_at: new Date('2026-10-29T01:00:00Z'), props: { source: 'cli' } },
        { id: 2, event_name: 'deploy_success', created_at: new Date('2026-10-20T01:00:00Z'), props: { source: 'cli' } }
      ];
    }
    return [];
  };
  const data = await bi.computeAdminBi({ query: q, range: 7, now: later });
  assert.equal(calls.some((s) => s.includes('SELECT DISTINCT') && s.includes('website_id')), false);
  assert.equal(data.kpis.deploys.complete, true);
  assert.equal(data.kpis.deploys.prev, 1);
  assert.equal(data.kpis.deploys.derivedTotal, 0);
  assert.ok(data.series.every((p) => p.deploySource === 'events' && p.deploySplitKnown));
  assert.equal(data.series[0].deploySuccess, 0); // 有埋点的日子里 0 就是 0
});

test('if the tracking-start lookup fails, the deploy series falls back to live events everywhere', async () => {
  const q = async (sql) => {
    if (sql.includes('MIN(created_at) AS t')) throw Object.assign(new Error('boom'), { code: 'ER_X' });
    return [];
  };
  const data = await bi.computeAdminBi({ query: q, range: 7, now: NOW });
  assert.ok(data.warnings.includes('trackingStart: ER_X'));
  assert.ok(data.series.every((p) => p.deploySource === 'events' && p.deploySuccess === 0));
  assert.equal(data.tracking.deploysAt, null);
});

// ── get_admin_bi action ─────────────────────────────────────
test('get_admin_bi rejects anonymous and non-admin callers', async () => {
  queryImpl = async (sql) => (sql.includes('FROM user_roles WHERE user_id') ? [{ roles: ['user'] }] : []);
  const anon = await websiteApi.main({ path: '/website/get-admin-bi', httpMethod: 'POST', headers: {}, body: { action: 'get_admin_bi' } });
  assert.equal(anon.statusCode, 401);
  const res = await call('get_admin_bi', { range: 30 }, { userId: 'user_plain' });
  assert.equal(res.statusCode, 403);
});

test('get_admin_bi: the only writes are the one-time deploy_daily_backfill ensure; no audit row', async () => {
  websiteApi._adminBiForTest.clear();
  websiteApi._deployBackfillForTest.reset();
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
  // v14：BI 看板属于汇总类读，不再写管理员审计
  assert.deepEqual(seen.filter((sql) => /admin_audit_log/.test(sql)), [], 'no audit row for get_admin_bi');
  // 唯一的写：迁移 022 的建表 + 8 行 INSERT IGNORE，只碰 deploy_daily_backfill
  const writes = seen.filter((sql) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE|TRUNCATE)\b/i.test(sql));
  assert.equal(writes.length, 2);
  assert.match(writes[0], /^CREATE TABLE IF NOT EXISTS deploy_daily_backfill \(/);
  assert.match(writes[1].trim(), /^INSERT IGNORE INTO deploy_daily_backfill\b/);
  for (const w of writes) {
    const tables = [...w.matchAll(/\b(?:TABLE(?: IF NOT EXISTS)?|INTO|UPDATE|FROM|JOIN)\s+`?(\w+)/gi)].map((m) => m[1]);
    assert.deepEqual([...new Set(tables)], ['deploy_daily_backfill'], w);
  }
  // 同一实例第二次打开看板：不再建表 / 写入
  websiteApi._adminBiForTest.clear();
  seen.length = 0;
  await call('get_admin_bi', { range: 30 });
  for (const sql of seen) assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i, sql);
});

test('deploy backfill ensure failing does not break get_admin_bi and is retried next time', async () => {
  websiteApi._adminBiForTest.clear();
  websiteApi._deployBackfillForTest.reset();
  let fail = true;
  const seen = [];
  queryImpl = async (sql) => {
    seen.push(sql);
    if (sql.includes('FROM user_roles WHERE user_id')) return [{ roles: ['admin'] }];
    if (fail && sql.includes('CREATE TABLE IF NOT EXISTS deploy_daily_backfill')) throw Object.assign(new Error('denied'), { code: 'ER_TABLEACCESS_DENIED_ERROR' });
    return [];
  };
  const res = await call('get_admin_bi', { range: 7 });
  assert.equal(JSON.parse(res.body).success, true);
  assert.equal(seen.filter((q) => /INSERT IGNORE INTO deploy_daily_backfill/.test(q)).length, 0);
  fail = false;
  websiteApi._adminBiForTest.clear();
  await call('get_admin_bi', { range: 7 });
  assert.equal(seen.filter((q) => /INSERT IGNORE INTO deploy_daily_backfill/.test(q)).length, 1);
});

test('the inline ensure matches migration 022, seeds/022 and /workspace/v14/log-backfill.json', () => {
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const inline = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS deploy_daily_backfill'), src.indexOf("COMMENT='部署按天回填（埋点之前，只有总数）'`"));
  const mig = fs.readFileSync(path.join(__dirname, 'migrations/022_add_deploy_daily_backfill.sql'), 'utf8');
  const cols = (t) => [...t.matchAll(/^\s+(\w+)\s+(DATE|VARCHAR\(\d+\)|INT UNSIGNED|TINYINT\(1\)|DATETIME|TIMESTAMP)(?=\s)/gm)].map((m) => `${m[1]} ${m[2]}`);
  assert.equal(cols(mig).length, 10);
  assert.deepEqual(cols(inline), cols(mig));
  const seed = fs.readFileSync(path.join(__dirname, 'migrations/seeds/022_seed_deploy_daily_backfill.sql'), 'utf8');
  const seedRows = [...seed.matchAll(/\('(\d{4}-\d{2}-\d{2})', 'log_backfill', (\d+), NULL, NULL, ([01]), '([^']+)', '([^']+)'/g)]
    .map((m) => [m[1], Number(m[2]), Number(m[3]), m[4], m[5]]);
  assert.deepEqual(websiteApi._deployBackfillForTest.rows, seedRows);
  assert.deepEqual(websiteApi._deployBackfillForTest.rows.map((r) => [r[0], r[1]]),
    [['2026-10-02', 0], ['2026-10-03', 0], ['2026-10-04', 24], ['2026-10-05', 18], ['2026-10-06', 22], ['2026-10-07', 136], ['2026-10-08', 124], ['2026-10-09', 26]]);
  const jsonPath = '/workspace/v14/log-backfill.json';
  if (fs.existsSync(jsonPath)) {
    const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    assert.deepEqual(websiteApi._deployBackfillForTest.rows.map((r) => [r[0], r[1]]), j.days.map((d) => [d.date, d.total]));
  }
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

// ── 日志脱敏守卫（v13）：上面所有测试打出的日志里都不能出现 token、JWT、OAuth code 或邮箱 ──
test('no token, JWT, OAuth code or email reached any console log in this suite', () => {
  logGuard.assertNoLeaks();
});

// ── migration 022 / seed ────────────────────────────────────
test('migration 022 only creates deploy_daily_backfill and touches no existing table', () => {
  const strip = (t) => t.replace(/--.*$/gm, '').replace(/COMMENT\s+'[^']*'/g, '');
  const sql = strip(fs.readFileSync(path.join(__dirname, 'migrations/022_add_deploy_daily_backfill.sql'), 'utf8'));
  const stmts = sql.split(';').map((x) => x.trim()).filter(Boolean);
  assert.equal(stmts.length, 1);
  assert.match(stmts[0], /^CREATE TABLE IF NOT EXISTS deploy_daily_backfill \(/);
  assert.doesNotMatch(sql, /\b(ALTER|DROP|DELETE|UPDATE|INSERT|RENAME|TRUNCATE|REPLACE)\b/i);
});

test('the one-shot seed only inserts log_backfill rows with unknown fail / channel', () => {
  const raw = fs.readFileSync(path.join(__dirname, 'migrations/seeds/022_seed_deploy_daily_backfill.sql'), 'utf8');
  const sql = raw.replace(/--.*$/gm, '');
  const stmts = sql.split(';').map((x) => x.trim()).filter(Boolean);
  assert.equal(stmts.length, 1);
  assert.match(stmts[0], /^INSERT IGNORE INTO deploy_daily_backfill\b/);
  assert.doesNotMatch(sql, /\b(ALTER|DROP|DELETE|UPDATE|CREATE|TRUNCATE|REPLACE)\b/i);
  const rows = [...sql.matchAll(/\('(\d{4}-\d{2}-\d{2})', 'log_backfill', (\d+), NULL, NULL, ([01]),/g)];
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.map((r) => r[1]), ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  // 只有日志开始那天和埋点开始那天是部分覆盖
  assert.deepEqual(rows.filter((r) => r[3] === '1').map((r) => r[1]), ['2026-10-02', '2026-10-09']);
  // 不含日志原文、令牌、邮箱
  assert.doesNotMatch(raw, /Bearer|eyJ[A-Za-z0-9_-]{10,}|dmx_|@[a-z0-9-]+\.[a-z]{2,}/i);
});
