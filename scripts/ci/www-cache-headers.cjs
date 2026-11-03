#!/usr/bin/env node
'use strict';

/**
 * www 发布并刷新缓存之后，核对线上响应头。
 * 比较的是 Cache-Control 指令集合，不是整串：按逗号拆开、去空格、转小写。
 * /assets/*.js 必须正好是 public + immutable + max-age=31536000，不能有 no-store 或 private。
 * index.html 必须是短缓存（max-age≤60，或带 no-cache），不能带 immutable。
 *
 * 只请求公开的 https://www.demox.site，不读密钥。
 */

const https = require('https');

const ORIGIN = (process.env.WWW_CACHE_CHECK_ORIGIN || 'https://www.demox.site').replace(/\/+$/, '');
const INDEX_PATH = '/index.html';

function parseCacheControl(value) {
  const flags = new Set();
  const params = new Map();
  for (const part of String(value || '').split(',')) {
    const text = part.trim().toLowerCase();
    if (!text) continue;
    const eq = text.indexOf('=');
    if (eq === -1) {
      flags.add(text);
      continue;
    }
    const key = text.slice(0, eq).trim();
    const raw = text.slice(eq + 1).trim();
    params.set(key, key === 'max-age' && /^\d+$/.test(raw) ? String(Number(raw)) : raw);
  }
  return { flags, params };
}

function isShortEntryCache(value) {
  const parsed = parseCacheControl(value);
  if (parsed.flags.has('immutable')) return false;
  if (parsed.flags.has('no-cache')) return true;
  const age = parsed.params.get('max-age');
  if (age == null || !/^\d+$/.test(age)) return false;
  const seconds = Number(age);
  return seconds <= 60;
}

function isImmutableYear(value) {
  const parsed = parseCacheControl(value);
  if (parsed.flags.has('no-store') || parsed.flags.has('private')) return false;
  if (parsed.flags.size !== 2 || !parsed.flags.has('public') || !parsed.flags.has('immutable')) return false;
  if (parsed.params.size !== 1 || parsed.params.get('max-age') !== '31536000') return false;
  return true;
}

function hashedAssetPath(html) {
  const match = String(html || '').match(/\/assets\/[A-Za-z0-9._-]+\.js/);
  return match ? match[0] : '';
}

function headerValue(headers, name) {
  const value = headers[name] || headers[name.toLowerCase()] || '';
  return Array.isArray(value) ? value.join(', ') : String(value);
}

function fetchUrl(url, redirectsLeft) {
  const left = redirectsLeft == null ? 3 : redirectsLeft;
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        Accept: 'text/html,application/javascript,*/*',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location && left > 0) {
          const next = new URL(res.headers.location, url).toString();
          fetchUrl(next, left - 1).then(resolve, reject);
          return;
        }
        resolve({
          status,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          url
        });
      });
    });
    req.setTimeout(20000, () => {
      req.destroy(new Error('timeout ' + url));
    });
    req.on('error', reject);
  });
}

async function checkWwwCacheHeaders(fetchImpl) {
  const load = fetchImpl || fetchUrl;
  const indexUrl = ORIGIN + INDEX_PATH;
  const home = await load(indexUrl);
  if (home.status !== 200) {
    throw new Error(indexUrl + ' status ' + home.status);
  }
  const htmlCache = headerValue(home.headers, 'cache-control');
  if (!isShortEntryCache(htmlCache)) {
    throw new Error('index.html Cache-Control is not a short policy: ' + htmlCache);
  }
  const assetPath = hashedAssetPath(home.body);
  if (!assetPath) throw new Error('index.html has no /assets/*.js');
  const assetUrl = new URL(assetPath, ORIGIN + '/').toString();
  const asset = await load(assetUrl);
  if (asset.status !== 200) throw new Error(assetUrl + ' status ' + asset.status);
  const assetCache = headerValue(asset.headers, 'cache-control');
  if (!isImmutableYear(assetCache)) {
    throw new Error(assetPath + ' Cache-Control is not public immutable max-age=31536000: ' + assetCache);
  }
  return { indexUrl, htmlCache, assetUrl, assetCache };
}

async function main() {
  const result = await checkWwwCacheHeaders();
  console.log('www cache headers ok');
  console.log('index.html ' + result.htmlCache);
  console.log(result.assetUrl + ' ' + result.assetCache);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  parseCacheControl,
  isShortEntryCache,
  isImmutableYear,
  hashedAssetPath,
  checkWwwCacheHeaders
};
