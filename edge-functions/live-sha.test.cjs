'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const routerPath = path.join(__dirname, 'subdomain-router.js');
const source = fs.readFileSync(routerPath);
const text = source.toString('utf8');

// 2026-10-22 #125 把仓库锁成当时已发布的 ef-1281msyw（不含 K2）。
// LIVE.sha256 继续只记录那份已发布正文，回滚对照用它。
// 仓库里的 subdomain-router.js 现在是 K0–K2 源站守卫，发布核对通过之前不要把新哈希写进 LIVE.sha256。
const PUBLISHED_EDGE_SHA256 = '0e706f11290e265349ec19a65ef8b18629bd22d47e5c6912131461da015a510b';
const REPO_ORIGIN_GUARD_SHA256 = 'e127e9728304aefefb0f3b139825229de59358c7522c411e27e84b6ecc6bb039';

test('LIVE.sha256 stays the last published edge body, separate from the repo origin guard', () => {
  const published = fs.readFileSync(path.join(__dirname, 'LIVE.sha256'), 'utf8').trim();
  const actual = crypto.createHash('sha256').update(source).digest('hex');
  assert.equal(published, PUBLISHED_EDGE_SHA256);
  assert.equal(actual, REPO_ORIGIN_GUARD_SHA256);
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
