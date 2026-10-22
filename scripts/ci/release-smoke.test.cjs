'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  readSmokeConfig,
  storeZip,
  bundleNames,
  runSmoke
} = require('./release-smoke.cjs');

const EMAIL = 'smoke-user@example.com';
const PASSWORD = 'smoke-password-placeholder';
const TOKEN = 'smoke-token-placeholder-value';
const WEBSITE_ID = 'SMK00001';

function env(extra = {}) {
  return {
    DEMOX_SMOKE_EMAIL: EMAIL,
    DEMOX_SMOKE_PASSWORD: PASSWORD,
    DEMOX_SMOKE_WEBSITE_ID: WEBSITE_ID,
    DEMOX_SMOKE_LIN_BASE: 'https://lin-backup.example',
    DEMOX_SMOKE_EK_BASE: 'https://api.demox.site',
    GITHUB_RUN_ID: '42',
    WWW_URL: 'https://www.example',
    ...extra
  };
}

function visible(lines) {
  return lines.filter((line) => !line.startsWith('::add-mask::')).join('\n');
}

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body, headers: opts.headers });
    const found = routes.find((route) => route.match(url, opts));
    if (!found) return { status: 404, text: () => Promise.resolve('missing'), headers: new Map() };
    return {
      status: found.status,
      text: () => Promise.resolve(found.body || ''),
      headers: { get: (name) => (found.headers || {})[name.toLowerCase()] || '' }
    };
  };
  fn.calls = calls;
  return fn;
}

function happyRoutes({ adminStatus = 403, health = 200, siteMarker = true } = {}) {
  const html = '<!doctype html><script src="/assets/index-abc123.js"></script>';
  return [
    { match: (url) => url.endsWith('/health'), status: health, body: '{"status":"ok"}' },
    {
      match: (url, opts) => url.endsWith('/auth/send-code') && opts.method === 'POST',
      status: 200,
      body: JSON.stringify({ success: true, message: '验证码已发送，请查收邮件' })
    },
    { match: (url) => url === 'https://www.example/' || url === 'https://www.example', status: 200, body: html },
    { match: (url) => url.includes('/assets/index-abc123.js'), status: 200, body: 'console.log(1)' },
    {
      match: (url, opts) => url.endsWith('/auth/login') && opts.method === 'POST',
      status: 200,
      body: JSON.stringify({ success: true, token: TOKEN })
    },
    {
      match: (url, opts) => url.endsWith('/list-user-roles'),
      status: adminStatus,
      body: adminStatus === 200 ? JSON.stringify({ success: true, data: [] }) : JSON.stringify({ success: false, error: '仅管理员可访问' })
    },
    {
      match: (url, opts) => url.endsWith('/deploy'),
      status: 200,
      body: JSON.stringify({ success: true, websiteId: WEBSITE_ID, defaultUrl: `https://${WEBSITE_ID.toLowerCase()}.demox.site/` })
    },
    {
      match: (url) => url.startsWith(`https://${WEBSITE_ID.toLowerCase()}.demox.site/`),
      status: 200,
      body: siteMarker ? '<p>demox-smoke-42</p>' : '<p>old</p>'
    }
  ];
}

test('config names the two accounts and refuses a missing secret', () => {
  const config = readSmokeConfig(env());
  assert.deepEqual(config.accounts.map((item) => item.label), ['易点', '磷']);
  assert.equal(config.accounts[0].base, 'https://api.demox.site');
  assert.equal(config.accounts[1].base, 'https://lin-backup.example');
  assert.throws(() => readSmokeConfig(env({ DEMOX_SMOKE_PASSWORD: '' })), /DEMOX_SMOKE_PASSWORD/);
  assert.throws(() => readSmokeConfig(env({ DEMOX_SMOKE_LIN_BASE: '' })), /DEMOX_SMOKE_LIN_BASE/);
  assert.equal(readSmokeConfig(env({ DEMOX_SMOKE_WEBSITE_ID: 'WL4KMR0N' })).websiteId, 'WL4KMR0N');
  assert.throws(() => readSmokeConfig(env({ DEMOX_SMOKE_WEBSITE_ID: 'jbagdduf' })), /jbagdduf/);
  assert.throws(() => readSmokeConfig(env({ DEMOX_SMOKE_WEBSITE_ID: 'JBAGDDUF' })), /jbagdduf/);
});

test('bundle names come from the homepage, not from a hardcoded file', () => {
  assert.deepEqual(bundleNames('<script src="/assets/index-abc123.js"></script><link href="/assets/app.css">'), [
    'assets/index-abc123.js',
    'assets/app.css'
  ]);
});

