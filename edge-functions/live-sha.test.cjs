'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const routerPath = path.join(__dirname, 'subdomain-router.js');
const source = fs.readFileSync(routerPath);
const text = source.toString('utf8');

// 2026-11-03 11:42 云帆把 3165903e 写入 ef-1281msyw，p0 22/22。
// LIVE.sha256 和 fixtures/live-subdomain-router.3165903e.js 就是这份已发布正文。
// 回滚目标仍是 fixtures/live-subdomain-router.9f6e3057.js，不要把它写进 LIVE.sha256。
const PUBLISHED_EDGE_SHA256 = '3165903e47815a186479cf84b7a786c2af9e7b8c3f1cd942cb9d416369f37b90';

test('LIVE.sha256 is the published edge body and matches the repo router', () => {
  const published = fs.readFileSync(path.join(__dirname, 'LIVE.sha256'), 'utf8').trim();
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/live-subdomain-router.3165903e.js'));
  const rollback = fs.readFileSync(path.join(__dirname, 'fixtures/live-subdomain-router.9f6e3057.js'));
  const actual = crypto.createHash('sha256').update(source).digest('hex');
  assert.equal(published, PUBLISHED_EDGE_SHA256);
  assert.equal(actual, published);
  assert.equal(crypto.createHash('sha256').update(fixture).digest('hex'), published);
  assert.equal(crypto.createHash('sha256').update(rollback).digest('hex'), '9f6e3057b4010c1ad51c3b0d8dadbcae51988ae46eec3b7045e7b7d600eca7b3');
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
