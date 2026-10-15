const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'subdomain-router.js'), 'utf8');
const TOKEN_HEADER = 'x-demox-origin-token';
const SECRET_A = 'origin-guard-test-slot-a-placeholder';
const SECRET_B = 'origin-guard-test-slot-b-placeholder';
const PUBLIC_HTML = '<!doctype html><html><head><title>Keep</title><script src="/assets/app.js"></script></head><body><main>Public body</main></body></html>';
const LETTERS_HTML = '<!doctype html><html><head><title>山间来信</title><link rel="stylesheet" href="/assets/essay.css"></head><body><main>山间来信</main></body></html>';
const SPA_HTML = '<!doctype html><html><head><title>Coverage</title><script src="/assets/dashboard.js"></script></head><body><main>Dashboard</main></body></html>';
const CUSTOM_404 = '<!doctype html><html><head><title>Missing</title></head><body><h1>Missing page</h1></body></html>';

function fakeCache() {
  const store = new Map();
  const puts = [];
  return {
    store,
    puts,
    cache: {
      match: async (req) => {
        const key = String(req && req.url ? req.url : req);
        const entry = store.get(key);
        return entry ? new Response(entry.body, { headers: entry.headers }) : undefined;
      },
      put: async (req, resp) => {
        const key = String(req && req.url ? req.url : req);
        const entry = { body: await resp.text(), headers: Object.fromEntries(resp.headers.entries()) };
        store.set(key, entry);
        puts.push({ key, ...entry });
      },
      delete: async (req) => store.delete(String(req && req.url ? req.url : req))
    }
  };
}

function headerBag(input, init) {
  if (init && init.headers) return new Headers(init.headers);
  if (input && typeof input === 'object' && input.headers) return new Headers(input.headers);
  return new Headers();
}

