const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const logGuard = require('../../scripts/log-leak-guard.cjs').installLogLeakGuard();

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

const dbModulePath = require.resolve('./shared/db.js');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: {
    query: async () => [],
    transaction: async (cb) => cb({ query: async () => [{ affectedRows: 0 }, []] })
  }
};

const websiteApi = require('./index.js');
const rollup = websiteApi._analyticsRollupForTest;

function loggerFor() {
  const lines = [];
  return {
    lines,
    error(line) {
      const text = String(line);
      lines.push(text);
      console.error(text);
    }
  };
}

function makeState(watermark) {
  return {
    watermark: watermark == null ? null : watermark,
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
  if (sql.includes('SELECT watermark_ms FROM site_analytics_rollup_watermark')) {
    return state.watermark == null ? [] : [{ watermark_ms: state.watermark }];
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
    now,
    logger,
    query: async (sql, params) => applySql(state, sql, params),
    transaction: async (cb) => {
      if (state.failCommit) {
        const error = new Error(state.failMessage);
        error.code = 'ER_LOCK_DEADLOCK';
        throw error;
      }
      return cb({
        query: async (sql, params) => [applySql(state, sql, params), []]
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

test('migration 024 creates the watermark and gap tables and documents 暂定', () => {
  const dir = path.join(__dirname, 'migrations');
  const file = path.join(dir, '024_add_analytics_rollup_watermark.sql');
  const sql = fs.readFileSync(file, 'utf8');
  const numbers = fs.readdirSync(dir).filter((name) => /^\d{3}_.*\.sql$/.test(name)).map((name) => Number(name.slice(0, 3)));
  assert.equal(numbers.filter((n) => n === 24).length, 1);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS site_analytics_rollup_watermark/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS site_analytics_rollup_gaps/);
  assert.match(sql, /over_48h/);
  assert.match(sql, /object_too_large/);
  assert.match(sql, /暂定/);
  assert.match(sql, /watermark_ms < /);
  assert.doesNotMatch(sql, /\bALTER\b/i);
  assert.doesNotMatch(sql, /DROP TABLE (?!site_analytics_rollup_)/);
  const creates = (text) => [...text.matchAll(/CREATE TABLE IF NOT EXISTS[\s\S]*?ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='[^']*'/g)]
    .map((match) => match[0].replace(/\s+/g, ' ').trim());
  assert.deepEqual(creates(rollup.tableDdl.join('\n')), creates(sql.replace(/^--.*$/gm, '')));
  assert.equal(rollup.ALERT_KEYWORD, 'ALERT analytics-rollup-5m');
  assert.equal(rollup.OBJECT_MAX_BYTES, 256 * 1024);
  assert.equal(rollup.LOOKBACK_MS, 48 * 60 * 60 * 1000);
});

test('weekly coverage is provisional when the watermark lags or a gap overlaps the week', () => {
  const weekStart = Date.parse('2026-10-05T00:00:00.000Z');
  const weekEnd = Date.parse('2026-10-12T00:00:00.000Z');
  const { coverage } = rollup;
  assert.equal(coverage({ watermarkMs: weekEnd, gaps: [], weekStartMs: weekStart, weekEndMs: weekEnd }).provisional, false);
  assert.equal(coverage({ watermarkMs: weekEnd, gaps: [], weekStartMs: weekStart, weekEndMs: weekEnd }).reason, 'complete');
  assert.equal(coverage({ watermarkMs: null, gaps: [], weekStartMs: weekStart, weekEndMs: weekEnd }).reason, 'watermark');
  assert.equal(coverage({ watermarkMs: weekEnd - 1, gaps: [], weekStartMs: weekStart, weekEndMs: weekEnd }).provisional, true);
  const gap = coverage({
    watermarkMs: weekEnd,
    gaps: [{ gapStartMs: weekStart + 60_000, gapEndMs: weekStart + 120_000, reason: 'over_48h', objectKey: '' }],
    weekStartMs: weekStart,
    weekEndMs: weekEnd
  });
  assert.equal(gap.provisional, true);
  assert.equal(gap.reason, 'gap');
  const before = coverage({
    watermarkMs: weekEnd,
    gaps: [{ gapStartMs: weekStart - 600_000, gapEndMs: weekStart, reason: 'over_48h', objectKey: '' }],
    weekStartMs: weekStart,
    weekEndMs: weekEnd
  });
  assert.equal(before.provisional, false);
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
  assert.equal(state.watermark, now);
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
  assert.equal(state.watermark, now);
});

test('a 3h stall backfills from the watermark and ignores older objects', async () => {
  const now = Date.parse('2026-10-15T06:00:00.000Z');
  const state = makeState(now - 3 * 60 * 60 * 1000);
  const logger = loggerFor();
  const stale = makeObject(now - 4 * 60 * 60 * 1000, { rand: 'stale0000001' });
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
  assert.equal(state.watermark, now);
  assert.equal(result.gap, null);
  assert.ok(deps.provider.lists.some((prefix) => prefix.includes('hour=03')));
  assert.ok(deps.provider.lists.some((prefix) => prefix.includes('hour=05')));
  assert.ok(deps.provider.lists.every((prefix) => !prefix.includes('hour=02')));
  assert.ok(deps.provider.gets.every((key) => key !== stale.key));
  assert.deepEqual(logger.lines, []);
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
  assert.equal(logger.lines.length, 1);
  assert.match(logger.lines[0], /^ALERT analytics-rollup-5m step=backlog window=\S+ code=BACKLOG_OVER_CAP remaining=500$/);

  deps.provider.gets.length = 0;
  const secondLogger = loggerFor();
  const second = await rollup.run(depsFor(state, objects, now, secondLogger));
  assert.equal(second.success, true);
  assert.equal(second.processed, 500);
  assert.equal(second.backlog, 0);
  assert.equal(state.views, 2500);
  assert.equal(state.watermark, now);
  assert.equal(state.ingested.size, 4500);
  assert.deepEqual(secondLogger.lines, []);
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
  assert.equal(state.watermark, now);
  const coverage = rollup.coverage({
    watermarkMs: state.watermark,
    gaps: state.gaps.map(gapMs),
    weekStartMs: now - 7 * 24 * 60 * 60 * 1000,
    weekEndMs: now
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
  assert.equal(logger.lines.length, 1);
  const gapStart = new Date(now - 72 * 60 * 60 * 1000).toISOString();
  const gapEnd = new Date(now - 48 * 60 * 60 * 1000).toISOString();
  assert.equal(
    logger.lines[0],
    `ALERT analytics-rollup-5m step=gap window=${gapStart}/${gapEnd} code=GAP_OVER_48H`
  );
  assert.equal(state.gaps.length, 1);
  assert.equal(state.gaps[0].reason, 'over_48h');
  assert.equal(state.watermark, now);
  const coverage = rollup.coverage({
    watermarkMs: state.watermark,
    gaps: state.gaps.map(gapMs),
    weekStartMs: now - 80 * 60 * 60 * 1000,
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
  state.failCommit = true;
  state.failMessage = `deadlock admin@demox.site password=supersecret ${'B'.repeat(48)} eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature`;
  const logger = loggerFor();
  const objects = [makeObject(now - 10 * 60 * 1000, { rand: 'fail00000001' })];
  const result = await rollup.run(depsFor(state, objects, now, logger));
  assert.equal(result.success, false);
  assert.equal(result.step, 'commit');
  assert.equal(result.code, 'ER_LOCK_DEADLOCK');
  assert.equal(logger.lines.length, 1);
  assert.match(logger.lines[0], /^ALERT analytics-rollup-5m step=commit window=\S+ code=ER_LOCK_DEADLOCK$/);
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

test('rollup logs do not contain secrets or object contents', () => {
  logGuard.assertNoLeaks();
});
