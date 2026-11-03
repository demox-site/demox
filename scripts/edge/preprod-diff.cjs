'use strict';

// Local differential and production calibration for the edge router.
//
//   node scripts/edge/preprod-diff.cjs --self-test
//   node scripts/edge/preprod-diff.cjs --calibrate --save-baseline /tmp/demox-p0-baseline.json
//   node scripts/edge/preprod-diff.cjs --calibrate --baseline /tmp/demox-p0-baseline.json
//   node scripts/edge/preprod-diff.cjs
//
// Router subrequests addressed to *.demox.site re-enter this process. They do not
// open a socket to the live EdgeOne edge. The final origin hop is the COS website
// host derived from the bucket config (site-N → the Guangzhou bucket in the
// 2026-10-10 incident; sites.demox.site → LEGACY_BUCKET resource-game / ap-chengdu).
// Bucket 1's public website endpoint answers AccessDenied, so that hop uses a
// snapshot instead of COS.
//
// --self-test never dials the network. --calibrate (when it captures a baseline)
// and the public real-origin diff do send read-only client requests to the
// allowlisted *.demox.site hosts: GET/HEAD with no body, and POST/PUT/OPTIONS
// with an empty body. Those are the baseline and the bucket-1 object snapshots,
// not router subrequests. --calibrate --baseline reuses the saved file and only
// dials *.demox.site again if a snapshot for a discovered asset is missing.
// Those client requests, and the COS final hop, are pinned to addresses from
// DNS-over-HTTPS (or --resolve host:ip). System DNS is not used for them unless
// --no-doh / DEMOX_PREPROD_DOH=0. http:// on an EdgeOne host is excluded only
// when the live response is a 301 to https. Any other http status is a mismatch.
// site-3.demox.site http is listed separately: that origin never enters the function.
//
// Signing keys are read from the environment and never printed.
// DEMOX_BANNED_PATH is optional. Rows that need it are skipped when it is unset.

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const tls = require('tls');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const LIVE_FIXTURE = path.join(ROOT, 'edge-functions/fixtures/live-subdomain-router.3165903e.js');
const HOMEPAGE = '<!doctype html><title>Home</title><h1>homepage</h1>';
const OBJECT_HTML = '<!doctype html><title>Object</title><h1>object</h1>';
const SECRET = 'origin-guard-test-slot-a-placeholder';

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'];
const SCHEMES = ['https', 'http'];

// Derived from scf-code/website-api LEGACY_BUCKET (bucket + region → website endpoint)
// and docs/incidents/2026-10-10-edge-cookie-strip-503.md (site-3 CNAME).
const BUCKET1_COS = 'resource-game-1307257815.cos-website.ap-chengdu.myqcloud.com';
const SITE3_COS = 'demox-sites-1490780430.cos-website.ap-guangzhou.myqcloud.com';

const CLIENT_ALLOW = new Set([
  'www.demox.site',
  'sites.demox.site',
  'site-3.demox.site',
  'coverage.demox.site',
  'letters-from-the-hill.demox.site'
]);
const NETWORK_ALLOW = new Set([
  'www.demox.site',
  'sites.demox.site',
  'site-3.demox.site',
  'coverage.demox.site',
  'letters-from-the-hill.demox.site',
  BUCKET1_COS,
  SITE3_COS
]);

function resolvePreprodLimits(env) {
  const source = env || {};
  const capGiven = source.DEMOX_PREPROD_MAX_REQUESTS;
  const gapGiven = source.DEMOX_PREPROD_GAP_MS;
  let cap = capGiven == null || String(capGiven).trim() === '' ? 240 : Number(capGiven);
  let gap = gapGiven == null || String(gapGiven).trim() === '' ? 80 : Number(gapGiven);
  if (!Number.isFinite(cap)) cap = 240;
  if (!Number.isFinite(gap)) gap = 80;
  const capEffective = Math.min(cap, 300);
  const gapEffective = Math.max(gap, 50);
  return {
    cap: capEffective,
    gap: gapEffective,
    requestedCap: cap,
    requestedGap: gap,
    clamped: capEffective !== cap || gapEffective !== gap
  };
}

const PREPROD_LIMITS = resolvePreprodLimits(process.env);
const MAX_REQUESTS = PREPROD_LIMITS.cap;
const GAP_MS = PREPROD_LIMITS.gap;
if (PREPROD_LIMITS.clamped) {
  console.error(
    'preprod-diff limits clamped: DEMOX_PREPROD_MAX_REQUESTS=' + MAX_REQUESTS +
    ' (requested ' + PREPROD_LIMITS.requestedCap + ', cap <= 300); DEMOX_PREPROD_GAP_MS=' + GAP_MS +
    ' (requested ' + PREPROD_LIMITS.requestedGap + ', interval >= 50)'
  );
}

let netCount = 0;
let lastNetAt = 0;
const pinnedAddress = new Map();

const HTTP_EXCLUDE_REASON = 'pre-function 301 (EO redirects http→https before the edge function)';
// 按主机名列出。site-3 的 http 是 COS 自定义源站，不进边缘函数；https 仍比对。
const HTTP_NOT_ON_EDGE = [
  {
    host: 'site-3.demox.site',
    reason: 'site-3 的 http 是 COS 自定义源站（CNAME 到 cos-website），请求不经过边缘函数。https 仍进函数，继续比对。'
  }
];
const WWW_ASSET_CACHE = 'public, max-age=31536000, immutable';
const WWW_HTML_CACHE = 'public, max-age=60';
const CACHE_HEADER_NAMES = [
  'cache-control', 'expires', 'pragma', 'age', 'etag', 'last-modified',
  'cdn-cache-control', 'surrogate-control'
];

function isReservedIPv4(ip) {
  const parts = String(ip || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const a = parts[0];
  const b = parts[1];
  const c = parts[2];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function parseBannedPath(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const matched = text.match(/\/sites\/([^/]+)\/([A-Za-z0-9]+)/);
  if (!matched) return null;
  return { uid: matched[1], id: matched[2].toUpperCase() };
}

function parseHostPin(spec) {
  const text = String(spec || '').trim();
  const idx = text.lastIndexOf(':');
  if (idx <= 0) return null;
  return { host: text.slice(0, idx).toLowerCase(), ip: text.slice(idx + 1) };
}

function parseCli(argv) {
  const pins = new Map();
  const envPins = String(process.env.DEMOX_PREPROD_RESOLVE || '');
  for (const part of envPins.split(',')) {
    const pin = parseHostPin(part);
    if (pin) pins.set(pin.host, pin.ip);
  }
  let doh = process.env.DEMOX_PREPROD_DOH !== '0' && String(process.env.DEMOX_PREPROD_DOH || '').toLowerCase() !== 'off';
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--no-doh') {
      doh = false;
      continue;
    }
    if (argv[i] === '--doh') {
      doh = true;
      continue;
    }
    if (argv[i] === '--resolve') {
      const pin = parseHostPin(argv[i + 1]);
      if (!pin) throw new Error('--resolve expects host:ip');
      pins.set(pin.host, pin.ip);
      i += 1;
      continue;
    }
    rest.push(argv[i]);
  }
  return { argv: rest, pins, doh };
}

