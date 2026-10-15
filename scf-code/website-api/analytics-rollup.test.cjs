const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const logGuard = require('../../scripts/log-leak-guard.cjs').installLogLeakGuard();

const { randomTestSecret, signTestJwt } = require('../../scripts/test-jwt.cjs');
Object.assign(process.env, {
  MYSQL_HOST: '127.0.0.1',
  MYSQL_USER: 'test',
  MYSQL_PASSWORD: 'test',
  MYSQL_DATABASE: 'test',
  JWT_SECRET: randomTestSecret(),
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret_test',
  ANALYTICS_ROLLUP_WATERMARK_ENABLED: '1'
});

const dbDouble = {
  query: async () => [],
  transaction: async (cb) => cb({ query: async () => [{ affectedRows: 0 }, []] })
};
const dbModulePath = require.resolve('./shared/db.js');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: {
    query: (...args) => dbDouble.query(...args),
    transaction: (...args) => dbDouble.transaction(...args)
  }
};

const storage = require('./shared/storage.js');
const realCreateProvider = storage.createProvider;
let legacyProviderFactory = null;
storage.createProvider = function createProvider(cfg) {
  if (typeof legacyProviderFactory === 'function') return legacyProviderFactory(cfg);
  return realCreateProvider(cfg);
};

const websiteApi = require('./index.js');
const rollup = websiteApi._analyticsRollupForTest;

function loggerFor() {
  const lines = [];
  const logs = [];
  const push = (bucket, line, method) => {
    const text = String(line);
    bucket.push(text);
    console[method](text);
    return text;
  };
  return {
    lines,
    logs,
    error(line) {
      push(lines, line, 'error');
    },
    log(line) {
      push(logs, line, 'log');
    }
  };
}

function heartbeatKeys(line) {
  return [...String(line).matchAll(/(?:^|\s)([A-Za-z0-9_.-]+)=/g)].map((match) => match[1]);
}

function makeState(watermark) {
  return {
    watermark: watermark == null ? null : watermark,
    initialMs: null,
    ingested: new Set(),
    skipped: new Set(),
    gaps: [],
    gapIds: new Set(),
    views: 0,
    failCommit: false,
    failMessage: ''
  };
}

function applySql(state, sql, params = []) {
  const probe = String(sql).match(/^SELECT 1 FROM (site_analytics_rollup_watermark|site_analytics_rollup_gaps) LIMIT 0$/);
  if (probe) {
    if ((state.missingTables || []).includes(probe[1])) {
      const error = new Error(`Table '${probe[1]}' doesn't exist`);
      error.code = 'ER_NO_SUCH_TABLE';
      error.errno = 1146;
      throw error;
    }
    return [];
  }
  if (sql.includes('FROM site_analytics_rollup_watermark WHERE id = 1')) {
    return state.watermark == null ? [] : [{ watermark_ms: state.watermark, initial_ms: state.initialMs }];
  }
  if (sql.includes('FROM site_analytics_ingested_events WHERE object_key IN')) {
    return params.filter((key) => state.ingested.has(key)).map((object_key) => ({ object_key }));
  }
  if (sql.includes('FROM site_analytics_rollup_gaps') && sql.includes('object_too_large')) {
    return params.filter((key) => state.skipped.has(key)).map((object_key) => ({ object_key }));
  }
  if (sql.includes('FROM websites')) {
    return params.map((website_id) => ({ website_id }));
  }
  if (sql.includes('INSERT IGNORE INTO site_analytics_ingested_events')) {
    const key = params[0];
    if (state.ingested.has(key)) return { affectedRows: 0 };
    state.ingested.add(key);
    return { affectedRows: 1 };
  }
  if (sql.includes('INSERT IGNORE INTO site_analytics_rollup_gaps')) {
    const reason = sql.includes("'over_48h'") ? 'over_48h' : 'object_too_large';
    const objectKey = reason === 'object_too_large' ? params[2] : '';
    const id = `${reason}|${params[0]}|${objectKey}`;
    if (state.gapIds.has(id)) return { affectedRows: 0 };
    state.gapIds.add(id);
    state.gaps.push({ gap_start: params[0], gap_end: params[1], reason, object_key: objectKey });
    if (objectKey) state.skipped.add(objectKey);
    return { affectedRows: 1 };
  }
  if (sql.includes('INSERT INTO site_analytics_rollup_watermark')) {
    const next = Number(params[0]);
    const initial = Number(params[1]);
    if (state.watermark == null) state.initialMs = initial;
    state.watermark = state.watermark == null ? next : Math.max(state.watermark, next);
    return { affectedRows: 1 };
  }
  if (sql.includes('INSERT INTO site_daily_stats')) {
    state.views += Number(params[2]) || 0;
    return { affectedRows: 1 };
  }
  return { affectedRows: 1 };
}

function depsFor(state, objects, now, logger) {
  const executed = [];
  const runSql = (sql, params) => {
    executed.push(String(sql));
    return applySql(state, sql, params);
  };
  const provider = {
    lists: [],
    gets: [],
    async list(prefix) {
      provider.lists.push(prefix);
      return objects
        .filter((obj) => obj.key.startsWith(prefix))
        .map((obj) => ({ key: obj.key, size: obj.size }));
    },
    async get(key) {
      provider.gets.push(key);
      const obj = objects.find((item) => item.key === key);
      if (!obj) {
        const error = new Error('missing object');
        error.code = 'NOSUCHKEY';
        throw error;
      }
      return obj.body;
    }
  };
  return {
    provider,
    executed,
    now,
    logger,
    query: async (sql, params) => runSql(sql, params),
    transaction: async (cb) => {
      if (state.failCommit) {
        const error = new Error(state.failMessage);
        error.code = 'ER_LOCK_DEADLOCK';
        if (state.failErrno != null) error.errno = state.failErrno;
        if (state.failSqlState) error.sqlState = state.failSqlState;
        throw error;
      }
      return cb({
        query: async (sql, params) => [runSql(sql, params), []]
      });
    }
  };
}

function makeObject(ts, { websiteId = 'SITE0001', rand, size, body, type = 'view' } = {}) {
  const date = new Date(ts);
  const day = date.toISOString().slice(0, 10);
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const suffix = rand || 'aabbccddeeff';
  const key = `analytics/raw/date=${day}/hour=${hour}/${websiteId}-${ts}-${suffix}.ndjson`;
  const payload = body == null
    ? `${JSON.stringify({ websiteId, type, ts, path: '/' })}\n`
    : body;
  return {
    key,
    ts,
    body: payload,
    size: size == null ? Buffer.byteLength(payload) : size
  };
}

function gapMs(row) {
  return {
    gapStartMs: Date.parse(String(row.gap_start).replace(' ', 'T') + 'Z'),
    gapEndMs: Date.parse(String(row.gap_end).replace(' ', 'T') + 'Z'),
    reason: row.reason,
    objectKey: row.object_key
  };
}

