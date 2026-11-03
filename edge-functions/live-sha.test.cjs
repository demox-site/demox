'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const routerPath = path.join(__dirname, 'subdomain-router.js');
const source = fs.readFileSync(routerPath);
const text = source.toString('utf8');

// ef-1281msyw 上已发布的仍是 9f6e3057。这次只改仓库里的路由正文，
// LIVE.sha256 继续等于那份已发布字节；新正文上线并通过 p0 后再另开 PR 改它。
const PUBLISHED_EDGE_SHA256 = '9f6e3057b4010c1ad51c3b0d8dadbcae51988ae46eec3b7045e7b7d600eca7b3';
const REPO_ROUTER_SHA256 = '3165903e47815a186479cf84b7a786c2af9e7b8c3f1cd942cb9d416369f37b90';

test('LIVE.sha256 stays the published edge body while the repo router is ahead', () => {
  const published = fs.readFileSync(path.join(__dirname, 'LIVE.sha256'), 'utf8').trim();
  const actual = crypto.createHash('sha256').update(source).digest('hex');
  assert.equal(published, PUBLISHED_EDGE_SHA256);
  assert.equal(actual, REPO_ROUTER_SHA256);
  assert.notEqual(actual, published);
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
