#!/usr/bin/env node
'use strict';

/**
 * 发布冒烟。易点（api.demox.site，主）和磷（备源站）各跑一遍：
 *   GET /health → 200
 *   https://www.demox.site/ → 200，并且页面引用的当前 bundle 也是 200
 *   非管理员测试账号登录后，把同一个测试站点重新发布，再把站点页面抓下来核对
 *
 * 账号密码只来自环境变量 DEMOX_SMOKE_EMAIL / DEMOX_SMOKE_PASSWORD（GitHub secrets）。
 * 本文件不写死任何口令、令牌或邮箱。日志先打 ::add-mask::，再打印其它内容。
 */

const crypto = require('crypto');

const WWW_URL = 'https://www.demox.site/';
const EK_DEFAULT_BASE = 'https://api.demox.site';
const ATTEMPTS = 3;
const GAP_MS = 5000;
const TIMEOUT_MS = 15000;
const SITE_ATTEMPTS = 12;
const SITE_GAP_MS = 5000;

function mustEnv(env, name) {
  const value = String(env[name] == null ? '' : env[name]).trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function parseHttpsBase(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} 不是 URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} 必须是不带账号和查询串的 https URL`);
  }
  return value.replace(/\/+$/, '');
}

function readSmokeConfig(env) {
  const email = mustEnv(env, 'DEMOX_SMOKE_EMAIL');
  const password = mustEnv(env, 'DEMOX_SMOKE_PASSWORD');
  const websiteId = mustEnv(env, 'DEMOX_SMOKE_WEBSITE_ID');
  if (!/^[A-Za-z0-9]{4,32}$/.test(websiteId)) throw new Error('DEMOX_SMOKE_WEBSITE_ID 格式不正确');
  if (websiteId.toLowerCase() === 'jbagdduf') {
    throw new Error('DEMOX_SMOKE_WEBSITE_ID 不能是 jbagdduf，那个站点只供边缘语言探针读取');
  }
  if (email.length > 200 || password.length > 200) throw new Error('测试账号凭证过长');
  const linBase = parseHttpsBase(mustEnv(env, 'DEMOX_SMOKE_LIN_BASE'), 'DEMOX_SMOKE_LIN_BASE');
  const ekRaw = String(env.DEMOX_SMOKE_EK_BASE || '').trim() || EK_DEFAULT_BASE;
  const ekBase = parseHttpsBase(ekRaw, 'DEMOX_SMOKE_EK_BASE');
  const wwwUrl = parseHttpsBase(String(env.WWW_URL || WWW_URL).trim(), 'WWW_URL') + '/';
  const mirrorRaw = String(env.DEMOX_SMOKE_WWW_MIRROR_URL || '').trim();
  const mirrorUrl = mirrorRaw ? parseHttpsBase(mirrorRaw, 'DEMOX_SMOKE_WWW_MIRROR_URL') : '';
  const expectBundle = String(env.EXPECT_BUNDLE || '').trim();
  if (expectBundle && !/^assets\/[A-Za-z0-9._-]{1,120}\.js$/.test(expectBundle)) {
    throw new Error('EXPECT_BUNDLE 必须是 assets/ 下的 .js 文件名');
  }
  const runId = String(env.GITHUB_RUN_ID || 'local').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'local';
  return {
    email,
    password,
    websiteId,
    accounts: [
      { name: 'ek', label: '易点', base: ekBase },
      { name: 'lin', label: '磷', base: linBase }
    ],
    wwwUrl,
    mirrorUrl,
    expectBundle,
    marker: `demox-smoke-${runId}`
  };
}

function createRedactor(secrets) {
  return (text) => {
    const values = [...new Set((secrets || []).filter((item) => typeof item === 'string' && item.length >= 4))];
    values.sort((a, b) => b.length - a.length);
    let out = String(text == null ? '' : text);
    for (const value of values) out = out.split(value).join('[redacted]');
    return out;
  };
}

/** 先写 GitHub 掩码，不能先过 redactor。 */
function maskSecret(rawLog, secrets, value) {
  if (typeof value !== 'string' || value.length === 0) return;
  secrets.push(value);
  rawLog(`::add-mask::${value}`);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function storeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, data);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function smokeHtml(marker) {
  return `<!doctype html><html><head><title>demox smoke</title></head><body><p>${marker}</p></body></html>`;
}

function bundleNames(html) {
  const names = new Set();
  const re = /(?:src|href)=["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(html))) {
    const ref = match[1].split('?')[0].split('#')[0];
    const index = ref.indexOf('assets/');
    if (index === -1) continue;
    const name = ref.slice(index);
    if (/^assets\/[A-Za-z0-9._/-]{1,160}\.(?:js|css)$/.test(name)) names.add(name);
  }
  return [...names];
}

function assetUrl(pageUrl, name) {
  return new URL('/' + name.replace(/^\/+/, ''), pageUrl).toString();
}

async function fetchText(fetchImpl, url, { method = 'GET', headers = {}, body = undefined, timeoutMs = TIMEOUT_MS, redirect = 'manual' } = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers,
      body,
      redirect,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const aborted = Boolean(error && (error.name === 'TimeoutError' || error.name === 'AbortError'));
    if (aborted) return { status: 'TIMEOUT', text: '', headers: new Map() };
    const code = error && error.cause && error.cause.code;
    return { status: typeof code === 'string' ? `ERR ${code}` : 'ERR', text: '', headers: new Map() };
  }
  let text = '';
  try {
    text = await res.text();
  } catch {
    text = '';
  }
  return { status: res.status, text, headers: res.headers };
}

function headerGet(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  return '';
}

async function retry(log, label, attempts, gapMs, wait, fn) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await wait(gapMs);
    last = await fn();
    log(`  ${label} 第 ${attempt}/${attempts} 次: ${last.summary}`);
    if (last.ok) return last;
  }
  throw new Error(`${label} 失败：${last ? last.summary : '没有结果'}`);
}

async function checkHealth(account, deps) {
  await retry(deps.log, `${account.label} GET /health`, ATTEMPTS, GAP_MS, deps.wait, async () => {
    const res = await fetchText(deps.fetchImpl, `${account.base}/health`);
    return { ok: res.status === 200, summary: String(res.status) };
  });
}

async function checkPageBundle(label, pageUrl, config, deps) {
  const page = await retry(deps.log, `${label} GET ${pageUrl}`, ATTEMPTS, GAP_MS, deps.wait, async () => {
    const res = await fetchText(deps.fetchImpl, pageUrl, { redirect: 'follow' });
    const bundles = res.status === 200 ? bundleNames(res.text) : [];
    const scripts = bundles.filter((name) => name.endsWith('.js'));
    const expectedOk = !config.expectBundle || res.text.includes(config.expectBundle);
    const ok = res.status === 200 && scripts.length > 0 && expectedOk;
    return {
      ok,
      summary: `${res.status} scripts=${scripts.length}${config.expectBundle && !expectedOk ? ' missing-bundle' : ''}`,
      text: res.text,
      scripts
    };
  });
  for (const name of page.scripts) {
    const url = assetUrl(pageUrl, name);
    await retry(deps.log, `${label} GET ${name}`, ATTEMPTS, GAP_MS, deps.wait, async () => {
      const res = await fetchText(deps.fetchImpl, url, { redirect: 'follow' });
      return { ok: res.status === 200, summary: String(res.status) };
    });
  }
}

async function checkWww(config, deps) {
  await checkPageBundle('www', config.wwwUrl, config, deps);
  if (config.mirrorUrl) await checkPageBundle('www-mirror', config.mirrorUrl, config, deps);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function login(account, config, deps) {
  const res = await fetchText(deps.fetchImpl, `${account.base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action: 'login', email: config.email, password: config.password })
  });
  const body = parseJson(res.text);
  const token = body && typeof body.token === 'string' ? body.token : '';
  if (token) maskSecret(deps.rawLog, deps.secrets, token);
  deps.log(`  ${account.label} login: HTTP ${res.status}`);
  if (res.status !== 200 || !body || body.success !== true || !token) {
    throw new Error(`${account.label} 登录失败：HTTP ${res.status}`);
  }
  return token;
}

