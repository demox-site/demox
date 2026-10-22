'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { assertAllowed, ALLOWED_ACTIONS, runEdgeDeploy, restorePrevious, probeChildEnv, issueChildEnv } = require('./edge-deploy.cjs');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deploy-'));
  const master = 'master-edge-source\n';
  const masterPath = path.join(dir, 'subdomain-router.js');
  const liveShaPath = path.join(dir, 'LIVE.sha256');
  fs.writeFileSync(masterPath, master);
  fs.writeFileSync(liveShaPath, `${sha256(master)}\n`);
  return { dir, master, masterPath, liveShaPath, previousPath: path.join(dir, 'previous.js') };
}

function env(extra = {}) {
  return {
    TENCENT_EDGE_WRITE_ROLE_ARN: 'qcs::cam::uin/100021031865:roleName/demox-ci-edge-write',
    TENCENT_OIDC_PROVIDER_ID: 'github-actions',
    EO_ZONE_ID: 'zone-3kplfkbflnd6',
    EO_FUNCTION_ID: 'ef-1281msyw',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example/token',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
    GITHUB_TOKEN: 'github-token',
    GITHUB_REPOSITORY: 'demox-site/demox',
    DEMOX_SMOKE_LIN_BASE: 'https://lin-backup.example',
    DEMOX_SMOKE_EMAIL: 'smoke-user@example.com',
    DEMOX_SMOKE_PASSWORD: 'smoke-password',
    DEMOX_SMOKE_WEBSITE_ID: 'SMK00001',
    DEMOX_SMOKE_PRIVATE_SITE_URL: 'https://private.example/',
    ...extra
  };
}

function fakeFetch(mode) {
  let live = 'previous-live';
  let modifies = 0;
  const calls = [];
  const fn = async (url, init = {}) => {
    const headers = init.headers || {};
    const action = headers['X-TC-Action'] || '';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), action, body });
    if (String(url).includes('token.actions')) {
      return { ok: true, status: 200, json: async () => ({ value: 'id-token-value' }) };
    }
    if (action === 'AssumeRoleWithWebIdentity') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          Response: {
            Credentials: { TmpSecretId: 'AKIDEXAMPLE', TmpSecretKey: 'SECRETKEY99', Token: 'SESSIONTOKEN' },
            Expiration: 'soon'
          }
        })
      };
    }
    if (action === 'ModifyFunction') {
      modifies += 1;
      if (mode === 'throw-once' && modifies === 1) throw new Error('ModifyFunction 网络错误');
      if (mode !== 'mismatch' || modifies > 1) live = body.Content;
      return { ok: true, status: 200, json: async () => ({ Response: { RequestId: 'mod' } }) };
    }
    if (action === 'DescribeFunctions') {
      const content = mode === 'mismatch' && modifies === 1 ? 'wrong-content' : live;
      return {
        ok: true,
        status: 200,
        json: async () => ({ Response: { Functions: [{ FunctionId: 'ef-1281msyw', Content: content }] } })
      };
    }
    if (action === 'DescribeFunctionRuntimeEnvironment') {
      return { ok: true, status: 200, json: async () => ({ Response: { Environment: 'ok' } }) };
    }
    throw new Error(`unexpected ${action} ${url}`);
  };
  fn.calls = calls;
  return fn;
}

function teoActions(fetchImpl) {
  return fetchImpl.calls.map((call) => call.action).filter((action) => action && action !== 'AssumeRoleWithWebIdentity');
}

test('only the three EdgeOne actions are allowed', () => {
  for (const action of ALLOWED_ACTIONS) assert.equal(assertAllowed(action), action);
  assert.throws(() => assertAllowed('CreatePurgeTask'), /拒绝调用/);
  assert.throws(() => assertAllowed('DeleteFunction'), /拒绝调用/);
});

test('wrong function id never calls ModifyFunction', async () => {
  const files = fixture();
  const fetchImpl = fakeFetch('ok');
  await assert.rejects(
    () => runEdgeDeploy({
      env: env({ EO_FUNCTION_ID: 'ef-other' }),
      fetchImpl,
      log: () => {},
      masterPath: files.masterPath,
      liveShaPath: files.liveShaPath,
      previousPath: files.previousPath,
      attempts: 1,
      gapMs: 0
    }),
    /ef-1281msyw/
  );
  assert.equal(fetchImpl.calls.some((call) => call.action === 'ModifyFunction'), false);
});

test('a non-empty host map refuses before any write', async () => {
  const files = fixture();
  const fetchImpl = fakeFetch('ok');
  await assert.rejects(
    () => runEdgeDeploy({
      env: env({ DEMOX_TEST_HOST_MAP: 'k2t.example=1' }),
      fetchImpl,
      log: () => {},
      masterPath: files.masterPath,
      liveShaPath: files.liveShaPath,
      previousPath: files.previousPath
    }),
    /DEMOX_TEST_HOST_MAP/
  );
  assert.equal(fetchImpl.calls.some((call) => call.action === 'ModifyFunction'), false);
});

