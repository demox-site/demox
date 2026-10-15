/**
 * 本地模拟：可配置延迟的 mock 后端，经 subdomain-router 打 www 和 sites 公开对象。
 * 不访问生产，不读取密钥。默认延迟 1500ms（高于线上实测 1.04–1.43s）。
 *
 *   node scripts/origin-guard-latency-sim.mjs
 *   node scripts/origin-guard-latency-sim.mjs --delay 1500 --out docs/origin-guard-latency-sim.md
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routerPath = path.join(root, 'edge-functions', 'subdomain-router.js');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

const delayMs = Number(argValue('--delay', '1500'));
const outPath = path.resolve(root, argValue('--out', 'docs/origin-guard-latency-sim.md'));
if (!Number.isFinite(delayMs) || delayMs < 0) {
  console.error('delay must be a non-negative number');
  process.exit(1);
}

const WWW_PATH = 'sites/1985655011013808129/EPX2UU43/dist';

function verdict(body) {
  if (body.subdomain === 'www') {
    return {
      success: true,
      path: WWW_PATH,
      websiteId: 'EPX2UU43',
      origin: 'sites.demox.site',
      visibility: 'public',
      hideWatermark: true
    };
  }
  if (body.websiteId === 'EPX2UU43') return { success: true, allow: true, path: WWW_PATH };
  if (body.websiteId === 'PUBLIC1') return { success: true, allow: true, path: 'sites/owner-1/PUBLIC1/dist' };
  if (body.websiteId === 'BANNED1') return { success: true, allow: false, reason: 'blocked' };
  if (body.websiteId === 'PRIV8') {
    return { success: true, allow: true, path: 'sites/owner-1/PRIV8/dist', visibility: 'private' };
  }
  if (body.websiteId) return { success: true, allow: false, reason: 'not_found' };
  return { success: false, message: 'not found' };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const hits = [];
const server = http.createServer(async (req, res) => {
  try {
    const raw = await readBody(req);
    const pathname = String(req.url || '').split('?')[0];
    if (pathname !== '/resolve-subdomain') {
      res.writeHead(204);
      res.end();
      return;
    }
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = {}; }
    hits.push({
      websiteId: body.websiteId || '',
      subdomain: body.subdomain || '',
      at: Date.now()
    });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const payload = JSON.stringify(verdict(body));
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    });
    res.end(payload);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
const apiBase = `http://127.0.0.1:${address.port}`;

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
      store.set(key, { body: await resp.text(), headers: Object.fromEntries(resp.headers.entries()) });
    },
    delete: async (req) => store.delete(String(req && req.url ? req.url : req))
  };
}

function headerBag(input, init) {
  if (init && init.headers) return new Headers(init.headers);
  if (input && typeof input === 'object' && input.headers) return new Headers(input.headers);
  return new Headers();
}

const source = fs.readFileSync(routerPath, 'utf8');
const event = { waitUntil() {}, passThroughOnException() {} };
let handle = null;
let depth = 0;
const PUBLIC_HTML = '<!doctype html><html><head><title>Keep</title></head><body><main>Public body</main></body></html>';

async function edgeFetch(input, init) {
  const href = String(input && input.url ? input.url : input);
  if (href.startsWith(apiBase)) {
    const method = (init && init.method) || 'GET';
    const headers = headerBag(input, init);
    const request = { method, headers };
    if (init && init.body != null && method !== 'GET' && method !== 'HEAD') request.body = init.body;
    if (init && init.signal) request.signal = init.signal;
    return fetch(href, request);
  }
  const headers = headerBag(input, init);
  if (depth === 0 && href.includes('sites.demox.site/sites/1985655011013808129/EPX2UU43/')) {
    depth += 1;
    try {
      return await handle(new Request(href, { method: 'GET', headers }), event);
    } finally {
      depth -= 1;
    }
  }
  return new Response(PUBLIC_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

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
  env: { DEMOX_API_URL: apiBase, DEMOX_HOME_URL: 'https://www.demox.site' },
  caches: { default: fakeCache() },
  addEventListener() {},
  fetch: edgeFetch
});
vm.runInContext(`${source}\nglobalThis.__testHooks = { handle, ORIGIN_RESOLVE_BUDGET_MS, ORIGIN_RESOLVE_ATTEMPT_MS };`, ctx);
handle = ctx.__testHooks.handle;
const budgetMs = ctx.__testHooks.ORIGIN_RESOLVE_BUDGET_MS;
const attemptMs = ctx.__testHooks.ORIGIN_RESOLVE_ATTEMPT_MS;

const cases = [
  {
    name: 'www /',
    url: 'https://www.demox.site/',
    status: 200,
    route: 'origin-guard=allow',
    hits: 2,
    minMs: delayMs * 2 - 100
  },
  {
    name: 'www /pricing',
    url: 'https://www.demox.site/pricing',
    status: 200,
    route: 'origin-guard=allow',
    hits: 0,
    maxMs: 500
  },
  {
    name: 'sites public index',
    url: 'https://sites.demox.site/sites/owner-1/PUBLIC1/dist/index.html',
    status: 200,
    route: 'origin-guard=allow',
    hits: 1,
    minMs: delayMs - 50
  },
  {
    name: 'sites public asset',
    url: 'https://sites.demox.site/sites/owner-1/PUBLIC1/dist/assets/app.js',
    status: 200,
    route: 'origin-guard=allow',
    hits: 0,
    maxMs: 500
  },
  {
    name: 'sites banned',
    url: 'https://sites.demox.site/sites/owner-1/BANNED1/dist/index.html',
    status: 403,
    route: 'origin-guard=blocked',
    hits: 1,
    minMs: delayMs - 50
  },
  {
    name: 'sites banned again',
    url: 'https://sites.demox.site/sites/owner-1/BANNED1/dist/secret.html',
    status: 403,
    route: 'origin-guard=blocked',
    hits: 0,
    maxMs: 500
  },
  {
    name: 'sites private',
    url: 'https://sites.demox.site/sites/owner-1/PRIV8/dist/index.html',
    status: 403,
    route: 'origin-guard=blocked',
    hits: 1,
    minMs: delayMs - 50
  },
  {
    name: 'sites private again',
    url: 'https://sites.demox.site/sites/owner-1/PRIV8/dist/secret.html',
    status: 403,
    route: 'origin-guard=blocked',
    hits: 0,
    maxMs: 500
  }
];

const rows = [];
const failures = [];
for (const spec of cases) {
  const before = hits.length;
  const started = Date.now();
  const response = await handle(new Request(spec.url, { headers: { Accept: 'text/html' } }), event);
  const elapsed = Date.now() - started;
  await response.text();
  const route = response.headers.get('x-demox-route') || '';
  const backendHits = hits.length - before;
  const row = {
    name: spec.name,
    url: spec.url,
    status: response.status,
    route,
    elapsed,
    backendHits
  };
  rows.push(row);
  if (response.status !== spec.status) failures.push(`${spec.name}: status ${response.status} wanted ${spec.status}`);
  if (route !== spec.route) failures.push(`${spec.name}: route ${route} wanted ${spec.route}`);
  if (route.includes('origin-guard=error')) failures.push(`${spec.name}: origin-guard=error`);
  if (backendHits !== spec.hits) failures.push(`${spec.name}: backend hits ${backendHits} wanted ${spec.hits}`);
  if (spec.minMs != null && elapsed < spec.minMs) failures.push(`${spec.name}: ${elapsed}ms < ${spec.minMs}ms`);
  if (spec.maxMs != null && elapsed > spec.maxMs) failures.push(`${spec.name}: ${elapsed}ms > ${spec.maxMs}ms`);
}

const table = [
  '| 请求 | 状态 | x-demox-route | 耗时 ms | 本次后端次数 |',
  '| --- | ---: | --- | ---: | ---: |',
  ...rows.map((row) => `| ${row.name} | ${row.status} | \`${row.route}\` | ${row.elapsed} | ${row.backendHits} |`)
].join('\n');

const doc = `# 源站守卫慢后端本地模拟

本地 HTTP mock（\`127.0.0.1\`，延迟 ${delayMs}ms）驱动 \`edge-functions/subdomain-router.js\`。没有访问生产，也没有配置签名密钥。www 回源到 \`sites.demox.site\` 时会再次进入守卫，走 by-ID 解析。

- 命令：\`node scripts/origin-guard-latency-sim.mjs --delay ${delayMs}\`
- 守卫单次尝试：${attemptMs}ms
- 守卫总预算：${budgetMs}ms
- 解析缓存：进程内 Cache API shim（与单测相同的 \`match\` / \`put\` 合约）。延迟本身来自真实的本地 HTTP 往返。
- 生成时间：${new Date().toISOString()}

${table}

www 首页冷请求打两次后端（label 解析，然后重入后的 by-ID）。\`/pricing\` 和同一个公开对象的第二次请求在 15s 缓存里，后端次数为 0。封禁（\`allow:false\`）和私有（\`allow:true\` 但仍带 \`visibility:private\`）都是 403，没有把对象取回来。这些响应都不是 \`origin-guard=error\`。
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, doc);
server.close();

console.log(table);
console.log(`wrote ${path.relative(root, outPath)}`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
