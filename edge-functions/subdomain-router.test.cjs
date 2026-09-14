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
vm.runInContext(`${source}\nglobalThis.__testHooks = { withDemoxBadge, rewriteOrigin, isWwwSpaRoute };`, context);

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
