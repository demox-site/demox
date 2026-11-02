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

function bodyOf(opts) {
  try {
    return JSON.parse(opts.body || '{}');
  } catch {
    return {};
  }
}

function happyRoutes({
  adminStatus = 403,
  health = 200,
  siteMarker = true,
  rejectExe = { status: 200, success: false, code: 'EXECUTABLE_FILE_REJECTED' },
  rejectMsi = { status: 200, success: false, code: 'EXECUTABLE_FILE_REJECTED' }
} = {}) {
  const html = '<!doctype html><script src="/assets/index-abc123.js"></script>';
  const rejectBody = (spec) => JSON.stringify({ success: spec.success, code: spec.code, message: '发布失败：可执行文件' });
  return [
    { match: (url) => url.endsWith('/health'), status: health, body: '{"status":"ok"}' },
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
      match: (url, opts) => url.endsWith('/deploy') && bodyOf(opts).action === 'init_deploy_upload' && bodyOf(opts).fileName === 'Setup.MSI',
      status: rejectMsi.status,
      body: rejectBody(rejectMsi)
    },
    {
      match: (url, opts) => url.endsWith('/deploy') && bodyOf(opts).action === 'init_deploy_upload',
      status: rejectExe.status,
      body: rejectBody(rejectExe)
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

function postActions(fetchImpl, urlPrefix) {
  return fetchImpl.calls
    .filter((call) => call.url.startsWith(urlPrefix) && (call.method || 'GET') === 'POST')
    .map((call) => bodyOf(call).action || call.url);
}

function deployCalls(fetchImpl, action) {
  return fetchImpl.calls.filter((call) => call.url.endsWith('/deploy') && bodyOf(call).action === action);
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
  const publishes = deployCalls(fetchImpl, 'upload_and_deploy');
  assert.equal(publishes.length, 2);
  assert.equal(bodyOf(publishes[0]).fileName, 'index.html.zip');
  assert.equal(bodyOf(publishes[0]).websiteId, WEBSITE_ID);
  const rejects = deployCalls(fetchImpl, 'init_deploy_upload');
  assert.equal(rejects.length, 4);
  for (const call of rejects) {
    assert.deepEqual(bodyOf(call), { action: 'init_deploy_upload', fileName: bodyOf(call).fileName });
    assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
  }
  assert.deepEqual(rejects.map((call) => bodyOf(call).fileName), ['x.exe', 'Setup.MSI', 'x.exe', 'Setup.MSI']);
  assert.deepEqual(postActions(fetchImpl, 'https://api.demox.site'), [
    'login',
    'list_user_roles',
    'init_deploy_upload',
    'init_deploy_upload',
    'upload_and_deploy'
  ]);
  assert.deepEqual(postActions(fetchImpl, 'https://lin-backup.example'), [
    'login',
    'list_user_roles',
    'init_deploy_upload',
    'init_deploy_upload',
    'upload_and_deploy'
  ]);
  const login = fetchImpl.calls.find((call) => call.url.endsWith('/auth/login'));
  assert.equal(JSON.parse(login.body).password, PASSWORD);
  assert.match(text, /易点/);
  assert.match(text, /磷/);
  assert.match(text, /reject x\.exe: HTTP 200 code=EXECUTABLE_FILE_REJECTED/);
  assert.match(text, /reject Setup\.MSI: HTTP 200 code=EXECUTABLE_FILE_REJECTED/);
});

test('an admin test account fails before publish', async () => {
  const fetchImpl = fakeFetch(happyRoutes({ adminStatus: 200 }));
  await assert.rejects(
    () => runSmoke({ env: env(), fetchImpl, rawLog: () => {}, log: () => {}, secrets: [], wait: async () => {} }),
    /管理员/
  );
  assert.equal(fetchImpl.calls.some((call) => call.url.endsWith('/deploy')), false);
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

test('accepting an executable file fails the smoke before publish', async () => {
  const fetchImpl = fakeFetch(happyRoutes({
    rejectExe: { status: 200, success: true, code: '' }
  }));
  await assert.rejects(
    () => runSmoke({ env: env(), fetchImpl, rawLog: () => {}, log: () => {}, secrets: [], wait: async () => {} }),
    /可执行文件拒收失败：x\.exe HTTP 200/
  );
  assert.equal(deployCalls(fetchImpl, 'upload_and_deploy').length, 0);
  assert.equal(deployCalls(fetchImpl, 'init_deploy_upload').length, 1);
});

test('Setup.MSI must be rejected with the same code before publish', async () => {
  const fetchImpl = fakeFetch(happyRoutes({
    rejectMsi: { status: 400, success: false, code: 'INVALID_TOTAL_SIZE' }
  }));
  await assert.rejects(
    () => runSmoke({ env: env(), fetchImpl, rawLog: () => {}, log: () => {}, secrets: [], wait: async () => {} }),
    /可执行文件拒收失败：Setup\.MSI HTTP 400 INVALID_TOTAL_SIZE/
  );
  assert.equal(deployCalls(fetchImpl, 'upload_and_deploy').length, 0);
  assert.deepEqual(deployCalls(fetchImpl, 'init_deploy_upload').map((call) => bodyOf(call).fileName), ['x.exe', 'Setup.MSI']);
});

test('executable rejection with the wrong HTTP status fails the smoke before publish', async () => {
  const fetchImpl = fakeFetch(happyRoutes({
    rejectExe: { status: 500, success: false, code: 'EXECUTABLE_FILE_REJECTED' }
  }));
  await assert.rejects(
    () => runSmoke({ env: env(), fetchImpl, rawLog: () => {}, log: () => {}, secrets: [], wait: async () => {} }),
    /可执行文件拒收失败：x\.exe HTTP 500 EXECUTABLE_FILE_REJECTED/
  );
  assert.equal(deployCalls(fetchImpl, 'upload_and_deploy').length, 0);
});

test('published site must contain this run marker', async () => {
  const fetchImpl = fakeFetch(happyRoutes({ siteMarker: false }));
  await assert.rejects(
    () => runSmoke({ env: env(), fetchImpl, rawLog: () => {}, log: () => {}, secrets: [], wait: async () => {} }),
    /published site/
  );
});
