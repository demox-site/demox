#!/usr/bin/env node
'use strict';

/**
 * 发布失败时开一条 GitHub issue。
 * 标题和正文按失败类型写：版本门禁拒绝、部署失败、冒烟已回滚、冒烟回滚失败。
 * 正文带阶段和运行链接。GITHUB_TOKEN 先 ::add-mask::，不进后续日志。
 */

const { createRedactor, maskSecret } = require('./release-smoke.cjs');

const LABEL = 'release-failure';

const FAILURE_KINDS = Object.freeze({
  'version-gate': '版本门禁拒绝',
  deploy: '部署失败',
  'smoke-rolled-back': '冒烟未通过，已回滚',
  'smoke-rollback-failed': '冒烟未通过，回滚失败'
});

function buildIssue({ component = 'function-api', stage, kind, reason, sha, runUrl, rollback }) {
  const headline = FAILURE_KINDS[kind];
  if (!headline) throw new Error('缺少失败类型');
  const stageName = String(stage || '').trim() || '未知';
  const title = `发布失败：${component} ${headline}（${stageName}）`.slice(0, 120);
  const body = [
    '@启明',
    '',
    `阶段：${stageName}`,
    `原因：${String(reason || '').trim() || headline}`,
    rollback || headline,
    '',
    `- 提交：${sha || '未知'}`,
    `- 运行：${runUrl || '未知'}`
  ].join('\n');
  return { title, body, labels: [LABEL] };
}

function runUrlFromEnv(env) {
  const server = String(env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/+$/, '');
  const repo = String(env.GITHUB_REPOSITORY || '').trim();
  const runId = String(env.GITHUB_RUN_ID || '').trim();
  if (!repo || !runId) return '';
  return `${server}/${repo}/actions/runs/${runId}`;
}

async function github(fetchImpl, token, method, url, payload) {
  const res = await fetchImpl(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'demox-release',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function openReleaseIssue({
  env = process.env,
  fetchImpl = globalThis.fetch,
  rawLog = console.log,
  log = rawLog,
  secrets = [],
  stage,
  kind,
  rollback
} = {}) {
  maskSecret(rawLog, secrets, env.GITHUB_TOKEN);
  const hide = createRedactor(secrets);
  const safeLog = (line) => log(hide(line));
  const token = String(env.GITHUB_TOKEN || '').trim();
  const repo = String(env.GITHUB_REPOSITORY || '').trim();
  if (!token) throw new Error('缺少 GITHUB_TOKEN（job 需要 permissions: issues: write）');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('GITHUB_REPOSITORY 格式不正确');
  const stageName = String(stage || env.RELEASE_STAGE || '').trim();
  const failureKind = String(kind || env.RELEASE_KIND || '').trim();
  if (!stageName) throw new Error('缺少发布阶段名称');
  if (!FAILURE_KINDS[failureKind]) throw new Error('缺少失败类型');
  const api = String(env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  const issue = buildIssue({
    component: String(env.RELEASE_COMPONENT || 'function-api').trim() || 'function-api',
    stage: stageName,
    kind: failureKind,
    reason: env.RELEASE_REASON,
    sha: String(env.GITHUB_SHA || '').slice(0, 12),
    runUrl: runUrlFromEnv(env),
    rollback: rollback || env.RELEASE_ROLLBACK_NOTE
  });
  const labelRes = await github(fetchImpl, token, 'POST', `${api}/repos/${repo}/labels`, {
    name: LABEL,
    color: 'b60205',
    description: '自动发布失败，需要启明看'
  });
  if (labelRes.status !== 201 && labelRes.status !== 422) {
    throw new Error(`创建标签 ${LABEL} 失败：HTTP ${labelRes.status}`);
  }
  const created = await github(fetchImpl, token, 'POST', `${api}/repos/${repo}/issues`, issue);
  if (created.status !== 201 || !created.body || !created.body.html_url) {
    throw new Error(`创建 issue 失败：HTTP ${created.status}`);
  }
  safeLog(`opened ${created.body.html_url}`);
  return { url: created.body.html_url, title: issue.title, body: issue.body };
}

async function main(env = process.env) {
  const secrets = [];
  const hide = () => createRedactor(secrets);
  try {
    await openReleaseIssue({
      env,
      secrets,
      rawLog: console.log,
      log: (line) => console.log(hide()(line)),
      stage: env.RELEASE_STAGE,
      rollback: env.RELEASE_ROLLBACK_NOTE
    });
  } catch (error) {
    const message = hide()(error && error.message ? error.message : String(error));
    console.error(`::error::${message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { LABEL, FAILURE_KINDS, buildIssue, runUrlFromEnv, openReleaseIssue };