test('migration 024 creates the watermark and gap tables and the runtime does not', () => {
  const dir = path.join(__dirname, 'migrations');
  const file = path.join(dir, '024_add_analytics_rollup_watermark.sql');
  const sql = fs.readFileSync(file, 'utf8');
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const numbers = fs.readdirSync(dir).filter((name) => /^\d{3}_.*\.sql$/.test(name)).map((name) => Number(name.slice(0, 3)));
  assert.equal(numbers.filter((n) => n === 24).length, 1);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS site_analytics_rollup_watermark/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS site_analytics_rollup_gaps/);
  assert.match(sql, /over_48h/);
  assert.match(sql, /object_too_large/);
  assert.match(sql, /before_watermark/);
  assert.match(sql, /watermark_ms < /);
  assert.match(sql, /initial_ms/);
  assert.match(sql, /周一 00:00 UTC\+8/);
  assert.match(sql, /2026-10-04 16:00:00\.000/);
  assert.match(sql, /不要传 UTC\+8 墙上时间/);
  assert.match(sql, /SELECT watermark_ms, initial_ms FROM site_analytics_rollup_watermark WHERE id = 1/);
  assert.match(sql, /status = 'active'/);
  assert.match(sql, /reason <> 'test_fire'/);
  assert.match(sql, /status VARCHAR\(16\) NOT NULL DEFAULT 'active'/);
  assert.match(sql, /test-fire:<YYYYMMDD>-<n>/);
  assert.match(sql, /SET status = 'void'/);
  assert.doesNotMatch(sql, /\bDELETE\b/i);
  assert.doesNotMatch(sql, /需要 CREATE/);
  assert.doesNotMatch(sql, /运行时还会执行/);
  assert.doesNotMatch(sql, /运行时会执行/);
  assert.doesNotMatch(sql, /\bALTER\b/i);
  assert.doesNotMatch(sql, /DROP TABLE (?!site_analytics_rollup_)/);
  assert.equal(source.includes('CREATE TABLE IF NOT EXISTS site_analytics_rollup_watermark'), false);
  assert.equal(source.includes('CREATE TABLE IF NOT EXISTS site_analytics_rollup_gaps'), false);
  assert.equal(source.includes('需要 CREATE'), false);
  const docs = ['analytics-rollup.md', 'function-versions.md', 'function-api-ci.md'].map((name) => (
    fs.readFileSync(path.join(__dirname, '../../docs', name), 'utf8')
  ));
  for (const doc of docs) assert.doesNotMatch(doc, /需要 CREATE/);
  assert.match(docs[0], /status = 'active'/);
  assert.match(docs[0], /reason <> 'test_fire'/);
  assert.match(docs[0], /SET status = 'void'/);
  assert.match(docs[0], /test-fire:<YYYYMMDD>-<n>/);
  assert.match(docs[0], /ANALYTICS_RAW_ENABLED/);
  assert.match(docs[0], /INFO analytics-rollup-5m/);
  assert.match(docs[0], /step=tables window=- code=CONFIG_MISSING/);
  assert.doesNotMatch(docs[0], /周报标/);
  assert.doesNotMatch(docs[0], /标「暂定」/);
  assert.match(docs[1], /运行时不执行 CREATE/);
  assert.match(docs[1], /ANALYTICS_RAW_ENABLED=1/);
  assert.match(docs[2], /ANALYTICS_RAW_BUCKET_ID/);
  assert.deepEqual([...rollup.TABLE_NAMES], ['site_analytics_rollup_watermark', 'site_analytics_rollup_gaps']);
  assert.equal(rollup.ALERT_KEYWORD, 'ALERT analytics-rollup-5m');
  assert.equal(rollup.OBJECT_MAX_BYTES, 256 * 1024);
  assert.equal(rollup.LOOKBACK_MS, 48 * 60 * 60 * 1000);
});

test('weekly coverage uses Monday 00:00 UTC+8 and treats pre-tracking weeks as provisional', () => {
  const weekStart = Date.parse('2026-10-04T16:00:00.000Z');
  const weekEnd = Date.parse('2026-10-11T16:00:00.000Z');
  const inside = Date.parse('2026-10-07T04:00:00.000Z');
  assert.deepEqual(rollup.weekWindow(inside), { weekStartMs: weekStart, weekEndMs: weekEnd });
  assert.deepEqual(rollup.weekWindow(Date.parse('2026-10-15T03:48:00.000Z')), {
    weekStartMs: Date.parse('2026-10-11T16:00:00.000Z'),
    weekEndMs: Date.parse('2026-10-18T16:00:00.000Z')
  });
  const { coverage } = rollup;
  const base = { initialMs: weekStart, weekStartMs: weekStart, weekEndMs: weekEnd };
  assert.equal(coverage({ ...base, watermarkMs: weekEnd, gaps: [] }).provisional, false);
  assert.equal(coverage({ ...base, watermarkMs: weekEnd, gaps: [] }).reason, 'complete');
  assert.equal(coverage({ ...base, watermarkMs: null, gaps: [] }).reason, 'watermark');
  assert.equal(coverage({ ...base, watermarkMs: weekEnd - 1, gaps: [] }).provisional, true);
  assert.equal(coverage({
    watermarkMs: weekEnd,
    initialMs: null,
    gaps: [],
    weekStartMs: weekStart,
    weekEndMs: weekEnd
  }).reason, 'before_watermark');
  assert.equal(coverage({
    watermarkMs: weekEnd,
    initialMs: weekStart + 1,
    gaps: [],
    weekStartMs: weekStart,
    weekEndMs: weekEnd
  }).reason, 'before_watermark');
  const gap = coverage({
    ...base,
    watermarkMs: weekEnd,
    gaps: [{ gapStartMs: weekStart + 60_000, gapEndMs: weekStart + 120_000, reason: 'over_48h', objectKey: '' }]
  });
  assert.equal(gap.provisional, true);
  assert.equal(gap.reason, 'gap');
  const before = coverage({
    ...base,
    watermarkMs: weekEnd,
    gaps: [{ gapStartMs: weekStart - 600_000, gapEndMs: weekStart, reason: 'over_48h', objectKey: '' }]
  });
  assert.equal(before.provisional, false);
  const activeGap = { gapStartMs: weekStart + 60_000, gapEndMs: weekStart + 120_000, reason: 'over_48h', objectKey: '', status: 'active' };
  assert.equal(coverage({ ...base, watermarkMs: weekEnd, gaps: [activeGap] }).reason, 'gap');
  assert.equal(coverage({ ...base, watermarkMs: weekEnd, gaps: [{ ...activeGap, status: 'void' }] }).provisional, false);
  assert.equal(coverage({
    ...base,
    watermarkMs: weekEnd,
    gaps: [{ ...activeGap, reason: 'test_fire', objectKey: 'test-fire:20261015-1' }]
  }).provisional, false);
  assert.equal(coverage({
    ...base,
    watermarkMs: weekEnd,
    gaps: [{ ...activeGap, reason: 'test_fire', objectKey: 'test-fire:20261015-1', status: 'void' }]
  }).reason, 'complete');
});

test('alert lines stay single-token and drop unsafe keys', () => {
  const line = rollup.formatAlert({
    step: 'read\nINJECT',
    window: 'not a window',
    code: 'HAS SPACE',
    key: 'analytics/raw/secret note',
    remaining: 3
  });
  assert.equal(line.includes('\n'), false);
  assert.equal(line, 'ALERT analytics-rollup-5m step=UNKNOWN window=- code=UNKNOWN remaining=3');
  const safe = rollup.formatAlert({
    step: 'commit',
    window: '2026-10-15T05:30:00.000Z/2026-10-15T06:00:00.000Z',
    code: 'ER_LOCK_DEADLOCK',
    errno: 1213,
    sqlState: '40001'
  });
  assert.equal(safe, 'ALERT analytics-rollup-5m step=commit window=2026-10-15T05:30:00.000Z/2026-10-15T06:00:00.000Z code=ER_LOCK_DEADLOCK errno=1213 sqlState=40001');
  const dropped = rollup.formatAlert({
    step: 'commit',
    window: '2026-10-15T05:30:00.000Z/2026-10-15T06:00:00.000Z',
    code: 'ER_LOCK_DEADLOCK',
    errno: -1,
    sqlState: 'deadlock text'
  });
  assert.equal(dropped.includes('errno'), false);
  assert.equal(dropped.includes('sqlState'), false);
  assert.equal(dropped.includes('deadlock text'), false);
});

test('re-running the same window does not double count', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const state = makeState(now - 30 * 60 * 1000);
  const logger = loggerFor();
  const objects = [0, 1, 2].map((i) => makeObject(now - 20 * 60 * 1000 + i * 1000, { rand: `idem${i}abcd` }));
  const first = await rollup.run(depsFor(state, objects, now, logger));
  assert.equal(first.success, true);
  assert.equal(first.processed, 3);
  assert.equal(state.views, 3);
  assert.equal(state.watermark, now - 5 * 60 * 1000);
  assert.deepEqual(logger.lines, []);

  const secondLogger = loggerFor();
  const secondDeps = depsFor(state, objects, now, secondLogger);
  const second = await rollup.run(secondDeps);
  assert.equal(second.success, true);
  assert.equal(second.processed, 0);
  assert.equal(state.views, 3);
  assert.equal(state.ingested.size, 3);
  assert.equal(secondDeps.provider.gets.length, 0);
  assert.deepEqual(secondLogger.lines, []);
  assert.equal(state.watermark, now - 5 * 60 * 1000);
});

