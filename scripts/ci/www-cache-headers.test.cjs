'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isShortEntryCache,
  isImmutableYear,
  hashedAssetPath,
  checkWwwCacheHeaders
} = require('./www-cache-headers.cjs');

test('index.html accepts max-age<=60 or no-cache, and rejects immutable', () => {
  assert.equal(isShortEntryCache('public, max-age=60'), true);
  assert.equal(isShortEntryCache('max-age=0'), true);
  assert.equal(isShortEntryCache('no-cache'), true);
  assert.equal(isShortEntryCache('public, no-cache, max-age=60'), true);
  assert.equal(isShortEntryCache('public, max-age=61'), false);
  assert.equal(isShortEntryCache('public, max-age=60, immutable'), false);
  assert.equal(isShortEntryCache('public, max-age=31536000, immutable'), false);
  assert.equal(isShortEntryCache('no-store'), false);
  assert.equal(isShortEntryCache(''), false);
});

test('asset cache is a directive set: order and spacing do not matter', () => {
  assert.equal(isImmutableYear('public, max-age=31536000, immutable'), true);
  assert.equal(isImmutableYear('immutable, public, max-age=31536000'), true);
  assert.equal(isImmutableYear('  Public,  Immutable, max-age=31536000 '), true);
  assert.equal(isImmutableYear('public,max-age=31536000,immutable'), true);
  assert.equal(isImmutableYear('public, max-age=60'), false);
  assert.equal(isImmutableYear('public, max-age=60, immutable'), false);
  assert.equal(isImmutableYear('max-age=31536000, immutable'), false);
  assert.equal(isImmutableYear('public, max-age=31536000, immutable, no-store'), false);
  assert.equal(isImmutableYear('private, max-age=31536000, immutable'), false);
  assert.equal(isImmutableYear('public, max-age=31536000, immutable, must-revalidate'), false);
});

test('hashed asset path is the first /assets/*.js in the html', () => {
  const html = '<script type="module" src="/assets/index-DxCBZomZ.js"></script>';
  assert.equal(hashedAssetPath(html), '/assets/index-DxCBZomZ.js');
  assert.equal(hashedAssetPath('<html></html>'), '');
});

test('checkWwwCacheHeaders rejects a reordered asset header that is private or no-store', async () => {
  const html = '<script src="/assets/index-DxCBZomZ.js"></script>';
  await assert.rejects(() => checkWwwCacheHeaders(async (url) => {
    if (url.endsWith('/index.html')) {
      return { status: 200, headers: { 'cache-control': 'public, max-age=60' }, body: html };
    }
    return { status: 200, headers: { 'cache-control': 'immutable, private, max-age=31536000' }, body: 'js' };
  }), /no-store|private|31536000/);
});

test('checkWwwCacheHeaders accepts a short index and a reordered immutable asset', async () => {
  const html = '<script src="/assets/index-DxCBZomZ.js"></script>';
  const result = await checkWwwCacheHeaders(async (url) => {
    if (url.endsWith('/index.html')) {
      return { status: 200, headers: { 'cache-control': 'max-age=60, public' }, body: html };
    }
    assert.equal(url, 'https://www.demox.site/assets/index-DxCBZomZ.js');
    return {
      status: 200,
      headers: { 'cache-control': 'immutable, max-age=31536000, public' },
      body: 'js'
    };
  });
  assert.equal(result.htmlCache, 'max-age=60, public');
  assert.equal(result.assetCache, 'immutable, max-age=31536000, public');
});
