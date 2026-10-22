'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LABEL, buildIssue, openReleaseIssue } = require('./open-release-issue.cjs');

const TOKEN = 'github-token-placeholder-value';

test('issue title names the stage and the body mentions 启明', () => {
  const issue = buildIssue({
    stage: 'function-api 冒烟未通过，已回滚别名',
    sha: 'abc123',
    runUrl: 'https://github.com/demox-site/demox/actions/runs/7',
    rollback: '已把两个账号的 production 别名切回上一版。'
  });
  assert.match(issue.title, /^发布失败：function-api/);
  assert.match(issue.body, /@启明/);
  assert.deepEqual(issue.labels, [LABEL]);
  assert.match(issue.body, /abc123/);
});

test('openReleaseIssue masks the token, creates the label, and opens the issue', async () => {
  const sink = [];
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: opts.body && JSON.parse(opts.body), auth: opts.headers.Authorization });
    if (url.endsWith('/labels')) return { status: 201, json: async () => ({ name: LABEL }) };
    return { status: 201, json: async () => ({ html_url: 'https://github.com/demox-site/demox/issues/9' }) };
  };
  const result = await openReleaseIssue({
    env: {
      GITHUB_TOKEN: TOKEN,
      GITHUB_REPOSITORY: 'demox-site/demox',
      GITHUB_SHA: '0123456789abcdef',
      GITHUB_RUN_ID: '7',
      GITHUB_SERVER_URL: 'https://github.com',
      RELEASE_STAGE: '边缘函数冒烟未通过，已写回上一版'
    },
    fetchImpl,
    rawLog: (line) => sink.push(line),
    log: (line) => sink.push(line),
    secrets: [],
    stage: '边缘函数冒烟未通过，已写回上一版'
  });
  assert.equal(sink[0], `::add-mask::${TOKEN}`);
  assert.equal(sink.slice(1).join('\n').includes(TOKEN), false);
  assert.equal(calls[0].url, 'https://api.github.com/repos/demox-site/demox/labels');
  assert.equal(calls[0].body.name, LABEL);
  assert.equal(calls[1].body.labels[0], LABEL);
  assert.match(calls[1].body.body, /@启明/);
  assert.match(calls[1].body.title, /边缘函数/);
  assert.equal(result.url, 'https://github.com/demox-site/demox/issues/9');
});

test('an existing label does not block the issue', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/labels')) return { status: 422, json: async () => ({ message: 'already_exists' }) };
    return { status: 201, json: async () => ({ html_url: 'https://github.com/demox-site/demox/issues/10' }) };
  };
  const result = await openReleaseIssue({
    env: {
      GITHUB_TOKEN: TOKEN,
      GITHUB_REPOSITORY: 'demox-site/demox',
      GITHUB_SHA: 'abc',
      GITHUB_RUN_ID: '1'
    },
    fetchImpl,
    rawLog: () => {},
    log: () => {},
    secrets: [],
    stage: 'website 函数冒烟未通过，已回滚别名'
  });
  assert.match(result.url, /\/issues\/10$/);
});
