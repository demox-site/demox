const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'subdomain-router.js'), 'utf8');



// ── 2026-10-10 demox_access 账号令牌 cookie 止血（step 1）───────────────────────────
{
  const hooksContext = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, console, addEventListener: () => {} });
  vm.runInContext(`${source}\nglobalThis.__cookieHooks = { stripAuthCookieValue, withoutAuthCookieHeaders, hasAuthCookie };`, hooksContext);
  const { stripAuthCookieValue, withoutAuthCookieHeaders } = hooksContext.__cookieHooks;

  test('cookie strip: removes only demox_access and keeps the other cookies in order', () => {
    assert.equal(stripAuthCookieValue('a=1; demox_access=tok; b=2'), 'a=1; b=2');
    assert.equal(stripAuthCookieValue('demox_access=tok; theme=dark'), 'theme=dark');
    assert.equal(stripAuthCookieValue('sid=x; demox_access=tok'), 'sid=x');
  });

  test('cookie strip: only demox_access leaves nothing and the Cookie header is dropped', () => {
    assert.equal(stripAuthCookieValue('demox_access=tok'), '');
    const h = withoutAuthCookieHeaders(new Headers({ cookie: 'demox_access=tok', accept: 'text/html' }));
    assert.equal(h.get('cookie'), null);
    assert.equal(h.get('accept'), 'text/html');
  });

  test('cookie strip: tolerates spacing variants and duplicate demox_access pairs', () => {
    assert.equal(stripAuthCookieValue('a=1;demox_access=tok;b=2'), 'a=1; b=2');
    assert.equal(stripAuthCookieValue('  demox_access = tok ;  a=1 ;; '), 'a=1');
    assert.equal(stripAuthCookieValue('demox_access=1; a=1; demox_access=2'), 'a=1');
    assert.equal(stripAuthCookieValue('demox_access'), '');
  });

  test('cookie strip: removes the site ticket as well as the account cookie', () => {
    assert.equal(stripAuthCookieValue('a=1; demox_site=ticket; demox_access=tok; b=2'), 'a=1; b=2');
    assert.equal(stripAuthCookieValue('demox_site=ticket'), '');
  });

  test('cookie strip: look-alike names and cookie-less requests are untouched', () => {
    assert.equal(stripAuthCookieValue('demox_access2=x; xdemox_access=y; Demox_Access=z; demox_site2=q'), 'demox_access2=x; xdemox_access=y; Demox_Access=z; demox_site2=q');
    assert.equal(stripAuthCookieValue(''), '');
    const h = withoutAuthCookieHeaders(new Headers({ accept: 'text/html' }));
    assert.equal(h.get('cookie'), null);
    assert.equal(h.get('accept'), 'text/html');
  });
}

function cookieOf(input, init) {
  if (input && typeof input === 'object' && input.headers && typeof input.headers.get === 'function') {
    return { url: input.url, cookie: input.headers.get('cookie') };
  }
  const h = init && init.headers ? new Headers(init.headers) : new Headers();
  return { url: String(input), cookie: h.get('cookie') };
}

