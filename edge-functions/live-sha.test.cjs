'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const routerPath = path.join(__dirname, 'subdomain-router.js');
const source = fs.readFileSync(routerPath);
const text = source.toString('utf8');

// REQ-27 已写上 ef-1281msyw。LIVE.sha256 就是这份已发布正文，和仓库里的 subdomain-router.js 是同一份字节。
const PUBLISHED_EDGE_SHA256 = '9f6e3057b4010c1ad51c3b0d8dadbcae51988ae46eec3b7045e7b7d600eca7b3';

test('LIVE.sha256 is the published edge body and matches the repo router', () => {
  const published = fs.readFileSync(path.join(__dirname, 'LIVE.sha256'), 'utf8').trim();
  const actual = crypto.createHash('sha256').update(source).digest('hex');
  assert.equal(published, PUBLISHED_EDGE_SHA256);
  assert.equal(actual, published);
});

test('repo router keeps published cache prefixes and judges origin paths by site id', () => {
  assert.match(text, /var RESOLVE_CACHE_PREFIX = 'https:\/\/resolve\.demox\.site\/v2\/';/);
  assert.match(text, /var RESOLVE_LEGACY_CACHE_PREFIX = 'https:\/\/resolve\.demox\.site\/';/);
  assert.match(text, /var OFFICIAL_DOMAINS = \['demox\.site'\];/);
  assert.equal(text.includes("var ORIGIN_GUARD_HOSTS = ['sites.demox.site'];"), true);
  assert.equal(text.includes('site-\\d+|sites-[a-z0-9-]+|origin-[a-z0-9-]+'), true);
  assert.equal(text.includes('async function resolveSiteById'), true);
  assert.equal(text.includes('async function handleOriginGuard'), true);
  assert.equal(text.includes('staleIfError: false'), true);
});
