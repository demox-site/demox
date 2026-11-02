'use strict';

// Local differential of the edge router.
//   node scripts/edge/preprod-diff.cjs --self-test
//   DEMOX_BANNED_PATH='/sites/<uid>/<id>/dist/index.html' node scripts/edge/preprod-diff.cjs
// The self-test uses a mock origin. Without --self-test, origin fetches go to the live network.
// Signing keys are read from DEMOX_ORIGIN_GUARD_SECRET_A / DEMOX_ORIGIN_GUARD_KID and never printed.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const LIVE_GIT = '4131fb1687ab4874fef739093b9627e03994ac34:edge-functions/subdomain-router.js';
const HOMEPAGE = '<!doctype html><title>Home</title><h1>homepage</h1>';
const OBJECT_HTML = '<!doctype html><title>Object</title><h1>object</h1>';
const SECRET = 'origin-guard-test-slot-a-placeholder';

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'];
const SCHEMES = ['https', 'http'];

function sha256(text) {
  return crypto.createHash('sha256').update(Buffer.from(String(text), 'utf8')).digest('hex');
}

function loadLiveSource() {
  const expected = fs.readFileSync(path.join(ROOT, 'edge-functions/LIVE.sha256'), 'utf8').trim();
  const buf = execFileSync('git', ['show', LIVE_GIT], { cwd: ROOT, maxBuffer: 20 * 1024 * 1024 });
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (got !== expected) {
    throw new Error('live subdomain-router.js sha ' + got + ' != LIVE.sha256 ' + expected);
  }
  return buf.toString('utf8');
}

function loadNextSource() {
  return fs.readFileSync(path.join(ROOT, 'edge-functions/subdomain-router.js'), 'utf8');
}

function fakeCache() {
  const store = new Map();
  return {
    match: async (req) => {
      const key = String(req && req.url ? req.url : req);
      const entry = store.get(key);
      return entry ? new Response(entry.body, { headers: entry.headers }) : undefined;
    },
    put: async (req, resp) => {
      const key = String(req && req.url ? req.url : req);
      store.set(key, {
        body: await resp.clone().text(),
        headers: Object.fromEntries(resp.headers.entries())
      });
    },
    delete: async (req) => store.delete(String(req && req.url ? req.url : req))
  };
}

function methodOf(input, init) {
  if (init && init.method) return String(init.method).toUpperCase();
  if (input && typeof input === 'object' && input.method) return String(input.method).toUpperCase();
  return 'GET';
}

function headersOf(input, init) {
  if (init && init.headers) return new Headers(init.headers);
  if (input && typeof input === 'object' && input.headers) return new Headers(input.headers);
  return new Headers();
}

function hrefOf(input) {
  return String(input && input.url ? input.url : input);
}

function resolveBody(payload, failClosed) {
  if (failClosed) throw new Error('resolve down');
  if (payload.websiteId === 'BANNED1') return { success: true, allow: false, reason: 'blocked' };
  if (payload.websiteId === 'PRIV8') {
    return { success: true, allow: true, visibility: 'private', path: 'sites/owner-1/PRIV8/dist' };
  }
  if (payload.websiteId === 'DOWN1') throw new Error('resolve down');
  if (payload.websiteId === 'NOSUCH01') return { success: true, allow: false, reason: 'not_found' };
  if (payload.websiteId === 'EPX2UU43') {
    return { success: true, allow: true, path: 'sites/1985655011013808129/EPX2UU43/dist' };
  }
  if (payload.websiteId === 'PUBLIC1') return { success: true, allow: true, path: 'sites/owner-1/PUBLIC1/dist' };
  if (payload.websiteId === 'HGSBPOX6') {
    return { success: true, allow: true, path: 'sites/1985655011013808129/HGSBPOX6/dist' };
  }
  if (payload.subdomain === 'www' || payload.label === 'www') {
    return {
      success: true,
      path: 'sites/1985655011013808129/EPX2UU43/dist',
      websiteId: 'EPX2UU43',
      origin: 'sites.demox.site',
      visibility: 'public',
      hideWatermark: true
    };
  }
  if (payload.subdomain === 'coverage') {
    return {
      success: true,
      path: 'sites/1985655011013808129/HGSBPOX6/dist',
      websiteId: 'HGSBPOX6',
      origin: 'site-3.demox.site',
      visibility: 'public',
      hideWatermark: true
    };
  }
  if (payload.subdomain === 'letters-from-the-hill') {
    return {
      success: true,
      path: 'sites/owner-1/PUBLIC1/dist',
      websiteId: 'PUBLIC1',
      origin: 'sites.demox.site',
      visibility: 'public',
      hideWatermark: true
    };
  }
  return { success: false, message: 'not found' };
}

