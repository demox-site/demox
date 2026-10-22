'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { releaseFunctionApi, rollbackRelease, sanitizeApprover } = require('./function-api-release.cjs');

function releaseEnv(extra = {}) {
  return {
    EK_ENABLED: 'true',
    LIN_ROLE_ARN: 'qcs::cam::uin/100021031865:roleName/demox-ci-deploy',
    EK_ROLE_ARN: 'qcs::cam::uin/100052992193:roleName/demox-ci-deploy',
    LIN_COS_BUCKET: 'lin-bucket-1307257815',
    EK_COS_BUCKET: 'ek-bucket-1490780430',
    LIN_COS_REGION: 'ap-chengdu',
    EK_COS_REGION: 'ap-guangzhou',
    LIN_DEVELOP_URL: 'https://lin-develop.example',
    EK_DEVELOP_URL: 'https://ek-develop.example',
    DEMOX_SMOKE_LIN_BASE: 'https://lin-backup.example',
    DEMOX_SMOKE_EMAIL: 'smoke-user@example.com',
    DEMOX_SMOKE_PASSWORD: 'smoke-password-placeholder',
    DEMOX_SMOKE_WEBSITE_ID: 'SMK00001',
    GITHUB_TOKEN: 'github-token-placeholder',
    GITHUB_REPOSITORY: 'demox-site/demox',
    GITHUB_ACTOR: 'ci',
    FUNCTION_API_ZIP: extra.zip || '',
    ...extra
  };
}

function fakeSpawn(scripted) {
  const calls = [];
  const fn = async (script, args, env) => {
    calls.push({ script, args, env });
    const found = scripted.find((item) => item.script === script && (!item.args || item.args.every((arg, index) => args[index] === arg)));
    if (!found) return { code: 1, outputs: {} };
    return { code: found.code == null ? 0 : found.code, outputs: found.outputs || {} };
  };
  fn.calls = calls;
  return fn;
}

test('promote approver drops characters the release record rejects', () => {
  assert.equal(sanitizeApprover('cursor[bot]'), 'cursorbot');
  assert.equal(sanitizeApprover(''), 'cursor');
  assert.equal(sanitizeApprover('ci'), 'ci');
});

test('release refuses to start when the backup account is disabled', async () => {
  const spawn = fakeSpawn([]);
  const zip = path.join(os.tmpdir(), `fapi-${process.pid}.zip`);
  fs.writeFileSync(zip, 'zip');
  await assert.rejects(
    () => releaseFunctionApi({ env: releaseEnv({ EK_ENABLED: 'false', zip }), spawn }),
    /DEMOX_EK_ENABLED/
  );
  assert.equal(spawn.calls.length, 0);
  fs.unlinkSync(zip);
});

test('release stages, smokes develop, promotes, then smokes production on both accounts', async () => {
  const zip = path.join(os.tmpdir(), `fapi-ok-${process.pid}.zip`);
  fs.writeFileSync(zip, 'zip');
  const queue = [
    { outputs: { cos_key: 'scf-deploy/ci/pkg.zip', sha256: 'ab'.repeat(32) } },
    { outputs: { cos_key: 'scf-deploy/ci/pkg.zip', sha256: 'ab'.repeat(32) } },
    { outputs: { version: '9', develop_previous: '8', production: '8' } },
    { outputs: { version: '11', develop_previous: '10', production: '10' } },
    { outputs: {} },
    { outputs: { previous: '8', version: '9' } },
    { outputs: { previous: '10', version: '11' } },
    { outputs: {} }
  ];
  const ordered = fakeSpawn([]);
  ordered.fn = null;
  const calls = [];
  const spawnOrdered = async (script, args, env) => {
    calls.push({ script, args, env });
    const next = queue.shift();
    return { code: 0, outputs: next.outputs };
  };
  spawnOrdered.calls = calls;
  const result = await releaseFunctionApi({ env: releaseEnv({ zip }), spawn: spawnOrdered });
  assert.deepEqual(result, { lin: '9', ek: '11' });
  const commands = calls.map((call) => `${call.script} ${call.args[0] || 'smoke'} ${call.env.DEMOX_TARGET || ''} ${call.env.DEMOX_SMOKE_EK_BASE || ''}`);
  assert.deepEqual(commands, [
    'scripts/ci/scf-function-api.cjs stage lin ',
    'scripts/ci/scf-function-api.cjs stage ek ',
    'scripts/ci/scf-function-api.cjs deploy-develop lin ',
    'scripts/ci/scf-function-api.cjs deploy-develop ek ',
    'scripts/ci/release-smoke.cjs smoke  https://ek-develop.example',
    'scripts/ci/scf-function-api.cjs promote lin ',
    'scripts/ci/scf-function-api.cjs promote ek ',
    'scripts/ci/release-smoke.cjs smoke  https://api.demox.site'
  ]);
  assert.equal(calls[4].env.DEMOX_SMOKE_LIN_BASE, 'https://lin-develop.example');
  assert.equal(calls[7].env.DEMOX_SMOKE_LIN_BASE, 'https://lin-backup.example');
  assert.equal(calls[2].env.DEMOX_REUSE_PUBLISHED, '1');
  assert.equal(calls[5].env.DEMOX_SKIP_PUBLIC_CHECK, '1');
  fs.unlinkSync(zip);
});

