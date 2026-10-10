const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'subdomain-router.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
const routerConfigSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'configs', 'routers.ts'), 'utf8');
const context = vm.createContext({
  URL,
  Request,
  Response,
  Headers,
  console,
  addEventListener: () => {},
  fetch: async () => { throw new Error('Unexpected fetch'); }
});
vm.runInContext(`${source}\nglobalThis.__testHooks = { withDemoxBadge, rewriteOrigin, isWwwSpaRoute, buildOriginUrl };`, context);

async function render(hideWatermark) {
  return context.__testHooks.withDemoxBadge(
    new Request('https://sample.demox.site/'),
    { waitUntil: () => {} },
    new Response('<!doctype html><html><body><main>Site</main></body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    }),
    { websiteId: 'SITE1', hideWatermark }
  );
}

test('site-{id}.demox.site origin uses HTTP so COS custom domains work before HTTPS bind', () => {
  const req = new Request('https://stx0k1md.demox.site/');
  const url = context.__testHooks.buildOriginUrl(
    req,
    '/sites/u/STX0K1MD/dist/index.html',
    '',
    'site-3.demox.site'
  );
  assert.equal(url, 'http://site-3.demox.site/sites/u/STX0K1MD/dist/index.html');
  const legacy = context.__testHooks.buildOriginUrl(req, '/sites/u/EPX2UU43/dist/index.html', '', 'sites.demox.site');
  assert.match(legacy, /^https:\/\/sites\.demox\.site\//);
});

test('strips COS force-download so HTML is not saved as an attachment', async () => {
  const resp = await context.__testHooks.withDemoxBadge(
    new Request('https://sample.demox.site/'),
    { waitUntil: () => {} },
    new Response('<!doctype html><html><body><main>Site</main></body></html>', {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': 'attachment',
        'x-cos-force-download': 'true'
      }
    }),
    { websiteId: 'SITE1', hideWatermark: true }
  );
  assert.equal(resp.headers.get('content-disposition'), null);
  assert.equal(resp.headers.get('x-cos-force-download'), null);
  assert.match(await resp.text(), /<main>Site<\/main>/);
});

test('hosted HTML includes a report control under the Demox watermark', async () => {
  const html = await (await render(false)).text();
  assert.match(html, /data-demox-site-badge="report"/);
  assert.match(html, /举报此站点/);
});

test('hosted HTML includes the Demox watermark by default', async () => {
  const html = await (await render(false)).text();
  assert.match(html, /data-demox-site-badge="wrap"/);
  assert.match(html, /Powered by Demox/);
});

test('hosted HTML omits the Demox watermark when the site setting hides it', async () => {
  const html = await (await render(true)).text();
  assert.doesNotMatch(html, /data-demox-site-badge="wrap"/);
  assert.doesNotMatch(html, /Powered by Demox/);
  assert.match(html, /<main>Site<\/main>/);
});

test('HTML at or above 1MB is served without reading the body for watermark injection', async () => {
  let reads = 0;
  const body = '<!doctype html><html><body><main>Big</main></body></html>';
  const origin = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': '2191103',
      'Cache-Control': 'public, max-age=60',
      'ETag': '"origin-etag"'
    }
  });
  const originalText = origin.text.bind(origin);
  origin.text = async () => {
    reads += 1;
    return originalText();
  };
  const originalClone = origin.clone.bind(origin);
  origin.clone = () => {
    reads += 1;
    return originalClone();
  };
  const resp = await context.__testHooks.withDemoxBadge(
    new Request('https://09vp31gs.demox.site/'),
    { waitUntil: () => {} },
    origin,
    { websiteId: '09VP31GS', hideWatermark: false }
  );
  assert.equal(reads, 0);
  assert.equal(resp.status, 200);
  assert.equal(resp.headers.get('etag'), '"origin-etag"');
  assert.equal(resp.headers.get('content-length'), '2191103');
  const html = await resp.text();
  assert.match(html, /<main>Big<\/main>/);
  assert.doesNotMatch(html, /data-demox-site-badge/);
});

test('watermark injection falls back to the origin body when reading HTML throws', async () => {
  const body = '<!doctype html><html><body><main>Still here</main></body></html>';
  const origin = new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
  const originalClone = origin.clone.bind(origin);
  origin.clone = () => {
    const cloned = originalClone();
    cloned.text = async () => {
      const error = new Error('OverSize');
      error.name = 'OverSize';
      throw error;
    };
    return cloned;
  };
  const resp = await context.__testHooks.withDemoxBadge(
    new Request('https://09vp31gs.demox.site/'),
    { waitUntil: () => {} },
    origin,
    { websiteId: '09VP31GS', hideWatermark: false }
  );
  assert.equal(resp.status, 200);
  const html = await resp.text();
  assert.match(html, /<main>Still here<\/main>/);
  assert.doesNotMatch(html, /data-demox-site-badge/);
});

async function renderWithSeo(html, seo) {
  return context.__testHooks.withDemoxBadge(
    new Request('https://sample.demox.site/about'),
    { waitUntil: () => {} },
    new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    }),
    { websiteId: 'SITE1', hideWatermark: true, seo }
  );
}

test('hosted HTML injects configured SEO tags and replaces the original title', async () => {
  const html = await (await renderWithSeo(
    '<!doctype html><html><head><title>Old Title</title><meta name="description" content="old desc"></head><body><main>Site</main></body></html>',
    {
      title: 'Custom Title',
      description: 'Custom desc',
      ogImage: 'https://cdn.example/og.png'
    }
  )).text();
  assert.match(html, /<title data-demox-seo>Custom Title<\/title>/);
  assert.doesNotMatch(html, /Old Title/);
  assert.doesNotMatch(html, /old desc/);
  assert.match(html, /property="og:title" content="Custom Title"/);
  assert.match(html, /name="description" content="Custom desc"/);
  assert.match(html, /property="og:image" content="https:\/\/cdn.example\/og.png"/);
  assert.match(html, /property="og:url" content="https:\/\/sample.demox.site\/about"/);
  assert.match(html, /<main>Site<\/main>/);
});

test('hosted HTML leaves the original title alone when only description is configured', async () => {
  const html = await (await renderWithSeo(
    '<!doctype html><html><head><title>Keep Me</title></head><body>ok</body></html>',
    { title: null, description: 'Only desc', ogImage: null }
  )).text();
  assert.match(html, /<title>Keep Me<\/title>/);
  assert.match(html, /name="description" content="Only desc"/);
});

