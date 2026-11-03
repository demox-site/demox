'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'scripts/edge/preprod-diff.cjs',
  'edge-functions/LIVE.sha256',
  'edge-functions/fixtures/live-subdomain-router.0e706f11.js',
  'edge-functions/subdomain-router.js',
  'edge-functions/subdomain-router.live-diff.test.cjs'
];

function git(cwd, args, env) {
  return execFileSync('git', args, {
    cwd,
    env: env || process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

test('live-diff passes in a depth-1 clone with no published-body commit', { timeout: 60_000 }, () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'demox-live-diff-'));
  const src = path.join(work, 'src');
  const shallow = path.join(work, 'shallow');
  const emptyGit = path.join(work, 'empty-git');
  fs.mkdirSync(src, { recursive: true });
  for (const rel of FILES) {
    const dest = path.join(src, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dest);
  }
  git(src, ['init']);
  git(src, ['config', 'user.email', 'live-diff@example.com']);
  git(src, ['config', 'user.name', 'live-diff']);
  git(src, ['add', '.']);
  git(src, ['commit', '-m', 'vendor live body']);
  git(work, ['clone', '--depth', '1', 'file://' + src, shallow]);
  const commits = git(shallow, ['rev-list', '--count', 'HEAD']).trim();
  assert.equal(commits, '1');
  let missingHistory = false;
  try {
    git(shallow, ['cat-file', '-t', '4131fb1687ab4874fef739093b9627e03994ac34']);
  } catch (err) {
    missingHistory = true;
  }
  assert.equal(missingHistory, true, 'shallow clone must not contain the published body commit');

  fs.mkdirSync(emptyGit, { recursive: true });
  git(emptyGit, ['init', '--bare']);
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME || '/tmp',
    TMPDIR: process.env.TMPDIR || '/tmp',
    LANG: process.env.LANG || 'C.UTF-8',
    GIT_DIR: emptyGit
  };
  const probe = execFileSync(process.execPath, ['--test', 'edge-functions/subdomain-router.live-diff.test.cjs'], {
    cwd: shallow,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024
  });
  assert.match(probe, /# fail 0/);
  assert.match(probe, /# pass [1-9]/);
  const loaded = execFileSync(process.execPath, ['-e', `
    const { loadLiveSource } = require('./scripts/edge/preprod-diff.cjs');
    const text = loadLiveSource();
    if (!text.includes('async function handleRequest')) process.exit(2);
  `], {
    cwd: shallow,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(loaded, '');
});
