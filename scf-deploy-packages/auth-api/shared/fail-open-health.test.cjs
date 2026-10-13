const test = require('node:test');
const assert = require('node:assert/strict');
const { checkKeyValid, createFailOpenCounter } = require('./fail-open-health.cjs');

const KEY = 'k-' + require('crypto').randomBytes(16).toString('hex');

test('key: rejects when env unset', () => {
  assert.equal(checkKeyValid({ 'X-Demox-Check-Key': KEY }, {}), false);
  assert.equal(checkKeyValid({ 'X-Demox-Check-Key': '' }, { FAIL_OPEN_CHECK_KEY: '' }), false);
});
test('key: match is case-insensitive on header name, exact on value', () => {
  const env = { FAIL_OPEN_CHECK_KEY: KEY };
  assert.equal(checkKeyValid({ 'x-demox-check-key': KEY }, env), true);
  assert.equal(checkKeyValid({ 'X-Demox-Check-Key': KEY }, env), true);
  assert.equal(checkKeyValid({ 'X-Demox-Check-Key': KEY + 'x' }, env), false);
  assert.equal(checkKeyValid({ 'X-Demox-Check-Key': 'short' }, env), false);
  assert.equal(checkKeyValid({}, env), false);
  assert.equal(checkKeyValid(undefined, env), false);
});
test('counter: queries 24h window, caches success 60s', async () => {
  let t = 1_000_000_000, calls = [];
  const c = createFailOpenCounter({ now: () => t, query: async (sql, p) => { calls.push([sql, p]); return [{ n: 3 }]; } });
  assert.equal(await c(), 3);
  assert.match(calls[0][0], /COUNT\(\*\).*login_throttle_fail_open.*created_at_ms >= \?/);
  assert.deepEqual(calls[0][1], [t - 86400000]);
  t += 59_000; assert.equal(await c(), 3); assert.equal(calls.length, 1);
  t += 2_000; assert.equal(await c(), 3); assert.equal(calls.length, 2);
});
test('counter: DB error -> null (never 0), not cached', async () => {
  let fail = true, n = 0;
  const c = createFailOpenCounter({ query: async () => { n++; if (fail) throw new Error('ECONNREFUSED'); return [{ n: 0 }]; } });
  assert.equal(await c(), null);
  fail = false;
  assert.equal(await c(), 0);
  assert.equal(n, 2);
});
test('counter: garbage row -> null', async () => {
  const c = createFailOpenCounter({ query: async () => [] });
  assert.equal(await c(), null);
});