test('a 3h stall backfills from the watermark and ignores older objects', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const state = makeState(now - 3 * 60 * 60 * 1000);
  const logger = loggerFor();
  const stale = makeObject(now - 5 * 60 * 60 * 1000, { rand: 'stale0000001' });
  const objects = [
    stale,
    makeObject(now - 3 * 60 * 60 * 1000 + 10 * 60 * 1000, { rand: 'back00000001' }),
    makeObject(now - 2 * 60 * 60 * 1000, { rand: 'back00000002' }),
    makeObject(now - 60 * 60 * 1000, { rand: 'back00000003' })
  ];
  const deps = depsFor(state, objects, now, logger);
  const result = await rollup.run(deps);
  assert.equal(result.success, true);
  assert.equal(result.processed, 3);
  assert.equal(state.views, 3);
  assert.equal(state.watermark, now - 5 * 60 * 1000);
  assert.equal(result.gap, null);
  assert.ok(deps.provider.lists.some((prefix) => prefix.includes('hour=02')));
  assert.ok(deps.provider.lists.some((prefix) => prefix.includes('hour=03')));
  assert.ok(deps.provider.lists.some((prefix) => prefix.includes('hour=05')));
  assert.ok(deps.provider.lists.every((prefix) => !prefix.includes('hour=01')));
  assert.ok(deps.provider.gets.every((key) => key !== stale.key));
  assert.equal(logger.lines.length, 1);
  assert.match(logger.lines[0], /^ALERT analytics-rollup-5m step=watermark window=\S+ code=STALE_WATERMARK$/);
});

test('already-ingested objects are filtered before the 2000 cap and the rest drains on the next run', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const state = makeState(Date.parse('2026-10-15T03:00:00.000Z'));
  const logger = loggerFor();
  const objects = [];
  for (let i = 0; i < 2000; i += 1) {
    const obj = makeObject(Date.parse('2026-10-15T03:00:00.000Z') + i * 1000, { rand: `old${String(i).padStart(8, '0')}` });
    state.ingested.add(obj.key);
    objects.push(obj);
  }
  const freshStart = Date.parse('2026-10-15T04:00:00.000Z');
  for (let i = 0; i < 2500; i += 1) {
    objects.push(makeObject(freshStart + i * 1000, { rand: `new${String(i).padStart(8, '0')}` }));
  }
  const deps = depsFor(state, objects, now, logger);
  const first = await rollup.run(deps);
  assert.equal(first.success, true);
  assert.equal(first.processed, 2000);
  assert.equal(first.backlog, 500);
  assert.equal(state.views, 2000);
  assert.equal(state.watermark, Date.parse('2026-10-15T04:30:00.000Z'));
  assert.equal(deps.provider.gets.length, 2000);
  assert.ok(deps.provider.gets.every((key) => key.includes('hour=04')));
  assert.equal(logger.lines.length, 2);
  assert.ok(logger.lines.some((line) => /code=STALE_WATERMARK$/.test(line)));
  assert.ok(logger.lines.some((line) => /^ALERT analytics-rollup-5m step=backlog window=\S+ code=BACKLOG_OVER_CAP remaining=500$/.test(line)));

  deps.provider.gets.length = 0;
  const secondLogger = loggerFor();
  const second = await rollup.run(depsFor(state, objects, now, secondLogger));
  assert.equal(second.success, true);
  assert.equal(second.processed, 500);
  assert.equal(second.backlog, 0);
  assert.equal(state.views, 2500);
  assert.equal(state.watermark, now - 5 * 60 * 1000);
  assert.equal(state.ingested.size, 4500);
  assert.equal(secondLogger.lines.length, 1);
  assert.match(secondLogger.lines[0], /^ALERT analytics-rollup-5m step=watermark window=\S+ code=STALE_WATERMARK$/);
});

test('an object over 256KB is skipped with an alert and makes the week provisional', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const state = makeState(now - 30 * 60 * 1000);
  const logger = loggerFor();
  const secret = `admin@demox.site password=supersecret ${'A'.repeat(48)}`;
  const normal = makeObject(now - 10 * 60 * 1000, { rand: 'normal000001' });
  const huge = makeObject(now - 10 * 60 * 1000 + 1000, {
    rand: 'huge00000001',
    size: 256 * 1024 + 1,
    body: `${JSON.stringify({ websiteId: 'SITE0001', type: 'view', ts: now, path: '/', note: secret })}\n`
  });
  const deps = depsFor(state, [normal, huge], now, logger);
  const result = await rollup.run(deps);
  assert.equal(result.success, true);
  assert.equal(result.processed, 1);
  assert.equal(state.views, 1);
  assert.deepEqual(deps.provider.gets, [normal.key]);
  assert.equal(logger.lines.length, 1);
  assert.match(logger.lines[0], /^ALERT analytics-rollup-5m step=read window=\S+ code=OBJECT_TOO_LARGE key=/);
  assert.ok(logger.lines[0].includes(huge.key));
  assert.equal(logger.lines[0].includes(secret), false);
  assert.equal(logger.lines[0].includes('\n'), false);
  assert.equal(state.gaps.length, 1);
  assert.equal(state.gaps[0].reason, 'object_too_large');
  assert.equal(state.gaps[0].object_key, huge.key);
  assert.equal(state.watermark, now - 5 * 60 * 1000);
  const weekStartMs = state.watermark - 7 * 24 * 60 * 60 * 1000;
  const coverage = rollup.coverage({
    watermarkMs: state.watermark,
    initialMs: weekStartMs,
    gaps: state.gaps.map(gapMs),
    weekStartMs,
    weekEndMs: state.watermark
  });
  assert.equal(coverage.provisional, true);
  assert.equal(coverage.reason, 'gap');
  assert.equal(coverage.gaps[0].objectKey, huge.key);

  const again = loggerFor();
  const second = await rollup.run(depsFor(state, [normal, huge], now, again));
  assert.equal(second.processed, 0);
  assert.equal(state.views, 1);
  assert.deepEqual(again.lines, []);
  assert.equal(state.gaps.length, 1);
});

test('a watermark older than 48h alerts the gap and does not read the skipped objects', async () => {
  const now = Date.parse('2026-10-15T12:00:00.000Z');
  const state = makeState(now - 72 * 60 * 60 * 1000);
  const logger = loggerFor();
  const dropped = makeObject(now - 60 * 60 * 60 * 1000, { rand: 'drop00000001' });
  const kept = makeObject(now - 60 * 60 * 1000, { rand: 'keep00000001' });
  const deps = depsFor(state, [dropped, kept], now, logger);
  const result = await rollup.run(deps);
  assert.equal(result.success, true);
  assert.equal(result.processed, 1);
  assert.equal(state.views, 1);
  assert.deepEqual(deps.provider.gets, [kept.key]);
  assert.equal(logger.lines.length, 2);
  assert.match(logger.lines[0], /^ALERT analytics-rollup-5m step=watermark window=\S+ code=STALE_WATERMARK$/);
  const gapStart = new Date(now - 72 * 60 * 60 * 1000).toISOString();
  const gapEnd = new Date(now - 48 * 60 * 60 * 1000).toISOString();
  assert.equal(
    logger.lines[1],
    `ALERT analytics-rollup-5m step=gap window=${gapStart}/${gapEnd} code=GAP_OVER_48H`
  );
  assert.equal(state.gaps.length, 1);
  assert.equal(state.gaps[0].reason, 'over_48h');
  assert.equal(state.watermark, now - 5 * 60 * 1000);
  const weekStartMs = now - 80 * 60 * 60 * 1000;
  const coverage = rollup.coverage({
    watermarkMs: state.watermark,
    initialMs: weekStartMs,
    gaps: state.gaps.map(gapMs),
    weekStartMs,
    weekEndMs: now - 50 * 60 * 60 * 1000
  });
  assert.equal(coverage.provisional, true);
  assert.equal(coverage.reason, 'gap');

  const again = loggerFor();
  const second = await rollup.run(depsFor(state, [dropped, kept], now, again));
  assert.equal(second.processed, 0);
  assert.equal(state.views, 1);
  assert.ok(again.lines.every((line) => !line.includes('GAP_OVER_48H')));
});