test('dry-run describes and does not modify or probe', async () => {
  const files = fixture();
  const fetchImpl = fakeFetch('ok');
  const logs = [];
  const phases = [];
  const result = await runEdgeDeploy({
    env: env({ EDGE_DRY_RUN: 'true' }),
    fetchImpl,
    log: (line) => logs.push(line),
    probe: async (phase) => { phases.push(phase); },
    dryRun: true,
    masterPath: files.masterPath,
    liveShaPath: files.liveShaPath,
    previousPath: files.previousPath
  });
  assert.equal(result.dryRun, true);
  assert.deepEqual(phases, []);
  assert.deepEqual(teoActions(fetchImpl), ['DescribeFunctions', 'DescribeFunctionRuntimeEnvironment']);
  assert.match(logs.find((line) => line.includes('dry-run')), /未调用 ModifyFunction/);
  assert.equal(logs[0], '::add-mask::request-token');
  const visible = logs.filter((line) => !line.startsWith('::add-mask::'));
  for (const secret of ['request-token', 'SECRETKEY99', 'id-token-value', 'smoke-password']) {
    assert.equal(visible.some((line) => line.includes(secret)), false);
  }
  const assume = fetchImpl.calls.find((call) => call.action === 'AssumeRoleWithWebIdentity');
  assert.equal(assume.body.DurationSeconds, 3600);
  assert.equal(assume.body.RoleArn, 'qcs::cam::uin/100021031865:roleName/demox-ci-edge-write');
});

test('real run writes master, checks the read-back, then probes', async () => {
  const files = fixture();
  const fetchImpl = fakeFetch('ok');
  const phases = [];
  const result = await runEdgeDeploy({
    env: env(),
    fetchImpl,
    log: () => {},
    probe: async (phase) => { phases.push(phase); },
    masterPath: files.masterPath,
    liveShaPath: files.liveShaPath,
    previousPath: files.previousPath,
    attempts: 1,
    gapMs: 0,
    dryRun: false
  });
  assert.equal(result.dryRun, false);
  assert.deepEqual(phases, ['baseline', 'check']);
  assert.deepEqual(teoActions(fetchImpl), [
    'DescribeFunctions',
    'DescribeFunctionRuntimeEnvironment',
    'ModifyFunction',
    'DescribeFunctions'
  ]);
  const modify = fetchImpl.calls.find((call) => call.action === 'ModifyFunction');
  assert.equal(modify.body.FunctionId, 'ef-1281msyw');
  assert.equal(modify.body.ZoneId, 'zone-3kplfkbflnd6');
  assert.equal(modify.body.Content, files.master);
  assert.equal(fs.readFileSync(files.previousPath, 'utf8'), 'previous-live');
});

test('read-back mismatch writes the previous content back and opens an issue', async () => {
  const files = fixture();
  const fetchImpl = fakeFetch('mismatch');
  const phases = [];
  const issues = [];
  await assert.rejects(
    () => runEdgeDeploy({
      env: env(),
      fetchImpl,
      log: () => {},
      probe: async (phase) => { phases.push(phase); },
      openIssue: async (issueEnv, note) => { issues.push({ note, stage: issueEnv.RELEASE_STAGE }); },
      masterPath: files.masterPath,
      liveShaPath: files.liveShaPath,
      previousPath: files.previousPath,
      attempts: 1,
      gapMs: 0,
      dryRun: false
    }),
    /不一致/
  );
  const modifies = fetchImpl.calls.filter((call) => call.action === 'ModifyFunction');
  assert.equal(modifies.length, 2);
  assert.equal(modifies[1].body.Content, 'previous-live');
  assert.deepEqual(phases, ['baseline', 'check']);
  assert.equal(issues.length, 1);
  assert.match(issues[0].note, /写回去/);
  assert.equal(teoActions(fetchImpl).every((action) => ALLOWED_ACTIONS.has(action)), true);
});

test('probe failure writes back and stays failed after the write-back probe', async () => {
  const files = fixture();
  const fetchImpl = fakeFetch('ok');
  let checks = 0;
  const issues = [];
  await assert.rejects(
    () => runEdgeDeploy({
      env: env(),
      fetchImpl,
      log: () => {},
      probe: async (phase) => {
        if (phase !== 'check') return;
        checks += 1;
        if (checks === 1) throw new Error('probe failed smoke-password');
      },
      openIssue: async (_issueEnv, note) => { issues.push(note); },
      masterPath: files.masterPath,
      liveShaPath: files.liveShaPath,
      previousPath: files.previousPath,
      attempts: 1,
      gapMs: 0,
      dryRun: false
    }),
    (error) => {
      assert.match(error.message, /probe failed/);
      assert.equal(error.message.includes('smoke-password'), false);
      assert.match(error.message, /发布仍然失败|写回后复核/);
      return true;
    }
  );
  assert.equal(checks, 2);
  assert.equal(fetchImpl.calls.filter((call) => call.action === 'ModifyFunction').length, 2);
  assert.equal(issues.length, 1);
  assert.equal(String(issues[0]).includes('smoke-password'), false);
});

