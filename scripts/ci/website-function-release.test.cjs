'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseWebsiteFunction, aliasVersion, pushedVersion, failureCategory } = require('./website-function-release.cjs');

function releaseEnv(extra = {}) {
  return {
    DEMOX_TOKEN: 'demox-token-placeholder',
    DEMOX_SMOKE_LIN_BASE: 'https://lin-backup.example',
    DEMOX_SMOKE_EMAIL: 'smoke-user@example.com',
    DEMOX_SMOKE_PASSWORD: 'smoke-password-placeholder',
    DEMOX_SMOKE_WEBSITE_ID: 'SMK00001',
    GITHUB_TOKEN: 'github-token-placeholder',
    GITHUB_REPOSITORY: 'demox-site/demox',
    ...extra
  };
}

const LIST_BEFORE = 'Slug: website\n别名: production->v3, develop->v4\n';

function listFor(production, develop) {
  return { code: 0, stdout: `Slug: website\n别名: production->v${production}, develop->v${develop}\n` };
}

test('alias parser reads the website slug only', () => {
  const text = 'Slug: other\n别名: production->v1, develop->v1\nSlug: website\n别名: production->v3, develop->v4\n';
  assert.equal(aliasVersion(text, 'production'), '3');
  assert.equal(aliasVersion(text, 'develop'), '4');
  assert.equal(pushedVersion('旧版本: 1\n版本: 12\n'), '12');
  assert.equal(failureCategory('认证失败 token=secret'), 'auth（令牌无效/过期）');
});

function statefulCli({ production, develop, pushVersion, smokeCode = 0, onCall }) {
  const state = { production, develop };
  return async (command, args, env) => {
    if (onCall) onCall({ command, args, env, state });
    if (command === 'demox' && args[1] === 'list') return listFor(state.production, state.develop);
    if (command === 'demox' && args[1] === 'push') return { code: 0, stdout: `版本: ${pushVersion}` };
    if (command === 'demox' && args[1] === 'alias') {
      const version = String(args.at(-1) || '').replace('--version=', '');
      if (args[3] === 'production') state.production = version;
      if (args[3] === 'develop') state.develop = version;
      return { code: 0, stdout: '' };
    }
    if (args[0] === 'scripts/ci/release-smoke.cjs') return { code: smokeCode, stdout: '' };
    if (args[0] === 'scripts/ci/open-release-issue.cjs') return { code: 0, stdout: '' };
    return { code: 1, stdout: 'unexpected' };
  };
}

test('deploy pushes index, flips both aliases, then smokes both front doors', async () => {
  const calls = [];
  const spawn = statefulCli({
    production: '3',
    develop: '4',
    pushVersion: '9',
    onCall: (call) => calls.push(call)
  });
  const result = await releaseWebsiteFunction({ env: releaseEnv(), spawn });
  assert.deepEqual(result.version, '9');
  assert.deepEqual(calls.map((call) => `${call.command} ${(call.args || []).slice(0, 3).join(' ')}`), [
    'demox functions list --id',
    'demox functions push ./scf-code/website-api',
    'demox functions alias set',
    'demox functions list --id',
    'demox functions alias set',
    'demox functions list --id',
    'node scripts/ci/release-smoke.cjs'
  ]);
  assert.equal(calls[2].args.at(-1), '--version=9');
  assert.equal(calls[2].args[3], 'develop');
  assert.equal(calls[4].args[3], 'production');
  assert.equal(calls[6].env.DEMOX_SMOKE_EK_BASE, 'https://api.demox.site');
  assert.equal(calls[6].env.DEMOX_SMOKE_LIN_BASE, 'https://lin-backup.example');
  assert.equal(calls.some((call) => JSON.stringify(call.args).includes('demox-token-placeholder')), false);
});

test('smoke failure restores both aliases and opens an issue without printing CLI output', async () => {
  const calls = [];
  let lists = 0;
  const spawn = async (command, args, env) => {
    calls.push({ command, args, env });
    if (command === 'demox' && args[1] === 'list') {
      lists += 1;
      if (lists === 1) return { code: 0, stdout: LIST_BEFORE };
      if (lists === 2) return listFor(3, 9);
      if (lists === 3) return listFor(9, 9);
      if (lists === 4) return listFor(3, 9);
      return listFor(3, 4);
    }
    if (command === 'demox' && args[1] === 'push') return { code: 0, stdout: '令牌 abc 版本: 9' };
    if (command === 'demox' && args[1] === 'alias') return { code: 0, stdout: '' };
    if (args[0] === 'scripts/ci/release-smoke.cjs') return { code: 1, stdout: 'smoke body hidden' };
    if (args[0] === 'scripts/ci/open-release-issue.cjs') return { code: 0, stdout: '' };
    return { code: 1, stdout: '' };
  };
  await assert.rejects(
    () => releaseWebsiteFunction({ env: releaseEnv(), spawn }),
    (error) => {
      assert.match(error.message, /冒烟失败/);
      assert.equal(error.message.includes('令牌 abc'), false);
      assert.equal(error.message.includes('smoke body'), false);
      return true;
    }
  );
  const aliases = calls.filter((call) => call.args[1] === 'alias').map((call) => `${call.args[3]}=${call.args.at(-1)}`);
  assert.deepEqual(aliases, ['develop=--version=9', 'production=--version=9', 'production=--version=3', 'develop=--version=4']);
  assert.equal(calls.at(-1).args[0], 'scripts/ci/open-release-issue.cjs');
  const issue = calls.at(-1);
  assert.equal(issue.env.RELEASE_STAGE, 'website 冒烟未通过，已回滚别名');
  assert.match(issue.env.RELEASE_ROLLBACK_NOTE, /v3/);
  assert.match(issue.env.RELEASE_ROLLBACK_NOTE, /v4/);
});

test('rollback uses the given version and does not push', async () => {
  const calls = [];
  const spawn = statefulCli({
    production: '3',
    develop: '4',
    onCall: (call) => calls.push(call)
  });
  const result = await releaseWebsiteFunction({ env: releaseEnv({ ROLLBACK_VERSION: '2' }), spawn, mode: 'rollback' });
  assert.equal(result.version, '2');
  assert.equal(calls.some((call) => call.args[1] === 'push'), false);
  assert.equal(calls.find((call) => call.args[1] === 'alias').args.at(-1), '--version=2');
});

test('missing token does not call the CLI', async () => {
  const spawn = async () => { throw new Error('called'); };
  await assert.rejects(
    () => releaseWebsiteFunction({ env: releaseEnv({ DEMOX_TOKEN: '' }), spawn }),
    /DEMOX_TOKEN/
  );
});