test('a database failure emits one alert and returns instead of throwing', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const watermark = now - 30 * 60 * 1000;
  const state = makeState(watermark);
  const token = signTestJwt({ sub: '1' });
  state.failCommit = true;
  state.failErrno = 1213;
  state.failSqlState = '40001';
  state.failMessage = `deadlock admin@demox.site password=supersecret ${'B'.repeat(48)} ${token}`;
  const logger = loggerFor();
  const objects = [makeObject(now - 10 * 60 * 1000, { rand: 'fail00000001' })];
  const result = await rollup.run(depsFor(state, objects, now, logger));
  assert.equal(result.success, false);
  assert.equal(result.step, 'commit');
  assert.equal(result.code, 'ER_LOCK_DEADLOCK');
  assert.equal(logger.lines.length, 1);
  assert.match(logger.lines[0], /^ALERT analytics-rollup-5m step=commit window=\S+ code=ER_LOCK_DEADLOCK errno=1213 sqlState=40001$/);
  assert.equal(logger.lines[0].includes(token), false);
  assert.equal(logger.lines[0].includes('\n'), false);
  assert.equal(logger.lines[0].includes('admin@'), false);
  assert.equal(logger.lines[0].includes('password'), false);
  assert.equal(logger.lines[0].includes('eyJ'), false);
  assert.equal(logger.lines[0].includes(state.failMessage), false);
  assert.equal(state.watermark, watermark);
  assert.equal(state.views, 0);
  assert.equal(state.ingested.size, 0);
  assert.equal(state.gaps.length, 0);
});

test('the timer returns success:false so the platform does not retry', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const logger = loggerFor();
  const prevEnabled = process.env.ANALYTICS_RAW_ENABLED;
  const prevBucket = process.env.ANALYTICS_RAW_BUCKET_ID;
  process.env.ANALYTICS_RAW_ENABLED = '1';
  process.env.ANALYTICS_RAW_BUCKET_ID = '7';
  rollup.setDeps({
    now,
    logger,
    provider: {
      async list() {
        const error = new Error('socket hang up');
        error.code = 'ECONNRESET';
        throw error;
      },
      async get() {
        throw new Error('should not read');
      }
    }
  });
  try {
    const response = await websiteApi.main({
      Type: 'Timer',
      TriggerName: 'analytics-rollup-5m',
      Time: new Date(now).toISOString()
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.success, false);
    assert.equal(body.step, 'list');
    assert.equal(body.code, 'ECONNRESET');
    assert.equal(logger.lines.length, 1);
    assert.match(logger.lines[0], /^ALERT analytics-rollup-5m step=list window=\S+ code=ECONNRESET$/);
  } finally {
    rollup.setDeps(null);
    if (prevEnabled == null) delete process.env.ANALYTICS_RAW_ENABLED;
    else process.env.ANALYTICS_RAW_ENABLED = prevEnabled;
    if (prevBucket == null) delete process.env.ANALYTICS_RAW_BUCKET_ID;
    else process.env.ANALYTICS_RAW_BUCKET_ID = prevBucket;
  }
});

test('an object uploaded just after the hour boundary is counted on the next run', async () => {
  const boundary = Date.parse('2026-10-15T06:00:00.000Z');
  const state = makeState(Date.parse('2026-10-15T05:50:00.000Z'));
  const logger = loggerFor();
  const first = await rollup.run(depsFor(state, [], boundary, logger));
  assert.equal(first.success, true);
  assert.equal(first.processed, 0);
  assert.equal(state.watermark, Date.parse('2026-10-15T05:55:00.000Z'));
  assert.deepEqual(logger.lines, []);

  const late = makeObject(boundary - 2000, { rand: 'boundary0001' });
  const secondLogger = loggerFor();
  const second = await rollup.run(depsFor(state, [late], boundary + 5 * 60 * 1000, secondLogger));
  assert.equal(second.success, true);
  assert.equal(second.processed, 1);
  assert.equal(state.views, 1);
  assert.equal(state.watermark, boundary);
  assert.equal(state.ingested.has(late.key), true);
  assert.ok(secondLogger.lines.every((line) => !line.includes('LATE_OBJECT')));
});

test('an uningested object older than the watermark is counted and logged LATE_OBJECT', async () => {
  const now = Date.parse('2026-10-15T06:15:00.000Z');
  const watermark = Date.parse('2026-10-15T06:10:00.000Z');
  const state = makeState(watermark);
  const logger = loggerFor();
  const late = makeObject(Date.parse('2026-10-15T06:05:00.000Z'), { rand: 'lateobj00001' });
  const result = await rollup.run(depsFor(state, [late], now, logger));
  assert.equal(result.success, true);
  assert.equal(result.processed, 1);
  assert.equal(state.views, 1);
  assert.equal(state.watermark, watermark);
  assert.deepEqual(logger.lines, []);
  const lateLines = logger.logs.filter((line) => line.includes('code=LATE_OBJECT'));
  assert.equal(lateLines.length, 1);
  assert.match(lateLines[0], /^INFO analytics-rollup-5m step=ingest window=\S+ code=LATE_OBJECT key=/);
  assert.ok(lateLines[0].includes(late.key));
  assert.ok((result.alerts || []).every((line) => !line.includes('LATE_OBJECT')));

  const again = loggerFor();
  const second = await rollup.run(depsFor(state, [late], now, again));
  assert.equal(second.processed, 0);
  assert.equal(state.views, 1);
  assert.deepEqual(again.lines, []);
  assert.ok(again.logs.every((line) => !line.includes('LATE_OBJECT')));
});

test('the first run records initial_ms so earlier weeks stay provisional', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const state = makeState(null);
  const logger = loggerFor();
  const result = await rollup.run(depsFor(state, [], now, logger));
  assert.equal(result.success, true);
  const horizon = now - 48 * 60 * 60 * 1000;
  assert.equal(state.initialMs, horizon);
  assert.equal(state.watermark, now - 5 * 60 * 1000);
  const earlier = rollup.weekWindow(horizon - 10 * 24 * 60 * 60 * 1000);
  const cov = rollup.coverage({
    watermarkMs: state.watermark,
    initialMs: state.initialMs,
    gaps: [],
    weekStartMs: earlier.weekStartMs,
    weekEndMs: earlier.weekEndMs
  });
  assert.equal(cov.provisional, true);
  assert.equal(cov.reason, 'before_watermark');
});

function lockConn(state, got) {
  const calls = { release: 0 };
  const conn = {
    async query(sql, params) {
      const text = String(sql);
      if (text.includes('GET_LOCK')) return [[{ got }], []];
      if (text.includes('RELEASE_LOCK')) {
        calls.release += 1;
        return [[{ released: 1 }], []];
      }
      return [applySql(state, text, params), []];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {}
  };
  return { calls, conn, withConnection: async (fn) => fn(conn) };
}

test('a busy GET_LOCK skips the run without an alert or releasing the lock', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const watermark = now - 30 * 60 * 1000;
  const state = makeState(watermark);
  const logger = loggerFor();
  const { calls, withConnection } = lockConn(state, 0);
  const result = await rollup.run({
    ...depsFor(state, [makeObject(now - 10 * 60 * 1000, { rand: 'locked000001' })], now, logger),
    withConnection
  });
  assert.equal(result.success, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'locked');
  assert.equal(calls.release, 0);
  assert.deepEqual(logger.lines, []);
  assert.equal(state.watermark, watermark);
  assert.equal(state.views, 0);
});

test('GET_LOCK is held on one connection and released after success or failure', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const state = makeState(now - 30 * 60 * 1000);
  const logger = loggerFor();
  const obj = makeObject(now - 10 * 60 * 1000, { rand: 'lock00000001' });
  const held = lockConn(state, 1);
  const result = await rollup.run({ ...depsFor(state, [obj], now, logger), withConnection: held.withConnection });
  assert.equal(result.success, true);
  assert.equal(result.processed, 1);
  assert.equal(state.views, 1);
  assert.equal(held.calls.release, 1);

  const failed = makeState(now - 30 * 60 * 1000);
  const failLogger = loggerFor();
  const lock = lockConn(failed, 1);
  lock.conn.beginTransaction = async () => {
    const error = new Error('deadlock');
    error.code = 'ER_LOCK_DEADLOCK';
    error.errno = 1213;
    error.sqlState = '40001';
    throw error;
  };
  const broken = await rollup.run({
    ...depsFor(failed, [obj], now, failLogger),
    withConnection: lock.withConnection
  });
  assert.equal(broken.success, false);
  assert.equal(broken.code, 'ER_LOCK_DEADLOCK');
  assert.match(failLogger.lines[0], /errno=1213 sqlState=40001$/);
  assert.equal(lock.calls.release, 1);
  assert.equal(failed.watermark, now - 30 * 60 * 1000);
});

