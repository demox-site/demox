'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const routerPath = path.join(__dirname, 'subdomain-router.js');
const source = fs.readFileSync(routerPath);
const text = source.toString('utf8');

test('live edge router bytes match edge-functions/LIVE.sha256', () => {
  const expected = fs.readFileSync(path.join(__dirname, 'LIVE.sha256'), 'utf8').trim();
  const actual = crypto.createHash('sha256').update(source).digest('hex');
  assert.equal(actual, expected);
  assert.equal(expected, '0e706f11290e265349ec19a65ef8b18629bd22d47e5c6912131461da015a510b');
});

test('live cache prefixes and official domain list stay exactly as published', () => {
  assert.match(text, /var RESOLVE_CACHE_PREFIX = 'https:\/\/resolve\.demox\.site\/v2\/';/);
  assert.match(text, /var RESOLVE_LEGACY_CACHE_PREFIX = 'https:\/\/resolve\.demox\.site\/';/);
  assert.match(text, /var OFFICIAL_DOMAINS = \['demox\.site'\];/);
  assert.equal(text.includes('resolve-k2test.demox.site'), false);
  assert.equal(text.includes('DEMOX_TEST_HOST_MAP'), false);
  assert.equal(text.includes('k2t-'), false);
});
