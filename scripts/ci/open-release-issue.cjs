#!/usr/bin/env node
'use strict';

/**
 * 发布失败时开一条 GitHub issue。
 * 标题写明阶段，正文 @启明，并打上 release-failure 标签。
 * GITHUB_TOKEN 先 ::add-mask::，不进后续日志。
 */

const { createRedactor, maskSecret } = require('./release-smoke.cjs');

const LABEL = 'release-failure';

function buildIssue({ stage, sha, runUrl, rollback }) {
  const title = `发布失败：${stage}`.slice(0, 120);
  const body = [
    '@启明',
    '',
    `自动发布在「${stage}」失败。`,
    rollback || '已尝试回滚到上一版。',
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
  if (!stageName) throw new Error('缺少发布阶段名称');
  const api = String(env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  const issue = buildIssue({
    stage: stageName,
    sha: String(env.GITHUB_SHA || '').slice(0, 12),
    runUrl: runUrlFromEnv(env),
    rollback
  });
  const labelRes = await github(fetchImpl, token, 'POST', `${api}/repos/${repo}/labels`, {
    name: LABEL,
    color: 'b60205',
    description: '自动发布冒烟失败，需要启明看'
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

module.exports = { LABEL, buildIssue, runUrlFromEnv, openReleaseIssue };