test('manual limit above 2000 is capped and a short limit leaves a backlog', async () => {
  assert.equal(rollup.normalizeLimit(10000), 2000);
  assert.equal(rollup.normalizeLimit(0), 2000);
  assert.equal(rollup.normalizeLimit('nope'), 2000);
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const state = makeState(Date.parse('2026-10-15T05:00:00.000Z'));
  const logger = loggerFor();
  const objects = [0, 1, 2, 3].map((i) => makeObject(Date.parse('2026-10-15T05:10:00.000Z') + i * 1000, {
    rand: `lim${i}0000000`
  }));
  const result = await rollup.run({ ...depsFor(state, objects, now, logger), limit: 2 });
  assert.equal(result.processed, 2);
  assert.equal(result.backlog, 2);
  assert.ok(logger.lines.some((line) => /code=STALE_WATERMARK$/.test(line)));
  assert.ok(logger.lines.some((line) => /code=BACKLOG_OVER_CAP remaining=2$/.test(line)));
  assert.equal(state.watermark, Date.parse('2026-10-15T05:10:00.000Z'));
});

test('a time budget stops cleanly and does not settle unread objects', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const watermark = now - 3 * 60 * 60 * 1000;
  const idle = makeState(watermark);
  const idleLogger = loggerFor();
  let calls = 0;
  const idleDeps = depsFor(idle, [makeObject(watermark + 60 * 1000, { rand: 'budget000001' })], now, idleLogger);
  idleDeps.clock = () => {
    calls += 1;
    return calls === 1 ? now : now + rollup.TIME_BUDGET_MS;
  };
  const stopped = await rollup.run(idleDeps);
  assert.equal(stopped.success, true);
  assert.equal(stopped.budget, true);
  assert.equal(stopped.processed, 0);
  assert.equal(idleDeps.provider.lists.length, 0);
  assert.equal(idle.watermark, watermark);
  assert.equal(idle.ingested.size, 0);
  assert.ok(idleLogger.lines.some((line) => /code=STALE_WATERMARK$/.test(line)));
  assert.ok(idleLogger.lines.some((line) => /code=TIME_BUDGET$/.test(line)));

  const start = Date.parse('2026-10-15T03:00:00.000Z');
  const state = makeState(start);
  const logger = loggerFor();
  const objects = [0, 1, 2].map((i) => makeObject(Date.parse('2026-10-15T03:10:00.000Z') + i * 1000, {
    rand: `budg${i}000000`
  }));
  let gets = 0;
  const deps = depsFor(state, objects, now, logger);
  const origGet = deps.provider.get.bind(deps.provider);
  deps.provider.get = async (key) => {
    gets += 1;
    return origGet(key);
  };
  deps.clock = () => (gets >= 2 ? now + rollup.TIME_BUDGET_MS : now);
  const result = await rollup.run(deps);
  assert.equal(result.success, true);
  assert.equal(result.processed, 2);
  assert.equal(result.budget, true);
  assert.equal(deps.provider.gets.length, 2);
  assert.equal(state.ingested.has(objects[2].key), false);
  assert.equal(state.watermark, Date.parse('2026-10-15T03:10:00.000Z'));
  assert.match(logger.lines.join('\n'), /code=TIME_BUDGET/);
});

test('manual days and hours do not shrink the scan', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const state = makeState(now - 3 * 60 * 60 * 1000);
  const logger = loggerFor();
  const objects = [makeObject(now - 3 * 60 * 60 * 1000 + 10 * 60 * 1000, { rand: 'span00000001' })];
  const deps = depsFor(state, objects, now, logger);
  const prevEnabled = process.env.ANALYTICS_RAW_ENABLED;
  const prevBucket = process.env.ANALYTICS_RAW_BUCKET_ID;
  process.env.ANALYTICS_RAW_ENABLED = '1';
  process.env.ANALYTICS_RAW_BUCKET_ID = '7';
  rollup.setDeps(deps);
  try {
    const response = await websiteApi.main({
      Type: 'Timer',
      TriggerName: 'analytics-rollup-5m',
      Time: new Date(now).toISOString(),
      CustomArgument: JSON.stringify({ days: 1, hours: 1, limit: 10000 })
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.success, true);
    assert.equal(body.processed, 1);
    assert.ok(deps.provider.lists.some((prefix) => prefix.includes('hour=03')));
    assert.ok(deps.provider.lists.some((prefix) => prefix.includes('hour=05')));
  } finally {
    rollup.setDeps(null);
    if (prevEnabled == null) delete process.env.ANALYTICS_RAW_ENABLED;
    else process.env.ANALYTICS_RAW_ENABLED = prevEnabled;
    if (prevBucket == null) delete process.env.ANALYTICS_RAW_BUCKET_ID;
    else process.env.ANALYTICS_RAW_BUCKET_ID = prevBucket;
  }
});

test('an object stamped at HH:59:58 is counted once when it appears 6 or 20 minutes later', async () => {
  const stamped = Date.parse('2026-10-15T05:59:58.000Z');
  const delays = [
    { minutes: 6, watermark: Date.parse('2026-10-15T06:00:00.000Z') },
    { minutes: 20, watermark: Date.parse('2026-10-15T06:15:00.000Z') }
  ];
  for (const { minutes, watermark } of delays) {
    const obj = makeObject(stamped, { rand: `xhour${String(minutes).padStart(4, '0')}` });
    const now = stamped + minutes * 60 * 1000;
    const state = makeState(watermark);
    const logger = loggerFor();
    const deps = depsFor(state, [obj], now, logger);
    const first = await rollup.run(deps);
    assert.equal(first.success, true);
    assert.equal(first.processed, 1);
    assert.equal(state.views, 1);
    assert.equal(state.ingested.has(obj.key), true);
    assert.ok(deps.provider.lists.some((prefix) => prefix.includes('hour=05')));
    const lateLines = logger.logs.filter((line) => line.includes('code=LATE_OBJECT'));
    assert.equal(lateLines.length, 1);
    assert.match(lateLines[0], /^INFO analytics-rollup-5m step=ingest window=\S+ code=LATE_OBJECT key=/);
    assert.ok(logger.lines.every((line) => !line.includes('LATE_OBJECT')));
    assert.ok((first.alerts || []).every((line) => !line.includes('LATE_OBJECT')));

    const againLogger = loggerFor();
    const againDeps = depsFor(state, [obj], now, againLogger);
    const second = await rollup.run(againDeps);
    assert.equal(second.success, true);
    assert.equal(second.processed, 0);
    assert.equal(state.views, 1);
    assert.equal(againDeps.provider.gets.length, 0);
    assert.ok(againLogger.lines.every((line) => !line.includes('LATE_OBJECT')));
  }
});