async function assertNotAdmin(account, token, deps) {
  const res = await fetchText(deps.fetchImpl, `${account.base}/list-user-roles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ action: 'list_user_roles' })
  });
  const body = parseJson(res.text);
  deps.log(`  ${account.label} admin check: HTTP ${res.status}`);
  if (res.status === 200 && body && body.success === true) {
    throw new Error(`${account.label} 测试账号是管理员，冒烟拒绝使用`);
  }
  if (res.status !== 403) throw new Error(`${account.label} 无法确认测试账号不是管理员：HTTP ${res.status}`);
}

async function publishSite(account, config, token, deps) {
  const zip = storeZip([{ name: 'index.html', data: smokeHtml(config.marker) }]);
  const res = await fetchText(deps.fetchImpl, `${account.base}/deploy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      action: 'upload_and_deploy',
      fileName: 'index.html.zip',
      fileContentBase64: zip.toString('base64'),
      websiteId: config.websiteId
    }),
    timeoutMs: 60000
  });
  const body = parseJson(res.text);
  const code = body && (body.code || body.error) ? String(body.code || body.error).slice(0, 80) : '';
  deps.log(`  ${account.label} publish: HTTP ${res.status} success=${Boolean(body && body.success)}${code ? ` code=${code}` : ''}`);
  if (res.status !== 200 || !body || body.success !== true) {
    throw new Error(`${account.label} 发布测试站点失败：HTTP ${res.status}${code ? ` ${code}` : ''}`);
  }
  const fallback = `https://${config.websiteId.toLowerCase()}.demox.site/`;
  const siteUrl = typeof body.defaultUrl === 'string' && body.defaultUrl.startsWith('https://')
    ? body.defaultUrl
    : fallback;
  await retry(deps.log, `${account.label} GET published site`, SITE_ATTEMPTS, SITE_GAP_MS, deps.wait, async () => {
    const page = await fetchText(deps.fetchImpl, siteUrl, { redirect: 'follow' });
    const seen = page.status === 200 && page.text.includes(config.marker);
    return { ok: seen, summary: `${page.status}${seen ? ' marker' : ' no-marker'}` };
  });
}