test('production smoke failure rolls both aliases back and opens an issue', async () => {
  const zip = path.join(os.tmpdir(), `fapi-bad-${process.pid}.zip`);
  fs.writeFileSync(zip, 'zip');
  const queue = [
    { code: 0, outputs: { cos_key: 'scf-deploy/ci/pkg.zip', sha256: 'ab'.repeat(32) } },
    { code: 0, outputs: { cos_key: 'scf-deploy/ci/pkg.zip', sha256: 'ab'.repeat(32) } },
    { code: 0, outputs: { version: '9', develop_previous: '8', production: '8' } },
    { code: 0, outputs: { version: '11', develop_previous: '10', production: '10' } },
    { code: 0, outputs: {} },
    { code: 0, outputs: { previous: '8', version: '9' } },
    { code: 0, outputs: { previous: '10', version: '11' } },
    { code: 1, outputs: {} },
    { code: 0, outputs: {} },
    { code: 0, outputs: {} },
    { code: 0, outputs: {} }
  ];
  const calls = [];
  const spawnOrdered = async (script, args, env) => {
    calls.push({ script, args, env });
    const next = queue.shift();
    return next;
  };
  await assert.rejects(
    () => releaseFunctionApi({ env: releaseEnv({ zip }), spawn: spawnOrdered }),
    /冒烟失败/
  );
  const tail = calls.slice(-3).map((call) => `${call.args[0] || 'issue'} ${call.env.DEMOX_TARGET || ''} ${call.env.RELEASE_STAGE || ''}`);
  assert.deepEqual(tail, [
    'rollback ek ',
    'rollback lin ',
    'issue  function-api 冒烟未通过，已回滚别名'
  ]);
  assert.equal(calls.at(-3).args[2], '10');
  assert.equal(calls.at(-2).args[2], '8');
  fs.unlinkSync(zip);
});

test('develop smoke failure rolls develop back and leaves production rollback unused', async () => {
  const zip = path.join(os.tmpdir(), `fapi-dev-${process.pid}.zip`);
  fs.writeFileSync(zip, 'zip');
  const queue = [
    { code: 0, outputs: { cos_key: 'scf-deploy/ci/pkg.zip', sha256: 'ab'.repeat(32) } },
    { code: 0, outputs: { cos_key: 'scf-deploy/ci/pkg.zip', sha256: 'ab'.repeat(32) } },
    { code: 0, outputs: { version: '9', develop_previous: '8', production: '7' } },
    { code: 0, outputs: { version: '11', develop_previous: '10', production: '6' } },
    { code: 1, outputs: {} },
    { code: 0, outputs: {} },
    { code: 0, outputs: {} },
    { code: 0, outputs: {} }
  ];
  const calls = [];
  const spawnOrdered = async (script, args, env) => {
    calls.push({ script, args, env });
    return queue.shift();
  };
  await assert.rejects(() => releaseFunctionApi({ env: releaseEnv({ zip }), spawn: spawnOrdered }), /冒烟失败/);
  const names = calls.map((call) => call.args[0] || 'other');
  assert.deepEqual(names, ['stage', 'stage', 'deploy-develop', 'deploy-develop', 'other', 'rollback-develop', 'rollback-develop', 'other']);
  assert.equal(calls[5].env.DEMOX_TARGET, 'ek');
  assert.equal(calls[5].args[2], '10');
  assert.equal(calls[6].args[2], '8');
  fs.unlinkSync(zip);
});

test('manual rollback asks both accounts for numeric versions', async () => {
  const calls = [];
  const spawnOrdered = async (script, args, env) => {
    calls.push({ script, args, env });
    return { code: 0, outputs: {} };
  };
  await rollbackRelease({ env: releaseEnv({ ROLLBACK_VERSION: '4', EK_VERSION: '6' }), spawn: spawnOrdered });
  assert.deepEqual(calls.map((call) => `${call.env.DEMOX_TARGET} ${call.args.join(' ')}`), [
    'lin rollback --version 4',
    'ek rollback --version 6'
  ]);
  await assert.rejects(
    () => rollbackRelease({ env: releaseEnv({ ROLLBACK_VERSION: '4', EK_VERSION: '' }), spawn: spawnOrdered }),
    /数字版本号/
  );
});