test('a successful run emits one heartbeat and the formatter keeps the key allow-list', async () => {
  assert.deepEqual([...rollup.HEARTBEAT_KEYS], ['watermark', 'windows', 'processed', 'late', 'duration']);
  const leaked = rollup.formatHeartbeat({
    watermark: Date.parse('2026-10-15T05:55:00.000Z'),
    windows: 2,
    processed: 1,
    late: 0,
    duration: 'lt1s',
    error: 'deadlock admin@demox.site password=supersecret',
    message: 'raw event body',
    user: 'SITE0001',
    note: 'should-not-appear'
  });
  assert.equal(leaked.startsWith('HEARTBEAT analytics-rollup-5m '), true);
  assert.deepEqual(heartbeatKeys(leaked), [...rollup.HEARTBEAT_KEYS]);
  assert.equal(leaked.includes('admin@'), false);
  assert.equal(leaked.includes('password'), false);
  assert.equal(leaked.includes('should-not-appear'), false);
  assert.equal(leaked.includes('SITE0001'), false);
  assert.equal(leaked.includes('\n'), false);
  const dirtyDuration = rollup.formatHeartbeat({
    watermark: 1,
    windows: 0,
    processed: 0,
    late: 0,
    duration: '1s password=supersecret'
  });
  assert.equal(dirtyDuration.includes('password'), false);
  assert.match(dirtyDuration, /duration=UNKNOWN$/);
  assert.equal(rollup.durationBucket(0), 'lt1s');
  assert.equal(rollup.durationBucket(1500), '1to10s');
  assert.equal(rollup.durationBucket(20000), '10to60s');
  assert.equal(rollup.durationBucket(120000), '1to4m');
  assert.equal(rollup.durationBucket(240000), 'gt4m');

  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const state = makeState(now - 20 * 60 * 1000);
  const logger = loggerFor();
  const obj = makeObject(now - 10 * 60 * 1000, { rand: 'heart0000001' });
  let ticks = 0;
  const deps = depsFor(state, [obj], now, logger);
  deps.clock = () => {
    ticks += 1;
    return ticks === 1 ? now : now + 1500;
  };
  const result = await rollup.run(deps);
  assert.equal(result.success, true);
  assert.equal(result.processed, 1);
  const beats = logger.logs.filter((line) => line.startsWith('HEARTBEAT analytics-rollup-5m '));
  assert.equal(beats.length, 1);
  assert.deepEqual(heartbeatKeys(beats[0]), [...rollup.HEARTBEAT_KEYS]);
  assert.match(beats[0], /^HEARTBEAT analytics-rollup-5m watermark=\d+ windows=\d+ processed=1 late=0 duration=1to10s$/);
  assert.equal(beats[0].includes(obj.key), false);
  assert.equal(beats[0].includes('SITE'), false);
  assert.equal(beats[0].includes('\n'), false);
  assert.ok(logger.lines.every((line) => !line.startsWith('HEARTBEAT ')));

  const again = loggerFor();
  const second = await rollup.run(depsFor(state, [obj], now, again));
  assert.equal(second.processed, 0);
  assert.equal(state.views, 1);
  assert.equal(again.logs.filter((line) => line.startsWith('HEARTBEAT analytics-rollup-5m ')).length, 1);
});

test('a watermark more than 30 minutes behind alerts STALE_WATERMARK at run start', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const staleAt = now - rollup.STALE_WATERMARK_MS - 60 * 1000;
  const state = makeState(staleAt);
  const logger = loggerFor();
  const result = await rollup.run(depsFor(state, [], now, logger));
  assert.equal(result.success, true);
  assert.equal(logger.lines.length, 1);
  assert.match(logger.lines[0], /^ALERT analytics-rollup-5m step=watermark window=\S+ code=STALE_WATERMARK$/);
  assert.equal(logger.logs.filter((line) => line.startsWith('HEARTBEAT analytics-rollup-5m ')).length, 1);

  const exact = makeState(now - rollup.STALE_WATERMARK_MS);
  const exactLogger = loggerFor();
  const exactResult = await rollup.run(depsFor(exact, [], now, exactLogger));
  assert.equal(exactResult.success, true);
  assert.ok(exactLogger.lines.every((line) => !line.includes('STALE_WATERMARK')));
});

test('disabled raw logging or a missing bucket alerts CONFIG_MISSING', async () => {
  const prevEnabled = process.env.ANALYTICS_RAW_ENABLED;
  const prevBucket = process.env.ANALYTICS_RAW_BUCKET_ID;
  const logger = loggerFor();
  const event = {
    Type: 'Timer',
    TriggerName: 'analytics-rollup-5m',
    Time: '2026-10-15T06:00:00.000Z'
  };
  rollup.setDeps({ logger, now: Date.parse('2026-10-15T06:00:00.000Z') });
  try {
    delete process.env.ANALYTICS_RAW_ENABLED;
    delete process.env.ANALYTICS_RAW_BUCKET_ID;
    const disabled = await websiteApi.main(event);
    assert.equal(disabled.statusCode, 200);
    const disabledBody = JSON.parse(disabled.body);
    assert.equal(disabledBody.success, false);
    assert.equal(disabledBody.code, 'CONFIG_MISSING');
    assert.equal(logger.lines.length, 1);
    assert.equal(logger.lines[0], 'ALERT analytics-rollup-5m step=config window=- code=CONFIG_MISSING');
    assert.equal(logger.logs.length, 0);
    assert.equal(logger.lines[0].includes('未启用'), false);

    logger.lines.length = 0;
    process.env.ANALYTICS_RAW_ENABLED = '1';
    delete process.env.ANALYTICS_RAW_BUCKET_ID;
    const noBucket = await websiteApi.main(event);
    const noBucketBody = JSON.parse(noBucket.body);
    assert.equal(noBucketBody.success, false);
    assert.equal(noBucketBody.code, 'CONFIG_MISSING');
    assert.equal(logger.lines.length, 1);
    assert.equal(logger.lines[0], 'ALERT analytics-rollup-5m step=config window=- code=CONFIG_MISSING');
    assert.equal(logger.logs.length, 0);
  } finally {
    rollup.setDeps(null);
    if (prevEnabled == null) delete process.env.ANALYTICS_RAW_ENABLED;
    else process.env.ANALYTICS_RAW_ENABLED = prevEnabled;
    if (prevBucket == null) delete process.env.ANALYTICS_RAW_BUCKET_ID;
    else process.env.ANALYTICS_RAW_BUCKET_ID = prevBucket;
  }
});

test('COS NoSuchKey is skipped as a non-error with code NOSUCHKEY', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const state = makeState(Date.parse('2026-10-15T05:30:00.000Z'));
  const logger = loggerFor();
  const missing = makeObject(Date.parse('2026-10-15T05:35:00.000Z'), { rand: 'nosuch000001' });
  const kept = makeObject(Date.parse('2026-10-15T05:40:00.000Z'), { rand: 'keptnosuch01' });
  const secretNote = 'do-not-log-this-body';
  const deps = depsFor(state, [missing, kept], now, logger);
  const origGet = deps.provider.get.bind(deps.provider);
  deps.provider.get = async (key) => {
    if (key === missing.key) {
      const error = new Error(`The specified key does not exist. ${secretNote}`);
      error.code = 'NoSuchKey';
      error.statusCode = 404;
      throw error;
    }
    return origGet(key);
  };
  const result = await rollup.run(deps);
  assert.equal(result.success, true);
  assert.equal(result.processed, 1);
  assert.equal(state.views, 1);
  assert.equal(state.ingested.has(kept.key), true);
  assert.equal(state.ingested.has(missing.key), false);
  assert.ok(logger.lines.every((line) => !line.includes('code=ERROR')));
  assert.ok(logger.lines.every((line) => !line.includes('NoSuchKey')));
  assert.ok(logger.lines.every((line) => !line.includes(secretNote)));
  const skips = logger.logs.filter((line) => line.startsWith('SKIP analytics-rollup-5m '));
  assert.equal(skips.length, 1);
  assert.match(skips[0], /^SKIP analytics-rollup-5m step=read window=\S+ code=NOSUCHKEY key=/);
  assert.ok(skips[0].includes(missing.key));
  assert.equal(skips[0].includes(secretNote), false);
  assert.equal(skips[0].includes('\n'), false);
  assert.equal(logger.logs.filter((line) => line.startsWith('HEARTBEAT analytics-rollup-5m ')).length, 1);

  const again = loggerFor();
  const againDeps = depsFor(state, [missing, kept], now, again);
  const againGet = againDeps.provider.get.bind(againDeps.provider);
  againDeps.provider.get = async (key) => {
    if (key === missing.key) {
      const error = new Error(`The specified key does not exist. ${secretNote}`);
      error.code = 'NoSuchKey';
      error.statusCode = 404;
      throw error;
    }
    return againGet(key);
  };
  const second = await rollup.run(againDeps);
  assert.equal(second.success, true);
  assert.equal(second.processed, 0);
  assert.equal(state.views, 1);
  assert.equal(again.logs.filter((line) => line.includes('code=NOSUCHKEY')).length, 1);
  assert.ok(again.lines.every((line) => !line.includes('code=ERROR')));

  const broken = makeState(Date.parse('2026-10-15T05:30:00.000Z'));
  const brokenLogger = loggerFor();
  const brokenDeps = depsFor(broken, [kept], now, brokenLogger);
  brokenDeps.provider.get = async () => {
    const error = new Error('socket hang up');
    error.code = 'ECONNRESET';
    throw error;
  };
  const failed = await rollup.run(brokenDeps);
  assert.equal(failed.success, false);
  assert.equal(failed.code, 'ECONNRESET');
  assert.match(brokenLogger.lines[0], /code=ECONNRESET /);
  assert.equal(brokenLogger.logs.filter((line) => line.startsWith('HEARTBEAT ')).length, 0);
  assert.equal(brokenLogger.logs.filter((line) => line.includes('NOSUCHKEY')).length, 0);
});

