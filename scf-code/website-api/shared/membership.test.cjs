const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRoleIds,
  effectiveRoleIds,
  membershipSummary,
  computeProExpiry,
  resolveGrantExpiry,
  DEFAULT_PRO_DAYS
} = require('./membership.js');

test('expired pro is stripped from effective roles', () => {
  const now = new Date('2026-08-25T00:00:00Z');
  assert.deepEqual(
    effectiveRoleIds(['user', 'pro'], '2026-08-01T00:00:00Z', now),
    ['user']
  );
  assert.deepEqual(
    effectiveRoleIds(['user', 'pro', 'admin'], '2026-08-01T00:00:00Z', now),
    ['user', 'admin']
  );
});

test('lifetime and future expiry keep pro', () => {
  const now = new Date('2026-08-25T00:00:00Z');
  assert.deepEqual(effectiveRoleIds(['user', 'pro'], null, now), ['user', 'pro']);
  assert.deepEqual(effectiveRoleIds(['user', 'pro'], '2026-09-01T00:00:00Z', now), ['user', 'pro']);
});

test('renewal starts from remaining expiry', () => {
  const now = new Date('2026-08-25T00:00:00Z');
  const next = computeProExpiry({
    currentExpiresAt: '2026-09-01T00:00:00Z',
    days: 30,
    now
  });
  assert.equal(next.toISOString(), '2026-10-01T00:00:00.000Z');
});

test('expired or new grant starts from now', () => {
  const now = new Date('2026-08-25T00:00:00Z');
  const fromExpired = computeProExpiry({
    currentExpiresAt: '2026-08-01T00:00:00Z',
    days: 30,
    now
  });
  const fresh = computeProExpiry({ days: 30, now });
  assert.equal(fromExpired.toISOString(), '2026-09-24T00:00:00.000Z');
  assert.equal(fresh.toISOString(), '2026-09-24T00:00:00.000Z');
});

test('new pro grant defaults to 30 days; existing grant keeps expiry', () => {
  const now = new Date('2026-08-25T00:00:00Z');
  const created = resolveGrantExpiry({ hasPro: false, now });
  assert.equal(created.toISOString(), computeProExpiry({ days: DEFAULT_PRO_DAYS, now }).toISOString());
  const kept = resolveGrantExpiry({
    hasPro: true,
    currentExpiresAt: '2026-12-01T00:00:00Z',
    now
  });
  assert.equal(kept.toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(resolveGrantExpiry({ hasPro: true, proLifetime: true, now }), null);
});

test('membership summary reports leftover days', () => {
  const now = new Date('2026-08-25T00:00:00Z');
  const active = membershipSummary(['user', 'pro'], '2026-08-27T12:00:00Z', now);
  assert.equal(active.hasPro, true);
  assert.equal(active.remainingDays, 3);
  assert.equal(active.proLifetime, false);
  const expired = membershipSummary(['user', 'pro'], '2026-08-01T00:00:00Z', now);
  assert.equal(expired.hasPro, false);
  assert.equal(expired.proExpired, true);
  assert.deepEqual(expired.effectiveRoles, ['user']);
});

test('parseRoleIds normalizes JSON and case', () => {
  assert.deepEqual(parseRoleIds('["PRO","user"]'), ['pro', 'user']);
});