test('wrong zone never calls ModifyFunction', async () => {
  const files = fixture();
  const fetchImpl = fakeFetch('ok');
  await assert.rejects(
    () => runEdgeDeploy({
      env: env({ EO_ZONE_ID: 'zone-other' }),
      fetchImpl,
      log: () => {},
      masterPath: files.masterPath,
      liveShaPath: files.liveShaPath,
      previousPath: files.previousPath
    }),
    /zone-3kplfkbflnd6/
  );
  assert.equal(fetchImpl.calls.some((call) => call.action === 'ModifyFunction'), false);
});

test('a thrown ModifyFunction still writes the previous content back', async () => {
  const files = fixture();
  const fetchImpl = fakeFetch('throw-once');
  const issues = [];
  await assert.rejects(
    () => runEdgeDeploy({
      env: env(),
      fetchImpl,
      log: () => {},
      probe: async () => {},
      openIssue: async (_issueEnv, note) => { issues.push(note); },
      masterPath: files.masterPath,
      liveShaPath: files.liveShaPath,
      previousPath: files.previousPath,
      attempts: 1,
      gapMs: 0,
      dryRun: false
    }),
    /网络错误/
  );
  const modifies = fetchImpl.calls.filter((call) => call.action === 'ModifyFunction');
  assert.equal(modifies.length, 2);
  assert.equal(modifies[1].body.Content, 'previous-live');
  assert.equal(issues.length, 1);
});

test('probe and issue environments are an allowlist', () => {
  const source = env({
    TENCENTCLOUD_SECRET_ID: 'sts-id',
    TENCENTCLOUD_SECRET_KEY: 'sts-key',
    DEMOX_TOKEN: 'site-token',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example/token',
    PATH: '/usr/bin',
    HOME: '/home/runner',
    EDGE_BASELINE: '/tmp/baseline.json'
  });
  const probeEnv = probeChildEnv(source);
  assert.equal(probeEnv.DEMOX_SMOKE_PASSWORD, 'smoke-password');
  assert.equal(probeEnv.EDGE_BASELINE, '/tmp/baseline.json');
  assert.equal(probeEnv.PATH, '/usr/bin');
  for (const key of Object.keys(probeEnv)) {
    assert.equal(key.startsWith('ACTIONS_ID_TOKEN_REQUEST_'), false);
    assert.equal(key.startsWith('TENCENTCLOUD_'), false);
  }
  assert.equal(probeEnv.DEMOX_TOKEN, undefined);
  assert.equal(probeEnv.GITHUB_TOKEN, undefined);
  const issueEnv = issueChildEnv(source, '已写回');
  assert.equal(issueEnv.GITHUB_TOKEN, 'github-token');
  assert.equal(issueEnv.RELEASE_ROLLBACK_NOTE, '已写回');
  assert.equal(issueEnv.RELEASE_STAGE, '边缘函数冒烟未通过，已写回上一版');
  assert.equal(issueEnv.DEMOX_SMOKE_PASSWORD, undefined);
  assert.equal(issueEnv.DEMOX_TOKEN, undefined);
  assert.equal(issueEnv.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);
  assert.equal(issueEnv.TENCENTCLOUD_SECRET_ID, undefined);
});

test('restore skips a missing file and writes back only when the live sha differs', async () => {
  const files = fixture();
  const missing = await restorePrevious({
    env: env(),
    fetchImpl: fakeFetch('ok'),
    log: () => {},
    previousPath: path.join(files.dir, 'absent.js')
  });
  assert.equal(missing.reason, 'missing');
  fs.writeFileSync(files.previousPath, 'previous-live');
  const sameFetch = fakeFetch('ok');
  const same = await restorePrevious({
    env: env(),
    fetchImpl: sameFetch,
    log: () => {},
    previousPath: files.previousPath
  });
  assert.equal(same.reason, 'unchanged');
  assert.equal(sameFetch.calls.some((call) => call.action === 'ModifyFunction'), false);
  const changed = fakeFetch('ok');
  fs.writeFileSync(files.previousPath, 'saved-previous');
  const result = await restorePrevious({
    env: env(),
    fetchImpl: changed,
    log: () => {},
    previousPath: files.previousPath
  });
  assert.equal(result.restored, true);
  const modify = changed.calls.find((call) => call.action === 'ModifyFunction');
  assert.equal(modify.body.Content, 'saved-previous');
  assert.equal(modify.body.ZoneId, 'zone-3kplfkbflnd6');
  assert.equal(modify.body.FunctionId, 'ef-1281msyw');
});