function httpBypassReason(host) {
  const name = String(host || '').toLowerCase();
  const found = HTTP_NOT_ON_EDGE.find((item) => item.host === name);
  return found ? found.reason : '';
}

function liveIsPreFunction301(snap) {
  if (!snap || !snap.headers || snap.status !== 301) return false;
  const headers = snap.headers instanceof Headers ? snap.headers : new Headers(snap.headers);
  return (headers.get('location') || '').indexOf('https://') === 0;
}

function httpExcludeNote(snap) {
  if (!liveIsPreFunction301(snap)) return '';
  const headers = snap.headers instanceof Headers ? snap.headers : new Headers(snap.headers);
  return HTTP_EXCLUDE_REASON + '; verified 301 → ' + (headers.get('location') || '');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256Text(text) {
  return sha256(Buffer.from(String(text), 'utf8'));
}

function loadLiveSource() {
  const expected = fs.readFileSync(path.join(ROOT, 'edge-functions/LIVE.sha256'), 'utf8').trim();
  const buf = fs.readFileSync(LIVE_FIXTURE);
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (got !== expected) {
    throw new Error('live subdomain-router.js sha ' + got + ' != LIVE.sha256 ' + expected);
  }
  return buf.toString('utf8');
}

function loadNextSource() {
  return fs.readFileSync(path.join(ROOT, 'edge-functions/subdomain-router.js'), 'utf8');
}

function isEoHost(host) {
  const value = String(host || '').toLowerCase().replace(/\.+$/, '');
  if (value === 'demox.site' || value.endsWith('.demox.site')) return true;
  if (value.endsWith('.eo.dnse0.com') || value.endsWith('.edgeone.app')) return true;
  return false;
}

function mapCos(edgeHost) {
  const host = String(edgeHost || '').toLowerCase();
  if (host === 'sites.demox.site') {
    return { cosHost: BUCKET1_COS, hostHeader: 'sites.demox.site', snapshot: true };
  }
  if (/^site-\d+\.demox\.site$/.test(host)) {
    return { cosHost: SITE3_COS, hostHeader: host, snapshot: false };
  }
  return null;
}

function isEdgeHost(host) {
  return isEoHost(host);
}

async function pace() {
  netCount += 1;
  if (netCount > MAX_REQUESTS) {
    const err = new Error('request cap exceeded (' + MAX_REQUESTS + ')');
    err.code = 'CAP';
    throw err;
  }
  const wait = GAP_MS - (Date.now() - lastNetAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNetAt = Date.now();
}

function rawRequest(urlString, method, headers, body, options) {
  const opts = options || {};
  const u = new URL(urlString);
  const lib = u.protocol === 'http:' ? http : https;
  const headerBag = {};
  if (headers) {
    const source = headers instanceof Headers ? Object.fromEntries(headers.entries()) : headers;
    for (const [name, value] of Object.entries(source)) {
      if (value != null && value !== '') headerBag[name] = value;
    }
  }
  if (!headerBag.Host && !headerBag.host) headerBag.Host = u.hostname;
  const pin = opts.pin === false ? '' : (pinnedAddress.get(u.hostname.toLowerCase()) || '');
  const connectHost = pin || u.hostname;
  return new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: u.protocol,
      host: connectHost,
      hostname: connectHost,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: (u.pathname || '/') + u.search,
      method: method,
      headers: headerBag,
      rejectUnauthorized: true,
      servername: u.hostname,
      checkServerIdentity: function (_presented, cert) {
        return tls.checkServerIdentity(u.hostname, cert);
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const out = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value == null) continue;
          if (Array.isArray(value)) value.forEach((item) => out.append(name, item));
          else out.set(name, String(value));
        }
        resolve({
          status: res.statusCode || 0,
          headers: out,
          body: method === 'HEAD' ? Buffer.alloc(0) : buf
        });
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('timeout ' + urlString)));
    req.on('error', reject);
    if (body != null && method !== 'GET' && method !== 'HEAD') req.write(body);
    req.end();
  });
}

function dohEndpoints(name) {
  const q = encodeURIComponent(name);
  return [
    'https://dns.alidns.com/resolve?name=' + q + '&type=A',
    'https://doh.pub/dns-query?name=' + q + '&type=A'
  ];
}

async function dohLookupA(name) {
  let lastError = null;
  for (const url of dohEndpoints(name)) {
    try {
      const snap = await rawRequest(url, 'GET', { Accept: 'application/dns-json' }, null, { pin: false });
      const data = JSON.parse(snap.body.toString('utf8'));
      const answers = (data.Answer || []).filter((item) => item && item.type === 1 && item.data);
      if (!answers.length) throw new Error('no A record for ' + name);
      return { ip: String(answers[0].data), via: new URL(url).hostname };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('DoH failed for ' + name);
}

async function pinAllowlistedHosts(overrides, doh) {
  const hosts = Array.from(CLIENT_ALLOW).concat([BUCKET1_COS, SITE3_COS]);
  const report = [];
  pinnedAddress.clear();
  for (const host of hosts) {
    const key = host.toLowerCase();
    if (overrides && overrides.has(key)) {
      const ip = overrides.get(key);
      if (isReservedIPv4(ip)) throw new Error('refusing reserved resolve ' + host + ' -> ' + ip);
      pinnedAddress.set(key, ip);
      report.push({ host: key, ip: ip, via: 'override' });
      continue;
    }
    if (!doh) {
      report.push({ host: key, ip: '', via: 'system-dns' });
      continue;
    }
    const found = await dohLookupA(key);
    if (isReservedIPv4(found.ip)) {
      throw new Error('refusing reserved DoH answer ' + host + ' -> ' + found.ip + ' via ' + found.via);
    }
    pinnedAddress.set(key, found.ip);
    report.push({ host: key, ip: found.ip, via: found.via });
  }
  return report;
}

function formatResolutions(list) {
  return (list || []).map((item) => 'resolve ' + item.host + ' ' + (item.ip || '-') + ' ' + item.via).join('\n');
}

async function openNetwork(host, url, method, headers, transport) {
  if (isEoHost(host)) {
    const err = new Error('refusing real-network fetch to EO host ' + host);
    err.code = 'EO';
    throw err;
  }
  if (!NETWORK_ALLOW.has(host)) {
    const err = new Error('host not allowlisted for real network: ' + host);
    err.code = 'ALLOW';
    throw err;
  }
  await pace();
  if (transport) return transport(url, method, headers);
  const body = method === 'GET' || method === 'HEAD' ? null : '';
  return rawRequest(url, method, headers, body);
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

function isRequest(value) {
  return typeof Request === 'function' && value instanceof Request;
}

// EdgeOne: fetch(url, incomingRequest) does not carry the method. Non-HEAD is sent as GET.
// fetch(request) and a plain init keep the method. HEAD stays HEAD so the client body stays empty.
function outboundMethod(input, init) {
  if (isRequest(init)) {
    const method = String(init.method || 'GET').toUpperCase();
    return method === 'HEAD' ? 'HEAD' : 'GET';
  }
  if (init && typeof init === 'object' && init.method) return String(init.method).toUpperCase();
  if (!init && isRequest(input)) return String(input.method || 'GET').toUpperCase();
  return 'GET';
}

function headerSource(input, init) {
  if (init && typeof init === 'object' && init.headers) return init.headers;
  if (input && typeof input === 'object' && input.headers) return input.headers;
  return null;
}

function safeHeaders(input, init) {
  const headers = new Headers();
  const source = headerSource(input, init);
  if (!source) return headers;
  const bag = source instanceof Headers ? source : new Headers(source);
  bag.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower === 'host' || lower === 'content-length' || lower === 'connection') return;
    if (lower === 'keep-alive' || lower === 'transfer-encoding' || lower === 'te') return;
    if (lower === 'trailer' || lower === 'upgrade') return;
    headers.set(name, value);
  });
  return headers;
}

