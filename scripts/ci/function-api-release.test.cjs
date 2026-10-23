'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { releaseFunctionApi, rollbackRelease, sanitizeApprover, classifyFunctionApiFailure, detailFromStderr } = require('./function-api-release.cjs');
const { buildIssue } = require('./open-release-issue.cjs');

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

test('release stops before deploy-develop when stage omits a sha256', async () => {
  const zip = path.join(os.tmpdir(), `fapi-nosha-${process.pid}.zip`);
  fs.writeFileSync(zip, 'zip');
  const calls = [];
  const spawnOrdered = async (script, args, env) => {
    calls.push({ script, args, env });
    return { code: 0, outputs: { cos_key: 'scf-deploy/ci/pkg.zip', sha256: '' } };
  };
  await assert.rejects(
    () => releaseFunctionApi({ env: releaseEnv({ zip }), spawn: spawnOrdered }),
    /64 位 sha256/
  );
  assert.equal(calls.some((call) => call.args[0] === 'deploy-develop'), false);
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
  assert.equal(calls[2].env.DEMOX_ENTRY_MODE, 'http-trigger');
  assert.equal(calls[3].env.DEMOX_ENTRY_MODE, 'http-trigger');
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
  assert.deepEqual(calls.slice(-3).map((call) => call.args[0] || 'issue'), ['rollback', 'rollback', 'issue']);
  assert.deepEqual(calls.slice(-3, -1).map((call) => call.env.DEMOX_TARGET), ['ek', 'lin']);
  assert.equal(calls.at(-1).env.RELEASE_KIND, 'smoke-rolled-back');
  assert.equal(calls.at(-1).env.RELEASE_STAGE, 'production-smoke');
  assert.match(calls.at(-1).env.RELEASE_ROLLBACK_NOTE, /production 别名已切回上一版/);
  const issue = buildIssue({
    component: calls.at(-1).env.RELEASE_COMPONENT,
    stage: calls.at(-1).env.RELEASE_STAGE,
    kind: calls.at(-1).env.RELEASE_KIND,
    reason: calls.at(-1).env.RELEASE_REASON,
    sha: 'c933e9593619',
    runUrl: 'https://github.com/demox-site/demox/actions/runs/39741790641',
    rollback: calls.at(-1).env.RELEASE_ROLLBACK_NOTE
  });
  assert.equal(issue.title, '发布失败：function-api 冒烟未通过，已回滚（production-smoke）');
  assert.match(issue.body, /actions\/runs\/39741790641/);
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
  assert.equal(calls.at(-1).env.RELEASE_KIND, 'smoke-rolled-back');
  assert.equal(calls.at(-1).env.RELEASE_STAGE, 'develop-smoke');
  assert.match(calls.at(-1).env.RELEASE_ROLLBACK_NOTE, /production 未改/);
  fs.unlinkSync(zip);
});

test('version-gate refusal opens an issue without claiming a rollback', async () => {
  const zip = path.join(os.tmpdir(), `fapi-gate-${process.pid}.zip`);
  fs.writeFileSync(zip, 'zip');
  const queue = [
    { code: 0, outputs: { cos_key: 'scf-deploy/ci/pkg.zip', sha256: 'ab'.repeat(32) } },
    { code: 0, outputs: { cos_key: 'scf-deploy/ci/pkg.zip', sha256: 'ab'.repeat(32) } },
    { code: 1, outputs: { failure_kind: 'version-gate', failure_reason: 'downgrade' }, detail: '本地 app 0.1.21 低于线上 app 0.1.22，CI 不会降级。' }
  ];
  const calls = [];
  const spawnOrdered = async (script, args, env) => {
    calls.push({ script, args, env });
    const next = queue.shift();
    if (!next) return { code: 0, outputs: {} };
    return next;
  };
  await assert.rejects(
    () => releaseFunctionApi({ env: releaseEnv({ zip }), spawn: spawnOrdered }),
    /不会降级/
  );
  assert.equal(calls.some((call) => call.args[0] === 'rollback' || call.args[0] === 'rollback-develop'), false);
  const issueCall = calls.at(-1);
  assert.equal(issueCall.env.RELEASE_KIND, 'version-gate');
  assert.equal(issueCall.env.RELEASE_STAGE, 'deploy-develop');
  assert.match(issueCall.env.RELEASE_REASON, /不会降级/);
  assert.match(issueCall.env.RELEASE_REASON, /downgrade/);
  assert.match(issueCall.env.RELEASE_ROLLBACK_NOTE, /没有回滚/);
  assert.equal(issueCall.env.RELEASE_ROLLBACK_NOTE.includes('已回滚'), false);
  const issue = buildIssue({
    stage: issueCall.env.RELEASE_STAGE,
    kind: issueCall.env.RELEASE_KIND,
    reason: issueCall.env.RELEASE_REASON,
    sha: 'c933e9593619',
    runUrl: 'https://github.com/demox-site/demox/actions/runs/39741790641',
    rollback: issueCall.env.RELEASE_ROLLBACK_NOTE
  });
  assert.equal(issue.title, '发布失败：function-api 版本门禁拒绝（deploy-develop）');
  assert.match(issue.body, /阶段：deploy-develop/);
  assert.match(issue.body, /actions\/runs\/39741790641/);
  fs.unlinkSync(zip);
});