test('a rollup run never executes CREATE', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const state = makeState(now - 20 * 60 * 1000);
  const logger = loggerFor();
  const obj = makeObject(now - 10 * 60 * 1000, { rand: 'nocreate0001' });
  const huge = makeObject(now - 15 * 60 * 1000, { rand: 'nocreatehuge', size: rollup.OBJECT_MAX_BYTES + 1 });
  const deps = depsFor(state, [obj, huge], now, logger);
  const result = await rollup.run(deps);
  assert.equal(result.success, true);
  assert.ok(deps.executed.length > 0);
  assert.ok(deps.executed.some((sql) => sql.includes("reason = 'object_too_large' AND status = 'active'")));
  assert.ok(deps.executed.some((sql) => sql.includes("'object_too_large'") && sql.includes("'active'")));
  for (const sql of deps.executed) assert.doesNotMatch(sql, /\bCREATE\b/i);

  const old = makeState(now - 72 * 60 * 60 * 1000);
  const oldDeps = depsFor(old, [], now, loggerFor());
  const oldResult = await rollup.run(oldDeps);
  assert.equal(oldResult.success, true);
  assert.ok(oldDeps.executed.some((sql) => sql.includes("'over_48h'") && sql.includes("'active'")));
  for (const sql of oldDeps.executed) assert.doesNotMatch(sql, /\bCREATE\b/i);

  const missing = makeState(now - 20 * 60 * 1000);
  missing.missingTables = ['site_analytics_rollup_watermark', 'site_analytics_rollup_gaps'];
  const missingDeps = depsFor(missing, [obj], now, loggerFor());
  const missingResult = await rollup.run(missingDeps);
  assert.equal(missingResult.success, false);
  assert.ok(missingDeps.executed.length > 0);
  for (const sql of missingDeps.executed) assert.doesNotMatch(sql, /\bCREATE\b/i);
});

test('a missing rollup table alerts CONFIG_MISSING and does not move the watermark', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const stored = now - 20 * 60 * 1000;
  const line = 'ALERT analytics-rollup-5m step=tables window=- code=CONFIG_MISSING';
  const cases = [
    ['site_analytics_rollup_watermark'],
    ['site_analytics_rollup_gaps'],
    ['site_analytics_rollup_watermark', 'site_analytics_rollup_gaps']
  ];
  for (const names of cases) {
    const state = makeState(stored);
    state.missingTables = names;
    const logger = loggerFor();
    const obj = makeObject(now - 10 * 60 * 1000, { rand: 'missingtbl01' });
    const deps = depsFor(state, [obj], now, logger);
    const result = await rollup.run(deps);
    assert.equal(result.success, false);
    assert.equal(result.step, 'tables');
    assert.equal(result.code, 'CONFIG_MISSING');
    assert.deepEqual(result.missing, names);
    assert.deepEqual(result.alerts, [line]);
    assert.deepEqual(logger.lines, [line]);
    assert.equal(logger.logs.filter((item) => item.includes('HEARTBEAT')).length, 0);
    assert.equal(deps.provider.lists.length, 0);
    assert.equal(deps.provider.gets.length, 0);
    assert.equal(state.watermark, stored);
    assert.equal(state.views, 0);
    assert.equal(state.gaps.length, 0);
  }

  const present = makeState(stored);
  const presentLogger = loggerFor();
  const presentObj = makeObject(now - 10 * 60 * 1000, { rand: 'presenttbl01' });
  const presentDeps = depsFor(present, [presentObj], now, presentLogger);
  const presentResult = await rollup.run(presentDeps);
  assert.equal(presentResult.success, true);
  assert.equal(presentResult.processed, 1);
  assert.ok(present.watermark > stored);
  assert.equal(presentLogger.logs.filter((item) => item.startsWith('HEARTBEAT analytics-rollup-5m ')).length, 1);
  assert.ok(presentLogger.lines.every((item) => !item.includes('CONFIG_MISSING')));

  const denied = makeState(stored);
  const deniedLogger = loggerFor();
  const deniedDeps = depsFor(denied, [], now, deniedLogger);
  deniedDeps.query = async (sql, params) => {
    if (String(sql).startsWith('SELECT 1 FROM site_analytics_rollup_watermark')) {
      const error = new Error('denied');
      error.code = 'ER_TABLEACCESS_DENIED_ERROR';
      error.errno = 1142;
      throw error;
    }
    return depsFor(denied, [], now, deniedLogger).query(sql, params);
  };
  const deniedResult = await rollup.run(deniedDeps);
  assert.equal(deniedResult.success, false);
  assert.equal(deniedResult.code, 'ER_TABLEACCESS_DENIED_ERROR');
  assert.match(deniedLogger.lines[0], /^ALERT analytics-rollup-5m step=check-tables window=\S+ code=ER_TABLEACCESS_DENIED_ERROR /);
  assert.equal(deniedLogger.logs.filter((item) => item.includes('HEARTBEAT')).length, 0);
  assert.equal(denied.watermark, stored);
});

test('only failure codes use the ALERT prefix', async () => {
  const failure = /^(STALE_WATERMARK|CONFIG_MISSING|ER_LOCK_DEADLOCK|GAP_OVER_48H|OBJECT_TOO_LARGE|BACKLOG_OVER_CAP|TIME_BUDGET|ECONNRESET|ER_TABLEACCESS_DENIED_ERROR)$/;
  const seen = new Set();
  function check(logger, result) {
    for (const line of logger.lines) {
      assert.match(line, /^ALERT analytics-rollup-5m step=\S+ window=\S+ code=[A-Za-z0-9_.-]+/);
      const code = line.match(/code=([A-Za-z0-9_.-]+)/)[1];
      assert.match(code, failure);
      seen.add(code);
    }
    for (const line of logger.logs) {
      assert.equal(line.startsWith('ALERT '), false);
      if (line.includes('code=LATE_OBJECT')) {
        assert.match(line, /^INFO analytics-rollup-5m step=ingest window=\S+ code=LATE_OBJECT key=/);
      }
      if (line.includes('code=NOSUCHKEY')) {
        assert.match(line, /^SKIP analytics-rollup-5m step=read window=\S+ code=NOSUCHKEY key=/);
      }
    }
    for (const line of [...logger.lines, ...logger.logs, ...((result && result.alerts) || [])]) {
      assert.equal(/^ALERT .*code=LATE_OBJECT/.test(line), false);
      assert.equal(/^ALERT .*code=NOSUCHKEY/.test(line), false);
      if (line.startsWith('HEARTBEAT ')) assert.equal(line.startsWith('ALERT'), false);
    }
    if (result && result.alerts) {
      assert.ok(result.alerts.every((line) => line.startsWith('ALERT analytics-rollup-5m ')));
    }
  }

  const now = Date.parse('2026-10-15T06:15:00.000Z');
  const staleLogger = loggerFor();
  const stale = await rollup.run(depsFor(makeState(now - rollup.STALE_WATERMARK_MS - 60 * 1000), [], now, staleLogger));
  check(staleLogger, stale);

  const missingState = makeState(now - 10 * 60 * 1000);
  missingState.missingTables = ['site_analytics_rollup_gaps'];
  const missingLogger = loggerFor();
  const missing = await rollup.run(depsFor(missingState, [], now, missingLogger));
  assert.equal(missingLogger.lines[0], 'ALERT analytics-rollup-5m step=tables window=- code=CONFIG_MISSING');
  check(missingLogger, missing);

  const deadState = makeState(now - 20 * 60 * 1000);
  deadState.failCommit = true;
  deadState.failErrno = 1213;
  deadState.failSqlState = '40001';
  const deadLogger = loggerFor();
  const deadObj = makeObject(now - 10 * 60 * 1000, { rand: 'alertfail001' });
  const dead = await rollup.run(depsFor(deadState, [deadObj], now, deadLogger));
  check(deadLogger, dead);

  const lateLogger = loggerFor();
  const lateObj = makeObject(Date.parse('2026-10-15T06:05:00.000Z'), { rand: 'alertlate001' });
  const late = await rollup.run(depsFor(makeState(Date.parse('2026-10-15T06:10:00.000Z')), [lateObj], now, lateLogger));
  assert.equal(late.success, true);
  assert.ok(lateLogger.logs.some((line) => line.startsWith('INFO analytics-rollup-5m ') && line.includes('code=LATE_OBJECT')));
  assert.ok((late.alerts || []).every((line) => !line.includes('LATE_OBJECT')));
  check(lateLogger, late);

  const skipLogger = loggerFor();
  const missingObj = makeObject(Date.parse('2026-10-15T06:00:00.000Z'), { rand: 'alertskip001' });
  const skipDeps = depsFor(makeState(Date.parse('2026-10-15T05:50:00.000Z')), [missingObj], now, skipLogger);
  skipDeps.provider.get = async () => {
    const error = new Error('gone');
    error.code = 'NoSuchKey';
    throw error;
  };
  const skipped = await rollup.run(skipDeps);
  assert.equal(skipped.success, true);
  assert.ok(skipLogger.logs.some((line) => line.startsWith('SKIP analytics-rollup-5m ') && line.includes('code=NOSUCHKEY')));
  check(skipLogger, skipped);

  const hugeLogger = loggerFor();
  const huge = makeObject(now - 10 * 60 * 1000, { rand: 'alerthuge001', size: rollup.OBJECT_MAX_BYTES + 1 });
  const hugeResult = await rollup.run(depsFor(makeState(now - 20 * 60 * 1000), [huge], now, hugeLogger));
  check(hugeLogger, hugeResult);

  const formatted = rollup.formatInfo({
    step: 'ingest',
    window: '2026-10-15T06:00:00.000Z/2026-10-15T06:05:00.000Z',
    code: 'LATE_OBJECT',
    key: lateObj.key
  });
  assert.match(formatted, /^INFO analytics-rollup-5m step=ingest window=\S+ code=LATE_OBJECT key=/);
  assert.equal(formatted.startsWith('ALERT'), false);

  assert.ok(seen.has('STALE_WATERMARK'));
  assert.ok(seen.has('CONFIG_MISSING'));
  assert.ok(seen.has('ER_LOCK_DEADLOCK'));
  assert.ok(seen.has('OBJECT_TOO_LARGE'));
  assert.equal(seen.has('LATE_OBJECT'), false);
  assert.equal(seen.has('NOSUCHKEY'), false);
});