function makeGuard({ secret = '', secretA = '', secretB = '', kid = '', resolver, origin = null, now = 1_000_000, budget = null } = {}) {
  const calls = { resolve: [], origin: [] };
  const cache = fakeCache();
  let handle = null;
  const event = { waitUntil() {}, passThroughOnException() {} };
  const slotA = secretA || secret;
  const env = {
    DEMOX_API_URL: 'https://api.test',
    DEMOX_HOME_URL: 'https://www.demox.site'
  };
  if (slotA) env.DEMOX_ORIGIN_GUARD_SECRET_A = slotA;
  if (secretB) env.DEMOX_ORIGIN_GUARD_SECRET_B = secretB;
  if (kid) env.DEMOX_ORIGIN_GUARD_KID = kid;
  else if (slotA || secretB) env.DEMOX_ORIGIN_GUARD_KID = 'A';
  const ctx = vm.createContext({
    URL,
    Request,
    Response,
    Headers,
    crypto,
    TextEncoder,
    setTimeout,
    clearTimeout,
    AbortController,
    console: { log() {}, warn() {}, error() {} },
    env,
    caches: { default: cache.cache },
    addEventListener() {},
    fetch: async (input, init) => {
      const href = String(input && input.url ? input.url : input);
      const headers = headerBag(input, init);
      if (href.includes('/resolve-subdomain') || href.includes('/check-site-access')) {
        const payload = JSON.parse(init.body);
        calls.resolve.push(payload);
        return resolver(payload, calls.resolve.length, init, href);
      }
      const info = {
        href,
        headers,
        token: headers.get(TOKEN_HEADER) || '',
        hostHeader: headers.get('host')
      };
      calls.origin.push(info);
      if (origin) {
        const custom = await origin(info, {
          reenter: (url, requestHeaders) => handle(new Request(url, { method: 'GET', headers: requestHeaders }), event)
        });
        if (custom) return custom;
      }
      return new Response(PUBLIC_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  });
  vm.runInContext(
    `${source}\nglobalThis.__now = ${now};\nnowMs = function () { return globalThis.__now; };\n` +
      'globalThis.__testHooks = { handle, signOriginInternalToken, verifyOriginInternalToken, timingSafeEqual, parseOriginSitePath, originPathUnsafe, ORIGIN_RESOLVE_BAN_TTL, ORIGIN_RESOLVE_FOUND_TTL, ORIGIN_RESOLVE_NEGATIVE_TTL, RESOLVE_CACHE_TTL, ORIGIN_RESOLVE_BUDGET_MS, ORIGIN_GUARD_ALLOWLIST, ORIGIN_GUARD_HOSTS, ORIGIN_GUARD_HOST_RE, ORIGIN_INTERNAL_TOKEN_TTL_MS, ORIGIN_TOKEN_CLOCK_SKEW_MS, ORIGIN_OBJECT_MAX_AGE, ORIGIN_GUARD_MIN_SECRET_BYTES };',
    ctx
  );
  if (budget) {
    vm.runInContext(
      `ORIGIN_RESOLVE_BUDGET_MS = ${budget.budget}; ORIGIN_RESOLVE_ATTEMPT_MS = ${budget.attempt}; ORIGIN_RESOLVE_RETRY_DELAY_MS = ${budget.delay};`,
      ctx
    );
  }
  handle = ctx.__testHooks.handle;
  const visit = async (url, headers) => {
    const response = await handle(new Request(url, { headers: headers || { Accept: 'text/html' } }), event);
    return { response, html: await response.text() };
  };
  const call = async (url, init) => {
    const response = await handle(new Request(url, init || { headers: { Accept: 'text/html' } }), event);
    return { response, html: await response.text() };
  };
  return {
    calls,
    cache,
    visit,
    call,
    ctx,
    advance: (ms) => { ctx.__now += ms; }
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

function allow(id, uid) {
  return { success: true, allow: true, path: `sites/${uid}/${id}/dist` };
}

function assertOptionsCors(response) {
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('allow') || '', /^GET, HEAD$/);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-headers'), 'Range, If-None-Match, If-Modified-Since');
  assert.equal(response.headers.get('access-control-max-age'), '86400');
  const corsNames = [];
  response.headers.forEach((value, name) => {
    if (name.toLowerCase().indexOf('access-control-') === 0) corsNames.push(name.toLowerCase());
  });
  corsNames.sort();
  assert.deepEqual(corsNames, [
    'access-control-allow-headers',
    'access-control-allow-methods',
    'access-control-allow-origin',
    'access-control-max-age'
  ]);
}

function originTokenMessage(exp, method, host, pathname, search, kid) {
  return [
    'v1',
    String(kid || ''),
    String(exp),
    String(method || 'GET').toUpperCase(),
    String(host || '').toLowerCase(),
    String(pathname || ''),
    String(search || '')
  ].join('\n');
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Buffer.from(sig).toString('hex');
}

function verdictResolver(map) {
  return (payload, n, init, href) => {
    if (href.includes('/check-site-access')) return json({ success: true, allowed: true });
    if (payload.websiteId) {
      const spec = map[payload.websiteId];
      if (spec === 'throw') throw new TypeError('network error');
      if (typeof spec === 'function') return spec(payload, n, init);
      return json(spec || { success: true, allow: false, reason: 'not_found' });
    }
    if (map.label) return map.label(payload, n, init);
    throw new Error('unexpected label resolve ' + JSON.stringify(payload));
  };
}

test('origin ban and unban expire in 15s; non-ban host resolve stays at most 60s', () => {
  const probe = vm.createContext({
    URL, Request, Response, Headers, console, addEventListener() {}, fetch: async () => { throw new Error('no fetch'); }
  });
  vm.runInContext(`${source}\nglobalThis.__c = { ban: ORIGIN_RESOLVE_BAN_TTL, found: ORIGIN_RESOLVE_FOUND_TTL, negative: ORIGIN_RESOLVE_NEGATIVE_TTL, host: RESOLVE_CACHE_TTL, budget: ORIGIN_RESOLVE_BUDGET_MS, hosts: ORIGIN_GUARD_HOSTS, allow: ORIGIN_GUARD_ALLOWLIST, re: ORIGIN_GUARD_HOST_RE, objectMaxAge: ORIGIN_OBJECT_MAX_AGE };`, probe);
  assert.equal(probe.__c.ban, 15);
  assert.equal(probe.__c.found, 15);
  assert.ok(probe.__c.found <= probe.__c.ban);
  assert.ok(probe.__c.negative <= probe.__c.ban);
  assert.ok(probe.__c.host <= 60);
  assert.equal(probe.__c.host, 60);
  assert.equal(probe.__c.objectMaxAge, 60);
  assert.equal(probe.__c.budget, 1500);
  assert.equal(probe.__c.allow.length, 0);
  assert.equal(probe.__c.hosts.includes('sites.demox.site'), true);
  assert.equal(probe.__c.re.test('site-3.demox.site'), true);
  assert.equal(probe.__c.re.test('sites-eclick.demox.site'), true);
  assert.equal(probe.__c.re.test('origin-3.demox.site'), true);
  assert.equal(probe.__c.re.test('static.demox.site'), false);
  assert.equal(probe.__c.re.test('cdn.demox.site'), false);
  assert.match(source, /staleIfError:\s*false/);
  assert.match(source, /DEMOX_ORIGIN_GUARD_SECRET_A/);
  assert.match(source, /DEMOX_ORIGIN_GUARD_SECRET_B/);
  assert.match(source, /DEMOX_ORIGIN_GUARD_KID/);
  assert.doesNotMatch(source, /DEMOX_ORIGIN_GUARD_SECRET_A['"]?\s*[:=]\s*['"][A-Za-z0-9+/]{16,}['"]/);
});

test('banned, private, and owner-mismatch origin paths are the same 403 and do not fetch origin', async () => {
  const cases = ['BANNED1', 'PRIV8', 'MISMATCH'];
  const r = makeGuard({
    resolver: verdictResolver({
      BANNED1: { success: true, allow: false, reason: 'blocked' },
      PRIV8: { success: true, allow: false, reason: 'blocked' },
      MISMATCH: { success: true, allow: false, reason: 'blocked' }
    })
  });
  const pages = [];
  for (const id of cases) {
    const before = r.calls.origin.length;
    const { response, html } = await r.visit(`https://sites.demox.site/sites/owner-1/${id}/dist/index.html`);
    pages.push(html);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(html, /无法访问/);
    assert.doesNotMatch(html, /此站点已被停用|举报|私有|需要重新验证|登录后查看|Public body/);
    assert.equal(r.calls.origin.length, before);
  }
  assert.equal(pages[0], pages[1]);
  assert.equal(pages[1], pages[2]);
  const viaSite3 = await r.visit('https://site-3.demox.site/sites/owner-1/BANNED1/dist/index.html');
  assert.equal(viaSite3.response.status, 403);
  assert.equal(viaSite3.response.headers.get('cache-control'), 'no-store');
});

test('missing id is 404, a mismatched canonical path is 404, and neither fetches origin', async () => {
  const r = makeGuard({
    resolver: verdictResolver({
      GONE0001: { success: true, allow: false, reason: 'not_found' },
      PUBLIC1: { success: true, allow: true, path: 'sites/other-user/PUBLIC1/dist' }
    })
  });
  const missing = await r.visit('https://sites.demox.site/sites/owner-1/GONE0001/dist/index.html');
  assert.equal(missing.response.status, 404);
  assert.equal(missing.response.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(missing.html, /Public body/);
  const mismatched = await r.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html');
  assert.equal(mismatched.response.status, 404);
  assert.equal(r.calls.origin.length, 0);
});

test('an allow:true verdict that still says private is not served', async () => {
  const r = makeGuard({
    resolver: verdictResolver({
      PRIV8: { success: true, allow: true, path: 'sites/owner-1/PRIV8/dist', visibility: 'private' }
    })
  });
  const { response, html } = await r.visit('https://sites.demox.site/sites/owner-1/PRIV8/index.html');
  assert.equal(response.status, 403);
  assert.match(html, /无法访问/);
  assert.doesNotMatch(html, /此站点已被停用|私有/);
  assert.equal(r.calls.origin.length, 0);
});

test('a public origin path passes through with the same body and a client max-age of 60', async () => {
  const r = makeGuard({
    resolver: verdictResolver({ PUBLIC1: allow('PUBLIC1', 'owner-1') })
  });
  const { response, html } = await r.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html');
  assert.equal(response.status, 200);
  assert.equal(html, PUBLIC_HTML);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(r.calls.resolve[0].websiteId, 'PUBLIC1');
  assert.equal(r.calls.resolve[0].uid, 'owner-1');
  assert.equal(r.calls.resolve[0].subdomain, undefined);
});

test('paths that are not /sites/<uid>/<ID>/ are 403, including the empty allowlist targets', async () => {
  const r = makeGuard({
    resolver: () => { throw new Error('unparsed paths must not resolve'); }
  });
  for (const pathName of ['/', '/robots.txt', '/favicon.ico', '/health', '/_/assets/app.js', '/sites/only-uid']) {
    const { response } = await r.visit('https://sites.demox.site' + pathName);
    assert.equal(response.status, 403, pathName);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(r.calls.resolve.length, 0);
  assert.equal(r.calls.origin.length, 0);
  r.ctx.ORIGIN_GUARD_ALLOWLIST.push({ path: '/health', reason: 'test-only' });
  const allowed = await r.visit('https://sites.demox.site/health');
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.html, PUBLIC_HTML);
  const stillDenied = await r.visit('https://sites.demox.site/robots.txt');
  assert.equal(stillDenied.response.status, 403);
});

test('a site path without a trailing slash is judged, then redirected, never fetched unchecked', async () => {
  const r = makeGuard({
    resolver: verdictResolver({
      PUBLIC1: allow('PUBLIC1', 'owner-1'),
      BANNED1: { success: true, allow: false, reason: 'blocked' }
    })
  });
  const moved = await r.visit('https://sites.demox.site/sites/owner-1/PUBLIC1?x=1');
  assert.equal(moved.response.status, 308);
  assert.equal(moved.response.headers.get('location'), '/sites/owner-1/PUBLIC1/?x=1');
  assert.equal(moved.response.headers.get('cache-control'), 'no-store');
  const banned = await r.visit('https://site-3.demox.site/sites/owner-1/BANNED1');
  assert.equal(banned.response.status, 403);
  assert.equal(banned.response.headers.get('location'), null);
  assert.equal(r.calls.origin.length, 0);
});

test('resolve timeout or error with no cache is 503 no-store and does not fetch origin', async () => {
  const hang = makeGuard({
    budget: { budget: 80, attempt: 30, delay: 1 },
    resolver: (payload, n, init) => new Promise((resolve, reject) => {
      if (init && init.signal) init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })
  });
  const started = Date.now();
  const hung = await hang.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html');
  assert.ok(Date.now() - started < 500, '503 lands inside the resolve budget');
  assert.equal(hung.response.status, 503);
  assert.equal(hung.response.headers.get('cache-control'), 'no-store');
  assert.match(hung.html, /暂时无法访问/);
  assert.equal(hang.calls.origin.length, 0);
  assert.equal(hang.cache.puts.length, 0);

  const down = makeGuard({
    resolver: () => { throw new TypeError('network error'); }
  });
  const failed = await down.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html');
  assert.equal(failed.response.status, 503);
  assert.equal(failed.response.headers.get('cache-control'), 'no-store');
  assert.equal(down.calls.origin.length, 0);
  assert.equal(down.cache.puts.length, 0, 'errors are not cached');
  const again = await down.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html');
  assert.equal(again.response.status, 503);
  assert.ok(down.calls.resolve.length >= 4, 'the next request resolves again instead of sticking on a cached error');
});

test('one transient failure inside the budget still serves; a backend error is not retried', async () => {
  let attempts = 0;
  const r = makeGuard({
    resolver: () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('network error');
      return json(allow('PUBLIC1', 'owner-1'));
    }
  });
  const { response, html } = await r.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html');
  assert.equal(response.status, 200);
  assert.equal(html, PUBLIC_HTML);
  assert.equal(attempts, 2);

  const backend = makeGuard({
    resolver: () => json({ success: false, message: 'resolve failed' })
  });
  const denied = await backend.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html');
  assert.equal(denied.response.status, 503);
  assert.equal(backend.calls.resolve.length, 1);
  assert.equal(backend.calls.origin.length, 0);

  let hops = 0;
  const retry5xx = makeGuard({
    resolver: () => {
      hops += 1;
      return hops === 1 ? json({ message: 'bad gateway' }, 502) : json(allow('PUBLIC1', 'owner-1'));
    }
  });
  assert.equal((await retry5xx.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html')).response.status, 200);
  assert.equal(hops, 2);
});

test('a ban is 403 within 15s, an unban is 200 within 15s, and expiry plus resolver failure is 503', async () => {
  let mode = 'allow';
  const r = makeGuard({
    resolver: () => {
      if (mode === 'down') throw new TypeError('network error');
      if (mode === 'blocked') return json({ success: true, allow: false, reason: 'blocked' });
      return json(allow('PUBLIC1', 'owner-1'));
    }
  });
  assert.equal((await r.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html')).response.status, 200);
  const key = 'https://resolve.demox.site/v2/id/PUBLIC1/owner-1';
  const stored = r.cache.store.get(key);
  assert.match(stored.headers['cache-control'], /max-age=15\b/);
  assert.doesNotMatch(stored.headers['cache-control'], /max-age=60\b/);
  assert.doesNotMatch(stored.headers['cache-control'], /max-age=600\b/);

  mode = 'blocked';
  r.advance(14_000);
  const hidden = await r.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html');
  assert.equal(hidden.response.status, 200, 'a fresh allow entry still serves just inside 15s');
  r.advance(1_000);
  const beforeBan = r.calls.origin.length;
  const banned = await r.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html');
  assert.equal(banned.response.status, 403);
  assert.match(banned.html, /无法访问/);
  assert.doesNotMatch(banned.html, /此站点已被停用/);
  assert.doesNotMatch(banned.html, /Public body/);
  assert.equal(r.calls.origin.length, beforeBan, 'a ban must not fetch the object');
  assert.equal(JSON.parse(r.cache.store.get(key).body).status, 'blocked');
  assert.match(r.cache.store.get(key).headers['cache-control'], /max-age=15\b/);
  assert.doesNotMatch(r.cache.store.get(key).headers['cache-control'], /max-age=60\b/);

  mode = 'allow';
  r.advance(14_000);
  assert.equal((await r.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html')).response.status, 403);
  r.advance(1_000);
  const unbanned = await r.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html');
  assert.equal(unbanned.response.status, 200);
  assert.equal(unbanned.html, PUBLIC_HTML);

  mode = 'down';
  const duringOutage = await r.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html');
  assert.equal(duringOutage.response.status, 200);
  assert.equal(duringOutage.html, PUBLIC_HTML);
  r.advance(15_000);
  const beforeFail = r.calls.origin.length;
  const expiredOutage = await r.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html');
  assert.equal(expiredOutage.response.status, 503);
  assert.equal(expiredOutage.response.headers.get('cache-control'), 'no-store');
  assert.equal(r.calls.origin.length, beforeFail, 'expired cache plus an error must not fetch origin');
});

test('subdomain and custom-domain traffic keep the old resolver, including stale-if-error', async () => {
  let labelDown = false;
  const r = makeGuard({
    resolver: (payload) => {
      if (payload.websiteId) throw new Error('subdomain traffic must not use by-id resolve');
      if (labelDown) throw new TypeError('network error');
      if (payload.host) {
        return json({
          success: true,
          path: 'sites/owner-1/CUST1/dist',
          websiteId: 'CUST1',
          origin: 'sites.demox.site',
          visibility: 'public',
          hideWatermark: true
        });
      }
      return json({
        success: true,
        path: 'sites/owner-1/LCJAIAC0/dist',
        websiteId: 'LCJAIAC0',
        origin: 'site-3.demox.site',
        visibility: 'public',
        hideWatermark: true
      });
    },
    origin: async (info) => {
      if (info.href.startsWith('http://site-3.demox.site/') || info.href.includes('sites.demox.site/sites/owner-1/')) {
        return new Response(LETTERS_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      return null;
    }
  });
  const home = await r.visit('https://letters-from-the-hill.demox.site/');
  assert.equal(home.response.status, 200);
  assert.match(home.html, /山间来信/);
  assert.match(home.response.headers.get('x-demox-route') || '', /^resolve=/);
  labelDown = true;
  r.advance(5 * 60_000);
  const stale = await r.visit('https://letters-from-the-hill.demox.site/');
  assert.equal(stale.response.status, 200, 'a resolve outage must not take down a normal site inside the existing stale window');
  assert.match(stale.html, /山间来信/);

  labelDown = false;
  const custom = await r.visit('https://blog.example.com/');
  assert.equal(custom.response.status, 200);
  assert.match(custom.html, /山间来信/);

  const officialPrivate = makeGuard({
    resolver: () => json({
      success: true,
      path: 'sites/owner-1/PRIV8/dist',
      websiteId: 'PRIV8',
      origin: 'sites.demox.site',
      visibility: 'private',
      hideWatermark: true
    })
  });
  const gate = await officialPrivate.visit('https://priv8.demox.site/');
  assert.match(gate.html, /需要重新验证/);
  assert.equal(officialPrivate.calls.origin.length, 0);
  assert.equal(officialPrivate.calls.resolve.some((payload) => payload.websiteId), false);
});

test('forged internal markers from an external request stay guarded', async () => {
  const r = makeGuard({
    secret: SECRET_A,
    resolver: verdictResolver({
      BANNED1: { success: true, allow: false, reason: 'blocked' },
      PUBLIC1: allow('PUBLIC1', 'owner-1')
    })
  });
  const forgedHeaders = {
    Accept: 'text/html',
    'x-demox-origin-token': '1.' + 'ab'.repeat(32),
    'x-demox-internal': '1',
    'x-origin-internal': 'true',
    'user-agent': 'demox-origin-fetch'
  };
  const banned = await r.visit('https://sites.demox.site/sites/owner-1/BANNED1/dist/index.html', forgedHeaders);
  assert.equal(banned.response.status, 403);
  assert.equal(r.calls.origin.length, 0);
  assert.ok(r.calls.resolve.some((payload) => payload.websiteId === 'BANNED1'));

  const copied = await r.ctx.__testHooks.signOriginInternalToken('GET', 'sites.demox.site', '/sites/owner-1/PUBLIC1/dist/index.html', '');
  const wrongPath = await r.visit('https://sites.demox.site/sites/owner-1/BANNED1/dist/index.html', {
    Accept: 'text/html',
    'x-demox-origin-token': copied
  });
  assert.equal(wrongPath.response.status, 403);
  assert.equal(r.calls.origin.filter((info) => info.href.includes('BANNED1')).length, 0);

  r.advance(r.ctx.__testHooks.ORIGIN_INTERNAL_TOKEN_TTL_MS + r.ctx.__testHooks.ORIGIN_TOKEN_CLOCK_SKEW_MS + 1000);
  const expired = await r.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html', {
    Accept: 'text/html',
    'x-demox-origin-token': copied
  });
  assert.equal(expired.response.status, 200);
  assert.ok(r.calls.resolve.some((payload) => payload.websiteId === 'PUBLIC1'), 'an expired token does not skip the guard');
  assert.equal(r.calls.origin.some((info) => info.href.includes('PUBLIC1') && info.token), false, 'client token is stripped before origin');
});

test('a valid internal token skips the guard, and the origin hop does not carry the token', async () => {
  const seen = [];
  const r = makeGuard({
    secret: SECRET_A,
    resolver: (payload, n, init, href) => {
      if (payload.websiteId) throw new Error('internal re-entry must not resolve by id');
      if (href.includes('/check-site-access')) return json({ success: true, allowed: true });
      if (payload.host === 'private.example.com') {
        return json({
          success: true,
          path: 'sites/owner-1/PRIV1/dist',
          websiteId: 'PRIV1',
          origin: 'sites.demox.site',
          visibility: 'private',
          hideWatermark: true
        });
      }
      return json({
        success: true,
        path: 'sites/owner-1/PUB1/dist',
        websiteId: 'PUB1',
        origin: 'sites.demox.site',
        visibility: 'public',
        hideWatermark: true
      });
    },
    origin: async (info, helpers) => {
      seen.push(info);
      if (info.token) {
        assert.equal(info.hostHeader, null);
        return helpers.reenter(info.href, info.headers);
      }
      return new Response(PUBLIC_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  });
  const pub = await r.visit('https://pub1.demox.site/');
  assert.equal(pub.response.status, 200);
  assert.match(pub.html, /Public body/);
  assert.equal(seen.filter((info) => info.token).length, 1);
  assert.ok(seen.some((info) => !info.token));
  assert.equal(r.calls.resolve.some((payload) => payload.websiteId), false);

  const priv = await r.visit('https://private.example.com/', {
    Accept: 'text/html',
    Cookie: 'demox_access=tok'
  });
  assert.equal(priv.response.status, 200);
  assert.match(priv.html, /Public body/);
  assert.doesNotMatch(priv.html, /需要重新验证|此站点已被停用/);
});

test('www document fetch carries a token only when the secret is set, and re-entry strips it', async () => {
  const seen = [];
  const r = makeGuard({
    secret: SECRET_A,
    resolver: (payload) => {
      if (payload.websiteId) throw new Error('www re-entry must not resolve by id');
      return json({
        success: true,
        path: 'sites/1985655011013808129/EPX2UU43/dist',
        websiteId: 'EPX2UU43',
        origin: 'sites.demox.site',
        visibility: 'public',
        hideWatermark: true
      });
    },
    origin: async (info, helpers) => {
      seen.push(info);
      if (info.token) return helpers.reenter(info.href, info.headers);
      return new Response(PUBLIC_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  });
  const home = await r.visit('https://www.demox.site/');
  assert.equal(home.response.status, 200);
  assert.match(home.html, /Public body/);
  assert.equal(seen.filter((info) => info.token).length, 1);
  assert.ok(seen.some((info) => !info.token && info.href.includes('/EPX2UU43/')));
  assert.equal(r.calls.resolve.some((payload) => payload.websiteId), false);
});

test('without the secret, normal origin fetches add no marker and a forged header is still guarded', async () => {
  const r = makeGuard({
    resolver: (payload) => {
      if (payload.websiteId) return json({ success: true, allow: false, reason: 'blocked' });
      return json({
        success: true,
        path: 'sites/owner-1/PUB1/dist',
        websiteId: 'PUB1',
        origin: 'sites.demox.site',
        visibility: 'public',
        hideWatermark: true
      });
    }
  });
  const home = await r.visit('https://pub1.demox.site/');
  assert.equal(home.response.status, 200);
  assert.match(home.html, /Public body/);
  assert.equal(r.calls.origin.every((info) => !info.token), true);
  const forged = await r.visit('https://sites.demox.site/sites/owner-1/BANNED1/dist/index.html', {
    Accept: 'text/html',
    'x-demox-origin-token': 'internal',
    'x-demox-internal': '1'
  });
  assert.equal(forged.response.status, 403);
  assert.equal(r.calls.origin.some((info) => info.href.includes('BANNED1')), false);
});

test('timingSafeEqual accepts only an exact match', () => {
  const probe = vm.createContext({
    URL, Request, Response, Headers, console, addEventListener() {}, fetch: async () => { throw new Error('no fetch'); }
  });
  vm.runInContext(`${source}\nglobalThis.__eq = timingSafeEqual;`, probe);
  assert.equal(probe.__eq('abc', 'abc'), true);
  assert.equal(probe.__eq('abc', 'abd'), false);
  assert.equal(probe.__eq('abc', 'abcd'), false);
  assert.equal(probe.__eq('', 'abc'), false);
});

test('first screen: three public shapes stay 200 via subdomain and the bucket-1 origin path', async () => {
  const r = makeGuard({
    resolver: (payload) => {
      if (payload.websiteId === 'EPX2UU43') return json(allow('EPX2UU43', '1985655011013808129'));
      if (payload.websiteId) throw new Error('unexpected id ' + payload.websiteId);
      if (payload.subdomain === 'www') {
        return json({
          success: true,
          path: 'sites/1985655011013808129/EPX2UU43/dist',
          websiteId: 'EPX2UU43',
          origin: 'sites.demox.site',
          visibility: 'public',
          hideWatermark: true
        });
      }
      if (payload.subdomain === 'letters-from-the-hill') {
        return json({
          success: true,
          path: 'sites/owner-1/LCJAIAC0/dist',
          websiteId: 'LCJAIAC0',
          origin: 'site-3.demox.site',
          visibility: 'public',
          hideWatermark: true
        });
      }
      if (payload.subdomain === 'coverage') {
        return json({
          success: true,
          path: 'sites/owner-1/COVERAGE/dist',
          websiteId: 'COVERAGE',
          origin: 'site-3.demox.site',
          visibility: 'public',
          hideWatermark: true
        });
      }
      if (payload.subdomain === 'miss404') {
        return json({
          success: true,
          path: 'sites/owner-1/MISS404/dist',
          websiteId: 'MISS404',
          origin: 'sites.demox.site',
          visibility: 'public',
          hideWatermark: true
        });
      }
      return json({ success: false, message: 'not found' });
    },
    origin: async (info) => {
      if (info.href.includes('/404.html')) {
        return new Response(CUSTOM_404, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      if (info.href.includes('MISS404')) {
        return new Response('missing', { status: 404, headers: { 'Content-Type': 'text/plain' } });
      }
      if (info.href.includes('/index.html') && info.href.includes('COVERAGE')) {
        return new Response(SPA_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      if (info.href.includes('COVERAGE')) {
        return new Response('missing', { status: 404, headers: { 'Content-Type': 'text/plain' } });
      }
      if (info.href.includes('LCJAIAC0')) {
        return new Response(LETTERS_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      if (info.href.includes('EPX2UU43')) {
        return new Response(PUBLIC_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      return null;
    }
  });

  const www = await r.visit('https://www.demox.site/');
  assert.equal(www.response.status, 200);
  assert.match(www.html, /<title>Keep<\/title>/);
  assert.match(www.html, /Public body/);

  const origin = await r.visit('https://sites.demox.site/sites/1985655011013808129/EPX2UU43/dist/index.html');
  assert.equal(origin.response.status, 200);
  assert.equal(origin.html, PUBLIC_HTML);
  assert.match(origin.response.headers.get('x-demox-route') || '', /origin-guard=allow/);

  const letters = await r.visit('https://letters-from-the-hill.demox.site/');
  assert.equal(letters.response.status, 200);
  assert.match(letters.html, /<title>山间来信<\/title>/);
  assert.match(letters.response.headers.get('x-demox-route') || '', /^resolve=/);

  const spa = await r.visit('https://coverage.demox.site/dashboard');
  assert.equal(spa.response.status, 200);
  assert.match(spa.html, /<title>Coverage<\/title>/);
  assert.match(spa.html, /Dashboard/);

  const missing = await r.visit('https://miss404.demox.site/no-such-page');
  assert.equal(missing.response.status, 404);
  assert.match(missing.html, /Missing page/);
  assert.doesNotMatch(missing.html, /站点未发布|此站点已被停用/);
});

test('M1: banned /sites/ objects are not served from bypass hosts and do not fetch origin', async () => {
  const r = makeGuard({
    resolver: (payload) => {
      if (payload.websiteId === 'BANNED1') return json({ success: true, allow: false, reason: 'blocked' });
      if (payload.websiteId) throw new Error('unexpected id ' + payload.websiteId);
      return json({ success: false, message: 'not found' });
    }
  });
  const path = '/sites/owner-1/BANNED1/dist/index.html';
  const hosts = [
    'https://static.demox.site',
    'https://cdn.demox.site',
    'https://randomxyz123.demox.site',
    'https://sites-eclick.demox.site',
    'https://origin-3.demox.site',
    'https://not-bound.example'
  ];
  for (const host of hosts) {
    const before = r.calls.origin.length;
    const { response, html } = await r.visit(host + path);
    assert.notEqual(response.status, 200, host);
    assert.equal(r.calls.origin.length, before, host);
    assert.doesNotMatch(html, /Public body/);
  }
  const encoded = await r.visit('https://static.demox.site/%73ites/owner-1/BANNED1/dist/index.html');
  assert.notEqual(encoded.response.status, 200);
  assert.equal(r.calls.origin.length, 0);
  const bypassPaths = [
    '/SITES/x',
    '/Sites/x',
    '/%53ITES/x',
    '/sites;x',
    '/sites-foo',
    '/%20sites/x',
    '/%E3%80%80sites/x',
    '/%EF%BC%B3ITES/x'
  ];
  const bypassHosts = [
    'https://static.demox.site',
    'https://cdn.demox.site',
    'https://randomxyz123.demox.site',
    'https://not-bound.example'
  ];
  for (const host of bypassHosts) {
    for (const bypassPath of bypassPaths) {
      const before = r.calls.origin.length;
      const { response } = await r.visit(host + bypassPath);
      assert.notEqual(response.status, 200, host + bypassPath);
      assert.equal(r.calls.origin.length, before, host + bypassPath);
    }
  }
  const formatPaths = [
    '/%E2%80%8Bsites/x',
    '/%C2%ADsites/x',
    '/%FFsites/x'
  ];
  for (const host of bypassHosts) {
    for (const formatPath of formatPaths) {
      const before = r.calls.origin.length;
      const { response } = await r.visit(host + formatPath);
      assert.notEqual(response.status, 200, host + formatPath);
      assert.equal(r.calls.origin.length, before, host + formatPath);
      if (formatPath.indexOf('%FF') !== -1) assert.equal(response.status, 400, host + formatPath);
    }
  }
  const root = await r.visit('https://sites-eclick.demox.site/');
  assert.notEqual(root.response.status, 200);
  assert.equal(r.calls.origin.length, 0);
  const open = await r.visit('https://randomxyz123.demox.site/index.html');
  assert.equal(open.response.status, 200);
  assert.equal(r.calls.origin.length, 1, 'a non-/sites/ unknown host still passthroughs');
});

test('M2: ..%2F traversal and other unsafe paths are rejected before lookup, signing, or origin', async () => {
  const r = makeGuard({
    secret: SECRET_A,
    resolver: () => { throw new Error('must not look up'); }
  });
  const unsafe = r.ctx.__testHooks.originPathUnsafe;
  const parse = r.ctx.__testHooks.parseOriginSitePath;
  assert.equal(unsafe('/sites/owner-1/PUBLIC1/dist/..%2F..%2F..%2Fowner-2/BANNED1/index.html'), true);
  assert.equal(unsafe('/a/%2e%2e/b'), true);
  assert.equal(unsafe('/a/%2E%2E/b'), true);
  assert.equal(unsafe('/a/%5csecret'), true);
  assert.equal(unsafe('/a/%25%2e%2e/b'), true);
  assert.equal(unsafe('/a\\b'), true);
  assert.equal(unsafe('/a//b'), true);
  assert.equal(unsafe('/a/../b'), true);
  assert.equal(unsafe('/a/./b'), true);
  assert.equal(unsafe('/sites/owner-1/PUBLIC1/index.html'), false);
  assert.equal(parse('/sites/owner-1/PUBLIC1/dist/..%2F..%2F..%2Fowner-2/BANNED1/index.html').reject, true);
  assert.equal(parse('/sites/owner.1/PUBLIC1/index.html').reject, true);
  assert.equal(parse('/sites/' + 'a'.repeat(65) + '/PUBLIC1/index.html').reject, true);
  assert.equal(parse('/sites/owner_1-a/PUBLIC1/index.html').uid, 'owner_1-a');

  const urls = [
    'https://sites.demox.site/sites/owner-1/PUBLIC1/dist/..%2F..%2F..%2Fowner-2/BANNED1/dist/index.html',
    'https://pub1.demox.site/dist/..%2F..%2F..%2Fowner-2/BANNED1/dist/index.html',
    'https://blog.example.com/assets/..%2fsecret',
    'https://sites.demox.site/sites/owner-1/PUBLIC1/%2e%2e%2fsecret',
    'https://sites.demox.site/sites/owner-1/PUBLIC1/%5Csecret',
    'https://sites.demox.site/sites/owner-1/PUBLIC1/%25%2e%2e/secret',
    'https://sites.demox.site/sites/owner-1/PUBLIC1//index.html',
    'https://sites.demox.site/sites/owner.1/PUBLIC1/index.html',
    'https://sites.demox.site/sites/' + 'a'.repeat(65) + '/PUBLIC1/index.html'
  ];
  for (const url of urls) {
    const { response } = await r.visit(url);
    assert.equal(response.status, 400, url);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(r.calls.resolve.length, 0);
  assert.equal(r.calls.origin.length, 0);
});

test('stored paths with leading or trailing slashes still serve a normal file', async () => {
  for (const stored of ['u/abc/', '/u/abc', 'u/abc']) {
    const r = makeGuard({
      resolver: () => json({
        success: true,
        path: stored,
        websiteId: 'ABC',
        origin: 'sites.demox.site',
        visibility: 'public',
        hideWatermark: true
      })
    });
    const { response, html } = await r.visit('https://abc.demox.site/file.txt');
    assert.equal(response.status, 200, stored);
    assert.equal(html, PUBLIC_HTML, stored);
    const hit = r.calls.origin.find((info) => info.href.includes('/u/abc/file.txt'));
    assert.ok(hit, stored);
    assert.equal(new URL(hit.href).pathname, '/u/abc/file.txt', stored);
  }
});

test('stored paths with a dot inside a segment still serve', async () => {
  for (const stored of ['v1.2', 'my.site', 'sites/u/v1.2/x']) {
    const r = makeGuard({
      secret: SECRET_A,
      resolver: () => json({
        success: true,
        path: stored,
        websiteId: 'ABC',
        origin: 'sites.demox.site',
        visibility: 'public',
        hideWatermark: true
      })
    });
    const { response, html } = await r.visit('https://abc.demox.site/file.txt');
    assert.equal(response.status, 200, stored);
    assert.equal(html, PUBLIC_HTML, stored);
    const hit = r.calls.origin.find((info) => info.href.includes('/file.txt'));
    assert.ok(hit, stored);
    assert.equal(new URL(hit.href).pathname, '/' + stored + '/file.txt', stored);
  }
});

test('stored paths with dot segments, percent, or backslash fail closed before signing or origin', async () => {
  for (const stored of ['.', '..', 'sites/u/../other', 'u/./abc', 'u/%2e%2e/x', 'u/%2e/abc', 'u/a\\b', 'u/%25name']) {
    const r = makeGuard({
      secret: SECRET_A,
      resolver: () => json({
        success: true,
        path: stored,
        websiteId: 'ABC',
        origin: 'sites.demox.site',
        visibility: 'public',
        hideWatermark: true
      })
    });
    const { response, html } = await r.visit('https://abc.demox.site/file.txt');
    assert.equal(response.status, 503, stored);
    assert.equal(response.headers.get('cache-control'), 'no-store', stored);
    assert.doesNotMatch(html, /Public body/, stored);
    assert.equal(r.calls.origin.length, 0, stored);
    assert.equal(r.calls.origin.some((info) => info.token), false, stored);
  }
});

test('M4: origin hosts allow GET and HEAD; OPTIONS is a local 204 and other methods are 405', async () => {
  const r = makeGuard({
    secret: SECRET_A,
    resolver: (payload) => {
      if (payload.websiteId === 'BANNED1') return json({ success: true, allow: false, reason: 'blocked' });
      if (payload.websiteId === 'PUBLIC1') return json(allow('PUBLIC1', 'owner-1'));
      throw new Error('unexpected lookup');
    }
  });
  const banned = 'https://sites.demox.site/sites/owner-1/BANNED1/dist/index.html';
  const putToken = await r.ctx.__testHooks.signOriginInternalToken('PUT', 'sites.demox.site', '/sites/owner-1/BANNED1/dist/index.html', '');
  assert.match(putToken, /^v1\.A\.\d+\.[0-9a-f]{64}$/);
  for (const method of ['PUT', 'POST', 'DELETE', 'PATCH']) {
    const { response } = await r.call(banned, {
      method,
      headers: { Accept: 'text/html', 'x-demox-origin-token': putToken }
    });
    assert.equal(response.status, 405, method);
    assert.match(response.headers.get('allow') || '', /GET/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(r.calls.resolve.length, 0);
  assert.equal(r.calls.origin.length, 0);
  const head = await r.call(banned, { method: 'HEAD', headers: { Accept: 'text/html' } });
  assert.equal(head.response.status, 403);
  assert.equal(r.calls.origin.length, 0, 'HEAD on a banned path does not fetch origin');
  const beforeOptions = { resolve: r.calls.resolve.length, origin: r.calls.origin.length };
  const options = await r.call('https://sites-eclick.demox.site/sites/owner-1/BANNED1/dist/index.html', {
    method: 'OPTIONS',
    headers: { Accept: 'text/html', 'x-demox-origin-token': putToken }
  });
  assertOptionsCors(options.response);
  assert.equal(r.calls.resolve.length, beforeOptions.resolve);
  assert.equal(r.calls.origin.length, beforeOptions.origin);
  const pub = await r.visit('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html');
  assert.equal(pub.response.status, 200);
});

test('OPTIONS on static, cdn, unknown, and unbound custom hosts is a local 204 and does not fetch origin', async () => {
  const r = makeGuard({
    resolver: () => json({ success: false, message: 'not found' })
  });
  const hosts = [
    'https://static.demox.site',
    'https://cdn.demox.site',
    'https://randomxyz123.demox.site',
    'https://not-bound.example'
  ];
  for (const host of hosts) {
    for (const path of ['/', '/sites/x']) {
      const before = r.calls.origin.length;
      const { response } = await r.call(host + path, {
        method: 'OPTIONS',
        headers: { Accept: 'text/html' }
      });
      assertOptionsCors(response);
      assert.equal(r.calls.origin.length, before, host + path);
    }
  }
  assert.match(source, /var ORIGIN_OPTIONS_CORS_ALLOW_HEADERS = 'Range, If-None-Match, If-Modified-Since';/);
});

test('GET and HEAD on origin hosts keep CORS headers sent by the origin', async () => {
  const r = makeGuard({
    resolver: () => json(allow('PUBLIC1', 'owner-1')),
    origin: () => new Response(PUBLIC_HTML, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, If-None-Match, If-Modified-Since, Content-Type',
        'Access-Control-Expose-Headers': 'ETag, Content-Length',
        'Access-Control-Max-Age': '600'
      }
    })
  });
  for (const method of ['GET', 'HEAD']) {
    const { response } = await r.call('https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html', {
      method,
      headers: { Accept: 'text/html' }
    });
    assert.equal(response.status, 200, method);
    assert.equal(response.headers.get('access-control-allow-origin'), '*', method);
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS', method);
    assert.equal(response.headers.get('access-control-allow-headers'), 'Range, If-None-Match, If-Modified-Since, Content-Type', method);
    assert.equal(response.headers.get('access-control-expose-headers'), 'ETag, Content-Length', method);
    assert.equal(response.headers.get('access-control-max-age'), '600', method);
  }
});

test('a resolved site OPTIONS still reaches origin', async () => {
  const r = makeGuard({
    resolver: () => json({
      success: true,
      path: 'u/abc',
      websiteId: 'ABC',
      origin: 'sites.demox.site',
      visibility: 'public',
      hideWatermark: true
    })
  });
  const { response } = await r.call('https://abc.demox.site/file.txt', {
    method: 'OPTIONS',
    headers: { Accept: 'text/html' }
  });
  assert.equal(r.calls.origin.length, 1);
  assert.equal(response.status, 200);
});

test('M5: tokens are v1.kid.exp.mac, both slots verify, and a short secret stays unset', async () => {
  assert.ok(new TextEncoder().encode(SECRET_A).length >= 32);
  assert.ok(new TextEncoder().encode(SECRET_B).length >= 32);
  const short = SECRET_A.slice(0, 31);
  assert.equal(new TextEncoder().encode(short).length, 31);

  const both = makeGuard({
    secretA: SECRET_A,
    secretB: SECRET_B,
    kid: 'A',
    resolver: (payload) => {
      if (payload.websiteId === 'PUBLIC1') return json({ success: true, allow: false, reason: 'not_found' });
      if (payload.websiteId) throw new Error('unexpected id ' + payload.websiteId);
      return json({ success: false, message: 'not found' });
    }
  });
  const path = '/sites/owner-1/PUBLIC1/dist/index.html';
  const tokenA = await both.ctx.__testHooks.signOriginInternalToken('GET', 'sites.demox.site', path, '');
  assert.match(tokenA, /^v1\.A\.\d+\.[0-9a-f]{64}$/);
  both.ctx.env.DEMOX_ORIGIN_GUARD_KID = 'B';
  const tokenB = await both.ctx.__testHooks.signOriginInternalToken('GET', 'sites.demox.site', path, '');
  assert.match(tokenB, /^v1\.B\.\d+\.[0-9a-f]{64}$/);
  both.ctx.env.DEMOX_ORIGIN_GUARD_KID = 'A';
  for (const token of [tokenA, tokenB]) {
    const { response } = await both.visit('https://sites.demox.site' + path, {
      Accept: 'text/html',
      'x-demox-origin-token': token
    });
    assert.equal(response.status, 200);
  }
  assert.equal(both.calls.resolve.length, 0);
  assert.equal(both.calls.origin.every((info) => !info.token), true);

  const tampered = tokenA.replace('v1.A.', 'v1.B.');
  const swapped = await both.visit('https://sites.demox.site' + path, {
    Accept: 'text/html',
    'x-demox-origin-token': tampered
  });
  assert.equal(swapped.response.status, 404);
  assert.ok(both.calls.resolve.some((payload) => payload.websiteId === 'PUBLIC1'));

  const signedLower = [];
  for (const spec of [
    { kid: 'a', secret: SECRET_A, token: tokenA },
    { kid: 'b', secret: SECRET_B, token: tokenB }
  ]) {
    const exp = spec.token.split('.')[2];
    const upperMac = await hmacHex(spec.secret, originTokenMessage(exp, 'GET', 'sites.demox.site', path, '', spec.kid.toUpperCase()));
    assert.equal(upperMac, spec.token.split('.')[3], spec.kid);
    const lowerMac = await hmacHex(spec.secret, originTokenMessage(exp, 'GET', 'sites.demox.site', path, '', spec.kid));
    assert.notEqual(lowerMac, upperMac, spec.kid);
    signedLower.push('v1.' + spec.kid + '.' + exp + '.' + lowerMac);
    both.ctx.env.DEMOX_ORIGIN_GUARD_KID = spec.kid;
    assert.equal(await both.ctx.__testHooks.signOriginInternalToken('GET', 'sites.demox.site', path, ''), '', spec.kid);
  }
  both.ctx.env.DEMOX_ORIGIN_GUARD_KID = 'A';
  for (const token of signedLower) {
    const lowerGuard = makeGuard({
      secretA: SECRET_A,
      secretB: SECRET_B,
      kid: 'A',
      resolver: (payload) => {
        if (payload.websiteId === 'PUBLIC1') return json({ success: true, allow: false, reason: 'not_found' });
        throw new Error('unexpected id ' + payload.websiteId);
      }
    });
    const { response } = await lowerGuard.visit('https://sites.demox.site' + path, {
      Accept: 'text/html',
      'x-demox-origin-token': token
    });
    assert.notEqual(response.status, 200, token.slice(0, 4));
    assert.equal(lowerGuard.calls.origin.length, 0, token.slice(0, 4));
    assert.ok(lowerGuard.calls.resolve.some((payload) => payload.websiteId === 'PUBLIC1'), token.slice(0, 4));
  }

  const kept = makeGuard({
    secret: SECRET_A,
    resolver: () => { throw new Error('internal hop must not resolve'); }
  });
  const direct = await kept.ctx.__testHooks.signOriginInternalToken('GET', 'sites.demox.site', path, '');
  const hosted = await kept.call('https://sites.demox.site' + path, {
    headers: { Host: 'sites.demox.site', Accept: 'text/html', 'x-demox-origin-token': direct }
  });
  assert.equal(hosted.response.status, 200);
  assert.equal(kept.calls.origin.length, 1);
  assert.equal(kept.calls.origin[0].token, '');
  assert.equal(kept.calls.origin[0].hostHeader, 'sites.demox.site');
  assert.equal(kept.calls.resolve.length, 0);

  const within = makeGuard({
    secret: SECRET_A,
    resolver: (payload) => {
      if (payload.websiteId) return json(allow('PUBLIC1', 'owner-1'));
      throw new Error('no label');
    }
  });
  const fresh = await within.ctx.__testHooks.signOriginInternalToken('GET', 'sites.demox.site', path, '');
  within.advance(within.ctx.__testHooks.ORIGIN_INTERNAL_TOKEN_TTL_MS + 4000);
  const skewed = await within.visit('https://sites.demox.site' + path, {
    Accept: 'text/html',
    'x-demox-origin-token': fresh
  });
  assert.equal(skewed.response.status, 200);
  assert.equal(within.calls.resolve.length, 0, '4s past exp is inside the 5s skew');
  within.advance(2000);
  const expired = await within.visit('https://sites.demox.site' + path, {
    Accept: 'text/html',
    'x-demox-origin-token': fresh
  });
  assert.equal(expired.response.status, 200);
  assert.ok(within.calls.resolve.some((payload) => payload.websiteId === 'PUBLIC1'));

  const unset = makeGuard({
    secret: short,
    resolver: (payload) => {
      if (payload.websiteId === 'BANNED1') return json({ success: true, allow: false, reason: 'blocked' });
      if (payload.websiteId) throw new Error('unexpected id');
      return json({
        success: true,
        path: 'sites/owner-1/PUB1/dist',
        websiteId: 'PUB1',
        origin: 'sites.demox.site',
        visibility: 'public',
        hideWatermark: true
      });
    }
  });
  assert.equal(await unset.ctx.__testHooks.signOriginInternalToken('GET', 'sites.demox.site', path, ''), '');
  const home = await unset.visit('https://pub1.demox.site/');
  assert.equal(home.response.status, 200);
  assert.equal(unset.calls.origin.every((info) => !info.token), true);
  const forged = await unset.visit('https://sites.demox.site/sites/owner-1/BANNED1/dist/index.html', {
    Accept: 'text/html',
    'x-demox-origin-token': 'v1.A.9999999999999.' + 'ab'.repeat(32)
  });
  assert.equal(forged.response.status, 403);
  assert.equal(unset.calls.origin.some((info) => info.href.includes('BANNED1')), false);

  const httpOrigin = makeGuard({
    secret: SECRET_A,
    resolver: () => json({
      success: true,
      path: 'sites/owner-1/PUB1/dist',
      websiteId: 'PUB1',
      origin: 'site-3.demox.site',
      visibility: 'public',
      hideWatermark: true
    })
  });
  const plain = await httpOrigin.visit('https://pub1.demox.site/');
  assert.equal(plain.response.status, 200);
  assert.ok(httpOrigin.calls.origin.some((info) => info.href.startsWith('http://site-3.demox.site/')));
  assert.equal(httpOrigin.calls.origin.every((info) => !info.token), true);
});