function cosResponse(method, href, mode) {
  const pathName = new URL(href).pathname;
  const wwwObject = pathName.includes('/EPX2UU43/');
  const htmlHeaders = { 'content-type': 'text/html; charset=utf-8' };
  if (pathName.includes('/NOSUCH01/')) {
    return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (method === 'HEAD') return new Response(null, { status: 200, headers: htmlHeaders });
  if (!pathName.includes('/sites/')) {
    return new Response('missing', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (mode === 'parity' && wwwObject) {
    return new Response(HOMEPAGE, { status: 200, headers: htmlHeaders });
  }
  if (method === 'GET') {
    return new Response(wwwObject ? HOMEPAGE : OBJECT_HTML, { status: 200, headers: htmlHeaders });
  }
  if (method === 'OPTIONS') {
    return new Response('Bad Request', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  return new Response('Method Not Allowed', { status: 405, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function isOriginUrl(href) {
  try {
    const host = new URL(href).hostname;
    return host === 'sites.demox.site' || host === 'site-3.demox.site' || /^site-\d+\.demox\.site$/.test(host);
  } catch (e) {
    return false;
  }
}

function createHandle(source, { secret, mode, realFetch, onCos }) {
  const cache = fakeCache();
  const env = {
    DEMOX_API_URL: process.env.DEMOX_API_URL || 'https://api.test',
    DEMOX_HOME_URL: 'https://www.demox.site'
  };
  if (secret) {
    env.DEMOX_ORIGIN_GUARD_SECRET_A = process.env.DEMOX_ORIGIN_GUARD_SECRET_A || SECRET;
    env.DEMOX_ORIGIN_GUARD_KID = process.env.DEMOX_ORIGIN_GUARD_KID || 'A';
  }
  let handle = null;
  const inflight = new Set();
  const ctx = vm.createContext({
    URL, URLSearchParams, Request, Response, Headers, crypto, TextEncoder, TextDecoder,
    setTimeout, clearTimeout, AbortController, console,
    env,
    caches: { default: cache },
    addEventListener() {},
    fetch: async (input, init) => {
      const href = hrefOf(input);
      const method = methodOf(input, init);
      const headers = headersOf(input, init);
      if (href.includes('/resolve-subdomain') || href.includes('/check-site-access')) {
        let payload = {};
        try {
          const raw = init && typeof init.body === 'string' ? init.body : '';
          payload = raw ? JSON.parse(raw) : {};
        } catch (e) {
          payload = {};
        }
        if (href.includes('/check-site-access')) {
          return new Response(JSON.stringify({ success: true, allowed: false, loginRequired: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        try {
          const body = resolveBody(payload, false);
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        } catch (e) {
          throw e;
        }
      }
      if (!realFetch && isOriginUrl(href)) {
        const key = method + ' ' + href;
        if (inflight.has(key)) {
          if (onCos) onCos(method, href);
          return cosResponse(method, href, mode);
        }
        inflight.add(key);
        try {
          return await handle(new Request(href, { method, headers }));
        } finally {
          inflight.delete(key);
        }
      }
      if (realFetch) return realFetch(input, init);
      return cosResponse(method, href, mode);
    }
  });
  vm.runInContext(source + '\nglobalThis.__handle = handle;', ctx);
  handle = ctx.__handle;
  return handle;
}

async function invoke(handle, url, method, cookie) {
  const headers = { Accept: 'text/html' };
  if (cookie) headers.Cookie = cookie;
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') init.body = '';
  const response = await handle(new Request(url, init), { waitUntil() {}, passThroughOnException() {} });
  const body = await response.text();
  return {
    status: response.status,
    route: response.headers.get('x-demox-route') || '',
    cache: response.headers.get('cache-control') || '',
    type: response.headers.get('content-type') || '',
    length: Buffer.byteLength(body),
    sha: sha256(body),
    body
  };
}

function matrixRows() {
  const rows = [];
  const cookies = [false, true];
  const guardPaths = [
    ['banned', '/sites/owner-1/BANNED1/dist/index.html'],
    ['private', '/sites/owner-1/PRIV8/dist/index.html'],
    ['public', '/sites/1985655011013808129/EPX2UU43/dist/index.html'],
    ['public', '/sites/owner-1/PUBLIC1/dist/index.html'],
    ['noid', '/assets/index-abc.js'],
    ['noid', '/robots.txt'],
    ['lookup', '/sites/owner-1/DOWN1/dist/index.html'],
    ['nosuch', '/sites/owner-1/NOSUCH01/dist/index.html']
  ];
  for (const scheme of SCHEMES) {
    for (const method of METHODS) {
      for (const cookie of cookies) {
        rows.push({ scheme, host: 'www.demox.site', method, path: '/', cookie, kind: 'public' });
        rows.push({ scheme, host: 'www.demox.site', method, path: '/assets/index-abc.js', cookie, kind: 'noid' });
        for (const host of ['sites.demox.site', 'site-3.demox.site']) {
          for (const [kind, pathName] of guardPaths) {
            rows.push({ scheme, host, method, path: pathName, cookie, kind });
          }
        }
        for (const host of ['coverage.demox.site', 'letters-from-the-hill.demox.site']) {
          rows.push({ scheme, host, method, path: '/', cookie, kind: 'public' });
        }
      }
    }
  }
  return rows;
}

function rowKey(row) {
  return [row.scheme, row.host, row.method, row.path, row.cookie ? 'cookie' : 'nocookie', row.kind].join(' ');
}

function verdict(row, oldR, newR, allow) {
  const same = oldR.status === newR.status && oldR.sha === newR.sha;
  if (same) return 'same';
  const allowed = allow.some((item) => item === rowKey(row));
  if (allowed) return 'expected';
  if ((row.kind === 'banned' || row.kind === 'private') && newR.status === 403 && oldR.status !== 403) return 'expected';
  if (row.kind === 'lookup' && newR.status === 503 && oldR.status !== 503) return 'expected';
  return 'unexpected';
}

async function runOfflineMatrix(allowlist) {
  const live = loadLiveSource();
  const next = loadNextSource();
  const oldHandle = createHandle(live, { secret: false, mode: 'parity' });
  const newHandle = createHandle(next, { secret: true, mode: 'parity' });
  const allow = allowlist || [];
  const results = [];
  for (const row of matrixRows()) {
    const url = row.scheme + '://' + row.host + row.path;
    const oldR = await invoke(oldHandle, url, row.method, row.cookie ? 'demox_access=fake' : '');
    const newR = await invoke(newHandle, url, row.method, row.cookie ? 'demox_access=fake' : '');
    const mark = verdict(row, oldR, newR, allow);
    results.push({ row, oldR, newR, mark });
  }
  return {
    results,
    unexpected: results.filter((item) => item.mark === 'unexpected'),
    expected: results.filter((item) => item.mark === 'expected'),
    same: results.filter((item) => item.mark === 'same')
  };
}

function formatTable(report) {
  const lines = ['mark  old  new  oldSha  newSha  kind  scheme  method  cookie  host  path'];
  for (const item of report.results) {
    const row = item.row;
    lines.push([
      item.mark,
      item.oldR.status,
      item.newR.status,
      item.oldR.sha.slice(0, 12),
      item.newR.sha.slice(0, 12),
      row.kind,
      row.scheme,
      row.method,
      row.cookie ? 'cookie' : 'nocookie',
      row.host,
      row.path
    ].join('  '));
  }
  lines.push('same=' + report.same.length + ' expected=' + report.expected.length + ' unexpected=' + report.unexpected.length);
  return lines.join('\n');
}

async function runWwwChain(source, mode) {
  const seen = [];
  const handle = createHandle(source, {
    secret: true,
    mode: mode || 'strict',
    onCos(method, href) { seen.push({ method, href }); }
  });
  const out = {};
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    out[method] = await invoke(handle, 'https://www.demox.site/', method, method === 'OPTIONS' ? 'demox_access=fake' : '');
    out[method].cos = seen.filter((item) => item.href.includes('/EPX2UU43/')).map((item) => item.method);
    seen.length = 0;
  }
  return out;
}

function readAllowlist(file) {
  if (!file) return [];
  const text = fs.readFileSync(file, 'utf8').trim();
  if (!text) return [];
  if (text.startsWith('[')) return JSON.parse(text);
  return text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
}

async function realFetch(input, init) {
  return fetch(input, init);
}

async function main(argv) {
  const selfTest = argv.includes('--self-test');
  const allowFile = argv.includes('--allowlist') ? argv[argv.indexOf('--allowlist') + 1] : '';
  if (selfTest) {
    const report = await runOfflineMatrix(readAllowlist(allowFile));
    process.stdout.write(formatTable(report) + '\n');
    if (report.unexpected.length) process.exit(1);
    return;
  }
  loadLiveSource();
  const banned = process.env.DEMOX_BANNED_PATH || '';
  if (!banned) {
    console.error('Set DEMOX_BANNED_PATH=/sites/<uid>/<id>/dist/index.html');
    process.exit(2);
  }
  const live = loadLiveSource();
  const next = loadNextSource();
  const oldHandle = createHandle(live, { secret: false, realFetch });
  const newHandle = createHandle(next, { secret: Boolean(process.env.DEMOX_ORIGIN_GUARD_SECRET_A), realFetch });
  const home = await realFetch('https://www.demox.site/', { headers: { Accept: 'text/html' } });
  const html = await home.text();
  const asset = (html.match(/\/assets\/index-[^"']+\.js/) || [])[0] || '';
  const rows = [];
  const hosts = ['www.demox.site', 'sites.demox.site', 'site-3.demox.site', 'coverage.demox.site', 'letters-from-the-hill.demox.site'];
  for (const scheme of SCHEMES) {
    for (const host of hosts) {
      for (const method of METHODS) {
        for (const cookie of [false, true]) {
          rows.push({ scheme, host, method, path: '/', cookie, kind: 'public' });
        }
      }
    }
  }
  if (asset) {
    for (const method of METHODS) {
      rows.push({ scheme: 'https', host: 'www.demox.site', method, path: asset, cookie: false, kind: 'noid' });
      rows.push({ scheme: 'https', host: 'sites.demox.site', method, path: asset, cookie: false, kind: 'noid' });
    }
  }
  rows.push({ scheme: 'https', host: 'sites.demox.site', method: 'GET', path: '/sites/1985655011013808129/EPX2UU43/dist/index.html', cookie: false, kind: 'public' });
  rows.push({ scheme: 'https', host: 'sites.demox.site', method: 'GET', path: '/sites/1985655011013808129/NOSUCH01/dist/index.html', cookie: false, kind: 'nosuch' });
  rows.push({ scheme: 'https', host: 'sites.demox.site', method: 'GET', path: banned, cookie: false, kind: 'banned' });
  rows.push({ scheme: 'https', host: 'sites.demox.site', method: 'OPTIONS', path: banned, cookie: true, kind: 'banned' });
  const allow = readAllowlist(allowFile);
  const results = [];
  for (const row of rows) {
    const url = row.scheme + '://' + row.host + row.path;
    const oldR = await invoke(oldHandle, url, row.method, row.cookie ? 'demox_access=fake' : '');
    let originHits = 0;
    const counting = createHandle(next, {
      secret: Boolean(process.env.DEMOX_ORIGIN_GUARD_SECRET_A),
      realFetch: async (input, init) => {
        const href = hrefOf(input);
        if (row.kind === 'banned' && href.includes(banned) && !href.includes('/resolve-subdomain')) originHits += 1;
        return realFetch(input, init);
      }
    });
    const newR = await invoke(counting, url, row.method, row.cookie ? 'demox_access=fake' : '');
    if (row.kind === 'banned' && (newR.status !== 403 || originHits !== 0)) {
      results.push({ row, oldR, newR, mark: 'unexpected' });
      continue;
    }
    results.push({ row, oldR, newR, mark: verdict(row, oldR, newR, allow) });
  }
  const report = {
    results,
    unexpected: results.filter((item) => item.mark === 'unexpected'),
    expected: results.filter((item) => item.mark === 'expected'),
    same: results.filter((item) => item.mark === 'same')
  };
  process.stdout.write(formatTable(report) + '\n');
  if (report.unexpected.length) process.exit(1);
}

module.exports = {
  HOMEPAGE,
  loadLiveSource,
  loadNextSource,
  runOfflineMatrix,
  runWwwChain,
  formatTable,
  createHandle
};

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}
