const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 2026-11-04 云帆：去 AE 重建请求时带 body 没有 duplex:'half'，Node 抛 "duplex option is required"。
// 非 GET 带 body + AE：直连 sites.demox.site 和无令牌透传，body 原样到源站，AE 不转发，Cookie 照转。
const PUID = '1985655011013808129';
const src = fs.readFileSync(path.join(__dirname, 'subdomain-router.js'), 'utf8');
function make(secret) {
  const calls = [];
  const ctx = vm.createContext({ URL, Request, Response, Headers, crypto: globalThis.crypto, TextEncoder, TextDecoder, setTimeout, clearTimeout, AbortController,
    console: { log() {}, warn() {}, error() {}, info() {} },
    env: Object.assign({ DEMOX_API_URL: 'https://api.test', DEMOX_HOME_URL: 'https://www.demox.site' }, secret ? { DEMOX_ORIGIN_GUARD_SECRET_A: 'origin-guard-test-slot-a-placeholder', DEMOX_ORIGIN_GUARD_KID: 'A' } : {}),
    caches: { default: { match: async () => undefined, put: async () => {}, delete: async () => false } }, addEventListener() {},
    fetch: async (input, init) => {
      const req = new Request(input, init);
      if (req.url.includes('/resolve-subdomain') || req.url.includes('/check-site-access')) {
        const p = JSON.parse(await req.text());
        if (p.websiteId) return Response.json({ success: true, allow: true, path: `sites/${PUID}/${p.websiteId}/dist`, visibility: 'public' });
        if (p.host) return Response.json({ success: true });
        return Response.json({ success: false }, { status: 404 });
      }
      const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text();
      calls.push({ url: req.url, method: req.method, ae: req.headers.get('accept-encoding'), cookie: req.headers.get('cookie'), body });
      return new Response('echo:' + body, { status: 200, headers: { 'content-type': 'text/plain' } });
    } });
  vm.runInContext(src + '\nglobalThis.__h=handle;', ctx);
  return async (url, init) => {
    calls.length = 0;
    const r = await ctx.__h(new Request(url, Object.assign({ duplex: 'half' }, init)), { waitUntil() {}, passThroughOnException() {} });
    return { status: r.status, text: await r.text(), calls: calls.slice() };
  };
}
const PAYLOAD = '{"p0":"body-probe","n":1}';
for (const secret of [true, false]) {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const ae of ['gzip, deflate, br', '']) {
      for (const [kind, url] of [['direct sites.demox.site', `https://sites.demox.site/sites/${PUID}/EPX2UU43/dist/api/x`], ['unknown-host passthrough', 'https://unknown-host.example/api/x'], ['sites.demox.site no-id passthrough', 'https://sites.demox.site/robots.txt']]) {
        test(`secret=${secret} ${kind} ${method} AE=${ae || 'none'}: body intact, AE not forwarded`, async () => {
          const run = make(secret);
          const headers = { 'content-type': 'application/json', cookie: 'a=1' };
          if (ae) headers['accept-encoding'] = ae;
          const r = await run(url, { method, headers, body: PAYLOAD });
          const hit = r.calls.find((c) => c.method === method);
          assert.ok(hit, 'origin got ' + method + ' (' + JSON.stringify(r.calls) + ', status ' + r.status + ')');
          assert.equal(hit.body, PAYLOAD);
          assert.equal(hit.ae, null);
          if (kind !== 'direct sites.demox.site') assert.equal(hit.cookie, 'a=1');
          assert.equal(r.status, 200);
          assert.equal(r.text, 'echo:' + PAYLOAD);
        });
      }
    }
  }
}