test('zip is a stored archive whose index contains the marker', () => {
  const zip = storeZip([{ name: 'index.html', data: '<p>demox-smoke-42</p>' }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.ok(zip.includes(Buffer.from('index.html')));
  assert.ok(zip.includes(Buffer.from('demox-smoke-42')));
});

test('happy path smokes both accounts and masks the password before any other log', async () => {
  const sink = { lines: [] };
  const fetchImpl = fakeFetch(happyRoutes());
  const result = await runSmoke({
    env: env(),
    fetchImpl,
    rawLog: (line) => sink.lines.push(line),
    log: (line) => sink.lines.push(line),
    secrets: [],
    wait: async () => {}
  });
  assert.deepEqual(result.accounts, ['ek', 'lin']);
  assert.equal(sink.lines[0], `::add-mask::${PASSWORD}`);
  assert.equal(sink.lines[1], `::add-mask::${EMAIL}`);
  assert.ok(sink.lines.includes(`::add-mask::${TOKEN}`));
  const text = visible(sink.lines);
  assert.equal(text.includes(PASSWORD), false);
  assert.equal(text.includes(EMAIL), false);
  assert.equal(text.includes(TOKEN), false);
  const deploys = fetchImpl.calls.filter((call) => call.url.endsWith('/deploy'));
  assert.equal(deploys.length, 2);
  const login = fetchImpl.calls.find((call) => call.url.endsWith('/auth/login'));
  assert.equal(JSON.parse(login.body).password, PASSWORD);
  assert.match(text, /易点/);
  assert.match(text, /磷/);
});

test('an admin test account fails before publish', async () => {
  const fetchImpl = fakeFetch(happyRoutes({ adminStatus: 200 }));
  await assert.rejects(
    () => runSmoke({ env: env(), fetchImpl, rawLog: () => {}, log: () => {}, secrets: [], wait: async () => {} }),
    /管理员/
  );
  assert.equal(fetchImpl.calls.some((call) => call.url.endsWith('/deploy')), false);
});

test('send-code 5xx on either account fails the smoke', async () => {
  const routes = happyRoutes();
  routes.unshift({
    match: (url, opts) => url.endsWith('/auth/send-code') && opts.method === 'POST' && url.startsWith('https://api.demox.site'),
    status: 502,
    body: JSON.stringify({ error: '请检查Region参数' })
  });
  const fetchImpl = fakeFetch(routes);
  await assert.rejects(
    () => runSmoke({ env: env(), fetchImpl, rawLog: () => {}, log: () => {}, secrets: [], wait: async () => {} }),
    /send-code/
  );
  const bodies = fetchImpl.calls
    .filter((call) => call.url.endsWith('/auth/send-code'))
    .map((call) => JSON.parse(call.body));
  assert.ok(bodies.length >= 1);
  assert.equal(bodies[0].email, EMAIL);
  assert.equal(bodies[0].action, 'send_code');
  assert.equal(fetchImpl.calls.some((call) => call.url.endsWith('/auth/login')), false);
});

test('send-code 429 is not a 5xx and both accounts are checked', async () => {
  const routes = happyRoutes().filter((route) => {
    const probe = route.match('https://api.demox.site/auth/send-code', { method: 'POST' });
    return !probe;
  });
  routes.push({
    match: (url, opts) => url.endsWith('/auth/send-code') && opts.method === 'POST',
    status: 429,
    body: JSON.stringify({ error: '发送过于频繁，请1分钟后重试' })
  });
  const fetchImpl = fakeFetch(routes);
  const result = await runSmoke({
    env: env(),
    fetchImpl,
    rawLog: () => {},
    log: () => {},
    secrets: [],
    wait: async () => {}
  });
  const sends = fetchImpl.calls.filter((call) => call.url.endsWith('/auth/send-code'));
  assert.deepEqual(sends.map((call) => call.url), [
    'https://api.demox.site/auth/send-code',
    'https://lin-backup.example/auth/send-code'
  ]);
  assert.deepEqual(result.accounts, ['ek', 'lin']);
});

test('health failure fails the smoke', async () => {
  const fetchImpl = fakeFetch(happyRoutes({ health: 503 }));
  await assert.rejects(
    () => runSmoke({ env: env(), fetchImpl, rawLog: () => {}, log: () => {}, secrets: [], wait: async () => {} }),
    /\/health/
  );
});

test('homepage without the expected bundle fails', async () => {
  const fetchImpl = fakeFetch(happyRoutes());
  await assert.rejects(
    () => runSmoke({
      env: env({ EXPECT_BUNDLE: 'assets/index-deadbeef.js' }),
      fetchImpl,
      rawLog: () => {},
      log: () => {},
      secrets: [],
      wait: async () => {}
    }),
    /www/
  );
});

test('published site must contain this run marker', async () => {
  const fetchImpl = fakeFetch(happyRoutes({ siteMarker: false }));
  await assert.rejects(
    () => runSmoke({ env: env(), fetchImpl, rawLog: () => {}, log: () => {}, secrets: [], wait: async () => {} }),
    /published site/
  );
});
