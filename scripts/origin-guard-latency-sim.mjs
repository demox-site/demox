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
const slept = [];
let nextDelay = () => delayMs;
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
    const d = nextDelay();
    slept.push(d);
    await new Promise((resolve) => setTimeout(resolve, d));
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
const PUBLIC_HTML = '<!doctype html><html><head><title>Keep</title></head><body><main>Public body</main></body></html>';
const TOKEN_HEADER = 'x-demox-origin-token';
// 测试占位，不是生产密钥。文档和日志都不打印它。
const SIM_SECRET = 'origin-guard-sim-slot-a-placeholder';

function loadRouter(routerSource, { secret = '', reenter = 'www-origin' } = {}) {
  const event = { waitUntil() {}, passThroughOnException() {} };
  const store = new Map();
  const cache = {
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
  let handle = null;
  let depth = 0;
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
    const token = headers.get(TOKEN_HEADER) || '';
    if (reenter === 'token' && token && href.includes('sites.demox.site/')) {
      return handle(new Request(href, { method: 'GET', headers }), event);
    }
    if (reenter === 'www-origin' && depth === 0 && href.includes('sites.demox.site/sites/1985655011013808129/EPX2UU43/')) {
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
  const env = { DEMOX_API_URL: apiBase, DEMOX_HOME_URL: 'https://www.demox.site' };
  if (secret) {
    env.DEMOX_ORIGIN_GUARD_SECRET_A = secret;
    env.DEMOX_ORIGIN_GUARD_KID = 'A';
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
    env,
    caches: { default: cache },
    addEventListener() {},
    fetch: edgeFetch
  });
  vm.runInContext(`${routerSource}\nglobalThis.__testHooks = { handle }; try { globalThis.__budget = ORIGIN_RESOLVE_BUDGET_MS; globalThis.__attempt = ORIGIN_RESOLVE_ATTEMPT_MS; } catch (e) {}`, ctx);
  handle = ctx.__testHooks.handle;
  return {
    handle,
    event,
    clearCache: () => store.clear(),
    budgetMs: ctx.__budget,
    attemptMs: ctx.__attempt
  };
}

function immutableRequest(url) {
  const req = new Request(url, { headers: { Accept: 'text/html' } });
  for (const name of ['set', 'append', 'delete']) {
    Object.defineProperty(req.headers, name, {
      configurable: true,
      value() { throw new TypeError('immutable headers'); }
    });
  }
  return req;
}

function orderStat(sorted, fraction) {
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const plain = loadRouter(source, { reenter: 'www-origin' });
const handle = plain.handle;
const event = plain.event;
const budgetMs = plain.budgetMs;
const attemptMs = plain.attemptMs;

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

// 性能门禁：KID=A、入站头不可变、每次清缓存。后端延迟在 1.0–1.4s 均匀抽取。
// 端到端门禁是线上 www 基线（median 2.090s / p90 2.454s）的 +15% / +25%。
const GATE_SAMPLES = 15;
const GATE_MEDIAN_MS = 2400;
const GATE_P90_MS = 3070;
const signed = loadRouter(source, { secret: SIM_SECRET, reenter: 'token' });
const delays = Array.from({ length: GATE_SAMPLES }, () => 1000 + Math.floor(Math.random() * 401));
const gateRows = [];
for (let i = 0; i < delays.length; i += 1) {
  signed.clearCache();
  const delay = delays[i];
  nextDelay = () => delay;
  const before = hits.length;
  const sleepAt = slept.length;
  const started = Date.now();
  let response;
  let failed = '';
  try {
    response = await signed.handle(immutableRequest('https://www.demox.site/'), signed.event);
  } catch (e) {
    failed = (e && e.message) || String(e);
    response = null;
  }
  const elapsed = Date.now() - started;
  if (response) await response.text();
  const sampleHits = hits.slice(before);
  const byId = sampleHits.filter((hit) => hit.websiteId).length;
  const sleptMs = slept.slice(sleepAt).reduce((sum, n) => sum + n, 0);
  const route = response ? (response.headers.get('x-demox-route') || '') : '';
  const status = response ? response.status : 0;
  gateRows.push({
    n: i + 1,
    delay,
    elapsed,
    added: elapsed - sleptMs,
    byId,
    route,
    status,
    failed
  });
  if (failed) failures.push(`gate sample ${i + 1}: ${failed}`);
  if (status !== 200) failures.push(`gate sample ${i + 1}: status ${status}`);
  if (route !== 'origin-guard=internal') failures.push(`gate sample ${i + 1}: route ${route || '(none)'}`);
  if (byId !== 0) failures.push(`gate sample ${i + 1}: by-id calls ${byId}`);
}

const e2eSorted = gateRows.map((row) => row.elapsed).sort((a, b) => a - b);
const addedSorted = gateRows.map((row) => row.added).sort((a, b) => a - b);
const e2eMedian = orderStat(e2eSorted, 0.5);
const e2eP90 = orderStat(e2eSorted, 0.9);
const addedMedian = orderStat(addedSorted, 0.5);
const addedP90 = orderStat(addedSorted, 0.9);
const gatePass = e2eMedian <= GATE_MEDIAN_MS && e2eP90 <= GATE_P90_MS && gateRows.every((row) => row.status === 200 && row.route === 'origin-guard=internal' && row.byId === 0);
if (!gatePass) {
  failures.push(`perf gate failed: www e2e median ${e2eMedian}ms (limit ${GATE_MEDIAN_MS}), p90 ${e2eP90}ms (limit ${GATE_P90_MS})`);
}

let baselineNote = '未能跑 #78（3dea4e0）对照。';
let baselineTable = '';
try {
  const { execFileSync } = await import('node:child_process');
  const oldSource = execFileSync('git', ['show', '3dea4e0:edge-functions/subdomain-router.js'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
  const old = loadRouter(oldSource, { reenter: 'none' });
  const oldRows = [];
  for (let i = 0; i < delays.length; i += 1) {
    old.clearCache();
    const delay = delays[i];
    nextDelay = () => delay;
    const sleepAt = slept.length;
    const started = Date.now();
    const response = await old.handle(immutableRequest('https://www.demox.site/'), old.event);
    const elapsed = Date.now() - started;
    await response.text();
    const sleptMs = slept.slice(sleepAt).reduce((sum, n) => sum + n, 0);
    oldRows.push({ elapsed, added: elapsed - sleptMs, status: response.status });
  }
  const oldE2e = oldRows.map((row) => row.elapsed).sort((a, b) => a - b);
  const oldAdded = oldRows.map((row) => row.added).sort((a, b) => a - b);
  const oldMedian = orderStat(oldE2e, 0.5);
  const oldP90 = orderStat(oldE2e, 0.9);
  const oldAddedMedian = orderStat(oldAdded, 0.5);
  const oldAddedP90 = orderStat(oldAdded, 0.9);
  baselineNote = '#78 没有源站守卫。对照把对象 fetch 当成没有源站延迟的本地 200，不重入本函数。同一组 1.0–1.4s 延迟、同样每次清缓存。路由器额外耗时 = 端到端 − 这次请求里 mock 实际 sleep 的总和。';
  baselineTable = [
    '| 版本 | 端到端 median ms | 端到端 p90 ms | 路由器额外 median ms | 路由器额外 p90 ms |',
    '| --- | ---: | ---: | ---: | ---: |',
    `| 当前（有签名，internal） | ${e2eMedian} | ${e2eP90} | ${addedMedian} | ${addedP90} |`,
    `| #78 \`3dea4e0\` | ${oldMedian} | ${oldP90} | ${oldAddedMedian} | ${oldAddedP90} |`,
    `| 当前 − #78 | ${e2eMedian - oldMedian} | ${e2eP90 - oldP90} | ${addedMedian - oldAddedMedian} | ${addedP90 - oldAddedP90} |`
  ].join('\n');
} catch (e) {
  baselineNote = '跑 #78 对照失败：' + ((e && e.message) || e);
  failures.push(baselineNote);
}

const gateTable = [
  '| # | 后端延迟 ms | 端到端 ms | 路由器额外 ms | by-ID | 状态 | x-demox-route |',
  '| ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ...gateRows.map((row) => `| ${row.n} | ${row.delay} | ${row.elapsed} | ${row.added} | ${row.byId} | ${row.status} | \`${row.route || row.failed}\` |`)
].join('\n');

const doc = `# 源站守卫慢后端本地模拟

本地 HTTP mock（\`127.0.0.1\`）驱动 \`edge-functions/subdomain-router.js\`。没有访问生产。

- 命令：\`node scripts/origin-guard-latency-sim.mjs --delay ${delayMs}\`
- 守卫单次尝试：${attemptMs}ms
- 守卫总预算：${budgetMs}ms
- 解析缓存：进程内 Cache API shim。延迟来自真实的本地 HTTP 往返。
- 生成时间：${new Date().toISOString()}

## 无签名（行为与现在的 by-ID 路径一致）

没有配置签名槽。www 回源会再次进入守卫，走 by-ID。

${table}

www 首页冷请求打两次后端（label 解析，然后重入后的 by-ID）。\`/pricing\` 和同一个公开对象的第二次请求在 15s 缓存里，后端次数为 0。

## 有签名的 www 冷请求门禁

KID=A，测试用占位密钥（不写入本文）。入站 \`Headers.set/append/delete\` 会抛，和边缘运行时一样。每个样本之间清空解析缓存。后端延迟在 1000–1400ms 均匀随机，${GATE_SAMPLES} 个样本。分位数用 nearest-rank：\`ceil(p * n)\`。

线上 www 基线 median 2090ms、p90 2454ms。门禁是端到端 median ≤ ${GATE_MEDIAN_MS}ms（+15%）且 p90 ≤ ${GATE_P90_MS}ms（+25%）。模拟没有真实源站延迟，所以端到端只含 label 解析的后端延迟和路由器自己的开销。

**门禁：${gatePass ? 'PASS' : 'FAIL'}。** 端到端 median ${e2eMedian}ms，p90 ${e2eP90}ms。路由器额外耗时 median ${addedMedian}ms，p90 ${addedP90}ms。by-ID 次数合计 ${gateRows.reduce((sum, row) => sum + row.byId, 0)}。

${gateTable}

${baselineNote}

${baselineTable}
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
