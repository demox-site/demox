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
function makeRouter({ resolver, cache = fakeCache(), now = 1_000_000 }) {
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
      'RESOLVE_TIMEOUT_MS = 30; RESOLVE_RETRY_DELAY_MS = 1;\n' +
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
  assert.equal(first.response.status, 404); // 无缓存可兜底：仍走原「站点不存在」分支
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
  const { response } = await r.visit('https://coverage.demox.site/');
  assert.ok(Date.now() - started < 2000, 'bounded by RESOLVE_TIMEOUT_MS * attempts');
  assert.equal(response.status, 404);
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
  assert.equal((await r.visit('https://coverage.demox.site/')).response.status, 404);
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
  const { response, html } = await r.visit(ESSAY_URL);
  assert.equal(response.status, 404);
  assert.doesNotMatch(html, /山间来信/);
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
    const { response, html } = await r.visit(ESSAY_URL);
    assert.equal(response.status, 404);
    assert.doesNotMatch(html, /山间来信/);
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
  assert.equal((await r.visit(ESSAY_URL)).response.status, 404);
});

test('remaining risk is bounded: if the edge never saw the ban because the backend was down, stale ends at 10 minutes', async () => {
  const backend = switchableBackend('ok');
  const r = makeRouter({ resolver: backend.resolver });
  assert.equal((await r.visit(ESSAY_URL)).response.status, 200);
  backend.set('down'); // 封禁发生在后端，但之后每次查询都失败
  r.advance(9 * 60_000);
  assert.equal((await r.visit(ESSAY_URL)).response.status, 200);
  r.advance(60_000);
  assert.equal((await r.visit(ESSAY_URL)).response.status, 404);
});