async function handleWithCookie(url, { cookie, resolve, method = 'GET', accept = 'text/html', body, headers = {}, access } = {}) {
  const calls = [];
  const routerContext = vm.createContext({
    URL, URLSearchParams, Request, Response, Headers, console,
    env: { DEMOX_API_URL: 'https://api.test', DEMOX_HOME_URL: 'https://www.demox.site' },
    caches: { default: { match: async () => null, put: async () => {} } },
    addEventListener: () => {},
    fetch: async (input, init) => {
      const c = cookieOf(input, init);
      if (init && typeof init.body === 'string') {
        try { c.posted = JSON.parse(init.body); } catch (e) { c.posted = null; }
      }
      calls.push(c);
      if (c.url.includes('/resolve-subdomain')) {
        return new Response(JSON.stringify(resolve || { success: false, message: 'not found' }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
      if (c.url.includes('/check-site-access')) {
        const posted = c.posted || {};
        let body = access || { success: true, allowed: true };
        if (posted.action === 'issue_site_ticket') {
          body = access && (access.ticket || access.allowed === false)
            ? access
            : { success: true, allowed: true, ticket: 'SITE_TICKET', maxAge: 3600 };
        }
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (c.url.startsWith('https://api.test/')) {
        return new Response('{"fn":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('<!doctype html><html><body><main>Live site</main></body></html>', {
        status: 200, headers: { 'Content-Type': 'text/html' }
      });
    }
  });
  vm.runInContext(`${source}\nglobalThis.__testHooks = { handle };`, routerContext);
  const h = Object.assign({ Accept: accept }, headers);
  if (cookie) h.Cookie = cookie;
  const init = { method, headers: h };
  if (body) init.body = body;
  const response = await routerContext.__testHooks.handle(new Request(url, init), { waitUntil: () => {}, passThroughOnException: () => {} });
  return { response, calls, text: await response.text() };
}

const PUBLIC_SITE = { success: true, path: 'sites/demo/PUB1/dist', websiteId: 'PUB1', origin: 'sites.demox.site', visibility: 'public', hideWatermark: true };
const PRIVATE_SITE = { success: true, path: 'sites/demo/PRV1/dist', websiteId: 'PRV1', origin: 'site-3.demox.site', visibility: 'private', hideWatermark: true };

test('origin fetch for a user site forwards the incoming request unchanged, cookie included (pre-#49 behaviour)', async () => {
  const { response, calls } = await handleWithCookie('https://pub1.demox.site/', { cookie: 'a=1; demox_access=ACCOUNT_TOKEN; b=2', resolve: PUBLIC_SITE });
  assert.equal(response.status, 200);
  const origin = calls.filter((c) => c.url.includes('sites.demox.site/'));
  assert.ok(origin.length >= 1);
  for (const c of origin) assert.equal(c.cookie, 'a=1; demox_access=ACCOUNT_TOKEN; b=2');
});

test('site function proxy (/api/*) never forwards demox_access to the user function', async () => {
  const { response, calls } = await handleWithCookie('https://pub1.demox.site/api/echo', {
    cookie: 'session=u1; demox_access=ACCOUNT_TOKEN', resolve: PUBLIC_SITE, accept: 'application/json'
  });
  assert.equal(response.status, 200);
  const fn = calls.find((c) => c.url.startsWith('https://api.test/PUB1/production/api/echo'));
  assert.ok(fn, 'function proxied');
  assert.equal(fn.cookie, 'session=u1');
  const only = await handleWithCookie('https://pub1.demox.site/api/echo', { cookie: 'demox_access=ACCOUNT_TOKEN', resolve: PUBLIC_SITE, accept: 'application/json' });
  assert.equal(only.calls.find((c) => c.url.startsWith('https://api.test/PUB1/')).cookie, null);
});

test('site function proxy keeps POST bodies when stripping the cookie', async () => {
  const { response, calls } = await handleWithCookie('https://pub1.demox.site/api/echo', {
    cookie: 'demox_access=ACCOUNT_TOKEN; k=v', resolve: PUBLIC_SITE, method: 'POST', body: '{"x":1}', accept: 'application/json',
    headers: { 'Content-Type': 'application/json' }
  });
  assert.equal(response.status, 200);
  assert.equal(calls.find((c) => c.url.startsWith('https://api.test/PUB1/')).cookie, 'k=v');
});

test('unknown official subdomain passthrough forwards the request unchanged (pre-#49) and still expires the cookie', async () => {
  const { response, calls } = await handleWithCookie('https://nobody-here.demox.site/x', { cookie: 'demox_access=ACCOUNT_TOKEN; z=9' });
  const pass = calls.filter((c) => c.url.startsWith('https://nobody-here.demox.site/'));
  assert.equal(pass.length, 1);
  assert.equal(pass[0].cookie, 'demox_access=ACCOUNT_TOKEN; z=9');
  assert.match(response.headers.get('set-cookie') || '', /demox_access=; Max-Age=0/);
});

test('requests carrying the old cookie get both expiry variants back', async () => {
  const { response } = await handleWithCookie('https://pub1.demox.site/', { cookie: 'demox_access=ACCOUNT_TOKEN', resolve: PUBLIC_SITE });
  const set = response.headers.get('set-cookie') || '';
  assert.match(set, /demox_access=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=\/; Domain=\.demox\.site; Secure; SameSite=Lax/);
  assert.match(set, /demox_access=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=\/; Secure; SameSite=Lax/);
  assert.doesNotMatch(set, /ACCOUNT_TOKEN/);
});

test('requests without the old cookie get no Set-Cookie added', async () => {
  const { response } = await handleWithCookie('https://pub1.demox.site/', { cookie: 'a=1', resolve: PUBLIC_SITE });
  assert.equal(response.headers.get('set-cookie'), null);
});

test('private *.demox.site site ignores the account cookie and shows the login gate', async () => {
  const { response, calls, text } = await handleWithCookie('https://prv1.demox.site/', { cookie: 'demox_access=ACCOUNT_TOKEN', resolve: PRIVATE_SITE });
  assert.equal(response.status, 200);
  assert.match(text, /登录后查看/);
  assert.doesNotMatch(text, /需要重新验证/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls.some((c) => c.url.includes('/check-site-access')), false);
  assert.equal(calls.some((c) => c.url.includes('site-3.demox.site') || c.url.includes('/sites/demo/')), false);
  const api = await handleWithCookie('https://prv1.demox.site/api/x', { resolve: PRIVATE_SITE, accept: 'application/json' });
  assert.equal(api.response.status, 401);
  assert.equal(api.calls.some((c) => c.url.startsWith('https://api.test/PRV1/')), false);
});

test('private *.demox.site site ticket opens the site and is not the account token', async () => {
  const { response, calls, text } = await handleWithCookie('https://botcamp.demox.site/docs', {
    cookie: 'demox_access=ACCOUNT_TOKEN; demox_site=SITE_TICKET',
    resolve: PRIVATE_SITE,
    access: { success: true, allowed: true }
  });
  assert.equal(response.status, 200);
  assert.match(text, /Live site/);
  const check = calls.find((c) => c.url.includes('/check-site-access'));
  assert.ok(check);
  assert.equal(check.posted.action, 'check_site_access');
  assert.equal(check.posted.token, 'SITE_TICKET');
  assert.equal(check.posted.host, 'botcamp.demox.site');
  assert.equal(calls.some((c) => c.url.includes('site-3.demox.site')), true);
  const fn = await handleWithCookie('https://botcamp.demox.site/api/echo', {
    cookie: 'session=u1; demox_site=SITE_TICKET; demox_access=ACCOUNT_TOKEN',
    resolve: PRIVATE_SITE,
    accept: 'application/json',
    access: { success: true, allowed: true }
  });
  const proxied = fn.calls.find((c) => c.url.startsWith('https://api.test/PRV1/'));
  assert.ok(proxied);
  assert.equal(proxied.cookie, 'session=u1');
});

test('private *.demox.site auth-complete sets a host-only site ticket and never the account token', async () => {
  const { response, calls } = await handleWithCookie('https://prv1.demox.site/.demox/auth-complete', {
    resolve: PRIVATE_SITE,
    method: 'POST',
    body: 'token=ACCOUNT_TOKEN&next=https%3A%2F%2Fprv1.demox.site%2Fdocs',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://www.demox.site' },
    cookie: 'demox_access=ACCOUNT_TOKEN',
    access: { success: true, allowed: true, ticket: 'SITE_TICKET', maxAge: 999999 }
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/docs');
  const cookies = response.headers.getSetCookie();
  const siteCookie = cookies.find((item) => item.startsWith('demox_site='));
  assert.equal(siteCookie, 'demox_site=SITE_TICKET; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax');
  assert.equal(cookies.some((item) => item.includes('ACCOUNT_TOKEN')), false);
  const issued = calls.find((c) => c.posted && c.posted.action === 'issue_site_ticket');
  assert.ok(issued);
  assert.equal(issued.posted.token, 'ACCOUNT_TOKEN');
  assert.equal(issued.posted.host, 'prv1.demox.site');
  assert.equal(calls.some((c) => c.url.includes('site-3.demox.site')), false);
});

test('private *.demox.site auth-complete refuses to store the account token as the site cookie', async () => {
  const { response } = await handleWithCookie('https://prv1.demox.site/.demox/auth-complete', {
    resolve: PRIVATE_SITE,
    method: 'POST',
    body: 'token=ACCOUNT_TOKEN&next=https%3A%2F%2Fprv1.demox.site%2F',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://www.demox.site' },
    access: { success: true, allowed: true, ticket: 'ACCOUNT_TOKEN' }
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('set-cookie'), null);
});

// ── 2026-10-10 #49 follow-up：模拟 EdgeOne 的 Request/fetch 语义 ─────────────────────────
// 事故 17:18–17:23：带 demox_access 的请求在 EdgeOne 上公开站点 503、www 404。
// 推测：EdgeOne 不支持 new Request(request, init)，也不接受「重建的 Request」作为 fetch 的 init。
// 这里的 EdgeOne 模拟：Request(Request, …) 直接抛错；fetch(url, init) 的 init 若是 Request，
// 只接受原始入站请求（#49 之前线上一直这么用）；fetch(Request, init) 抛错。
// fetch(new Request(字符串URL, init)) 允许：/api/* 函数转发一直这么用，事故期间探针站带 cookie 调函数是正常的。
const NativeRequest = Request;
// EdgeOne 发到上游的「实际头」模型（依据 2026-10-10 17:52 生产现象 + 源站 curl 复现）：
//  - 入站 Request 当 init / 直接 fetch(入站 Request)：EdgeOne 按目标 URL 重新填 Host，自己管逐跳头。
//  - 普通 init 对象：头原样发出（包括 Host）——带 `Host: 用户站点` 去 COS 源站会 400 UserCnameInvalid。
const HOP_BY_HOP = ['host', 'content-length', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade'];
function edgeOneWireHeaders(input, init, incoming) {
  const target = new URL(input instanceof NativeRequest ? input.url : String(input));
  const viaIncoming = input === incoming || init === incoming;
  const src = viaIncoming ? incoming.headers : (init && init.headers ? new Headers(init.headers) : new Headers());
  const out = {};
  for (const [k, v] of src.entries()) {
    if (viaIncoming && HOP_BY_HOP.includes(k)) continue;
    out[k] = v;
  }
  if (!out.host) out.host = target.host;
  return out;
}
async function handleEdgeOneLike(url, { cookie, resolve, method = 'GET', accept = 'text/html', body, headers = {} } = {}) {
  const calls = [];
  const errors = [];
  let incoming = null;
  class EdgeOneRequest extends NativeRequest {
    constructor(input, init) {
      if (input instanceof NativeRequest) throw new TypeError('EdgeOne mock: Request(Request, init) not supported');
      super(input, init);
    }
  }
  const routerContext = vm.createContext({
    URL, URLSearchParams, Request: EdgeOneRequest, Response, Headers, console,
    env: { DEMOX_API_URL: 'https://api.test', DEMOX_HOME_URL: 'https://www.demox.site' },
    caches: { default: { match: async () => null, put: async () => {} } },
    addEventListener: () => {},
    fetch: async (input, init) => {
      if (input instanceof NativeRequest && init !== undefined) {
        errors.push('fetch(Request, init)'); throw new TypeError('EdgeOne mock: fetch(Request, init)');
      }
      if (init instanceof NativeRequest && init !== incoming) {
        errors.push('rebuilt Request as init'); throw new TypeError('EdgeOne mock: rebuilt Request as init');
      }
      const c = cookieOf(input, init);
      c.wire = edgeOneWireHeaders(input, init, incoming);
      c.method = (init && init.method) || (input && input.method) || 'GET';
      const b = init && init.body !== undefined ? init.body : (input instanceof NativeRequest ? input.body : undefined);
      c.body = b == null ? null : await new Response(b).text();
      calls.push(c);
      if (c.url.includes('/resolve-subdomain')) {
        return new Response(JSON.stringify(resolve || { success: false, message: 'not found' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (c.url.includes('/check-site-access')) {
        return new Response(JSON.stringify({ success: true, allowed: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (c.url.startsWith('https://api.test/')) {
        return new Response('{"fn":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('<!doctype html><html><body><main>Live site</main></body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
  });
  vm.runInContext(`${source}\nglobalThis.__testHooks = { handle };`, routerContext);
  const h = Object.assign({ Accept: accept }, headers);
  if (cookie) h.Cookie = cookie;
  const init = { method, headers: h };
  if (body) { init.body = body; init.duplex = 'half'; }
  incoming = new NativeRequest(url, init);
  let thrown = null;
  let response = null;
  try {
    response = await routerContext.__testHooks.handle(incoming, { waitUntil: () => {}, passThroughOnException: () => {} });
  } catch (e) { thrown = e; }
  return { response, calls, errors, thrown, text: response ? await response.text() : '' };
}

const WWW_SITE = { success: true, path: 'sites/owner/EPX2UU43/dist', websiteId: 'EPX2UU43', origin: 'sites.demox.site', visibility: 'public', hideWatermark: true };

// 只有 /api/* 用户函数不能收到 demox_access；静态源站 / 透传按 #49 之前原样转发（2026-10-10 决定）。
function assertNoAuthCookie(calls) {
  for (const c of calls) {
    if (!c.url.startsWith('https://api.test/')) continue;
    assert.doesNotMatch(String(c.cookie || ''), /demox_access|ACCOUNT_TOKEN/, `leaked to ${c.url}`);
  }
}

for (const withCookie of [false, true]) {
  const label = withCookie ? 'WITH demox_access' : 'without demox_access';
  const cookie = withCookie ? 'a=1; demox_access=ACCOUNT_TOKEN; b=2' : 'a=1; b=2';

  test(`EdgeOne-like: public site GET ${label} routes normally (200, origin fetched)`, async () => {
    const r = await handleEdgeOneLike('https://pub1.demox.site/', { cookie, resolve: PUBLIC_SITE });
    assert.equal(r.thrown, null);
    assert.deepEqual(r.errors, []);
    assert.equal(r.response.status, 200);
    assert.match(r.text, /Live site/);
    assert.match(r.response.headers.get('x-demox-route') || '', /origin=ok/);
    const origin = r.calls.filter((c) => c.url.includes('sites.demox.site/sites/demo/PUB1/'));
    assert.ok(origin.length >= 1);
    for (const c of origin) assert.equal(c.cookie, cookie);
    assertNoAuthCookie(r.calls);
  });

  test(`EdgeOne-like: www GET ${label} routes normally (200, not 404)`, async () => {
    const r = await handleEdgeOneLike('https://www.demox.site/', { cookie, resolve: WWW_SITE });
    assert.equal(r.thrown, null);
    assert.deepEqual(r.errors, []);
    assert.equal(r.response.status, 200);
    assert.match(r.text, /Live site/);
    assertNoAuthCookie(r.calls);
  });

  test(`EdgeOne-like: public site POST ${label} keeps method and body`, async () => {
    const r = await handleEdgeOneLike('https://pub1.demox.site/form', {
      cookie, resolve: PUBLIC_SITE, method: 'POST', body: 'x=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    assert.equal(r.thrown, null);
    assert.deepEqual(r.errors, []);
    assert.notEqual(r.response.status, 503);
    const origin = r.calls.find((c) => c.url.includes('sites.demox.site/sites/demo/PUB1/dist/form'));
    assert.ok(origin, 'origin fetched');
    assert.equal(origin.method, 'POST');
    assert.equal(origin.body, 'x=1');
    assertNoAuthCookie(r.calls);
  });

  test(`EdgeOne-like: site function GET/POST ${label} proxied without demox_access`, async () => {
    for (const m of ['GET', 'POST']) {
      const r = await handleEdgeOneLike('https://pub1.demox.site/api/echo', {
        cookie, resolve: PUBLIC_SITE, method: m, accept: 'application/json',
        body: m === 'POST' ? '{"x":1}' : undefined, headers: m === 'POST' ? { 'Content-Type': 'application/json' } : {}
      });
      assert.equal(r.thrown, null);
      assert.deepEqual(r.errors, []);
      assert.equal(r.response.status, 200);
      const fn = r.calls.find((c) => c.url.startsWith('https://api.test/PUB1/production/api/echo'));
      assert.ok(fn);
      assert.equal(fn.cookie, 'a=1; b=2');
      if (m === 'POST') assert.equal(fn.body, '{"x":1}');
      assertNoAuthCookie(r.calls);
    }
  });

  test(`EdgeOne-like: unknown subdomain passthrough ${label} does not throw and forwards the request unchanged`, async () => {
    const r = await handleEdgeOneLike('https://nobody-here.demox.site/x', { cookie });
    assert.equal(r.thrown, null);
    assert.deepEqual(r.errors, []);
    const pass = r.calls.filter((c) => c.url.startsWith('https://nobody-here.demox.site/'));
    assert.equal(pass.length, 1);
    assert.equal(pass[0].cookie, cookie);
  });
}

test('static origin and passthrough fetches keep the pre-#49 call shape (original request object)', () => {
  // 三次发布失败都出在这条路径上（17:18 重建 Request、17:52 Host、18:04 POST）。
  // 密钥未配置时用户站点仍是 originFetch(..., req)。源站守卫新增的三条 fetch 只能是剥令牌之后的回源。
  // www 在有签名槽时多一条 404.html：fetch(missingUrl, signed)，用的是新 Headers，不是入站 req。
  assert.match(source, /originFetch\(buildOriginUrl\(req, originPath, u\.search, originHost\), req\)/);
  assert.match(source, /originFetch\(buildOriginUrl\(req, `\/\$\{sitePath\}\/index\.html`, '', originHost\), \{ method: 'GET' \}\)/);
  assert.match(source, /fetch\(buildOriginUrl\(req, `\/\$\{sitePath\}\/404\.html`, '', originHost\), \{ method: 'GET' \}\)/);
  assert.doesNotMatch(source, /new Request\(req\b/);
  assert.doesNotMatch(source, /strippedFetchInit|originFetchInit|passThroughWithoutAuthCookie|withoutAuthCookie\(/);
  // 浅克隆（www deploy 的 actions/checkout 默认 depth 1）没有 3050f5d^，不能在测试里 git show。
  // 行内容冻结在 fixtures/pre-49-fetch-lines.txt，过滤规则与当初对源文件的提取一致。
  const pre = fs.readFileSync(path.join(__dirname, 'fixtures/pre-49-fetch-lines.txt'), 'utf8');
  const fetchLines = (src) => src.split('\n').map((l) => l.trim()).filter((l) => /\bfetch\(/.test(l) && !l.startsWith('//'));
  const preLines = fetchLines(pre);
  const nowLines = fetchLines(source);
  let cursor = 0;
  for (const line of nowLines) {
    if (cursor < preLines.length && line === preLines[cursor]) cursor += 1;
  }
  assert.equal(cursor, preLines.length, 'every pre-#49 fetch() line must remain verbatim and in order');
  const extras = [];
  cursor = 0;
  for (const line of nowLines) {
    if (cursor < preLines.length && line === preLines[cursor]) cursor += 1;
    else extras.push(line);
  }
  assert.deepEqual(extras, [
    'const custom404 = await fetch(missingUrl, signed);',
    "return capOriginObjectCache(await fetch(stripped), 'origin-guard=internal');",
    "return capOriginObjectCache(await fetch(stripOriginInternalToken(req)), 'origin-guard=allowlist');",
    "return capOriginObjectCache(await fetch(outbound), 'origin-guard=allow');"
  ]);
});


// ── 2026-10-10 17:52–17:53 回归：带 cookie 的普通 init 把入站 Host 带去 COS 源站 → 400 ─────────────────
const BROWSER_HEADERS = {
  'Accept-Encoding': 'gzip, br', 'Accept-Language': 'zh-CN', 'User-Agent': 'Mozilla/5.0 test',
  Connection: 'keep-alive', 'Keep-Alive': 'timeout=5', TE: 'trailers', Upgrade: 'h2c'
};

function originCalls(r, needle) {
  return r.calls.filter((c) => c.url.includes(needle));
}

for (const withCookie of [false, true]) {
  const label = withCookie ? 'WITH demox_access' : 'without demox_access';
  const cookie = withCookie ? 'a=1; demox_access=ACCOUNT_TOKEN; b=2' : 'a=1; b=2';
  for (const [name, url, resolve, method, accept] of [
    ['public site GET', 'https://pub1.demox.site/', PUBLIC_SITE, 'GET', 'text/html'],
    ['public site POST', 'https://pub1.demox.site/form', PUBLIC_SITE, 'POST', 'text/html'],
    ['private-bucket site GET (site-3 origin)', 'https://pub3.demox.site/', { ...PUBLIC_SITE, path: 'sites/demo/PUB3/dist', websiteId: 'PUB3', origin: 'site-3.demox.site' }, 'GET', 'text/html'],
    ['www GET', 'https://www.demox.site/', WWW_SITE, 'GET', 'text/html'],
    ['function GET', 'https://pub1.demox.site/api/echo', PUBLIC_SITE, 'GET', 'application/json'],
    ['function POST', 'https://pub1.demox.site/api/echo', PUBLIC_SITE, 'POST', 'application/json'],
    ['unknown host passthrough GET', 'https://nobody-here.demox.site/x', undefined, 'GET', 'text/html']
  ]) {
    test(`EdgeOne wire: ${name} ${label} never sends the incoming Host or hop-by-hop headers upstream`, async () => {
      const incomingHost = new URL(url).host;
      const r = await handleEdgeOneLike(url, {
        cookie, resolve, method, accept,
        body: method === 'POST' ? '{"x":1}' : undefined,
        headers: Object.assign({ Host: incomingHost, 'Content-Type': 'application/json' }, BROWSER_HEADERS)
      });
      assert.equal(r.thrown, null);
      assert.deepEqual(r.errors, []);
      const upstream = r.calls.filter((c) => !c.url.includes('/resolve-subdomain') && !c.url.includes('/check-site-access'));
      assert.ok(upstream.length >= 1, 'something was fetched upstream');
      for (const c of upstream) {
        const target = new URL(c.url).host;
        if (target === incomingHost) continue; // 同 URL 透传：Host 本来就是它
        assert.equal(c.wire.host, target, `${c.url} carried Host ${c.wire.host}`);
        if (!c.url.startsWith('https://api.test/')) {
          for (const h of ['connection', 'keep-alive', 'te', 'upgrade', 'transfer-encoding', 'content-length']) {
            assert.equal(c.wire[h], undefined, `${c.url} carried ${h}`);
          }
        }
        if (c.url.startsWith('https://api.test/')) assert.doesNotMatch(String(c.wire.cookie || ''), /demox_access|ACCOUNT_TOKEN/);
      }
    });
  }
}

for (const [name, url, resolve, method, needle] of [
  ['public site GET', 'https://pub1.demox.site/', PUBLIC_SITE, 'GET', 'sites.demox.site/sites/demo/PUB1/'],
  ['site-3 origin GET', 'https://pub3.demox.site/', { ...PUBLIC_SITE, path: 'sites/demo/PUB3/dist', websiteId: 'PUB3', origin: 'site-3.demox.site' }, 'GET', 'site-3.demox.site/sites/demo/PUB3/'],
  ['public site POST', 'https://pub1.demox.site/form', PUBLIC_SITE, 'POST', 'sites.demox.site/sites/demo/PUB1/dist/form'],
  ['www GET', 'https://www.demox.site/', WWW_SITE, 'GET', 'sites.demox.site/sites/owner/EPX2UU43/'],
  ['unknown host passthrough', 'https://nobody-here.demox.site/x', undefined, 'GET', 'https://nobody-here.demox.site/x']
]) {
  test(`EdgeOne wire: ${name} — origin request with and without demox_access is identical except Cookie (forwarded as-is)`, async () => {
    const host = new URL(url).host;
    const common = { resolve, method, body: method === 'POST' ? '{"x":1}' : undefined, headers: Object.assign({ Host: host, 'Content-Type': 'application/json' }, BROWSER_HEADERS) };
    const without = await handleEdgeOneLike(url, { ...common, cookie: 'a=1; b=2' });
    const withC = await handleEdgeOneLike(url, { ...common, cookie: 'a=1; demox_access=ACCOUNT_TOKEN; b=2' });
    const o1 = originCalls(without, needle);
    const o2 = originCalls(withC, needle);
    assert.ok(o1.length >= 1 && o1.length === o2.length, `origin calls ${o1.length} vs ${o2.length}`);
    for (let i = 0; i < o1.length; i += 1) {
      assert.equal(o2[i].url, o1[i].url);
      assert.equal(o2[i].method, o1[i].method);
      assert.equal(o2[i].body, o1[i].body);
      const a = { ...o1[i].wire }; const b = { ...o2[i].wire };
      assert.equal(a.cookie, 'a=1; b=2');
      assert.equal(b.cookie, 'a=1; demox_access=ACCOUNT_TOKEN; b=2'); // 静态源站：原样转发（#49 之前的行为）
      delete a.cookie; delete b.cookie;
      assert.deepEqual(b, a);
    }
  });
}

// ── 2026-10-10 18:07 决定：静态路径原样转发 + 所有带 demox_access 的响应追加两条过期 Set-Cookie ─────────────
function routerWith(fetchImpl) {
  const ctx = vm.createContext({
    URL, URLSearchParams, Request, Response, Headers, console,
    env: { DEMOX_API_URL: 'https://api.test', DEMOX_HOME_URL: 'https://www.demox.site' },
    caches: { default: { match: async () => null, put: async () => {} } },
    addEventListener: () => {},
    fetch: fetchImpl
  });
  vm.runInContext(`${source}\nglobalThis.__h = { handle, withExpiredAuthCookie, expireAuthCookieHeaders };`, ctx);
  return ctx.__h;
}

function siteFetch({ resolve = PUBLIC_SITE, origin, fn } = {}) {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/resolve-subdomain')) {
      return new Response(JSON.stringify(resolve || { success: false, message: 'not found' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('https://api.test/')) {
      return fn ? fn(url, init) : new Response('{"fn":true}', { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'fn_sid=f1; Path=/' } });
    }
    return origin ? origin(url, init) : new Response('<!doctype html><html><body><main>Live site</main></body></html>', {
      status: 200, headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'origin_sid=o1; Path=/' }
    });
  };
}

function setCookies(resp) {
  return typeof resp.headers.getSetCookie === 'function' ? resp.headers.getSetCookie() : [resp.headers.get('set-cookie')].filter(Boolean);
}

function assertExpiryPair(resp, label) {
  const sc = setCookies(resp).filter((c) => c.startsWith('demox_access='));
  const dom = sc.filter((c) => /Domain=\.demox\.site/.test(c));
  const host = sc.filter((c) => !/Domain=/i.test(c));
  assert.equal(dom.length, 1, `${label}: Domain=.demox.site expiry`);
  assert.equal(host.length, 1, `${label}: host-only expiry`);
  for (const c of sc) {
    assert.match(c, /^demox_access=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=\//, label);
    assert.doesNotMatch(c, /ACCOUNT_TOKEN/);
  }
}

async function call(h, url, { cookie, method = 'GET', accept = 'text/html', body } = {}) {
  const headers = { Accept: accept };
  if (cookie) headers.Cookie = cookie;
  const init = { method, headers };
  if (body) { init.body = body; init.duplex = 'half'; headers['Content-Type'] = 'application/json'; }
  return h.handle(new Request(url, init), { waitUntil: () => {}, passThroughOnException: () => {} });
}

const EXPIRY_CASES = [
  ['public page GET', 'https://pub1.demox.site/', {}, 'GET', 'text/html', 200],
  ['public page HEAD', 'https://pub1.demox.site/', {}, 'HEAD', 'text/html', 200],
  ['public page POST', 'https://pub1.demox.site/', {}, 'POST', 'text/html', 200],
  ['public page PUT', 'https://pub1.demox.site/', {}, 'PUT', 'text/html', 200],
  ['public page OPTIONS', 'https://pub1.demox.site/', {}, 'OPTIONS', 'text/html', 200],
  ['www GET', 'https://www.demox.site/', { resolve: WWW_SITE }, 'GET', 'text/html', 200],
  ['function GET', 'https://pub1.demox.site/api/echo', {}, 'GET', 'application/json', 200],
  ['function POST', 'https://pub1.demox.site/api/echo', {}, 'POST', 'application/json', 200],
  ['unknown host passthrough', 'https://nobody-here.demox.site/x', { resolve: null }, 'GET', 'text/html', 200],
  ['origin throws → 503', 'https://pub1.demox.site/', { origin: async () => { throw new Error('origin down'); } }, 'GET', 'text/html', 503],
  ['private site login gate', 'https://prv1.demox.site/', { resolve: PRIVATE_SITE }, 'GET', 'text/html', 200]
];

for (const [name, url, opts, method, accept, status] of EXPIRY_CASES) {
  test(`expiry Set-Cookie: ${name} WITH demox_access gets both expiry cookies; without gets none`, async () => {
    const h = routerWith(siteFetch(opts));
    const body = method === 'POST' || method === 'PUT' ? '{"x":1}' : undefined;
    const withC = await call(h, url, { cookie: 'a=1; demox_access=ACCOUNT_TOKEN', method, accept, body });
    assert.equal(withC.status, status);
    assertExpiryPair(withC, name);
    const without = await call(routerWith(siteFetch(opts)), url, { cookie: 'a=1', method, accept, body });
    assert.equal(without.status, status);
    assert.equal(setCookies(without).filter((c) => c.startsWith('demox_access=')).length, 0);
  });
}

test('expiry Set-Cookie: origin and function Set-Cookie headers are preserved (appended, not overwritten)', async () => {
  const page = await call(routerWith(siteFetch()), 'https://pub1.demox.site/', { cookie: 'demox_access=ACCOUNT_TOKEN' });
  assert.ok(setCookies(page).includes('origin_sid=o1; Path=/'), 'origin cookie kept');
  assertExpiryPair(page, 'page');
  const fn = await call(routerWith(siteFetch()), 'https://pub1.demox.site/api/echo', { cookie: 'demox_access=ACCOUNT_TOKEN', accept: 'application/json' });
  assert.ok(setCookies(fn).includes('fn_sid=f1; Path=/'), 'function cookie kept');
  assertExpiryPair(fn, 'function');
});

test('expiry Set-Cookie: origin response with immutable headers (set/append throw) → no 500, body and cookies intact', async () => {
  const immutable = () => {
    const r = new Response('<!doctype html><html><body><main>Frozen</main></body></html>', {
      status: 200, headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'origin_sid=o1; Path=/' }
    });
    const h = r.headers;
    for (const m of ['set', 'append', 'delete']) {
      Object.defineProperty(h, m, { value: () => { throw new TypeError('immutable headers'); } });
    }
    return r;
  };
  for (const url of ['https://pub1.demox.site/', 'https://nobody-here.demox.site/x', 'https://www.demox.site/']) {
    const resolve = url.includes('nobody') ? null : (url.includes('www') ? WWW_SITE : { ...PUBLIC_SITE, hideWatermark: true });
    const resp = await call(routerWith(siteFetch({ resolve, origin: async () => immutable() })), url, { cookie: 'demox_access=ACCOUNT_TOKEN' });
    assert.equal(resp.status, 200, url);
    assert.match(await resp.clone().text(), /Frozen/);
    assertExpiryPair(resp, url);
    assert.ok(setCookies(resp).includes('origin_sid=o1; Path=/'));
  }
});

test('withExpiredAuthCookie uses the proven re-wrap form (status/statusText/new Headers), not new Response(body, resp)', () => {
  const fnSrc = source.slice(source.indexOf('function withExpiredAuthCookie('), source.indexOf('function runtimeEnv('));
  assert.match(fnSrc, /new Response\(resp\.body, \{ status: resp\.status, statusText: resp\.statusText, headers: new Headers\(resp\.headers\) \}\)/);
  assert.doesNotMatch(fnSrc, /new Response\(resp\.body, resp\)/);
});

test('withExpiredAuthCookie: if re-wrapping the response throws, the original response is returned (never 500)', () => {
  const h = routerWith(async () => { throw new Error('unused'); });
  const weird = { status: 101, statusText: 'Switching Protocols', headers: new Headers(), body: null };
  assert.equal(h.withExpiredAuthCookie(weird, 'demox.site'), weird);
  const ok = new Response('x', { status: 200 });
  const wrapped = h.withExpiredAuthCookie(ok, 'demox.site');
  assert.notEqual(wrapped, ok);
  assert.equal(setCookies(wrapped).length, 2);
});

test('expiry Set-Cookie: non-official custom host gets no Demox cookie headers', async () => {
  const resp = await call(routerWith(siteFetch({ resolve: null })), 'https://example.org/', { cookie: 'demox_access=ACCOUNT_TOKEN' });
  assert.equal(setCookies(resp).filter((c) => c.startsWith('demox_access=')).length, 0);
});

test('private custom domain shows the login gate, not the official re-verify page', async () => {
  const { response, calls, text } = await handleWithCookie('https://www.example.co.uk/', { resolve: PRIVATE_SITE });
  assert.equal(response.status, 200);
  assert.match(text, /登录后查看/);
  assert.doesNotMatch(text, /需要重新验证/);
  assert.equal(calls.some((c) => c.url.includes('/check-site-access')), false);
  assert.equal(calls.some((c) => c.url.includes('site-3.demox.site') || c.url.includes('/sites/demo/')), false);
});

test('private custom domain with a host cookie still reaches origin', async () => {
  const { response, calls, text } = await handleWithCookie('https://www.example.co.uk/', {
    cookie: 'demox_access=ACCOUNT_TOKEN',
    resolve: PRIVATE_SITE,
    access: { success: true, allowed: true, cookieScope: 'host-only' }
  });
  assert.equal(response.status, 200);
  assert.match(text, /Live site/);
  assert.equal(calls.some((c) => c.url.includes('/check-site-access')), true);
  assert.equal(calls.some((c) => c.url.includes('site-3.demox.site')), true);
});

test('private custom domain auth-complete sets a host-only cookie and never a Domain attribute', async () => {
  const { response } = await handleWithCookie('https://www.example.co.uk/.demox/auth-complete', {
    resolve: PRIVATE_SITE,
    method: 'POST',
    body: 'token=ACCOUNT_TOKEN&next=https%3A%2F%2Fwww.example.co.uk%2Fdocs',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://www.demox.site' },
    access: { success: true, allowed: true, cookieScope: 'host-only' }
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/docs');
  const set = response.headers.get('set-cookie') || '';
  assert.match(set, /^demox_access=ACCOUNT_TOKEN; Max-Age=\d+; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  assert.doesNotMatch(set, /domain\s*=/i);
  assert.equal(set.includes('example.co.uk'), false);
  assert.equal(set.includes('co.uk'), false);
});

test('private custom domain auth-complete writes nothing when check-site-access refuses the public suffix', async () => {
  const { response, text } = await handleWithCookie('https://github.io/.demox/auth-complete', {
    resolve: PRIVATE_SITE,
    method: 'POST',
    body: 'token=ACCOUNT_TOKEN&next=https%3A%2F%2Fgithub.io%2F',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://www.demox.site' },
    access: { success: true, allowed: true, cookieScope: 'refuse', reason: 'public_suffix' }
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.doesNotMatch(text, /ACCOUNT_TOKEN/);
  assert.match(text, /不能保存登录状态/);
});

test('custom-domain auth cookie builder never emits Domain=', () => {
  const hooks = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, console, addEventListener: () => {} });
  vm.runInContext(`${source}\nglobalThis.__cookieHooks = { customDomainAuthCookieHeader, siteTicketCookieHeader, officialDomainOfHost };`, hooks);
  const header = hooks.__cookieHooks.customDomainAuthCookieHeader('www.example.co.uk', 'ACCOUNT_TOKEN');
  assert.match(header, /^demox_access=ACCOUNT_TOKEN; Max-Age=\d+; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  assert.equal(hooks.__cookieHooks.customDomainAuthCookieHeader('github.io', 'ACCOUNT_TOKEN').includes('Domain='), false);
  assert.equal(hooks.__cookieHooks.customDomainAuthCookieHeader('www.demox.site', 'ACCOUNT_TOKEN'), '');
  assert.equal(hooks.__cookieHooks.officialDomainOfHost('www.example.co.uk'), '');
  const ticket = hooks.__cookieHooks.siteTicketCookieHeader('botcamp.demox.site', 'SITE_TICKET');
  assert.match(ticket, /^demox_site=SITE_TICKET; Max-Age=3600; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  assert.equal(hooks.__cookieHooks.siteTicketCookieHeader('www.demox.site', 'SITE_TICKET'), '');
  assert.equal(hooks.__cookieHooks.siteTicketCookieHeader('www.example.co.uk', 'SITE_TICKET'), '');
  assert.equal(hooks.__cookieHooks.siteTicketCookieHeader('botcamp.demox.site', 'a; Domain=.demox.site'), '');
});
