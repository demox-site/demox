const test = require('node:test');
const assert = require('node:assert/strict');
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

const queries = [];
let queryImpl = async (sql) => { throw new Error(`Unexpected query: ${sql}`); };

const dbModulePath = require.resolve('./shared/db.js');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return queryImpl(sql, params);
    },
    transaction: async (callback) => callback({
      query: async (sql, params) => [await queryImpl(sql, params), []]
    })
  }
};

const websiteApi = require('./index.js');
const { main } = websiteApi;

function request(body) {
  return main({
    path: '/website/resolve-subdomain',
    httpMethod: 'POST',
    headers: {},
    body: { action: 'resolve_subdomain', ...body }
  });
}

function row(overrides) {
  return {
    path: 'sites/owner-1/EPX2UU43/dist',
    user_id: 'owner-1',
    website_id: 'EPX2UU43',
    visibility: 'public',
    ...overrides
  };
}

test.beforeEach(() => {
  queries.length = 0;
  queryImpl = async () => { throw new Error('unexpected query'); };
});

test('exact-id resolve of a public site returns only allow and path', async () => {
  queryImpl = async () => [row({})];
  const response = await request({ websiteId: 'EPX2UU43', uid: 'owner-1' });
  const body = JSON.parse(response.body);
  assert.deepEqual(body, { success: true, allow: true, path: 'sites/owner-1/EPX2UU43/dist' });
  assert.equal(Object.hasOwn(body, 'user_id'), false);
  assert.equal(Object.hasOwn(body, 'visibility'), false);
  assert.equal(Object.hasOwn(body, 'origin'), false);
  const sql = queries[0].sql;
  assert.match(sql, /WHERE w\.website_id = \?/);
  assert.equal(sql.includes('EPX2UU43'), false);
  assert.deepEqual(queries[0].params, ['public', 'EPX2UU43']);
  assert.equal(/\b(INSERT|UPDATE|DELETE)\b/i.test(sql), false);
});

test('private, disabled, and owner mismatch are the same public verdict', async () => {
  const blocked = { success: true, allow: false, reason: 'blocked' };
  for (const visibility of ['private', 'disabled']) {
    queries.length = 0;
    queryImpl = async () => [row({ visibility, user_id: 'owner-1' })];
    const body = JSON.parse((await request({ websiteId: 'EPX2UU43', uid: 'owner-1' })).body);
    assert.deepEqual(body, blocked);
    assert.equal(JSON.stringify(body).includes('owner-1'), false);
    assert.equal(JSON.stringify(body).includes(visibility), false);
  }
  queries.length = 0;
  queryImpl = async () => [row({ user_id: 'owner-1', visibility: 'public' })];
  const mismatch = JSON.parse((await request({ websiteId: 'EPX2UU43', uid: 'someone-else' })).body);
  assert.deepEqual(mismatch, blocked);
  assert.equal(JSON.stringify(mismatch).includes('owner-1'), false);
});

test('unknown id is not_found and a missing uid does not reveal the row', async () => {
  queryImpl = async () => [];
  const missing = JSON.parse((await request({ websiteId: 'NOSUCHID', uid: 'owner-1' })).body);
  assert.deepEqual(missing, { success: true, allow: false, reason: 'not_found' });

  queries.length = 0;
  queryImpl = async () => { throw new Error('must not look up without uid'); };
  const noUid = JSON.parse((await request({ websiteId: 'EPX2UU43' })).body);
  assert.deepEqual(noUid, { success: true, allow: false, reason: 'blocked' });
  assert.equal(queries.length, 0);
});

test('malformed ids are parameterized rejects and never interpolated', async () => {
  queryImpl = async () => { throw new Error('must not query'); };
  const evil = "EPX2UU43' OR '1'='1";
  const body = JSON.parse((await request({ websiteId: evil, uid: 'owner-1' })).body);
  assert.deepEqual(body, { success: true, allow: false, reason: 'not_found' });
  assert.equal(queries.length, 0);
});

test('database errors are not cached as not_found and do not echo the query', async () => {
  queryImpl = async () => { throw new Error("SELECT secret FROM websites WHERE website_id = 'EPX2UU43'"); };
  const body = JSON.parse((await request({ websiteId: 'EPX2UU43', uid: 'owner-1' })).body);
  assert.equal(body.success, false);
  assert.equal(body.allow, undefined);
  assert.equal(body.message, 'resolve failed');
  assert.equal(JSON.stringify(body).includes('EPX2UU43'), false);
  assert.equal(JSON.stringify(body).includes('secret'), false);
});

test('payloads without websiteId keep the legacy label lookup', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('information_schema.COLUMNS')) return [];
    if (sql.includes('FROM websites w')) {
      return [row({ website_id: 'WATERMARK1', path: 'sites/owner-1/WATERMARK1/dist' })];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  const body = JSON.parse((await request({ subdomain: 'watermark1', domain: 'demox.site' })).body);
  assert.equal(body.success, true);
  assert.equal(body.websiteId, 'WATERMARK1');
  assert.equal(body.visibility, 'public');
  assert.equal(body.allow, undefined);
  assert.equal(queries.some((q) => /WHERE w\.website_id = \? LIMIT 1/.test(q.sql)), false);
  assert.equal(queries.some((q) => q.sql.includes('w.subdomain = ?') || q.sql.includes('LOWER(w.website_id)')), true);
});

test('a websiteId payload does not fall through to label matching', async () => {
  queryImpl = async (sql) => {
    assert.match(sql, /WHERE w\.website_id = \?/);
    assert.equal(sql.includes('subdomain'), false);
    return [row({})];
  };
  const body = JSON.parse((await request({
    websiteId: 'EPX2UU43',
    uid: 'owner-1',
    subdomain: 'not-the-id',
    domain: 'demox.site'
  })).body);
  assert.deepEqual(body, { success: true, allow: true, path: 'sites/owner-1/EPX2UU43/dist' });
  assert.equal(queries.length, 1);
});

test('no token, JWT, OAuth code or email reached any console log in this suite', () => {
  logGuard.assertNoLeaks();
});