test('a stage failure is a deploy failure and does not claim a rollback', async () => {
  const zip = path.join(os.tmpdir(), `fapi-stage-${process.pid}.zip`);
  fs.writeFileSync(zip, 'zip');
  const calls = [];
  const spawnOrdered = async (script, args, env) => {
    calls.push({ script, args, env });
    if (calls.length === 1) return { code: 1, outputs: {}, detail: '上传失败 github-token-placeholder' };
    return { code: 0, outputs: {} };
  };
  await assert.rejects(() => releaseFunctionApi({ env: releaseEnv({ zip }), spawn: spawnOrdered }), /上传失败/);
  assert.equal(calls.at(-1).env.RELEASE_KIND, 'deploy');
  assert.equal(calls.at(-1).env.RELEASE_STAGE, 'stage');
  assert.match(calls.at(-1).env.RELEASE_ROLLBACK_NOTE, /没有回滚/);
  assert.equal(calls.at(-1).env.RELEASE_REASON.includes('github-token-placeholder'), false);
  assert.match(calls.at(-1).env.RELEASE_REASON, /\[redacted\]/);
  assert.equal(calls.some((call) => String(call.args[0] || '').startsWith('rollback')), false);
  fs.unlinkSync(zip);
});

test('smoke failure with a failed rollback says the rollback failed', async () => {
  const zip = path.join(os.tmpdir(), `fapi-rb-${process.pid}.zip`);
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
    { code: 1, outputs: {} },
    { code: 1, outputs: {} },
    { code: 0, outputs: {} }
  ];
  const calls = [];
  const spawnOrdered = async (script, args, env) => {
    calls.push({ script, args, env });
    return queue.shift();
  };
  await assert.rejects(() => releaseFunctionApi({ env: releaseEnv({ zip }), spawn: spawnOrdered }), /冒烟失败/);
  assert.equal(calls.at(-1).env.RELEASE_KIND, 'smoke-rollback-failed');
  assert.equal(calls.at(-1).env.RELEASE_STAGE, 'production-smoke');
  assert.match(calls.at(-1).env.RELEASE_ROLLBACK_NOTE, /回滚未完成：ek production、lin production/);
  const issue = buildIssue({
    stage: calls.at(-1).env.RELEASE_STAGE,
    kind: calls.at(-1).env.RELEASE_KIND,
    reason: calls.at(-1).env.RELEASE_REASON,
    runUrl: 'https://github.com/demox-site/demox/actions/runs/1',
    rollback: calls.at(-1).env.RELEASE_ROLLBACK_NOTE
  });
  assert.equal(issue.title, '发布失败：function-api 冒烟未通过，回滚失败（production-smoke）');
  fs.unlinkSync(zip);
});

test('classifyFunctionApiFailure keeps version-gate distinct from smoke rollback', () => {
  const gate = classifyFunctionApiFailure({
    phase: 'deploy-develop',
    outputs: { failure_kind: 'version-gate', failure_reason: 'config-drift' },
    message: 'lin deploy-develop 失败：配置指纹变了',
    rollbackFailures: [],
    switched: false
  });
  assert.equal(gate.kind, 'version-gate');
  assert.equal(gate.stage, 'deploy-develop');
  assert.match(gate.rollback, /没有回滚/);
  const smoke = classifyFunctionApiFailure({
    phase: 'develop-smoke',
    message: '双账号冒烟失败',
    rollbackFailures: ['lin develop'],
    switched: true
  });
  assert.equal(smoke.kind, 'smoke-rollback-failed');
  assert.match(detailFromStderr('noise\n::error::本地 app 低于线上\n'), /本地 app 低于线上/);
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
