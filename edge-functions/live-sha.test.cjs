'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const routerPath = path.join(__dirname, 'subdomain-router.js');
const source = fs.readFileSync(routerPath);
const text = source.toString('utf8');

// 2026-11-04 17:40 云帆把 71a677cf 写入 ef-1281msyw，检查全部通过（#164）。
// LIVE.sha256 和 fixtures/live-subdomain-router.71a677cf.js 就是这份已发布正文。
// 回滚目标是上一份现网正文 fixtures/live-subdomain-router.58bd6b56.js（2026-11-04 16:54 的 AE 热修）。
// 9f6e3057 会把浏览器的 Accept-Encoding 带进回源子请求，www 白屏（curl 92）；fixture 只留作历史，不能当回滚目标。
const PUBLISHED_EDGE_SHA256 = '71a677cfea3ce35ceb4b9a1e5b93993b513aac6d635cc4a1cb536c9a20a45a24';
const ROLLBACK_EDGE_SHA256 = '58bd6b5627462dfadc12091788515a11c28b7abc0cbc654a374804252dafb9b6';

test('LIVE.sha256 is the published edge body and matches the repo router', () => {
  const published = fs.readFileSync(path.join(__dirname, 'LIVE.sha256'), 'utf8').trim();
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/live-subdomain-router.71a677cf.js'));
  const rollback = fs.readFileSync(path.join(__dirname, 'fixtures/live-subdomain-router.58bd6b56.js'));
  const actual = crypto.createHash('sha256').update(source).digest('hex');
  assert.equal(published, PUBLISHED_EDGE_SHA256);
  assert.equal(actual, published);
  assert.equal(crypto.createHash('sha256').update(fixture).digest('hex'), published);
  assert.equal(crypto.createHash('sha256').update(rollback).digest('hex'), ROLLBACK_EDGE_SHA256);
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
