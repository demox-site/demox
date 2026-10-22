#!/usr/bin/env node
'use strict';

/**
 * push master 时的 function-api 发布。
 * 磷（备）先、易点（主）后：stage → deploy-develop → develop 冒烟 → promote → production 冒烟。
 * 冒烟或切换失败时，把已经动过的别名切回去，并开 release-failure issue。
 * 不读 FUNCTION_API_AUTO_DEPLOY。手动入口只剩 rollback。
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REQUIRED = [
  'EK_ENABLED',
  'LIN_ROLE_ARN',
  'EK_ROLE_ARN',
  'LIN_COS_BUCKET',
  'EK_COS_BUCKET',
  'LIN_COS_REGION',
  'EK_COS_REGION',
  'LIN_DEVELOP_URL',
  'EK_DEVELOP_URL',
  'DEMOX_SMOKE_LIN_BASE',
  'DEMOX_SMOKE_EMAIL',
  'DEMOX_SMOKE_PASSWORD',
  'DEMOX_SMOKE_WEBSITE_ID',
  'GITHUB_TOKEN',
  'GITHUB_REPOSITORY'
];

function requireReleaseEnv(env) {
  if (String(env.EK_ENABLED || '') !== 'true') {
    throw new Error('自动发布需要 DEMOX_EK_ENABLED=true，易点和磷都要发');
  }
  for (const name of REQUIRED) {
    if (!String(env[name] || '').trim()) throw new Error(`缺少 ${name}`);
  }
}

function targetEnv(env, target) {
  const lin = target === 'lin';
  return {
    TENCENTCLOUD_ROLE_ARN: lin ? env.LIN_ROLE_ARN : env.EK_ROLE_ARN,
    DEMOX_TARGET: target,
    DEMOX_ENTRY_MODE: lin ? 'custom-domain' : 'http-trigger',
    DEMOX_COS_BUCKET: lin ? env.LIN_COS_BUCKET : env.EK_COS_BUCKET,
    DEMOX_COS_REGION: lin ? env.LIN_COS_REGION : env.EK_COS_REGION,
    DEMOX_COS_ACCELERATE: lin ? (env.LIN_COS_ACCELERATE || '') : (env.EK_COS_ACCELERATE || ''),
    FUNCTION_API_DEVELOP_URL: lin ? env.LIN_DEVELOP_URL : env.EK_DEVELOP_URL,
    TENCENTCLOUD_REGION: env.TENCENTCLOUD_REGION || 'ap-guangzhou',
    RELEASE_APPROVER: env.GITHUB_ACTOR || env.RELEASE_APPROVER || ''
  };
}

function productionBase(env, target) {
  if (target === 'lin') return String(env.DEMOX_SMOKE_LIN_BASE).replace(/\/+$/, '');
  return String(env.DEMOX_SMOKE_EK_BASE || 'https://api.demox.site').trim().replace(/\/+$/, '');
}

function developBase(env, target) {
  return String(target === 'lin' ? env.LIN_DEVELOP_URL : env.EK_DEVELOP_URL).replace(/\/+$/, '');
}

async function runScf(spawnImpl, env, target, args, extra = {}) {
  const result = await spawnImpl('scripts/ci/scf-function-api.cjs', args, { ...targetEnv(env, target), ...extra });
  if (!result || result.code !== 0) {
    const error = new Error(`${target} ${args[0]} 失败`);
    error.outputs = result && result.outputs || {};
    throw error;
  }
  return result.outputs || {};
}

async function runSmoke(spawnImpl, env, bases) {
  const result = await spawnImpl('scripts/ci/release-smoke.cjs', [], {
    DEMOX_SMOKE_EK_BASE: bases.ek,
    DEMOX_SMOKE_LIN_BASE: bases.lin,
    EXPECT_BUNDLE: ''
  });
  if (!result || result.code !== 0) throw new Error('双账号冒烟失败');
}

async function openIssue(spawnImpl, env, rollback) {
  const result = await spawnImpl('scripts/ci/open-release-issue.cjs', [], {
    RELEASE_STAGE: 'function-api 冒烟未通过，已回滚别名',
    RELEASE_ROLLBACK_NOTE: rollback
  });
  if (!result || result.code !== 0) throw new Error('创建 release-failure issue 失败');
}

async function rollbackDeveloped(spawnImpl, env, done) {
  const failures = [];
  for (const target of ['ek', 'lin']) {
    const version = done[target] && done[target].developPrevious;
    if (!done[target] || !done[target].developed || done[target].promoteStarted || !/^\d+$/.test(String(version || ''))) continue;
    try {
      await runScf(spawnImpl, env, target, ['rollback-develop', '--version', String(version)]);
    } catch (error) {
      failures.push(`${target} develop`);
    }
  }
  return failures;
}

async function rollbackPromoted(spawnImpl, env, done) {
  const failures = [];
  for (const target of ['ek', 'lin']) {
    const version = done[target] && done[target].productionPrevious;
    if (!done[target] || !done[target].promoteStarted || !/^\d+$/.test(String(version || ''))) continue;
    try {
      await runScf(spawnImpl, env, target, ['rollback', '--version', String(version)], {
        DEMOX_SKIP_PUBLIC_CHECK: target === 'lin' ? '1' : '',
        RELEASE_LOG: ''
      });
    } catch (error) {
      failures.push(`${target} production`);
    }
  }
  return failures;
}

async function releaseFunctionApi({ env, spawn: spawnImpl }) {
  requireReleaseEnv(env);
  const zip = env.FUNCTION_API_ZIP || '.artifacts/unified-scf/demox-unified-scf.zip';
  if (!fs.existsSync(zip)) throw new Error(`找不到统一包 ${zip}`);
  const done = {
    lin: { developed: false, promoteStarted: false },
    ek: { developed: false, promoteStarted: false }
  };
  let switched = false;
  try {
    const staged = {};
    for (const target of ['lin', 'ek']) {
      staged[target] = await runScf(spawnImpl, env, target, ['stage', '--zip', zip]);
    }
    if (!staged.lin.cos_key || staged.lin.cos_key !== staged.ek.cos_key || staged.lin.sha256 !== staged.ek.sha256) {
      throw new Error('两个账号的部署包 key 或 sha256 不一致');
    }
    const key = staged.lin.cos_key;
    const sha256 = staged.lin.sha256;
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('stage 没有写出 64 位 sha256');
    for (const target of ['lin', 'ek']) {
      const outputs = await runScf(spawnImpl, env, target, ['deploy-develop', '--key', key, '--sha256', sha256], {
        DEMOX_REUSE_PUBLISHED: target === 'lin' ? '1' : ''
      });
      if (!/^\d+$/.test(String(outputs.version || '')) || !/^\d+$/.test(String(outputs.develop_previous || '')) || !/^\d+$/.test(String(outputs.production || ''))) {
        throw new Error(`${target} deploy-develop 没有返回 version / develop_previous / production`);
      }
      done[target].developed = true;
      done[target].version = outputs.version;
      done[target].developPrevious = outputs.develop_previous;
      done[target].productionPrevious = outputs.production;
      switched = true;
    }
    await runSmoke(spawnImpl, env, { ek: developBase(env, 'ek'), lin: developBase(env, 'lin') });
    for (const target of ['lin', 'ek']) {
      done[target].promoteStarted = true;
      const outputs = await runScf(spawnImpl, env, target, ['promote', '--version', done[target].version], {
        DEMOX_SKIP_PUBLIC_CHECK: target === 'lin' ? '1' : '',
        RELEASE_LOG: target === 'lin' ? '' : (env.RELEASE_LOG || 'docs/function-releases.jsonl')
      });
      if (/^\d+$/.test(String(outputs.previous || ''))) done[target].productionPrevious = outputs.previous;
    }
    await runSmoke(spawnImpl, env, { ek: productionBase(env, 'ek'), lin: productionBase(env, 'lin') });
    return { lin: done.lin.version, ek: done.ek.version };
  } catch (error) {
    const promoted = done.lin.promoteStarted || done.ek.promoteStarted;
    const rollbackFailures = promoted
      ? await rollbackPromoted(spawnImpl, env, done)
      : await rollbackDeveloped(spawnImpl, env, done);
    const note = !switched
      ? '别名没有切换。'
      : promoted
        ? `已尝试把易点和磷的 production 别名切回上一版。${rollbackFailures.length ? `回滚未完成：${rollbackFailures.join('、')}。` : ''}`
        : `已尝试把易点和磷的 develop 别名切回上一版，production 未改。${rollbackFailures.length ? `回滚未完成：${rollbackFailures.join('、')}。` : ''}`;
    try {
      await openIssue(spawnImpl, env, note);
    } catch (issueError) {
      error.message = `${error.message}；${issueError.message}`;
    }
    throw error;
  }
}

async function rollbackRelease({ env, spawn: spawnImpl }) {
  if (String(env.EK_ENABLED || '') !== 'true') throw new Error('回滚需要 DEMOX_EK_ENABLED=true');
  const linVersion = String(env.ROLLBACK_VERSION || '');
  const ekVersion = String(env.EK_VERSION || '');
  if (!/^\d+$/.test(linVersion) || !/^\d+$/.test(ekVersion)) throw new Error('rollback 需要磷和易点的数字版本号');
  await runScf(spawnImpl, env, 'lin', ['rollback', '--version', linVersion], { DEMOX_SKIP_PUBLIC_CHECK: '1', RELEASE_LOG: '' });
  await runScf(spawnImpl, env, 'ek', ['rollback', '--version', ekVersion], { RELEASE_LOG: '' });
}

function spawnNode(script, args, env) {
  const outputFile = path.join(os.tmpdir(), `gha-out-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.writeFileSync(outputFile, '');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, ...env, GITHUB_OUTPUT: outputFile },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('close', (code) => {
      const outputs = {};
      for (const line of fs.readFileSync(outputFile, 'utf8').split('\n')) {
        const index = line.indexOf('=');
        if (index > 0) outputs[line.slice(0, index)] = line.slice(index + 1);
      }
      fs.unlinkSync(outputFile);
      resolve({ code: code == null ? 1 : code, outputs });
    });
  });
}

async function main(env = process.env) {
  const command = process.argv[2] || 'release';
  const run = command === 'rollback' ? rollbackRelease : releaseFunctionApi;
  try {
    await run({ env, spawn: spawnNode });
  } catch (error) {
    console.error(`::error::${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { releaseFunctionApi, rollbackRelease, requireReleaseEnv };