test('router passes resolved SEO into the hosted HTML response', async () => {
  const routerContext = vm.createContext({
    URL,
    Request,
    Response,
    Headers,
    console,
    env: { DEMOX_API_URL: 'https://api.test' },
    caches: { default: { match: async () => null, put: async () => {} } },
    addEventListener: () => {},
    fetch: async (input) => {
      const url = String(input && input.url ? input.url : input);
      if (url.includes('/resolve-subdomain')) {
        return new Response(JSON.stringify({
          success: true,
          path: 'sites/demo/ABC',
          websiteId: 'SEO1',
          origin: 'sites.demox.site',
          visibility: 'public',
          hideWatermark: true,
          seo: {
            title: 'Resolved Title',
            description: 'Resolved desc',
            ogImage: 'https://cdn.example/share.png'
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('sites.demox.site')) {
        return new Response(
          '<!doctype html><html><head><title>Origin Title</title></head><body><main>Live</main></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        );
      }
      return new Response('{}', { status: 200 });
    }
  });
  vm.runInContext(`${source}\nglobalThis.__testHooks = { handle };`, routerContext);
  const response = await routerContext.__testHooks.handle(
    new Request('https://sample.demox.site/', { headers: { Accept: 'text/html' } }),
    { waitUntil: () => {}, passThroughOnException: () => {} }
  );
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<title data-demox-seo>Resolved Title<\/title>/);
  assert.doesNotMatch(html, /Origin Title/);
  assert.match(html, /name="description" content="Resolved desc"/);
  assert.match(html, /property="og:image" content="https:\/\/cdn.example\/share.png"/);
  assert.match(html, /<main>Live<\/main>/);
});

async function handleSite(url, { resolve = null, originStatus = 200, originBody = '<!doctype html><html><body><main>Live site</main></body></html>' } = {}) {
  const requests = [];
  const routerContext = vm.createContext({
    URL,
    Request,
    Response,
    Headers,
    console,
    env: { DEMOX_API_URL: 'https://api.test', DEMOX_HOME_URL: 'https://www.demox.site' },
    caches: { default: { match: async () => null, put: async () => {} } },
    addEventListener: () => {},
    fetch: async (input, init) => {
      const href = String(input && input.url ? input.url : input);
      requests.push(href);
      if (href.includes('/resolve-subdomain')) {
        return new Response(JSON.stringify(resolve || { success: false, message: 'not found' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const target = new URL(href);
      if (originStatus === 200 || target.pathname.endsWith('/index.html')) {
        return new Response(originBody, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      return new Response('Missing', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    }
  });
  vm.runInContext(`${source}\nglobalThis.__testHooks = { handle };`, routerContext);
  const response = await routerContext.__testHooks.handle(
    new Request(url, { headers: { Accept: 'text/html' } }),
    { waitUntil: () => {}, passThroughOnException: () => {} }
  );
  return { response, requests, html: await response.text() };
}

// P0 2026-09-14：未知子域名 404 不得改写已 resolve 站点。docs/incidents/2026-09-14-p0-unknown-subdomain-404-outage.md
test('P0: resolved www homepage stays 200 and is not a Demox 404 shell', async () => {
  const { response, html } = await handleSite('https://www.demox.site/', {
    resolve: {
      success: true,
      path: 'sites/1985655011013808129/EPX2UU43/dist',
      websiteId: 'EPX2UU43',
      origin: 'sites.demox.site',
      visibility: 'public',
      hideWatermark: true
    }
  });
  assert.equal(response.status, 200);
  assert.match(html, /<main>Live site<\/main>/);
  assert.doesNotMatch(html, /站点未发布/);
  assert.doesNotMatch(html, /页面不存在/);
  assert.doesNotMatch(html, /NoSuchKey/);
});

test('disabled sites return a takedown page and do not fetch origin', async () => {
  const { response, html, requests } = await handleSite('https://stx0k1md.demox.site/', {
    resolve: {
      success: true,
      path: 'sites/demo/STX0K1MD/dist',
      websiteId: 'STX0K1MD',
      origin: 'site-3.demox.site',
      visibility: 'disabled'
    }
  });
  assert.equal(response.status, 403);
  assert.match(html, /此站点已被停用/);
  assert.doesNotMatch(html, /Live site/);
  assert.doesNotMatch(html, /站点未发布/);
  assert.equal(requests.some((href) => href.includes('site-3.demox.site') || href.includes('/sites/demo/')), false);
});

test('P0: resolved user site homepage stays 200 and is not a Demox 404 shell', async () => {
  const { response, html } = await handleSite('https://coverage.demox.site/', {
    resolve: {
      success: true,
      path: 'sites/demo/COVERAGE',
      websiteId: 'COVERAGE',
      origin: 'sites.demox.site',
      visibility: 'public'
    }
  });
  assert.equal(response.status, 200);
  assert.match(html, /<main>Live site<\/main>/);
  assert.doesNotMatch(html, /站点未发布/);
  assert.doesNotMatch(html, /页面不存在/);
});

test('P0: www hardcoded fallback still 200 when resolve misses', async () => {
  const { response, html } = await handleSite('https://www.demox.site/', {
    resolve: { success: false, message: 'not found' }
  });
  assert.equal(response.status, 200);
  assert.match(html, /<main>Live site<\/main>/);
  assert.doesNotMatch(html, /站点未发布/);
});

test('P0: resolved user SPA keeps fallback when the path is missing', async () => {
  const { response, html } = await handleSite('https://coverage.demox.site/dashboard', {
    resolve: {
      success: true,
      path: 'sites/demo/COVERAGE',
      websiteId: 'COVERAGE',
      origin: 'sites.demox.site',
      visibility: 'public'
    },
    originStatus: 404
  });
  assert.equal(response.status, 200);
  assert.match(html, /<main>Live site<\/main>/);
});

test('hosted site /api routes go to the site function runtime', async () => {
  const requests = [];
  const routerContext = vm.createContext({
    URL,
    Request,
    Response,
    Headers,
    console,
    env: { DEMOX_API_URL: 'https://api.test' },
    caches: { default: { match: async () => null, put: async () => {} } },
    addEventListener: () => {},
    fetch: async (input, init) => {
      const url = String(input && input.url ? input.url : input);
      requests.push({ url, method: init?.method || (input && input.method) || 'GET' });
      if (url.includes('/resolve-subdomain')) {
        return new Response(JSON.stringify({
          success: true,
          path: 'sites/demo/ABC',
          websiteId: 'SITEAPI',
          origin: 'sites.demox.site',
          visibility: 'public'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SITEAPI/production/api/hello')) {
        return new Response(JSON.stringify({ ok: true, from: 'function' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('missing', { status: 404 });
    }
  });
  vm.runInContext(`${source}\nglobalThis.__testHooks = { handle };`, routerContext);
  const response = await routerContext.__testHooks.handle(
    new Request('https://sample.demox.site/api/hello', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name: 'Demox' })
    }),
    { waitUntil: () => {}, passThroughOnException: () => {} }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, from: 'function' });
  assert.ok(requests.some((item) => item.url.includes('https://api.test/SITEAPI/production/api/hello')));
});

test('the EdgeOne allowlist covers every current Demox client route', () => {
  const routes = new Set(['/']);
  for (const match of appSource.matchAll(/path="(\/[^"*:]+)"/g)) {
    routes.add(match[1].replace(/\/$/, '') || '/');
  }
  for (const match of routerConfigSource.matchAll(/id:\s*"([^"*]+)"/g)) {
    routes.add(`/${match[1]}`);
  }

  const missing = [...routes].filter((route) => !context.__testHooks.isWwwSpaRoute(route));
  assert.deepEqual(missing, []);
  assert.equal(context.__testHooks.isWwwSpaRoute('/console/projects/PROJECT1/settings'), true);
  assert.equal(context.__testHooks.isWwwSpaRoute('/console/projects/PROJECT1/sites'), true);
  assert.equal(context.__testHooks.isWwwSpaRoute('/console/projects/PROJECT1/sites/SITE1/analytics'), true);
  assert.equal(context.__testHooks.isWwwSpaRoute('/console/admin/dashboard'), true);
  assert.equal(context.__testHooks.isWwwSpaRoute('/console/not-real'), false);
  assert.equal(context.__testHooks.isWwwSpaRoute('/definitely-missing'), false);
});

async function rewrite({ host = 'www.demox.site', pathname, accept = 'text/html', originHost = 'sites.demox.site' }) {
  const requests = [];
  context.fetch = async (url) => {
    requests.push(String(url));
    const target = new URL(url);
    if (target.pathname.endsWith('/index.html')) {
      return new Response('<!doctype html><html><body><main>SPA</main></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      });
    }
    if (target.pathname.endsWith('/404.html')) {
      return new Response('<!doctype html><meta name="robots" content="noindex"><h1>Page not found</h1>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      });
    }
    return new Response('Missing', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  };

  const url = `https://${host}${pathname}`;
  const req = new Request(url, { headers: { Accept: accept } });
  const response = await context.__testHooks.rewriteOrigin(
    req,
    { waitUntil: () => {} },
    new URL(url),
    `/sites/demo/dist${pathname}`,
    'sites/demo/dist',
    originHost,
    { websiteId: 'EPX2UU43', label: host.split('.')[0], domain: 'demox.site', hideWatermark: true }
  );
  return { response, requests };
}

test('known Demox client routes retain the SPA fallback', async () => {
  const { response, requests } = await rewrite({ pathname: '/doc' });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<main>SPA<\/main>/);
  assert.equal(requests.length, 2);
  assert.match(requests[1], /\/sites\/demo\/dist\/index\.html$/);
});

test('unknown Demox document routes return the deployed 404 shell', async () => {
  const { response, requests } = await rewrite({ pathname: '/definitely-missing' });
  assert.equal(response.status, 404);
  assert.match(await response.text(), /name="robots" content="noindex"/);
  assert.equal(requests.length, 2);
  assert.match(requests[1], /\/sites\/demo\/dist\/404\.html$/);
});

test('hosted user SPAs retain catch-all routing', async () => {
  const { response, requests } = await rewrite({ host: 'sample.demox.site', pathname: '/dashboard' });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<main>SPA<\/main>/);
  assert.equal(requests.length, 2);
});

test('missing static assets do not fall back to HTML', async () => {
  const { response, requests } = await rewrite({ pathname: '/assets/missing.js', accept: '*/*' });
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'Missing');
  assert.equal(requests.length, 1);
});

test('custom 404 lookup uses the default origin when route metadata has no origin host', async () => {
  const { response, requests } = await rewrite({ pathname: '/missing-with-default-origin', originHost: '' });
  assert.equal(response.status, 404);
  assert.equal(new URL(requests[1]).hostname, 'sites.demox.site');
  assert.match(requests[1], /\/sites\/demo\/dist\/404\.html$/);
});

test('origin 404 without cache header (COS NoSuchKey) is served no-store, not max-age=60', async () => {
  const resp = await context.__testHooks.withDemoxBadge(
    new Request('https://sample.demox.site/missing.js'),
    { waitUntil: () => {} },
    new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404, headers: { 'Content-Type': 'application/xml' } }),
    { websiteId: 'SITE1' }
  );
  assert.equal(resp.status, 404);
  assert.equal(resp.headers.get('Cache-Control'), 'no-store');
});

test('origin 404 carrying a cacheable header is still downgraded to no-store', async () => {
  const resp = await context.__testHooks.withDemoxBadge(
    new Request('https://sample.demox.site/missing.css'),
    { waitUntil: () => {} },
    new Response('missing', { status: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=60' } }),
    { websiteId: 'SITE1' }
  );
  assert.equal(resp.headers.get('Cache-Control'), 'no-store');
});

test('successful origin responses without cache header keep the 60s default', async () => {
  const resp = await context.__testHooks.withDemoxBadge(
    new Request('https://sample.demox.site/app.js'),
    { waitUntil: () => {} },
    new Response('ok', { status: 200, headers: { 'Content-Type': 'application/javascript' } }),
    { websiteId: 'SITE1' }
  );
  assert.equal(resp.headers.get('Cache-Control'), 'public, max-age=60');
});

test('site 404.html and Demox fallback 404 pages are no-store', async () => {
  const { response } = await rewrite({ pathname: '/definitely-missing' });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');

  context.fetch = async () => new Response('Missing', { status: 404 });
  const url = 'https://user1.demox.site/nope';
  const fallback = await context.__testHooks.rewriteOrigin(
    new Request(url, { headers: { Accept: 'text/html' } }),
    { waitUntil: () => {} },
    new URL(url),
    '/sites/u/S/dist/nope',
    'sites/u/S/dist',
    'sites.demox.site',
    { websiteId: 'S', label: 'user1', domain: 'demox.site', hideWatermark: true }
  );
  assert.equal(fallback.status, 404);
  assert.equal(fallback.headers.get('Cache-Control'), 'no-store');
});

// ---------------------------------------------------------------------------
// 2026-10-08：resolve 结果缓存。超时/出错绝不缓存「找不到」，不存在只短缓存，
// 新鲜期由 cachedAt 在代码里判断，key 带版本绕开旧条目。
// ---------------------------------------------------------------------------

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

const LETTERS_FOUND = {
  success: true,
  path: 'sites/1985655011013808129/LCJAIAC0/dist',
  websiteId: 'LCJAIAC0',
  origin: 'site-3.demox.site',
  visibility: 'public',
  hideWatermark: true
};

// resolver: (payload, attemptNo) => Response | Promise<Response> | throws
function makeRouter({ resolver, cache = fakeCache(), now = 1_000_000, origin = null }) {
  const calls = { resolve: [], origin: [] };
  const routerContext = vm.createContext({
    URL,
    Request,
    Response,
    Headers,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    AbortController,
    env: { DEMOX_API_URL: 'https://api.test' },
    caches: { default: cache.cache },
    addEventListener: () => {},
    fetch: async (input, init) => {
      const href = String(input && input.url ? input.url : input);
      if (href.includes('/resolve-subdomain')) {
        const payload = JSON.parse(init.body);
        calls.resolve.push(payload);
        return resolver(payload, calls.resolve.length, init);
      }
      calls.origin.push(href);
      if (origin) {
        const custom = await origin(href, calls.origin.length, init);
        if (custom) return custom;
      }
      if (href.startsWith('http://site-3.demox.site/') || href.startsWith('https://sites.demox.site/')) {
        return new Response('<!doctype html><html><body><main>山间来信</main></body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        });
      }
      // 未知站点 passthrough 回源桶根（线上是 COS「站点未发布」404）
      return new Response('<title>404 · 站点未发布</title>', {
        status: 404,
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=60' }
      });
    }
  });
  vm.runInContext(
    `${source}\nglobalThis.__now = ${now};\nnowMs = function () { return globalThis.__now; };\n` +
      'RESOLVE_TIMEOUT_MS = 30; RESOLVE_RETRY_DELAY_MS = 1; ORIGIN_TIMEOUT_MS = 40;\n' +
      'globalThis.__testHooks = { handle, resolveSite };',
    routerContext
  );
  const visit = async (url) => {
    const response = await routerContext.__testHooks.handle(
      new Request(url, { headers: { Accept: 'text/html' } }),
      { waitUntil: () => {}, passThroughOnException: () => {} }
    );
    return { response, html: await response.text() };
  };
  return {
    calls,
    cache,
    visit,
    ctx: routerContext,
    advance: (ms) => { routerContext.__now += ms; }
  };
}

// 解析出错且没有可用兜底：503 暂时不可用（no-store），绝不是 404「站点未发布」。
function assertUnavailable({ response, html }, route = /^resolve=error; origin=none$/) {
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.ok(Number(response.headers.get('Retry-After')) > 0);
  assert.match(response.headers.get('x-demox-route') || '', route);
  assert.match(html, /暂时无法访问，请刷新/);
  assert.match(html, /Temporarily unavailable, please refresh/);
  assert.doesNotMatch(html, /站点未发布|山间来信/);
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('resolve: a network error is never cached as "not found"; the next visit re-resolves and serves 200', async () => {
  let down = true;
  const r = makeRouter({
    resolver: () => {
      if (down) throw new TypeError('network error');
      return json(LETTERS_FOUND);
    }
  });
  const first = await r.visit('https://letters-from-the-hill.demox.site/');
  assertUnavailable(first); // 无缓存可兜底：503 暂时不可用，不再落到「站点未发布」
  assert.equal(r.calls.resolve.length, 2, 'one retry after the error');
  assert.equal(r.cache.puts.length, 0, 'errors must not be written to the cache');

  down = false;
  const second = await r.visit('https://letters-from-the-hill.demox.site/');
  assert.equal(second.response.status, 200);
  assert.match(second.html, /山间来信/);
  assert.equal(r.calls.resolve.length, 3);
});

test('resolve: a hung backend times out, retries once, and caches nothing', async () => {
  const r = makeRouter({
    resolver: (payload, n, init) => new Promise((resolve, reject) => {
      if (init && init.signal) init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    })
  });
  const started = Date.now();
  const visited = await r.visit('https://coverage.demox.site/');
  assert.ok(Date.now() - started < 2000, 'bounded by RESOLVE_TIMEOUT_MS * attempts');
  assertUnavailable(visited);
  assert.equal(r.calls.resolve.length, 2);
  assert.equal(r.cache.puts.length, 0);
});

test('resolve: the retry rescues a transient failure and the hit is cached', async () => {
  const r = makeRouter({
    resolver: (payload, n) => (n === 1 ? json({ message: 'gateway' }, 502) : json(LETTERS_FOUND))
  });
  const { response, html } = await r.visit('https://letters-from-the-hill.demox.site/');
  assert.equal(response.status, 200);
  assert.match(html, /山间来信/);
  assert.equal(r.calls.resolve.length, 2);
  assert.equal(r.cache.puts.length, 1);
  assert.equal(JSON.parse(r.cache.puts[0].body).status, 'found');
});

test('resolve: backend success:false with a DB error is treated as an error, not as "not found"', async () => {
  const r = makeRouter({ resolver: () => json({ success: false, message: 'connect ETIMEDOUT' }) });
  await r.visit('https://coverage.demox.site/');
  assert.equal(r.calls.resolve.length, 2);
  assert.equal(r.cache.puts.length, 0);
});

test('resolve: a genuine "not found" is cached only briefly (15s) under a versioned key', async () => {
  let exists = false;
  const r = makeRouter({
    resolver: () => (exists ? json(LETTERS_FOUND) : json({ success: false, message: 'not found' }))
  });
  const first = await r.visit('https://letters-from-the-hill.demox.site/');
  assert.equal(first.response.status, 404);
  assert.equal(r.cache.puts.length, 1);
  const put = r.cache.puts[0];
  assert.equal(put.key, 'https://resolve.demox.site/v2/host/demox.site/letters-from-the-hill');
  assert.match(put.headers['cache-control'], /max-age=15\b/);
  assert.equal(JSON.parse(put.body).status, 'not_found');

  exists = true; // 刚设置好前缀
  r.advance(10_000);
  const within = await r.visit('https://letters-from-the-hill.demox.site/');
  assert.equal(within.response.status, 404, 'still inside the 15s negative window');
  assert.equal(r.calls.resolve.length, 1);

  r.advance(6_000);
  const after = await r.visit('https://letters-from-the-hill.demox.site/');
  assert.equal(after.response.status, 200, 'negative entry expires by cachedAt even if the edge keeps it');
  assert.equal(r.calls.resolve.length, 2);
});

test('resolve: legacy unversioned cache entries (the stuck letters-from-the-hill case) are ignored', async () => {
  const cache = fakeCache();
  // 旧版本写下的「找不到」：无版本 key、无 cachedAt
  cache.store.set('https://resolve.demox.site/host/demox.site/letters-from-the-hill', {
    body: JSON.stringify({ path: null, websiteId: null, origin: null, visibility: 'public' }),
    headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' }
  });
  // 万一同 key 上也有旧格式内容，也不能被当成命中
  cache.store.set('https://resolve.demox.site/v2/host/demox.site/letters-from-the-hill', {
    body: JSON.stringify({ path: null }),
    headers: { 'content-type': 'application/json' }
  });
  const r = makeRouter({ cache, resolver: () => json(LETTERS_FOUND) });
  const { response, html } = await r.visit('https://letters-from-the-hill.demox.site/');
  assert.equal(response.status, 200);
  assert.match(html, /山间来信/);
  assert.equal(r.calls.resolve.length, 1);
});

test('resolve: a positive entry is fresh for 60s, then re-resolved (old prefix stops serving once the backend says not found)', async () => {
  let moved = false;
  const r = makeRouter({
    resolver: () => (moved ? json({ success: false, message: 'not found' }) : json(LETTERS_FOUND))
  });
  assert.equal((await r.visit('https://example-essay.demox.site/')).response.status, 200);
  moved = true; // domain set 把站点挪到新前缀
  r.advance(30_000);
  assert.equal((await r.visit('https://example-essay.demox.site/')).response.status, 200);
  assert.equal(r.calls.resolve.length, 1);
  r.advance(31_000);
  assert.equal((await r.visit('https://example-essay.demox.site/')).response.status, 404);
  assert.equal(r.calls.resolve.length, 2);
});

test('resolve: when the backend errors after the fresh window, the last known route is served (stale-if-error)', async () => {
  let down = false;
  const r = makeRouter({
    resolver: () => {
      if (down) throw new TypeError('network error');
      return json(LETTERS_FOUND);
    }
  });
  assert.equal((await r.visit('https://coverage.demox.site/')).response.status, 200);
  down = true;
  r.advance(5 * 60_000);
  const { response, html } = await r.visit('https://coverage.demox.site/');
  assert.equal(response.status, 200);
  assert.match(html, /山间来信/);
  assert.equal(r.cache.puts.length, 1, 'stale fallback does not rewrite the entry');

  r.advance(5 * 60_000); // 共 10 分钟：超过 RESOLVE_STALE_IF_ERROR_TTL
  assertUnavailable(await r.visit('https://coverage.demox.site/'));
});

test('resolve: www keeps its hardcoded fallback when resolve errors', async () => {
  const r = makeRouter({ resolver: () => { throw new TypeError('network error'); } });
  const { response } = await r.visit('https://www.demox.site/');
  assert.equal(response.status, 200);
  assert.equal(r.cache.puts.length, 0);
});

test('resolve: custom hosts use the same rules (errors not cached, versioned key)', async () => {
  let down = true;
  const r = makeRouter({
    resolver: (payload) => {
      assert.equal(payload.host, 'blog.example.com');
      if (down) throw new TypeError('network error');
      return json(LETTERS_FOUND);
    }
  });
  await r.visit('https://blog.example.com/');
  assert.equal(r.cache.puts.length, 0);
  down = false;
  const { response } = await r.visit('https://blog.example.com/');
  assert.equal(response.status, 200);
  assert.equal(r.cache.puts[0].key, 'https://resolve.demox.site/v2/custom/blog.example.com');
});

test('resolve: cache.match throwing (EdgeOne 504 on expired entries) is treated as a miss', async () => {
  const cache = fakeCache();
  cache.cache.match = async () => { const e = new Error('504'); e.status = 504; throw e; };
  const r = makeRouter({ cache, resolver: () => json(LETTERS_FOUND) });
  const { response } = await r.visit('https://letters-from-the-hill.demox.site/');
  assert.equal(response.status, 200);
});

// ---------------------------------------------------------------------------
// stale-if-error 不得让被封禁 / 已删除的站点复活；窗口 10 分钟。
// ---------------------------------------------------------------------------

const LETTERS_BANNED = { ...LETTERS_FOUND, visibility: 'disabled' };
const ESSAY_URL = 'https://letters-from-the-hill.demox.site/';
const ESSAY_KEY = 'https://resolve.demox.site/v2/host/demox.site/letters-from-the-hill';

function switchableBackend(initial) {
  let state = initial;
  return {
    set: (next) => { state = next; },
    resolver: () => {
      if (state === 'down') throw new TypeError('network error');
      if (state === 'hang') return new Promise(() => {});
      if (state === 'banned') return json(LETTERS_BANNED);
      if (state === 'deleted') return json({ success: false, message: 'not found' });
      return json(LETTERS_FOUND);
    }
  };
}

test('stale window is a named 10-minute constant and found entries are stored for exactly that long', async () => {
  const backend = switchableBackend('ok');
  const r = makeRouter({ resolver: backend.resolver });
  assert.equal(r.ctx.RESOLVE_STALE_IF_ERROR_TTL, 600);
  await r.visit(ESSAY_URL);
  assert.match(r.cache.store.get(ESSAY_KEY).headers['cache-control'], /max-age=600\b/);
});

test('stale fallback ends exactly at 10 minutes after the last good lookup', async () => {
  const backend = switchableBackend('ok');
  const r = makeRouter({ resolver: backend.resolver });
  assert.equal((await r.visit(ESSAY_URL)).response.status, 200);
  backend.set('down');
  r.advance(10 * 60_000 - 1);
  assert.equal((await r.visit(ESSAY_URL)).response.status, 200);
  r.advance(1);
  assertUnavailable(await r.visit(ESSAY_URL));
});

test('banned site: the ban replaces the last good entry; when the backend then goes down the site is NOT served from stale', async () => {
  const backend = switchableBackend('ok');
  const r = makeRouter({ resolver: backend.resolver });
  assert.equal((await r.visit(ESSAY_URL)).response.status, 200);

  backend.set('banned');
  r.advance(61_000);
  const originBeforeBan = r.calls.origin.length;
  const banned = await r.visit(ESSAY_URL);
  assert.equal(banned.response.status, 403);
  assert.match(banned.html, /此站点已被停用/);
  const entry = JSON.parse(r.cache.store.get(ESSAY_KEY).body);
  assert.equal(entry.status, 'blocked');

  for (const state of ['down', 'hang']) {
    backend.set(state);
    for (const step of [16_000, 60_000, 5 * 60_000]) {
      r.advance(step);
      const { response, html } = await r.visit(ESSAY_URL);
      assert.notEqual(response.status, 200, `${state} +${step}ms must not revive a banned site`);
      assert.doesNotMatch(html, /山间来信/);
    }
  }
  assert.equal(
    r.calls.origin.slice(originBeforeBan).some((href) => href.includes('LCJAIAC0')),
    false,
    'never fetches the banned site origin after the ban'
  );
});

test('banned status is a real answer: cached only 15s fresh, never retried as an error, and unban takes effect after 15s', async () => {
  const backend = switchableBackend('banned');
  const r = makeRouter({ resolver: backend.resolver });
  assert.equal((await r.visit(ESSAY_URL)).response.status, 403);
  assert.equal(r.calls.resolve.length, 1, 'no retry: banned is not an error');
  backend.set('ok');
  r.advance(10_000);
  assert.equal((await r.visit(ESSAY_URL)).response.status, 403);
  r.advance(6_000);
  assert.equal((await r.visit(ESSAY_URL)).response.status, 200);
});

test('deleted site: "not found" replaces the last good entry; when the backend then goes down the site is NOT served from stale', async () => {
  const backend = switchableBackend('ok');
  const r = makeRouter({ resolver: backend.resolver });
  assert.equal((await r.visit(ESSAY_URL)).response.status, 200);

  backend.set('deleted');
  r.advance(61_000);
  assert.equal((await r.visit(ESSAY_URL)).response.status, 404);
  assert.equal(r.calls.resolve.length, 2, 'not found is not retried');
  assert.equal(JSON.parse(r.cache.store.get(ESSAY_KEY).body).status, 'not_found');

  backend.set('down');
  for (const step of [16_000, 60_000, 5 * 60_000]) {
    r.advance(step);
    assertUnavailable(await r.visit(ESSAY_URL));
  }
});

test('deleted site: if writing the "not found" entry fails, the old good entry is deleted instead of kept', async () => {
  const backend = switchableBackend('ok');
  const cache = fakeCache();
  const r = makeRouter({ cache, resolver: backend.resolver });
  assert.equal((await r.visit(ESSAY_URL)).response.status, 200);
  cache.cache.put = async () => { throw new Error('413'); };
  backend.set('deleted');
  r.advance(61_000);
  assert.equal((await r.visit(ESSAY_URL)).response.status, 404);
  assert.equal(cache.store.has(ESSAY_KEY), false);
  backend.set('down');
  r.advance(60_000);
  assertUnavailable(await r.visit(ESSAY_URL));
});

test('remaining risk is bounded: if the edge never saw the ban because the backend was down, stale ends at 10 minutes', async () => {
  const backend = switchableBackend('ok');
  const r = makeRouter({ resolver: backend.resolver });
  assert.equal((await r.visit(ESSAY_URL)).response.status, 200);
  backend.set('down'); // 封禁发生在后端，但之后每次查询都失败
  r.advance(9 * 60_000);
  assert.equal((await r.visit(ESSAY_URL)).response.status, 200);
  r.advance(60_000);
  assertUnavailable(await r.visit(ESSAY_URL));
});

// ---------------------------------------------------------------------------
// 2026-10-08 诊断：真正的 17s/404 来自站点文件回源（http://site-3.demox.site）挂起/抛错，
// 异常被 passThroughOnException 回源到桶根「站点未发布」。回源加超时+重试，失败回 503。
// ---------------------------------------------------------------------------

const LEGACY_ESSAY_KEY = 'https://resolve.demox.site/host/demox.site/letters-from-the-hill';

function routeOf(response) {
  return response.headers.get('x-demox-route');
}

test('origin: a throwing site-file fetch becomes 503 no-store (never 404 / 站点未发布), after one retry', async () => {
  const r = makeRouter({
    resolver: () => json(LETTERS_FOUND),
    origin: (href) => {
      if (href.startsWith('http://site-3.demox.site/')) throw new TypeError('Network connection lost');
      return null;
    }
  });
  const visited = await r.visit(ESSAY_URL);
  assertUnavailable(visited, /^resolve=miss; origin=error$/);
  const siteFetches = r.calls.origin.filter((h) => h.startsWith('http://site-3.demox.site/'));
  assert.equal(siteFetches.length, 2, 'one retry');
  assert.equal(r.calls.origin.some((h) => h.startsWith('https://sites.demox.site/') || h === ESSAY_URL), false,
    'never falls through to the bucket root');
});

test('origin: a hung fetch times out, the retry succeeds, and the visitor gets 200 with origin=retry', async () => {
  const r = makeRouter({
    resolver: () => json(LETTERS_FOUND),
    origin: (href, n) => (n === 1 ? new Promise(() => {}) : null)
  });
  const started = Date.now();
  const { response, html } = await r.visit(ESSAY_URL);
  assert.ok(Date.now() - started < 2000, 'bounded by ORIGIN_TIMEOUT_MS * attempts');
  assert.equal(response.status, 200);
  assert.match(html, /山间来信/);
  assert.equal(routeOf(response), 'resolve=miss; origin=retry');
  assert.equal(r.calls.origin.filter((h) => h.startsWith('http://site-3.demox.site/')).length, 2);
});

test('origin: two hung fetches → 503 (timeout ~ORIGIN_TIMEOUT_MS each), nothing cached as not found', async () => {
  const r = makeRouter({ resolver: () => json(LETTERS_FOUND), origin: () => new Promise(() => {}) });
  assertUnavailable(await r.visit(ESSAY_URL), /^resolve=miss; origin=error$/);
  assert.equal(r.calls.origin.filter((h) => h.startsWith('http://site-3.demox.site/')).length, 2);
  assert.equal(JSON.parse(r.cache.store.get(ESSAY_KEY).body).status, 'found', 'resolve entry unaffected');
});

test('origin: the default timeout is ~8s with one retry', () => {
  const r = makeRouter({ resolver: () => json(LETTERS_FOUND) });
  const fresh = vm.createContext({ URL, Request, Response, Headers, console, addEventListener: () => {} });
  vm.runInContext(`${source}\nglobalThis.__c = { t: ORIGIN_TIMEOUT_MS, a: ORIGIN_ATTEMPTS };`, fresh);
  assert.equal(fresh.__c.t, 8000);
  assert.equal(fresh.__c.a, 2);
  assert.ok(r);
});

test('origin: a real site 404 from the origin is still the site 404 (not 503), with origin=ok', async () => {
  const r = makeRouter({
    resolver: () => json(LETTERS_FOUND),
    origin: (href) => (href.includes('/missing.png')
      ? new Response('nope', { status: 404, headers: { 'Content-Type': 'text/plain' } })
      : null)
  });
  const res = await r.ctx.__testHooks.handle(
    new Request('https://letters-from-the-hill.demox.site/missing.png', { headers: { Accept: 'image/png' } }),
    { waitUntil: () => {}, passThroughOnException: () => {} }
  );
  assert.equal(res.status, 404);
  assert.equal(routeOf(res), 'resolve=miss; origin=ok');
});

test('handle: an unexpected throw on site traffic becomes 503, never reaches passThroughOnException', async () => {
  const r = makeRouter({ resolver: () => json(LETTERS_FOUND) });
  vm.runInContext('rewriteOrigin = async function () { throw new Error("boom"); };', r.ctx);
  assertUnavailable(await r.visit(ESSAY_URL), /^resolve=miss; origin=error$/);
});

test('handle: www keeps its existing path (no 503 mapping, no retry, no route header)', async () => {
  const r = makeRouter({
    resolver: () => { throw new TypeError('network error'); },
    origin: (href) => { if (href.startsWith('https://sites.demox.site/')) throw new TypeError('lost'); return null; }
  });
  await assert.rejects(() => r.visit('https://www.demox.site/'), /lost/);
  assert.equal(r.calls.origin.length, 1, 'www is not retried');

  const ok = makeRouter({ resolver: () => { throw new TypeError('network error'); } });
  const { response } = await ok.visit('https://www.demox.site/');
  assert.equal(response.status, 200);
  assert.equal(routeOf(response), null);
});

test('handle: platform hosts (sites.demox.site = www origin) keep passthrough when resolve errors', async () => {
  const r = makeRouter({ resolver: () => { throw new TypeError('network error'); } });
  const { response } = await r.visit('https://sites.demox.site/sites/x/EPX2UU43/dist/index.html');
  assert.notEqual(response.status, 503);
  assert.equal(r.calls.origin.at(-1), 'https://sites.demox.site/sites/x/EPX2UU43/dist/index.html');
});

test('route header: hit / miss / stale are reported on site responses', async () => {
  const backend = switchableBackend('ok');
  const r = makeRouter({ resolver: backend.resolver });
  assert.equal(routeOf((await r.visit(ESSAY_URL)).response), 'resolve=miss; origin=ok');
  r.advance(10_000);
  assert.equal(routeOf((await r.visit(ESSAY_URL)).response), 'resolve=hit; origin=ok');
  backend.set('down');
  r.advance(120_000);
  assert.equal(routeOf((await r.visit(ESSAY_URL)).response), 'resolve=stale; origin=ok');
});

test('v1fallback: v2 miss + backend error + a recent v1 entry → served via the old key', async () => {
  const cache = fakeCache();
  const now = 1_000_000_000;
  cache.store.set(LEGACY_ESSAY_KEY, {
    body: JSON.stringify(LETTERS_FOUND),
    headers: { 'content-type': 'application/json', date: new Date(now - 2 * 60_000).toUTCString() }
  });
  const r = makeRouter({ cache, now, resolver: () => { throw new TypeError('network error'); } });
  const { response, html } = await r.visit(ESSAY_URL);
  assert.equal(response.status, 200);
  assert.match(html, /山间来信/);
  assert.equal(routeOf(response), 'resolve=v1fallback; origin=ok');
  assert.equal(r.cache.puts.length, 0, 'fallback writes nothing');
  assert.equal(cache.store.has(LEGACY_ESSAY_KEY), true, 'old key untouched');
});

test('v1fallback: a v1 "found" entry older than the 10-min stale window (or of unknown age) is not used → 503', async () => {
  for (const headers of [
    { 'content-type': 'application/json', date: new Date(1_000_000_000 - 10 * 60_000).toUTCString() },
    { 'content-type': 'application/json', date: new Date(1_000_000_000 - 60_000).toUTCString(), age: '700' },
    { 'content-type': 'application/json' }
  ]) {
    const cache = fakeCache();
    cache.store.set(LEGACY_ESSAY_KEY, { body: JSON.stringify(LETTERS_FOUND), headers });
    const r = makeRouter({ cache, now: 1_000_000_000, resolver: () => { throw new TypeError('network error'); } });
    assertUnavailable(await r.visit(ESSAY_URL));
  }
});

test('v1fallback: a banned v1 entry is not revived (disabled page, no origin fetch), whatever its age', async () => {
  for (const date of [new Date(1_000_000_000 - 60_000).toUTCString(), new Date(0).toUTCString(), null]) {
    const cache = fakeCache();
    const headers = { 'content-type': 'application/json' };
    if (date) headers.date = date;
    cache.store.set(LEGACY_ESSAY_KEY, { body: JSON.stringify(LETTERS_BANNED), headers });
    const r = makeRouter({ cache, now: 1_000_000_000, resolver: () => { throw new TypeError('network error'); } });
    const { response, html } = await r.visit(ESSAY_URL);
    assert.equal(response.status, 403);
    assert.match(html, /此站点已被停用/);
    assert.doesNotMatch(html, /山间来信/);
    assert.equal(routeOf(response), 'resolve=v1fallback; origin=none');
    assert.equal(r.calls.origin.length, 0);
  }
});

test('v1fallback: a v1 "not found" entry keeps not-found semantics (existing unknown-host branch)', async () => {
  const cache = fakeCache();
  cache.store.set(LEGACY_ESSAY_KEY, {
    body: JSON.stringify({ path: null, websiteId: null, origin: null, visibility: 'public' }),
    headers: { 'content-type': 'application/json' }
  });
  const r = makeRouter({ cache, resolver: () => { throw new TypeError('network error'); } });
  const { response } = await r.visit(ESSAY_URL);
  assert.equal(response.status, 404);
  assert.equal(r.calls.origin.at(-1), ESSAY_URL, 'passthrough as before');
});

test('v1fallback: v1 is only consulted when there is no v2 entry at all, and never when the backend answers', async () => {
  const cache = fakeCache();
  cache.store.set(LEGACY_ESSAY_KEY, {
    body: JSON.stringify(LETTERS_FOUND),
    headers: { 'content-type': 'application/json', date: new Date(1_000_000_000).toUTCString() }
  });
  const backend = switchableBackend('deleted');
  const r = makeRouter({ cache, now: 1_000_000_000, resolver: backend.resolver });
  assert.equal((await r.visit(ESSAY_URL)).response.status, 404, 'backend answer wins over v1');
  backend.set('down');
  r.advance(16_000); // v2 not_found 条目过期但仍在
  assertUnavailable(await r.visit(ESSAY_URL));
});


// ── 2026-10-10 demox_access 账号令牌 cookie 止血（step 1）───────────────────────────
{
  const hooksContext = vm.createContext({ URL, Request, Response, Headers, console, addEventListener: () => {} });
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

  test('cookie strip: look-alike names and cookie-less requests are untouched', () => {
    assert.equal(stripAuthCookieValue('demox_access2=x; xdemox_access=y; Demox_Access=z'), 'demox_access2=x; xdemox_access=y; Demox_Access=z');
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

async function handleWithCookie(url, { cookie, resolve, method = 'GET', accept = 'text/html', body, headers = {} } = {}) {
  const calls = [];
  const routerContext = vm.createContext({
    URL, Request, Response, Headers, console,
    env: { DEMOX_API_URL: 'https://api.test', DEMOX_HOME_URL: 'https://www.demox.site' },
    caches: { default: { match: async () => null, put: async () => {} } },
    addEventListener: () => {},
    fetch: async (input, init) => {
      const c = cookieOf(input, init);
      calls.push(c);
      if (c.url.includes('/resolve-subdomain')) {
        return new Response(JSON.stringify(resolve || { success: false, message: 'not found' }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
      if (c.url.includes('/check-site-access')) {
        return new Response(JSON.stringify({ success: true, allowed: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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

test('origin fetch for a user site never carries demox_access but keeps the user cookies', async () => {
  const { response, calls } = await handleWithCookie('https://pub1.demox.site/', { cookie: 'a=1; demox_access=ACCOUNT_TOKEN; b=2', resolve: PUBLIC_SITE });
  assert.equal(response.status, 200);
  const origin = calls.filter((c) => c.url.includes('sites.demox.site/'));
  assert.ok(origin.length >= 1);
  for (const c of origin) assert.equal(c.cookie, 'a=1; b=2');
  assert.equal(calls.some((c) => String(c.cookie || '').includes('ACCOUNT_TOKEN')), false);
});

test('origin fetch drops the Cookie header when demox_access was the only cookie', async () => {
  const { calls } = await handleWithCookie('https://pub1.demox.site/', { cookie: 'demox_access=ACCOUNT_TOKEN', resolve: PUBLIC_SITE });
  const origin = calls.filter((c) => c.url.includes('sites.demox.site/'));
  assert.ok(origin.length >= 1);
  for (const c of origin) assert.equal(c.cookie, null);
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

test('unknown official subdomain passthrough strips demox_access', async () => {
  const { calls } = await handleWithCookie('https://nobody-here.demox.site/x', { cookie: 'demox_access=ACCOUNT_TOKEN; z=9' });
  const pass = calls.filter((c) => c.url.startsWith('https://nobody-here.demox.site/'));
  assert.equal(pass.length, 1);
  assert.equal(pass[0].cookie, 'z=9');
});

test('requests carrying the old cookie get both expiry variants back', async () => {
  const { response } = await handleWithCookie('https://pub1.demox.site/', { cookie: 'demox_access=ACCOUNT_TOKEN', resolve: PUBLIC_SITE });
  const set = response.headers.get('set-cookie') || '';
  assert.match(set, /demox_access=; Max-Age=0; Path=\/; Domain=\.demox\.site; Secure; SameSite=Lax/);
  assert.match(set, /demox_access=; Max-Age=0; Path=\/; Secure; SameSite=Lax/);
  assert.doesNotMatch(set, /ACCOUNT_TOKEN/);
});

test('requests without the old cookie get no Set-Cookie added', async () => {
  const { response } = await handleWithCookie('https://pub1.demox.site/', { cookie: 'a=1', resolve: PUBLIC_SITE });
  assert.equal(response.headers.get('set-cookie'), null);
});

test('private *.demox.site site ignores the account cookie and asks for re-verification', async () => {
  const { response, calls, text } = await handleWithCookie('https://prv1.demox.site/', { cookie: 'demox_access=ACCOUNT_TOKEN', resolve: PRIVATE_SITE });
  assert.equal(response.status, 503);
  assert.match(text, /需要重新验证/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls.some((c) => c.url.includes('/check-site-access')), false);
  assert.equal(calls.some((c) => c.url.includes('site-3.demox.site') || c.url.includes('/sites/demo/')), false);
  const api = await handleWithCookie('https://prv1.demox.site/api/x', { resolve: PRIVATE_SITE, accept: 'application/json' });
  assert.equal(api.response.status, 401);
  assert.equal(api.calls.some((c) => c.url.startsWith('https://api.test/PRV1/')), false);
});

test('private *.demox.site auth-complete never sets a token cookie or redirects', async () => {
  const { response } = await handleWithCookie('https://prv1.demox.site/.demox/auth-complete', {
    resolve: PRIVATE_SITE, method: 'POST', body: 'token=ACCOUNT_TOKEN&next=https%3A%2F%2Fprv1.demox.site%2F',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://www.demox.site' }
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('location'), null);
  assert.doesNotMatch(response.headers.get('set-cookie') || '', /ACCOUNT_TOKEN/);
});

// ── 2026-10-10 #49 follow-up：模拟 EdgeOne 的 Request/fetch 语义 ─────────────────────────
// 事故 17:18–17:23：带 demox_access 的请求在 EdgeOne 上公开站点 503、www 404。
// 推测：EdgeOne 不支持 new Request(request, init)，也不接受「重建的 Request」作为 fetch 的 init。
// 这里的 EdgeOne 模拟：Request(Request, …) 直接抛错；fetch(url, init) 的 init 若是 Request，
// 只接受原始入站请求（#49 之前线上一直这么用）；fetch(Request, init) 抛错。
// fetch(new Request(字符串URL, init)) 允许：/api/* 函数转发一直这么用，事故期间探针站带 cookie 调函数是正常的。
const NativeRequest = Request;
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
    URL, Request: EdgeOneRequest, Response, Headers, console,
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

function assertNoAuthCookie(calls) {
  for (const c of calls) assert.doesNotMatch(String(c.cookie || ''), /demox_access|ACCOUNT_TOKEN/, `leaked to ${c.url}`);
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
    for (const c of origin) assert.equal(c.cookie, 'a=1; b=2');
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

  test(`EdgeOne-like: unknown subdomain passthrough ${label} does not throw and strips demox_access`, async () => {
    const r = await handleEdgeOneLike('https://nobody-here.demox.site/x', { cookie });
    assert.equal(r.thrown, null);
    assert.deepEqual(r.errors, []);
    const pass = r.calls.filter((c) => c.url.startsWith('https://nobody-here.demox.site/'));
    assert.equal(pass.length, 1);
    assert.equal(pass[0].cookie, 'a=1; b=2');
  });
}

test('EdgeOne-like: requests without demox_access keep the pre-#49 fetch shape (original request object)', () => {
  // 回源/透传在没有 demox_access 时必须原样传入站请求（线上已验证的路径），只有带 cookie 时才换普通 init。
  assert.match(source, /function originFetchInit\(req\) \{\s*return hasAuthCookie\(req\.headers\) \? strippedFetchInit\(req\) : req;/);
  assert.match(source, /if \(!hasAuthCookie\(req\.headers\)\) return fetch\(req\);/);
  assert.doesNotMatch(source, /new Request\(req\b/);
});