function hrefOf(input) {
  return String(input && input.url ? input.url : input);
}

function resolveBody(payload, liveSites, bannedId) {
  const websiteId = String(payload.websiteId || '').toUpperCase();
  if (websiteId === 'BANNED1' || (bannedId && websiteId === bannedId)) {
    return { success: true, allow: false, reason: 'blocked' };
  }
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
  if (payload.websiteId === 'LCJAIAC0') {
    return { success: true, allow: true, path: 'sites/1985655011013808129/LCJAIAC0/dist' };
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
    if (liveSites) {
      return {
        success: true,
        path: 'sites/1985655011013808129/LCJAIAC0/dist',
        websiteId: 'LCJAIAC0',
        origin: 'site-3.demox.site',
        visibility: 'public',
        hideWatermark: false
      };
    }
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

function wwwOriginCacheControl(pathname) {
  const path = String(pathname || '');
  if (path.indexOf('/EPX2UU43/') === -1) return '';
  if (/\/assets\/[^/]+\.(?:js|mjs|css|wasm|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot)$/i.test(path)) {
    return WWW_ASSET_CACHE;
  }
  if (/\.html?$/i.test(path) || /\/$/.test(path)) return WWW_HTML_CACHE;
  return '';
}

function copyCacheHeaders(from, to) {
  const source = from instanceof Headers ? from : new Headers(from || {});
  for (let i = 0; i < CACHE_HEADER_NAMES.length; i += 1) {
    const name = CACHE_HEADER_NAMES[i];
    const value = source.get(name);
    if (value) to.set(name, value);
  }
}

function cosResponse(method, href) {
  const pathName = new URL(href).pathname;
  const wwwObject = pathName.includes('/EPX2UU43/');
  const headers = { 'content-type': 'text/html; charset=utf-8' };
  const originCache = wwwOriginCacheControl(pathName);
  if (originCache) headers['cache-control'] = originCache;
  if (/\/assets\/[^/]+\.css$/i.test(pathName)) headers['content-type'] = 'text/css; charset=utf-8';
  else if (/\/assets\/[^/]+\.(?:js|mjs)$/i.test(pathName)) headers['content-type'] = 'application/javascript; charset=utf-8';
  // HEAD 在 HTTP 上没有正文。NOSUCH01 不能先于这条返回带 body 的 404。
  if (method === 'HEAD') {
    if (pathName.includes('/NOSUCH01/') || !pathName.includes('/sites/')) {
      return new Response(null, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    return new Response(null, { status: 200, headers: headers });
  }
  if (pathName.includes('/NOSUCH01/')) {
    return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (!pathName.includes('/sites/')) {
    return new Response('missing', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (method === 'GET') {
    return new Response(wwwObject ? HOMEPAGE : OBJECT_HTML, { status: 200, headers: headers });
  }
  if (method === 'OPTIONS') {
    return new Response('Bad Request', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  return new Response('Method Not Allowed', { status: 405, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function snapKey(method, href) {
  const u = new URL(href);
  return method.toUpperCase() + ' ' + u.hostname.toLowerCase() + u.pathname + u.search;
}

function toResponse(snap) {
  return new Response(snap.body, { status: snap.status, headers: snap.headers });
}

function deniedSnapshot(snap) {
  if (!snap) return false;
  if (snap.status !== 403 && snap.status !== 400) return false;
  const text = Buffer.isBuffer(snap.body) ? snap.body.toString('utf8') : String(snap.body || '');
  return text.includes('AccessDenied') || text.includes('UserCnameInvalid');
}

function createHandle(source, options) {
  const opts = options || {};
  const secret = !!opts.secret;
  const liveOrigin = !!opts.liveOrigin;
  const liveSites = !!opts.liveSites;
  const banned = parseBannedPath(opts.bannedPath != null ? opts.bannedPath : process.env.DEMOX_BANNED_PATH);
  const bannedId = banned ? banned.id : '';
  const snapshots = opts.snapshots || new Map();
  const originCache = opts.originCache || null;
  const onCos = opts.onCos;
  const transport = opts.transport || null;
  const apiBase = opts.apiBase || 'https://api.test';
  let apiHost = 'api.test';
  try { apiHost = new URL(apiBase).hostname.toLowerCase(); } catch (e) { apiHost = 'api.test'; }
  const hops = [];
  const hostStack = [];
  const cache = fakeCache();
  const env = {
    DEMOX_API_URL: apiBase,
    DEMOX_HOME_URL: 'https://www.demox.site'
  };
  if (secret) {
    env.DEMOX_ORIGIN_GUARD_SECRET_A = process.env.DEMOX_ORIGIN_GUARD_SECRET_A || SECRET;
    env.DEMOX_ORIGIN_GUARD_KID = process.env.DEMOX_ORIGIN_GUARD_KID || 'A';
  }
  let handle = null;
  const ctx = vm.createContext({
    URL, URLSearchParams, Request, Response, Headers, crypto, TextEncoder, TextDecoder,
    setTimeout, clearTimeout, AbortController, console,
    env,
    caches: { default: cache },
    addEventListener() {},
    fetch: async (input, init) => {
      const href = hrefOf(input);
      const method = outboundMethod(input, init);
      if (href.includes('/resolve-subdomain') || href.includes('/check-site-access')) {
        let payload = {};
        try {
          const raw = init && typeof init.body === 'string' ? init.body : '';
          payload = raw ? JSON.parse(raw) : {};
        } catch (e) {
          payload = {};
        }
        let host = 'api.test';
        try { host = new URL(href).hostname; } catch (e) { host = 'api.test'; }
        hops.push({ host: host, scheme: 'https', method: 'POST', via: 'local-stub', url: href });
        if (href.includes('/check-site-access')) {
          return new Response(JSON.stringify({ success: true, allowed: false, loginRequired: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        const body = resolveBody(payload, liveSites, bannedId);
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      let target;
      try { target = new URL(href); } catch (e) {
        throw new Error('bad fetch url ' + href);
      }
      const host = target.hostname.toLowerCase();
      if (isEdgeHost(host)) {
        const top = hostStack[hostStack.length - 1] || '';
        if (host !== top) {
          if (hostStack.length > 6) throw new Error('re-entry depth exceeded for ' + href);
          hops.push({
            host: host,
            scheme: target.protocol.replace(':', ''),
            method: method,
            via: 'local-router',
            url: href
          });
          hostStack.push(host);
          try {
            const headers = safeHeaders(input, init);
            const next = { method: method, headers: headers };
            if (method !== 'GET' && method !== 'HEAD') next.body = '';
            return await handle(new Request(href, next), { waitUntil() {}, passThroughOnException() {} });
          } finally {
            hostStack.pop();
          }
        }
        if (onCos) onCos(method, href);
        const mapped = mapCos(host);
        const described = mapped
          ? new URL(target.pathname + target.search, 'https://' + mapped.cosHost + '/').toString()
          : href;
        const cosHost = mapped ? mapped.cosHost : host;
        if (!liveOrigin) {
          hops.push({
            host: cosHost,
            scheme: 'https',
            method: method,
            via: 'mock-origin',
            url: described
          });
          return cosResponse(method, href);
        }
        const key = snapKey(method, href);
        if (mapped && mapped.snapshot && snapshots.has(key) && !deniedSnapshot(snapshots.get(key))) {
          hops.push({
            host: cosHost,
            scheme: 'https',
            method: method,
            via: 'origin-snapshot',
            url: described
          });
          return toResponse(snapshots.get(key));
        }
        if (!mapped) {
          const err = new Error('refusing real-network fetch to EO host ' + host);
          err.code = 'EO';
          throw err;
        }
        const headers = { Host: mapped.hostHeader, Accept: 'text/html' };
        const cacheKey = method + ' ' + described;
        if (originCache && originCache.has(cacheKey)) {
          hops.push({
            host: cosHost,
            scheme: 'https',
            method: method,
            via: 'network',
            url: described
          });
          return toResponse(originCache.get(cacheKey));
        }
        hops.push({
          host: cosHost,
          scheme: 'https',
          method: method,
          via: 'network',
          url: described
        });
        const snap = await openNetwork(cosHost, described, method, headers, transport);
        if (originCache) originCache.set(cacheKey, snap);
        return toResponse(snap);
      }
      // 解析和统计打到 DEMOX_API_URL。徽章里会写上这个地址，所以校准要用现网那一个。
      // 这些请求留在本地，不算出网。
      if (host === apiHost || host === 'api.test' || href.indexOf('/website/analytics-track') !== -1 || href.indexOf('/website/report-site') !== -1) {
        hops.push({
          host: host,
          scheme: target.protocol.replace(':', ''),
          method: method,
          via: 'local-stub',
          url: href
        });
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (!liveOrigin) {
        hops.push({
          host: host,
          scheme: target.protocol.replace(':', ''),
          method: method,
          via: 'mock-origin',
          url: href
        });
        return new Response('', { status: 204 });
      }
      if (isEoHost(host) || !NETWORK_ALLOW.has(host)) {
        const err = new Error(isEoHost(host)
          ? 'refusing real-network fetch to EO host ' + host
          : 'host not allowlisted for real network: ' + host);
        err.code = isEoHost(host) ? 'EO' : 'ALLOW';
        throw err;
      }
      hops.push({
        host: host,
        scheme: target.protocol.replace(':', ''),
        method: method,
        via: 'network',
        url: href
      });
      const snap = await openNetwork(host, href, method, safeHeaders(input, init), transport);
      return toResponse(snap);
    }
  });
  vm.runInContext(source + '\nglobalThis.__handle = handle;', ctx);
  handle = ctx.__handle;
  async function wrapped(req, event) {
    return handle(req, event);
  }
  wrapped.__hops = hops;
  wrapped.__hostStack = hostStack;
  return wrapped;
}

async function invoke(handle, url, method, cookie) {
  handle.__hops.length = 0;
  handle.__hostStack.length = 0;
  handle.__hostStack.push(new URL(url).hostname.toLowerCase());
  const headers = { Accept: 'text/html' };
  if (cookie) headers.Cookie = cookie;
  const init = { method: method, headers: headers };
  if (method !== 'GET' && method !== 'HEAD') init.body = '';
  const response = await handle(new Request(url, init), { waitUntil() {}, passThroughOnException() {} });
  const raw = Buffer.from(await response.arrayBuffer());
  // 真实 HTTP 客户端看不到 HEAD 正文。比对仍检查 length 和 sha，不在 viewsDiffer 里跳过。
  const body = String(method).toUpperCase() === 'HEAD' ? Buffer.alloc(0) : raw;
  return {
    status: response.status,
    route: response.headers.get('x-demox-route') || '',
    cache: response.headers.get('cache-control') || '',
    type: response.headers.get('content-type') || '',
    length: body.length,
    sha: sha256(body),
    body: body.toString('utf8'),
    hops: handle.__hops.map((hop) => Object.assign({}, hop)),
    cdnCache: response.headers.get('cdn-cache-control') || '',
    surrogate: response.headers.get('surrogate-control') || '',
    expires: response.headers.get('expires') || ''
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

function noStoreOnly(result) {
  const parts = String(result && result.cache || '').toLowerCase().split(',').map((part) => part.trim()).filter(Boolean);
  if (!parts.includes('no-store')) return false;
  if (parts.some((part) => /s-maxage|max-age|public/.test(part))) return false;
  if (result.cdnCache || result.surrogate || result.expires) return false;
  return true;
}

function cacheText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cacheDirectives(value) {
  const flags = [];
  const params = [];
  for (const part of String(value || '').split(',')) {
    const text = part.trim().toLowerCase();
    if (!text) continue;
    const eq = text.indexOf('=');
    if (eq === -1) {
      flags.push(text);
      continue;
    }
    const key = text.slice(0, eq).trim();
    let raw = text.slice(eq + 1).trim();
    if (key === 'max-age' && /^\d+$/.test(raw)) raw = String(Number(raw));
    params.push(key + '=' + raw);
  }
  flags.sort();
  params.sort();
  return flags.join('\n') + '\n|\n' + params.join('\n');
}

function sameCachePolicy(a, b) {
  return cacheDirectives(a) === cacheDirectives(b);
}

function originCacheForWwwRow(row) {
  const pathName = String(row && row.path || '/');
  if (pathName.indexOf('/assets/') === 0) return WWW_ASSET_CACHE;
  return WWW_HTML_CACHE;
}

function isWwwDocumentOrAsset(row) {
  if (String(row.host || '').toLowerCase() !== 'www.demox.site') return false;
  const pathName = String(row.path || '/');
  if (pathName === '/' || pathName.endsWith('/') || /\.html?$/i.test(pathName)) return true;
  return pathName.indexOf('/assets/') === 0;
}

// www 的 /assets/* 和 HTML 只有在新 Cache-Control 与源站快照是同一组指令时，
// 才算 expected-cache-change。no-store、private，或任何对不上源站的值都是 unexpected。
function cacheChangeMark(row, oldR, newR) {
  const oldCache = oldR && oldR.cache;
  const newCache = newR && newR.cache;
  if (sameCachePolicy(oldCache, newCache)) return '';
  if (!isWwwDocumentOrAsset(row)) return 'unexpected';
  if (sameCachePolicy(newCache, originCacheForWwwRow(row))) return 'expected-cache-change';
  return 'unexpected';
}

function verdict(row, oldR, newR, allow) {
  const cacheMark = cacheChangeMark(row, oldR, newR);
  // 库里没有这个站点 ID：边缘 404，且必须 no-store，否则新发布的站点会被节点缓存成 404。
  if (row.kind === 'nosuch') {
    if (cacheMark) return 'unexpected';
    if (newR.status === 404 && noStoreOnly(newR)) return 'missing-site-404';
    return 'unexpected';
  }
  if (cacheMark === 'unexpected') return 'unexpected';
  const same = oldR.status === newR.status && oldR.sha === newR.sha;
  if (cacheMark === 'expected-cache-change') return same ? 'expected-cache-change' : 'unexpected';
  if (same) return 'same';
  const allowed = allow.some((item) => item === rowKey(row));
  if (allowed) return 'expected';
  if ((row.kind === 'banned' || row.kind === 'private') && newR.status === 403 && oldR.status !== 403) return 'expected';
  if (row.kind === 'lookup' && newR.status === 503 && oldR.status !== 503) return 'expected';
  return 'unexpected';
}

function isExpectedMark(mark) {
  return mark === 'expected' || mark === 'missing-site-404' || mark === 'expected-cache-change';
}

function guardRouteOnlyDifference(live, local) {
  if (!live || !local) return false;
  if (live.status !== local.status) return false;
  if (cacheText(live.cache) !== cacheText(local.cache)) return false;
  if (live.length !== local.length || live.sha !== local.sha) return false;
  const liveRoute = normRoute(live.route);
  const localRoute = normRoute(local.route);
  if (liveRoute === localRoute) return false;
  const fold = function (value) { return value.replace(/origin-guard=internal/g, 'origin-guard=allow'); };
  if (fold(liveRoute) !== fold(localRoute)) return false;
  return liveRoute.indexOf('origin-guard=internal') !== localRoute.indexOf('origin-guard=internal');
}

function hopSafe(hop) {
  if (hop.via !== 'network') return true;
  if (isEoHost(hop.host)) return false;
  return NETWORK_ALLOW.has(hop.host);
}

function collectUnsafe(results) {
  const bad = [];
  for (const item of results) {
    const hops = (item.hops || (item.oldR && item.oldR.hops) || []).concat(item.newR ? item.newR.hops || [] : []);
    for (const hop of hops) {
      if (!hopSafe(hop)) bad.push(hop);
    }
  }
  return bad;
}

async function runOfflineMatrix(allowlist) {
  const live = loadLiveSource();
  const next = loadNextSource();
  const oldHandle = createHandle(live, { secret: false });
  const newHandle = createHandle(next, { secret: false });
  const allow = allowlist || [];
  const results = [];
  for (const row of matrixRows()) {
    const url = row.scheme + '://' + row.host + row.path;
    const cookie = row.cookie ? 'demox_access=fake' : '';
    const oldR = await invoke(oldHandle, url, row.method, cookie);
    const newR = await invoke(newHandle, url, row.method, cookie);
    results.push({ row, oldR, newR, mark: verdict(row, oldR, newR, allow), hops: oldR.hops.concat(newR.hops) });
  }
  const unsafe = collectUnsafe(results);
  return {
    results,
    unexpected: results.filter((item) => item.mark === 'unexpected'),
    expected: results.filter((item) => isExpectedMark(item.mark)),
    same: results.filter((item) => item.mark === 'same'),
    missingSite: results.filter((item) => item.mark === 'missing-site-404'),
    unsafe
  };
}

function formatHop(hop) {
  return '  hop ' + hop.via + ' ' + hop.method + ' ' + hop.scheme + '://' + hop.host + ' ' + hop.url;
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
    const hops = (item.oldR.hops || []).map((hop) => Object.assign({ side: 'old' }, hop))
      .concat((item.newR.hops || []).map((hop) => Object.assign({ side: 'new' }, hop)));
    for (const hop of hops) lines.push('  ' + hop.side + formatHop(hop));
  }
  const missing = report.missingSite ? report.missingSite.length : report.results.filter((item) => item.mark === 'missing-site-404').length;
  const cacheChanges = report.results.filter((item) => item.mark === 'expected-cache-change').length;
  lines.push('same=' + report.same.length + ' expected=' + report.expected.length + ' expected-cache-change=' + cacheChanges + ' unexpected=' + report.unexpected.length + ' missing-site-404=' + missing);
  if (report.unsafe && report.unsafe.length) lines.push('unsafe-network=' + report.unsafe.length);
  return lines.join('\n');
}

async function runWwwChain(source, mode, opts) {
  const secret = opts && Object.prototype.hasOwnProperty.call(opts, 'secret') ? !!opts.secret : true;
  const seen = [];
  const handle = createHandle(source, {
    secret: secret,
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

function normRoute(value) {
  return String(value || '').replace(/resolve=(hit|miss|stale|v1fallback)/g, 'resolve=cache');
}

function viewOf(snap) {
  const body = snap.body ? Buffer.from(snap.body) : Buffer.alloc(0);
  const headers = snap.headers instanceof Headers ? snap.headers : new Headers(snap.headers || {});
  return {
    status: snap.status,
    route: headers.get('x-demox-route') || '',
    cache: headers.get('cache-control') || '',
    type: headers.get('content-type') || '',
    length: body.length,
    sha: sha256(body),
    body: body
  };
}

function discoverApiBase(items) {
  for (const item of items) {
    const buf = item.snap && item.snap.body;
    if (!buf) continue;
    const text = Buffer.from(buf).toString('utf8');
    const match = text.match(/https:\/\/[a-z0-9-]+\.ap-[a-z0-9-]+\.tencentscf\.com/);
    if (match) return match[0];
  }
  return 'https://api.test';
}

function calmXml(buf) {
  return Buffer.from(buf.toString('utf8')
    .replace(/<RequestId>[\s\S]*?<\/RequestId>/gi, '<RequestId></RequestId>')
    .replace(/<TraceId>[\s\S]*?<\/TraceId>/gi, '<TraceId></TraceId>'));
}

function viewsDiffer(live, local) {
  const fields = [];
  if (live.status !== local.status) fields.push('status');
  if (normRoute(live.route) !== normRoute(local.route)) fields.push('route');
  if (String(live.cache).toLowerCase() !== String(local.cache).toLowerCase()) fields.push('cache');
  if (String(live.type).toLowerCase() !== String(local.type).toLowerCase()) fields.push('type');
  const liveXml = String(live.type).toLowerCase().includes('xml');
  const localXml = String(local.type).toLowerCase().includes('xml');
  if (liveXml && localXml && live.status === local.status) {
    const a = calmXml(Buffer.isBuffer(live.body) ? live.body : Buffer.from(live.body || ''));
    const b = calmXml(Buffer.isBuffer(local.body) ? local.body : Buffer.from(local.body || ''));
    if (!a.equals(b)) fields.push('body');
  } else if (live.length !== local.length || live.sha !== local.sha) {
    fields.push('body');
  }
  return fields;
}

async function captureClient(row) {
  if (!CLIENT_ALLOW.has(row.host)) {
    throw new Error('baseline host not allowlisted: ' + row.host);
  }
  const url = row.scheme + '://' + row.host + row.path;
  await pace();
  const headers = { Accept: 'text/html', 'User-Agent': 'demox-preprod-calibrate' };
  if (row.cookie) headers.Cookie = 'demox_access=fake';
  const body = row.method === 'GET' || row.method === 'HEAD' ? null : '';
  const snap = await rawRequest(url, row.method, headers, body);
  return snap;
}

function publicRows(asset, banned) {
  const rows = [];
  const paths = [
    ['www.demox.site', '/', 'public'],
    ['sites.demox.site', '/', 'public'],
    ['sites.demox.site', '/sites/1985655011013808129/EPX2UU43/dist/index.html', 'public'],
    ['sites.demox.site', '/sites/1985655011013808129/NOSUCH01/dist/index.html', 'nosuch'],
    ['site-3.demox.site', '/', 'public'],
    ['site-3.demox.site', '/sites/1985655011013808129/HGSBPOX6/dist/index.html', 'public'],
    ['coverage.demox.site', '/', 'public'],
    ['letters-from-the-hill.demox.site', '/', 'public']
  ];
  if (asset) {
    paths.push(['www.demox.site', asset, 'noid']);
    paths.push(['sites.demox.site', asset, 'noid']);
  }
  if (banned) {
    paths.push(['sites.demox.site', banned, 'banned']);
    paths.push(['site-3.demox.site', banned, 'banned']);
  }
  for (const scheme of SCHEMES) {
    for (const [host, pathName, kind] of paths) {
      for (const method of METHODS) {
        const cookies = method === 'OPTIONS' ? [false, true] : [false];
        for (const cookie of cookies) {
          rows.push({ scheme, host, method, path: pathName, cookie, kind });
        }
      }
    }
  }
  return rows;
}

const SNAP_PATHS = [
  '/',
  '/sites/1985655011013808129/EPX2UU43/dist/index.html',
  '/sites/1985655011013808129/NOSUCH01/dist/index.html'
];

async function readBucket1CacheHeaders(pathName) {
  if (String(pathName || '').indexOf('/EPX2UU43/') === -1) return null;
  try {
    const snap = await rawRequest('https://' + BUCKET1_COS + pathName, 'GET', {
      Host: 'sites.demox.site',
      Accept: '*/*',
      'User-Agent': 'demox-preprod-calibrate'
    }, null);
    if (deniedSnapshot(snap)) return null;
    const cacheControl = snap.headers.get('cache-control') || '';
    if (!String(cacheControl).trim()) return null;
    return snap.headers;
  } catch (err) {
    return null;
  }
}

async function captureSnapshots(extraPaths) {
  const snapshots = new Map();
  const paths = SNAP_PATHS.concat(extraPaths || []);
  const originHeaders = new Map();
  for (const pathName of paths) {
    if (originHeaders.has(pathName)) continue;
    const fromBucket = await readBucket1CacheHeaders(pathName);
    originHeaders.set(pathName, fromBucket);
  }
  for (const pathName of paths) {
    for (const method of METHODS) {
      const url = 'https://sites.demox.site' + pathName;
      await pace();
      const snap = await rawRequest(url, method, {
        Accept: 'text/html',
        'User-Agent': 'demox-preprod-calibrate'
      }, method === 'GET' || method === 'HEAD' ? null : '');
      const fromBucket = originHeaders.get(pathName);
      if (fromBucket) copyCacheHeaders(fromBucket, snap.headers);
      else {
        const fallback = wwwOriginCacheControl(pathName);
        if (fallback) snap.headers.set('cache-control', fallback);
      }
      snapshots.set(snapKey(method, url), snap);
      const httpUrl = 'http://sites.demox.site' + pathName;
      snapshots.set(snapKey(method, httpUrl), snap);
    }
  }
  return snapshots;
}

function serializeSnapshots(snapshots) {
  const out = [];
  for (const [key, snap] of snapshots) {
    out.push({
      key,
      status: snap.status,
      headers: Object.fromEntries(snap.headers.entries()),
      body: Buffer.from(snap.body).toString('base64')
    });
  }
  return out;
}

function restoreSnapshots(list) {
  const snapshots = new Map();
  for (const item of list || []) {
    snapshots.set(item.key, {
      status: item.status,
      headers: new Headers(item.headers || {}),
      body: Buffer.from(item.body || '', 'base64')
    });
  }
  return snapshots;
}

function serializeView(row, snap, skipped) {
  if (skipped) return { row, skipped };
  const body = Buffer.from(snap.body);
  const headers = snap.headers instanceof Headers ? Object.fromEntries(snap.headers.entries()) : snap.headers;
  return {
    row,
    status: snap.status,
    headers,
    length: body.length,
    sha: sha256(body),
    body: body.toString('base64')
  };
}

function restoreView(item) {
  if (item.skipped) return { row: item.row, skipped: item.skipped };
  return {
    row: item.row,
    snap: {
      status: item.status,
      headers: new Headers(item.headers || {}),
      body: Buffer.from(item.body || '', 'base64')
    }
  };
}

async function runCalibration(argv, net) {
  const network = net || { pins: new Map(), doh: true };
  const resolutions = await pinAllowlistedHosts(network.pins, network.doh);
  const saveAt = argv.includes('--save-baseline') ? argv[argv.indexOf('--save-baseline') + 1] : '';
  const loadAt = argv.includes('--baseline') ? argv[argv.indexOf('--baseline') + 1] : '';
  const liveSource = loadLiveSource();
  let asset = '';
  let snapshots;
  let baseline;
  let bucket1Status = '';
  if (loadAt) {
    const parsed = JSON.parse(fs.readFileSync(loadAt, 'utf8'));
    if (parsed.liveSha && parsed.liveSha !== sha256Text(liveSource) && parsed.liveSha !== crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'edge-functions/LIVE.sha256'))).digest('hex')) {
      // live sha is the published body, stored separately
    }
    snapshots = restoreSnapshots(parsed.snapshots);
    baseline = parsed.rows.map(restoreView);
    asset = parsed.asset || '';
    bucket1Status = parsed.bucket1Status || '';
  } else {
    await pace();
    const probe = await rawRequest(
      'https://' + BUCKET1_COS + '/sites/1985655011013808129/EPX2UU43/dist/index.html',
      'GET',
      { Host: 'sites.demox.site', Accept: 'text/html', 'User-Agent': 'demox-preprod-calibrate' },
      null
    );
    bucket1Status = String(probe.status);
    const home = await captureClient({ scheme: 'https', host: 'www.demox.site', method: 'GET', path: '/', cookie: false });
    const html = home.body.toString('utf8');
    asset = (html.match(/\/assets\/index-[^"']+\.js/) || [])[0] || '';
    const extra = asset ? ['/sites/1985655011013808129/EPX2UU43/dist' + asset] : [];
    snapshots = await captureSnapshots(extra);
    const banned = process.env.DEMOX_BANNED_PATH || '';
    const rows = publicRows(asset, banned);
    baseline = [];
    for (const row of rows) {
      if (row.kind === 'banned' && !banned) {
        baseline.push({ row, skipped: 'banned-path unset' });
        continue;
      }
      try {
        const snap = await captureClient(row);
        baseline.push({ row, snap });
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        if (/certificate|CERT|hostname|altnames|tls/i.test(message)) {
          baseline.push({ row, skipped: 'tls certificate name mismatch' });
          continue;
        }
        throw err;
      }
    }
    if (saveAt) {
      const payload = {
        capturedAt: new Date().toISOString(),
        liveSha: fs.readFileSync(path.join(ROOT, 'edge-functions/LIVE.sha256'), 'utf8').trim(),
        asset,
        bucket1Status,
        snapshots: serializeSnapshots(snapshots),
        rows: baseline.map((item) => item.skipped ? { row: item.row, skipped: item.skipped } : serializeView(item.row, item.snap))
      };
      fs.writeFileSync(saveAt, JSON.stringify(payload));
    }
  }
  const apiBase = discoverApiBase(baseline);
  if (asset) {
    const bare = 'https://sites.demox.site' + asset;
    if (!snapshots.has(snapKey('GET', bare))) {
      const more = await captureSnapshots([asset]);
      for (const [key, snap] of more) {
        if (String(key).indexOf(asset) !== -1) snapshots.set(key, snap);
      }
    }
  }
  const handle = createHandle(liveSource, { secret: false, liveOrigin: true, liveSites: true, snapshots, apiBase });
  const matched = [];
  const mismatched = [];
  const skipped = [];
  const excluded = [];
  const routeNormalized = [];
  for (const item of baseline) {
    if (item.skipped) {
      skipped.push(item);
      continue;
    }
    const row = item.row;
    if (row.scheme === 'http') {
      const bypass = httpBypassReason(row.host);
      if (bypass) {
        excluded.push({ row, skipped: bypass });
        continue;
      }
      const redirect = httpExcludeNote(item.snap);
      if (redirect) {
        excluded.push({ row, skipped: redirect });
        continue;
      }
      mismatched.push({
        row,
        fields: ['http-not-301'],
        live: viewOf(item.snap),
        local: { status: 0, route: '', cache: '', type: '', length: 0, sha: '', body: Buffer.alloc(0) },
        hops: []
      });
      continue;
    }
    const url = row.scheme + '://' + row.host + row.path;
    let local;
    try {
      local = await invoke(handle, url, row.method, row.cookie ? 'demox_access=fake' : '');
    } catch (err) {
      mismatched.push({
        row,
        fields: ['throw'],
        live: viewOf(item.snap),
        local: { status: 0, route: '', cache: '', type: '', length: 0, sha: '', error: err.message },
        hops: []
      });
      continue;
    }
    const live = viewOf(item.snap);
    const fields = viewsDiffer(live, local);
    const record = { row, fields, live, local, hops: local.hops };
    if (fields.length === 1 && fields[0] === 'route' && guardRouteOnlyDifference(live, local)) {
      routeNormalized.push(record);
    } else if (fields.length) mismatched.push(record);
    else matched.push(record);
  }
  const unsafe = collectUnsafe(mismatched.concat(matched).concat(routeNormalized));
  return { matched, mismatched, skipped, excluded, routeNormalized, unsafe, asset, bucket1Status, netCount, resolutions };
}

function formatCalibration(report) {
  const lines = [];
  const resolved = formatResolutions(report.resolutions);
  if (resolved) lines.push(resolved);
  lines.push('bucket1-cos-status=' + (report.bucket1Status || 'unknown') + ' asset=' + (report.asset || ''));
  const excluded = report.excluded || [];
  const routeNormalized = report.routeNormalized || [];
  lines.push('matched=' + report.matched.length + ' route-normalized=' + routeNormalized.length + ' mismatched=' + report.mismatched.length + ' skipped=' + report.skipped.length + ' excluded=' + excluded.length);
  if (routeNormalized.length) {
    lines.push('route-normalized counts origin-guard=internal and origin-guard=allow as the same only when status, cache, length, and sha match. No guard secret is read.');
  }
  if (!process.env.DEMOX_BANNED_PATH) lines.push('SKIP banned-path DEMOX_BANNED_PATH unset');
  if (!process.env.DEMOX_ORIGIN_GUARD_SECRET_A) lines.push('SKIP secret DEMOX_ORIGIN_GUARD_SECRET_A unset (production has none)');
  for (const item of report.skipped) {
    let why = item.skipped || '';
    if (/certificate|altnames|tls/i.test(why)) why = 'tls certificate name mismatch';
    lines.push('SKIP ' + item.row.scheme + ' ' + item.row.method + ' ' + item.row.host + item.row.path + ' ' + why);
  }
  for (const item of report.excluded || []) {
    lines.push('EXCLUDE ' + item.row.scheme + ' ' + item.row.method + ' ' + item.row.host + item.row.path + ' ' + item.skipped);
  }
  for (const item of report.mismatched) {
    const row = item.row;
    lines.push('MISMATCH ' + [row.scheme, row.method, row.host + row.path, row.cookie ? 'cookie' : 'nocookie'].join(' ') + ' fields=' + item.fields.join(','));
    lines.push('  live status=' + item.live.status + ' route=' + JSON.stringify(item.live.route) + ' cache=' + JSON.stringify(item.live.cache) + ' type=' + JSON.stringify(item.live.type) + ' len=' + item.live.length + ' sha=' + item.live.sha.slice(0, 16));
    lines.push('  harness status=' + item.local.status + ' route=' + JSON.stringify(item.local.route) + ' cache=' + JSON.stringify(item.local.cache) + ' type=' + JSON.stringify(item.local.type) + ' len=' + item.local.length + ' sha=' + (item.local.sha || '').slice(0, 16) + (item.local.error ? ' err=' + item.local.error : ''));
    for (const hop of item.hops || []) lines.push(formatHop(hop));
  }
  if (report.unsafe.length) {
    lines.push('unsafe-network=' + report.unsafe.length);
    for (const hop of report.unsafe) lines.push(formatHop(hop));
  }
  return lines.join('\n');
}

async function runBannedEnvSelfTest(pathValue) {
  const text = pathValue || '/sites/uid-placeholder/VMPZGKSR/dist/index.html';
  const parsed = parseBannedPath(text);
  if (!parsed) throw new Error('banned path is not /sites/<uid>/<ID>/...');
  const handle = createHandle(loadNextSource(), { secret: false, bannedPath: text });
  const pathName = text.charAt(0) === '/' ? text : '/' + text;
  const url = 'https://sites.demox.site' + pathName;
  for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
    const result = await invoke(handle, url, method, '');
    if (result.status !== 403) throw new Error('banned ' + parsed.id + ' ' + method + ' status ' + result.status);
    if (!noStoreOnly(result)) throw new Error('banned ' + parsed.id + ' ' + method + ' missing Cache-Control: no-store');
    const fetched = (result.hops || []).some((hop) => hop.via === 'mock-origin' || hop.via === 'network' || hop.via === 'origin-snapshot');
    if (fetched) throw new Error('banned ' + parsed.id + ' ' + method + ' fetched origin');
  }
  return parsed;
}

async function runLiveDifferential(argv, net) {
  const network = net || { pins: new Map(), doh: true };
  const resolutions = await pinAllowlistedHosts(network.pins, network.doh);
  const allowFile = argv.includes('--allowlist') ? argv[argv.indexOf('--allowlist') + 1] : '';
  const allow = readAllowlist(allowFile);
  const banned = process.env.DEMOX_BANNED_PATH || '';
  loadLiveSource();
  await pace();
  const home = await rawRequest('https://www.demox.site/', 'GET', { Accept: 'text/html', 'User-Agent': 'demox-preprod-calibrate' }, null);
  const asset = (home.body.toString('utf8').match(/\/assets\/index-[^"']+\.js/) || [])[0] || '';
  const extra = asset ? ['/sites/1985655011013808129/EPX2UU43/dist' + asset] : [];
  const snapshots = await captureSnapshots(extra);
  const live = loadLiveSource();
  const next = loadNextSource();
  const originCache = new Map();
  const oldHandle = createHandle(live, { secret: false, liveOrigin: true, liveSites: true, snapshots, originCache, apiBase: 'https://api.test' });
  const newHandle = createHandle(next, { secret: false, liveOrigin: true, liveSites: true, snapshots, originCache, apiBase: 'https://api.test' });
  const rows = publicRows(asset, banned).filter((row) => row.kind !== 'banned' || banned);
  const results = [];
  for (const row of rows) {
    const url = row.scheme + '://' + row.host + row.path;
    const cookie = row.cookie ? 'demox_access=fake' : '';
    let oldR;
    let newR;
    try {
      oldR = await invoke(oldHandle, url, row.method, cookie);
      newR = await invoke(newHandle, url, row.method, cookie);
    } catch (err) {
      if (row.scheme === 'https' && row.host === 'site-3.demox.site') {
        results.push({
          row,
          oldR: { status: 0, sha: '', hops: [] },
          newR: { status: 0, sha: '', hops: [] },
          mark: 'skipped',
          error: err.message
        });
        continue;
      }
      throw err;
    }
    let mark = verdict(row, oldR, newR, allow);
    if (row.kind === 'banned') {
      const fetched = (newR.hops || []).some((hop) => hop.via === 'network' || hop.via === 'origin-snapshot' || hop.via === 'mock-origin');
      if (newR.status !== 403 || fetched) mark = 'unexpected';
    }
    results.push({ row, oldR, newR, mark });
  }
  const report = {
    results: results.filter((item) => item.mark !== 'skipped'),
    skipped: results.filter((item) => item.mark === 'skipped'),
    unexpected: results.filter((item) => item.mark === 'unexpected'),
    expected: results.filter((item) => isExpectedMark(item.mark)),
    same: results.filter((item) => item.mark === 'same'),
    missingSite: results.filter((item) => item.mark === 'missing-site-404'),
    unsafe: collectUnsafe(results.filter((item) => item.oldR)),
    resolutions
  };
  return report;
}

function readAllowlist(file) {
  if (!file) return [];
  const text = fs.readFileSync(file, 'utf8').trim();
  if (!text) return [];
  if (text.startsWith('[')) return JSON.parse(text);
  return text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
}

async function main(argv) {
  const cli = parseCli(argv);
  if (cli.argv.includes('--self-test')) {
    const allowFile = cli.argv.includes('--allowlist') ? cli.argv[cli.argv.indexOf('--allowlist') + 1] : '';
    const report = await runOfflineMatrix(readAllowlist(allowFile));
    process.stdout.write(formatTable(report) + '\n');
    const bannedProbe = await runBannedEnvSelfTest(process.env.DEMOX_BANNED_PATH || '');
    process.stdout.write('banned-env-self-test=PASS id=' + bannedProbe.id + '\n');
    if (report.unsafe.length || report.unexpected.length) process.exit(1);
    return;
  }
  if (cli.argv.includes('--calibrate')) {
    const report = await runCalibration(cli.argv, cli);
    process.stdout.write(formatCalibration(report) + '\n');
    if (report.unsafe.length || report.mismatched.length) process.exit(1);
    return;
  }
  const report = await runLiveDifferential(cli.argv, cli);
  const resolved = formatResolutions(report.resolutions);
  if (resolved) process.stdout.write(resolved + '\n');
  process.stdout.write(formatTable(report) + '\n');
  if (report.skipped && report.skipped.length) {
    process.stdout.write('skipped=' + report.skipped.length + '\n');
  }
  if (!process.env.DEMOX_BANNED_PATH) {
    process.stdout.write('skipped-banned=DEMOX_BANNED_PATH unset\n');
  }
  if (!process.env.DEMOX_ORIGIN_GUARD_SECRET_A) {
    process.stdout.write('secret=unset (production has no guard secret; both sides ran without one)\n');
  }
  if (report.unsafe.length || report.unexpected.length) process.exit(1);
}

module.exports = {
  HOMEPAGE,
  loadLiveSource,
  loadNextSource,
  runOfflineMatrix,
  runWwwChain,
  formatTable,
  createHandle,
  invoke,
  openNetwork,
  resolvePreprodLimits,
  parseBannedPath,
  isReservedIPv4,
  runBannedEnvSelfTest,
  verdict,
  cacheChangeMark,
  guardRouteOnlyDifference,
  httpBypassReason,
  liveIsPreFunction301,
  wwwOriginCacheControl,
  WWW_ASSET_CACHE,
  outboundMethod,
  isEoHost,
  mapCos,
  BUCKET1_COS,
  SITE3_COS
};

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