const LEGACY_ROLLUP_WARNING = 'analytics-rollup-5m watermark disabled; using legacy rollup';

test('watermark rollup is off unless ANALYTICS_ROLLUP_WATERMARK_ENABLED is exactly 1', async () => {
  assert.equal(LEGACY_ROLLUP_WARNING.startsWith('ALERT'), false);
  const prevFlag = process.env.ANALYTICS_ROLLUP_WATERMARK_ENABLED;
  const prevEnabled = process.env.ANALYTICS_RAW_ENABLED;
  const prevBucket = process.env.ANALYTICS_RAW_BUCKET_ID;
  const prevQuery = dbDouble.query;
  const prevTx = dbDouble.transaction;
  const prevFactory = legacyProviderFactory;
  const sql = [];
  const watermarkSql = [];
  const objects = [makeObject(Date.now(), { websiteId: 'SITE0001', rand: 'legacy000001' })];
  legacyProviderFactory = () => ({
    async list(prefix) {
      return objects
        .filter((obj) => obj.key.startsWith(prefix))
        .map((obj) => ({ key: obj.key, size: obj.size }));
    },
    async get(key) {
      const obj = objects.find((item) => item.key === key);
      if (!obj) throw new Error('missing object');
      return obj.body;
    }
  });
  dbDouble.query = async (statement, params) => {
    sql.push(String(statement));
    if (String(statement).includes('FROM websites')) {
      return (params || []).map((website_id) => ({ website_id }));
    }
    return [];
  };
  dbDouble.transaction = async (cb) => cb({
    query: async (statement) => {
      sql.push(String(statement));
      return [{ affectedRows: 1 }, []];
    }
  });
  rollup.setDeps({
    now: Date.now(),
    logger: loggerFor(),
    query: async (statement) => {
      watermarkSql.push(String(statement));
      return [];
    },
    transaction: async () => {
      watermarkSql.push('TRANSACTION');
      throw new Error('watermark transaction');
    },
    withConnection: async () => {
      watermarkSql.push('LOCK');
      throw new Error('watermark lock');
    },
    provider: {
      async list() {
        watermarkSql.push('LIST');
        return [];
      },
      async get() {
        watermarkSql.push('GET');
        throw new Error('watermark get');
      }
    }
  });
  const event = {
    Type: 'Timer',
    TriggerName: 'analytics-rollup-5m',
    Time: new Date().toISOString()
  };
  const offValues = [undefined, '0', 'true', ' 1'];
  try {
    const before = logGuard.lines.length;
    for (const flag of offValues) {
      if (flag === undefined) delete process.env.ANALYTICS_ROLLUP_WATERMARK_ENABLED;
      else process.env.ANALYTICS_ROLLUP_WATERMARK_ENABLED = flag;
      process.env.ANALYTICS_RAW_ENABLED = '1';
      process.env.ANALYTICS_RAW_BUCKET_ID = '7';
      sql.length = 0;
      watermarkSql.length = 0;
      const response = await websiteApi.main(event);
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.success, true, `flag ${JSON.stringify(flag)} body ${response.body}`);
      assert.equal(body.processed, 1);
      assert.equal(body.rollups.daily, 1);
      assert.equal(Object.hasOwn(body, 'watermark'), false);
      assert.ok(sql.some((statement) => statement.includes('INSERT INTO site_daily_stats')));
      assert.ok(sql.some((statement) => statement.includes('INSERT IGNORE INTO site_analytics_ingested_events')));
      assert.equal(sql.some((statement) => statement.includes('site_analytics_rollup_')), false);
      assert.equal(sql.some((statement) => /GET_LOCK|RELEASE_LOCK/.test(statement)), false);
      assert.equal(watermarkSql.length, 0);
    }
    const produced = logGuard.lines.slice(before);
    const warnings = produced.filter((line) => line.method === 'warn' && line.text === LEGACY_ROLLUP_WARNING);
    assert.equal(warnings.length, 1);
    assert.equal(produced.filter((line) => line.text.startsWith('ALERT')).length, 0);
    assert.equal(produced.some((line) => line.text.includes('ALERT analytics-rollup-5m')), false);

    process.env.ANALYTICS_ROLLUP_WATERMARK_ENABLED = '1';
    process.env.ANALYTICS_RAW_ENABLED = '1';
    process.env.ANALYTICS_RAW_BUCKET_ID = '7';
    const now = Date.parse('2026-10-15T06:00:00.000Z');
    const state = makeState(null);
    const logger = loggerFor();
    const deps = depsFor(state, [], now, logger);
    rollup.setDeps(deps);
    const onResponse = await websiteApi.main({
      Type: 'Timer',
      TriggerName: 'analytics-rollup-5m',
      Time: new Date(now).toISOString()
    });
    const onBody = JSON.parse(onResponse.body);
    assert.equal(onBody.success, true);
    assert.equal(typeof onBody.watermark, 'number');
    assert.ok(deps.executed.some((statement) => statement.includes('site_analytics_rollup_watermark')));
    assert.ok(deps.executed.some((statement) => statement.includes('site_analytics_rollup_gaps')));
    const warningsAfterOn = logGuard.lines.slice(before).filter((line) => line.text === LEGACY_ROLLUP_WARNING);
    assert.equal(warningsAfterOn.length, 1);
  } finally {
    rollup.setDeps(null);
    dbDouble.query = prevQuery;
    dbDouble.transaction = prevTx;
    legacyProviderFactory = prevFactory;
    if (prevFlag == null) delete process.env.ANALYTICS_ROLLUP_WATERMARK_ENABLED;
    else process.env.ANALYTICS_ROLLUP_WATERMARK_ENABLED = prevFlag;
    if (prevEnabled == null) delete process.env.ANALYTICS_RAW_ENABLED;
    else process.env.ANALYTICS_RAW_ENABLED = prevEnabled;
    if (prevBucket == null) delete process.env.ANALYTICS_RAW_BUCKET_ID;
    else process.env.ANALYTICS_RAW_BUCKET_ID = prevBucket;
  }
});

test('rollup logs do not contain secrets or object contents', () => {
  logGuard.assertNoLeaks();
});