async function checkAccount(account, config, deps) {
  deps.log(`- ${account.label} ${account.base}`);
  await checkHealth(account, deps);
  await checkWww(config, deps);
  const token = await login(account, config, deps);
  await assertNotAdmin(account, token, deps);
  await publishSite(account, config, token, deps);
}

async function runSmoke({
  env = process.env,
  fetchImpl = globalThis.fetch,
  rawLog = console.log,
  log = rawLog,
  secrets = [],
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  maskSecret(rawLog, secrets, env.DEMOX_SMOKE_PASSWORD);
  maskSecret(rawLog, secrets, env.DEMOX_SMOKE_EMAIL);
  const hide = createRedactor(secrets);
  const safeLog = (line) => log(hide(line));
  const config = readSmokeConfig(env);
  const deps = { fetchImpl, rawLog, log: safeLog, secrets, wait };
  safeLog(`release smoke marker=${config.marker}`);
  for (const account of config.accounts) await checkAccount(account, config, deps);
  safeLog('release smoke ok');
  return { marker: config.marker, accounts: config.accounts.map((account) => account.name) };
}

async function main(env = process.env) {
  const secrets = [];
  const hide = () => createRedactor(secrets);
  try {
    await runSmoke({ env, secrets, rawLog: console.log, log: (line) => console.log(hide()(line)) });
  } catch (error) {
    const message = hide()(error && error.message ? error.message : String(error));
    console.error(`::error::${message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  WWW_URL,
  EK_DEFAULT_BASE,
  readSmokeConfig,
  createRedactor,
  maskSecret,
  storeZip,
  smokeHtml,
  bundleNames,
  runSmoke
};
