#!/usr/bin/env node
'use strict';

/**
 * push master 时发布平台站点 EPX2UU43 的 website 函数。
 * CLI 只推 index.js。公开 API 仍跑 function-api 进程内的 website，不读这个别名。
 * 切到 production 之后仍对易点和磷的前门做同一套冒烟。失败把别名切回去，并开 issue。
 * workflow_dispatch 只做回滚。
 */

const { spawn } = require('child_process');
const { maskSecret } = require('./release-smoke.cjs');

const WEBSITE_ID = 'EPX2UU43';
const FN_SLUG = 'website';

const REQUIRED = [
  'DEMOX_TOKEN',
  'DEMOX_SMOKE_LIN_BASE',
  'DEMOX_SMOKE_EMAIL',
  'DEMOX_SMOKE_PASSWORD',
  'DEMOX_SMOKE_WEBSITE_ID',
  'GITHUB_TOKEN',
  'GITHUB_REPOSITORY'
];

function requireReleaseEnv(env) {
  for (const name of REQUIRED) {
    if (!String(env[name] || '').trim()) throw new Error(`缺少 ${name}`);
  }
}

function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function aliasVersion(text, aliasName) {
  let current = false;
  for (const line of stripAnsi(text).split('\n')) {
    const slug = line.match(/Slug:\s*(\S+)/);
    if (slug) current = slug[1] === FN_SLUG;
    if (!current || !line.includes('别名:')) continue;
    const prefix = `${aliasName}->v`;
    for (const part of line.split(/[ ,]+/)) {
      if (part.startsWith(prefix)) return part.slice(prefix.length);
    }
  }
  return '';
}

function pushedVersion(text) {
  const matches = [...stripAnsi(text).matchAll(/版本:\s*(\d+)/g)];
  return matches.length ? matches[matches.length - 1][1] : '';
}

function failureCategory(text) {
  const flat = stripAnsi(text);
  if (/认证失败|401|未登录|过期/.test(flat)) return 'auth（令牌无效/过期）';
  if (/403|没有权限|无权|forbidden|Forbidden/.test(flat)) return 'forbidden（令牌不是站点所有者）';
  if (/413|过大|too large/.test(flat)) return 'too_large';
  return 'other';
}

async function runDemox(spawnImpl, args) {
  const result = await spawnImpl('demox', args, {});
  const output = `${result && result.stdout || ''}${result && result.stderr || ''}`;
  if (!result || result.code !== 0) {
    throw new Error(`demox ${args.slice(0, 2).join(' ')} 失败（退出码 ${result && result.code != null ? result.code : 1}，类别 ${failureCategory(output)}，CLI 输出已隐藏）`);
  }
  return output;
}

async function readAliases(spawnImpl) {
  const listed = await runDemox(spawnImpl, ['functions', 'list', '--id', WEBSITE_ID]);
  const production = aliasVersion(listed, 'production');
  const develop = aliasVersion(listed, 'develop');
  if (!/^\d+$/.test(production) || !/^\d+$/.test(develop)) throw new Error('读不到当前别名');
  return { production, develop };
}

async function setAlias(spawnImpl, name, version) {
  await runDemox(spawnImpl, ['functions', 'alias', 'set', name, '--id', WEBSITE_ID, '--slug', FN_SLUG, `--version=${version}`]);
  const listed = await runDemox(spawnImpl, ['functions', 'list', '--id', WEBSITE_ID]);
  const now = aliasVersion(listed, name);
  if (now !== String(version)) throw new Error(`${name} 没有指到 v${version}（现在 v${now || '?'}）`);
}

async function runSmoke(spawnImpl, env) {
  const result = await spawnImpl('node', ['scripts/ci/release-smoke.cjs'], {
    DEMOX_SMOKE_EK_BASE: String(env.DEMOX_SMOKE_EK_BASE || 'https://api.demox.site').trim(),
    DEMOX_SMOKE_LIN_BASE: String(env.DEMOX_SMOKE_LIN_BASE).replace(/\/+$/, ''),
    EXPECT_BUNDLE: ''
  });
  if (!result || result.code !== 0) throw new Error('双账号冒烟失败');
}

async function openIssue(spawnImpl, rollback) {
  const result = await spawnImpl('node', ['scripts/ci/open-release-issue.cjs'], {
    RELEASE_STAGE: 'website 冒烟未通过，已回滚别名',
    RELEASE_ROLLBACK_NOTE: rollback
  });
  if (!result || result.code !== 0) throw new Error('创建 release-failure issue 失败');
}

async function releaseWebsiteFunction({ env, spawn: spawnImpl, mode = 'deploy' }) {
  requireReleaseEnv(env);
  const previous = await readAliases(spawnImpl);
  let target = '';
  let moved = '';
  try {
    if (mode === 'rollback') {
      target = String(env.ROLLBACK_VERSION || '');
      if (!/^\d+$/.test(target)) throw new Error('rollback 需要数字 version');
    } else {
      const pushed = await runDemox(spawnImpl, ['functions', 'push', './scf-code/website-api', '--id', WEBSITE_ID, '--slug', FN_SLUG]);
      target = pushedVersion(pushed);
      if (!/^\d+$/.test(target)) throw new Error('读不到新版本号');
    }
    await setAlias(spawnImpl, 'develop', target);
    moved = 'develop';
    await setAlias(spawnImpl, 'production', target);
    moved = 'both';
    await runSmoke(spawnImpl, env);
    return { version: target, previous };
  } catch (error) {
    const failures = [];
    if (moved === 'both' || moved === 'develop') {
      try {
        if (moved === 'both') await setAlias(spawnImpl, 'production', previous.production);
      } catch (rollbackError) {
        failures.push(`production（${rollbackError.message}）`);
      }
      try {
        await setAlias(spawnImpl, 'develop', previous.develop);
      } catch (rollbackError) {
        failures.push(`develop（${rollbackError.message}）`);
      }
    }
    const note = moved
      ? `已尝试把 website 的 production 切回 v${previous.production}、develop 切回 v${previous.develop}。${failures.length ? `回滚未完成：${failures.join('、')}。` : ''}`
      : '别名没有切换。';
    try {
      await openIssue(spawnImpl, note);
    } catch (issueError) {
      error.message = `${error.message}；${issueError.message}`;
    }
    throw error;
  }
}

function spawnCommand(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code: code == null ? 1 : code, stdout, stderr }));
  });
}

async function main(env = process.env) {
  const secrets = [];
  maskSecret(console.log, secrets, env.DEMOX_TOKEN);
  maskSecret(console.log, secrets, env.DEMOX_SMOKE_PASSWORD);
  maskSecret(console.log, secrets, env.DEMOX_SMOKE_EMAIL);
  const mode = process.argv[2] === 'rollback' ? 'rollback' : 'deploy';
  try {
    await releaseWebsiteFunction({ env, spawn: spawnCommand, mode });
  } catch (error) {
    console.error(`::error::${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  releaseWebsiteFunction,
  aliasVersion,
  pushedVersion,
  failureCategory,
  WEBSITE_ID,
  FN_SLUG
};
