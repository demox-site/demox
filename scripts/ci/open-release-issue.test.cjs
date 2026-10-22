'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LABEL, buildIssue, openReleaseIssue } = require('./open-release-issue.cjs');

const TOKEN = 'github-token-placeholder-value';
const RUN = 'https://github.com/demox-site/demox/actions/runs/39741790641';

test('issue title and body follow the failure kind, stage, and run link', () => {
  const cases = [
    ['version-gate', 'deploy-develop', '版本门禁拒绝', /没有回滚/, false],
    ['deploy', 'stage', '部署失败', /没有回滚/, false],
    ['smoke-rolled-back', 'production-smoke', '冒烟未通过，已回滚', /已切回上一版/, true],
    ['smoke-rollback-failed', 'develop-smoke', '冒烟未通过，回滚失败', /回滚未完成/, false]
  ];
  for (const [kind, stage, headline, note, rolledBack] of cases) {
    const issue = buildIssue({
      component: 'function-api',
      stage,
      kind,
      reason: kind === 'version-gate' ? '本地 app 0.1.21 低于线上 app 0.1.22，CI 不会降级。' : '双账号冒烟失败',
      sha: 'c933e9593619',
      runUrl: RUN,
      rollback: note.source
    });
    assert.equal(issue.title, `发布失败：function-api ${headline}（${stage}）`);
    assert.match(issue.body, /@启明/);
    assert.match(issue.body, new RegExp(`阶段：${stage}`));
    assert.match(issue.body, new RegExp(RUN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(issue.body, /c933e9593619/);
    assert.deepEqual(issue.labels, [LABEL]);
    if (kind === 'version-gate') {
      assert.equal(issue.title.includes('已回滚'), false);
      assert.match(issue.body, /不会降级/);
      assert.match(issue.body, /没有回滚/);
    }
    if (rolledBack) assert.match(issue.title, /已回滚/);
    if (kind === 'smoke-rollback-failed') assert.match(issue.title, /回滚失败/);
  }
  assert.throws(() => buildIssue({ stage: 'deploy-develop', kind: 'smoke', reason: 'x', runUrl: RUN }), /失败类型/);
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
      RELEASE_COMPONENT: '边缘函数',
      RELEASE_STAGE: 'write-back',
      RELEASE_KIND: 'smoke-rolled-back',
      RELEASE_REASON: '边缘冒烟失败',
      RELEASE_ROLLBACK_NOTE: '已写回上一版。'
    },
    fetchImpl,
    rawLog: (line) => sink.push(line),
    log: (line) => sink.push(line),
    secrets: [],
    stage: 'write-back',
    kind: 'smoke-rolled-back'
  });
  assert.equal(sink[0], `::add-mask::${TOKEN}`);
  assert.equal(sink.slice(1).join('\n').includes(TOKEN), false);
  assert.equal(calls[0].url, 'https://api.github.com/repos/demox-site/demox/labels');
  assert.equal(calls[0].body.name, LABEL);
  assert.equal(calls[1].body.labels[0], LABEL);
  assert.match(calls[1].body.body, /@启明/);
  assert.equal(calls[1].body.title, '发布失败：边缘函数 冒烟未通过，已回滚（write-back）');
  assert.match(calls[1].body.body, /阶段：write-back/);
  assert.match(calls[1].body.body, /https:\/\/github.com\/demox-site\/demox\/actions\/runs\/7/);
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
      GITHUB_RUN_ID: '1',
      RELEASE_STAGE: 'promote',
      RELEASE_KIND: 'deploy',
      RELEASE_REASON: 'website promote 失败'
    },
    fetchImpl,
    rawLog: () => {},
    log: () => {},
    secrets: [],
    stage: 'promote',
    kind: 'deploy'
  });
  assert.match(result.url, /\/issues\/10$/);
});
