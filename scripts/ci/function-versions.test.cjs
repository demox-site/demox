'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const v = require('./function-versions.cjs');

const GIT = '38f44560bb01576a79a7d3c8b27858853ee4afb6';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const ROOT = v.repoRoot();

function runtime(extra = {}) {
  return {
    entry: 'index.main',
    memoryMB: 512,
    timeoutSec: 300,
    layers: [],
    environmentNames: ['JWT_SECRET', 'MYSQL_HOST'],
    triggers: ['http:api.demox.site', 'timer:analytics-rollup-5m'],
    ...extra
  };
}

function entry(over = {}) {
  return { name: 'demox-function-api', appVersion: '0.2.0', runtimeVersion: '0.1.0', runtime: runtime(), ...over };
}

function liveState({ app = '0.1.0', rt = '0.1.0', sha = SHA_A, cfg, version = '3', develop = version, production = version } = {}) {
  const fingerprint = cfg || v.configFingerprint(runtime());
  const description = v.formatDescription({ app, runtime: rt, git: GIT, sha256: sha, cfg: fingerprint });
  const versions = [{ Version: String(develop), Description: description }];
  if (String(production) !== String(develop)) versions.push({ Version: String(production), Description: description });
  return {
    aliases: [
      { Name: 'develop', FunctionVersion: String(develop) },
      { Name: 'production', FunctionVersion: String(production) }
    ],
    versions
  };
}

function decide(over = {}, liveOver = {}) {
  const local = entry(over);
  const live = liveState(liveOver);
  return v.decideAppDeploy({ entry: local, aliases: live.aliases, versions: live.versions, codeSha256: SHA_B, gitSha: GIT });
}

function asSeed(manifest) {
  const seeded = structuredClone(manifest);
  seeded.seed = true;
  for (const fn of seeded.functions) {
    fn.appVersion = '0.0.0-placeholder';
    fn.runtimeVersion = '0.0.0-placeholder';
  }
  return seeded;
}

test('semver: placeholder is below a real release, and CI can tell greater from less', () => {
  assert.ok(v.compareSemver('0.0.0-placeholder', '0.0.0') < 0);
  assert.ok(v.compareSemver('0.0.0', '0.0.1') < 0);
  assert.ok(v.compareSemver('0.1.0', '0.0.9') > 0);
  assert.ok(v.compareSemver('1.0.0-rc.1', '1.0.0') < 0);
  assert.equal(v.compareSemver('1.2.3+build.4', '1.2.3'), 0);
  assert.equal(v.isPlaceholderVersion('0.0.0-placeholder'), true);
  assert.equal(v.isPlaceholderVersion('0.1.0'), false);
  assert.throws(() => v.parseSemver('01.0.0'), /semver/);
  assert.throws(() => v.parseSemver('1.0'), /semver/);
});

test('config fingerprint uses names only and ignores key order', () => {
  const left = v.configFingerprint(runtime());
  const right = v.configFingerprint(runtime({ environmentNames: ['MYSQL_HOST', 'JWT_SECRET'], triggers: ['timer:analytics-rollup-5m', 'http:api.demox.site'] }));
  assert.equal(left, right);
  assert.equal(left.length, 64);
  assert.notEqual(left, v.configFingerprint(runtime({ memoryMB: 1024 })));
  assert.throws(() => v.configFingerprint(runtime({ environment: { JWT_SECRET: 'secret-value' } })), /环境变量值/);
});

test('version description round-trips and never carries env values', () => {
  const cfg = v.configFingerprint(runtime());
  const line = v.formatDescription({ app: '0.2.0', runtime: '0.1.0', git: GIT, sha256: SHA_A, cfg });
  assert.deepEqual(v.parseDescription(line), { app: '0.2.0', runtime: '0.1.0', git: GIT, sha256: SHA_A, cfg });
  assert.equal(v.parseDescription('ci develop abc'), null);
  assert.equal(v.parseDescription(''), null);
  assert.doesNotMatch(line, /JWT_SECRET|secret-value|MYSQL_PASSWORD/);
  assert.throws(() => v.formatDescription({ app: '0.2.0', runtime: '0.1.0', git: 'local', sha256: SHA_A, cfg }), /40 位/);
});

test('app deploy: only a higher app with the same config fingerprint is allowed', () => {
  const ok = decide();
  assert.equal(ok.allow, true, ok.message);
  assert.match(ok.description, /^demox-release app=0\.2\.0 runtime=0\.1\.0 /);
  assert.match(ok.description, new RegExp(`sha256=${SHA_B}`));
  assert.equal(decide({}, { app: '0.2.0', sha: SHA_B }).reason, 'already-published');
  assert.equal(decide({}, { app: '0.2.0', sha: SHA_A }).reason, 'code-drift');
  assert.equal(decide({ appVersion: '0.1.0' }, { app: '0.2.0', sha: SHA_B }).reason, 'downgrade');
  assert.equal(decide({ runtimeVersion: '0.2.0' }).reason, 'runtime-drift');
  assert.equal(decide({ runtimeVersion: '0.0.1' }).reason, 'runtime-drift');
  assert.equal(decide({ runtime: runtime({ memoryMB: 1024 }) }).reason, 'config-drift');
});

function bareAliases({ develop = '11', production = '11', developDescription = 'baseline before CI', productionDescription = developDescription } = {}) {
  const versions = [{ Version: String(develop), Description: developDescription }];
  if (String(production) !== String(develop)) versions.push({ Version: String(production), Description: productionDescription });
  return {
    aliases: [
      { Name: 'develop', FunctionVersion: String(develop) },
      { Name: 'production', FunctionVersion: String(production) }
    ],
    versions
  };
}

test('bootstrap metadata only when both aliases lack demox-release', () => {
  const local = entry({ appVersion: '0.1.0', runtimeVersion: '0.1.0' });
  const both = bareAliases();
  const ok = v.decideAppDeploy({ entry: local, aliases: both.aliases, versions: both.versions, codeSha256: SHA_B, gitSha: GIT });
  assert.equal(ok.allow, true, ok.message);
  assert.equal(ok.reason, 'bootstrap-metadata');
  assert.equal(ok.live, null);
  const cfg = v.configFingerprint(local.runtime);
  assert.equal(ok.description, v.formatDescription({ app: '0.1.0', runtime: '0.1.0', git: GIT, sha256: SHA_B, cfg }));
  assert.doesNotMatch(ok.description, /JWT_SECRET|MYSQL_PASSWORD/);

  const splitVersions = bareAliases({ develop: '12', production: '11', developDescription: '', productionDescription: 'still no meta' });
  const split = v.decideAppDeploy({ entry: local, aliases: splitVersions.aliases, versions: splitVersions.versions, codeSha256: SHA_B, gitSha: GIT });
  assert.equal(split.reason, 'bootstrap-metadata');

  const meta = v.formatDescription({ app: '0.1.0', runtime: '0.1.0', git: GIT, sha256: SHA_A, cfg });
  const developOnly = bareAliases({ develop: '12', production: '11', developDescription: meta, productionDescription: 'baseline before CI' });
  const drift = v.decideAppDeploy({ entry: local, aliases: developOnly.aliases, versions: developOnly.versions, codeSha256: SHA_B, gitSha: GIT });
  assert.equal(drift.allow, false);
  assert.equal(drift.reason, 'missing-metadata');
  assert.match(drift.message, /已停止并告警/);
  assert.match(drift.message, /不会覆盖/);

  const productionOnly = bareAliases({ develop: '12', production: '11', developDescription: 'baseline before CI', productionDescription: meta });
  const driftOther = v.decideAppDeploy({ entry: entry(), aliases: productionOnly.aliases, versions: productionOnly.versions, codeSha256: SHA_B, gitSha: GIT });
  assert.equal(driftOther.reason, 'missing-metadata');
  assert.equal(driftOther.description, null);

  const present = decide();
  assert.equal(present.allow, true, present.message);
  assert.equal(present.reason, 'app-upgrade');
  assert.match(present.description, /^demox-release app=0\.2\.0 runtime=0\.1\.0 /);

  const placeholder = v.decideAppDeploy({
    entry: entry({ appVersion: '0.0.0-placeholder' }),
    aliases: both.aliases,
    versions: both.versions,
    codeSha256: SHA_B,
    gitSha: GIT
  });
  assert.equal(placeholder.allow, false);
  assert.equal(placeholder.reason, 'placeholder');
  assert.equal(placeholder.description, null);

  const badGit = v.decideAppDeploy({ entry: local, aliases: both.aliases, versions: both.versions, codeSha256: SHA_B, gitSha: 'local' });
  assert.equal(badGit.reason, 'bad-git');
  const badSha = v.decideAppDeploy({ entry: local, aliases: both.aliases, versions: both.versions, codeSha256: 'abc', gitSha: GIT });
  assert.equal(badSha.reason, 'bad-sha');
  const badRuntime = v.decideAppDeploy({
    entry: entry({ appVersion: '0.1.0', runtime: runtime({ memoryMB: 1 }) }),
    aliases: both.aliases,
    versions: both.versions,
    codeSha256: SHA_B,
    gitSha: GIT
  });
  assert.equal(badRuntime.reason, 'bad-runtime');
  assert.equal(badRuntime.description, null);
});

test('missing alias or $LATEST stops before bootstrap', () => {
  const local = entry();
  const noAlias = v.decideAppDeploy({
    entry: local,
    aliases: [{ Name: 'production', FunctionVersion: '3' }],
    versions: [],
    codeSha256: SHA_B,
    gitSha: GIT
  });
  assert.equal(noAlias.reason, 'missing-alias');
  const latest = v.decideAppDeploy({
    entry: local,
    aliases: [{ Name: 'develop', FunctionVersion: '$LATEST' }, { Name: 'production', FunctionVersion: '11' }],
    versions: [{ Version: '11', Description: '' }],
    codeSha256: SHA_B,
    gitSha: GIT
  });
  assert.equal(latest.reason, 'missing-alias');
  assert.equal(latest.description, null);
});

test('develop ahead of production uses the higher app version', () => {
  const cfg = v.configFingerprint(runtime());
  const older = v.formatDescription({ app: '0.1.0', runtime: '0.1.0', git: GIT, sha256: SHA_A, cfg });
  const newer = v.formatDescription({ app: '0.3.0', runtime: '0.1.0', git: GIT, sha256: SHA_B, cfg });
  const decision = v.decideAppDeploy({
    entry: entry({ appVersion: '0.2.0' }),
    aliases: [{ Name: 'develop', FunctionVersion: '5' }, { Name: 'production', FunctionVersion: '3' }],
    versions: [{ Version: '5', Description: newer }, { Version: '3', Description: older }],
    codeSha256: SHA_B,
    gitSha: GIT
  });
  assert.equal(decision.reason, 'downgrade');
});

test('real manifest is platform-only, bootstrapped, and has no account ids', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'functions.json'), 'utf8');
  const manifest = JSON.parse(raw);
  const check = v.validateManifest(manifest, { checkPaths: true, root: ROOT });
  assert.equal(check.ok, true, check.errors.join('\n'));
  assert.equal(Object.hasOwn(manifest, 'seed'), false);
  assert.equal(Object.hasOwn(manifest, 'seedNote'), false);
  assert.ok(manifest.functions.every((fn) => fn.layer === 'platform'));
  assert.ok(manifest.functions.every((fn) => fn.runtimeVersion === '0.1.0'));
  assert.equal(manifest.functions.find((fn) => fn.name === 'demox-function-api').appVersion, '0.1.2');
  assert.equal(manifest.functions.find((fn) => fn.name === 'demox-user-nodejs').appVersion, '0.1.0');
  assert.ok(manifest.functions.every((fn) => !v.isPlaceholderVersion(fn.appVersion) && !v.isPlaceholderVersion(fn.runtimeVersion)));
  assert.equal(v.deployEntry(manifest).name, 'demox-function-api');
  assert.ok(manifest.functions.every((fn) => fn.accountEnv === 'TENCENTCLOUD_ACCOUNT_UIN'));
  assert.ok(manifest.excluded.some((item) => item.track === 'user'));
  for (const id of v.BANNED_ACCOUNT_IDS) assert.equal(raw.includes(id), false);
  for (const banned of ['user-sites', 'demox-website-api', 'demox-auth-api', 'demox-mcp-api', 'demox-cert-renew']) {
    assert.equal(manifest.functions.some((fn) => fn.name === banned), false);
  }
  const poisoned = structuredClone(manifest);
  poisoned.functions.push({ ...poisoned.functions[0], name: 'customer-site', layer: 'user' });
  assert.equal(v.validateManifest(poisoned).ok, false);
});

test('PR check: code without an app bump fails once the manifest exists on base', () => {
  const manifest = v.loadManifest();
  const introduced = v.evaluateChanges({
    baseManifest: null,
    headManifest: asSeed(manifest),
    changedFiles: ['scripts/package-unified-scf.mjs', 'scf-code/website-api/index.js']
  });
  assert.equal(introduced.ok, true, introduced.errors.join('\n'));

  const websiteOnly = v.evaluateChanges({
    baseManifest: manifest,
    headManifest: manifest,
    changedFiles: ['scf-code/website-api/index.js', 'scf-code/website-api/shared/db.js']
  });
  assert.equal(websiteOnly.ok, false);
  assert.match(websiteOnly.errors.join('\n'), /demox-function-api 的代码变了/);

  const websiteBumped = structuredClone(manifest);
  websiteBumped.functions.find((fn) => fn.name === 'demox-function-api').appVersion = '0.1.3';
  const websiteAfterBump = v.evaluateChanges({
    baseManifest: manifest,
    headManifest: websiteBumped,
    changedFiles: ['scf-code/website-api/index.js', 'scf-code/website-api/shared/cookie-domain-policy.cjs']
  });
  assert.equal(websiteAfterBump.ok, true, websiteAfterBump.errors.join('\n'));

  const code = v.evaluateChanges({
    baseManifest: manifest,
    headManifest: manifest,
    changedFiles: ['scf-code/function-api/index.js']
  });
  assert.equal(code.ok, false);
  assert.match(code.errors.join('\n'), /demox-function-api 的代码变了/);

  const testsOnly = v.evaluateChanges({
    baseManifest: manifest,
    headManifest: manifest,
    changedFiles: ['scf-code/website-api/index.test.cjs', 'scf-code/function-api/README.md']
  });
  assert.equal(testsOnly.ok, true, testsOnly.errors.join('\n'));

  const bumped = structuredClone(manifest);
  bumped.functions[0].appVersion = '0.1.3';
  const afterBump = v.evaluateChanges({
    baseManifest: manifest,
    headManifest: bumped,
    changedFiles: ['scf-code/function-api/index.js']
  });
  assert.equal(afterBump.ok, true, afterBump.errors.join('\n'));

  const runtimeFile = v.evaluateChanges({
    baseManifest: manifest,
    headManifest: manifest,
    changedFiles: ['scripts/package-unified-scf.mjs']
  });
  assert.equal(runtimeFile.ok, false);
  assert.match(runtimeFile.errors.join('\n'), /runtime 文件或配置变了/);

  const runtimeCfg = structuredClone(manifest);
  runtimeCfg.functions[0].runtime = { ...runtimeCfg.functions[0].runtime, memoryMB: 1024 };
  const cfg = v.evaluateChanges({ baseManifest: manifest, headManifest: runtimeCfg, changedFiles: [] });
  assert.equal(cfg.ok, false);
  assert.match(cfg.errors.join('\n'), /runtime/);

  const handler = v.evaluateChanges({
    baseManifest: manifest,
    headManifest: bumped,
    changedFiles: ['scf-code/function-api/runtime-nodejs.js']
  });
  assert.equal(handler.ok, false);
  assert.match(handler.errors.join('\n'), /demox-user-nodejs 的代码变了/);
});

test('seed placeholder may correct environment names without a runtime bump', () => {
  const live = v.loadManifest();
  const api = live.functions.find((fn) => fn.name === 'demox-function-api');
  const added = [
    'DEMOX_PLATFORM_WEBSITE_ID',
    'DEMOX_SITE_WEBSITE_ID',
    'FUNCTIONS_COS_BUCKET',
    'FUNCTIONS_COS_REGION',
    'FUNCTIONS_NODE_RUNTIME',
    'FUNCTIONS_NODE_RUNTIME_URL',
    'FUNCTIONS_RUNTIME_NAMESPACE',
    'FUNCTION_ENV',
    'FUNCTION_PUBLIC_BASE_URL',
    'RUNTIME_INVOKE_SECRET',
    'FAIL_OPEN_CHECK_KEY'
  ];
  assert.equal(api.runtime.environmentNames.length, 32);
  assert.deepEqual(api.runtime.environmentNames, [...api.runtime.environmentNames].sort());
  assert.deepEqual(api.runtime.triggers, ['http:api.demox.site', 'timer:analytics-rollup-5m', 'timer:monthly-renew']);
  assert.equal(api.runtime.entry, 'index.main');
  assert.equal(api.runtime.memoryMB, 512);
  assert.equal(api.runtime.timeoutSec, 300);
  assert.deepEqual(api.runtime.layers, []);
  assert.equal(api.appVersion, '0.1.2');
  assert.equal(api.runtimeVersion, '0.1.0');
  assert.equal(Object.hasOwn(live, 'seed'), false);
  assert.equal(live.functions.find((fn) => fn.name === 'demox-user-nodejs').appVersion, '0.1.0');
  assert.equal(live.functions.find((fn) => fn.name === 'demox-user-nodejs').runtimeVersion, '0.1.0');
  for (const name of added) assert.equal(api.runtime.environmentNames.includes(name), true);

  const bootstrap = v.evaluateChanges({
    baseManifest: asSeed(live),
    headManifest: live,
    changedFiles: ['functions.json']
  });
  assert.equal(bootstrap.ok, true, bootstrap.errors.join('\n'));

  const head = asSeed(live);
  const base = structuredClone(head);
  const baseApi = base.functions.find((fn) => fn.name === 'demox-function-api');
  baseApi.runtime.environmentNames = baseApi.runtime.environmentNames.filter((name) => !added.includes(name));
  assert.equal(baseApi.runtime.environmentNames.length, 21);

  const namesOnly = v.evaluateChanges({
    baseManifest: base,
    headManifest: head,
    changedFiles: ['functions.json']
  });
  assert.equal(namesOnly.ok, true, namesOnly.errors.join('\n'));
  assert.match(namesOnly.warnings.join('\n'), /environmentNames/);

  const alsoMemory = structuredClone(head);
  alsoMemory.functions.find((fn) => fn.name === 'demox-function-api').runtime.memoryMB = 1024;
  const mixed = v.evaluateChanges({ baseManifest: base, headManifest: alsoMemory, changedFiles: [] });
  assert.equal(mixed.ok, false);
  assert.match(mixed.errors.join('\n'), /runtime/);

  const released = structuredClone(base);
  const releasedHead = structuredClone(head);
  for (const manifest of [released, releasedHead]) {
    manifest.seed = false;
    for (const fn of manifest.functions) {
      fn.appVersion = '0.1.0';
      fn.runtimeVersion = '0.1.0';
    }
  }
  const afterSeed = v.evaluateChanges({ baseManifest: released, headManifest: releasedHead, changedFiles: [] });
  assert.equal(afterSeed.ok, false);
  assert.match(afterSeed.errors.join('\n'), /runtime/);
});

test('release log records versions, commit, sha256, approver, and time', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
  const file = path.join(dir, 'docs', 'function-releases.jsonl');
  const record = v.buildReleaseRecord({
    fn: 'demox-function-api',
    app: '0.2.0',
    runtime: '0.1.0',
    version: '9',
    commit: GIT,
    sha256: SHA_B,
    config: v.configFingerprint(runtime()),
    approver: 'phosa',
    at: '2026-10-14T11:00:00.000Z'
  });
  v.appendReleaseRecord(file, record);
  const line = fs.readFileSync(file, 'utf8').trim();
  assert.deepEqual(JSON.parse(line), record);
  assert.doesNotMatch(line, /JWT_SECRET=|MYSQL_PASSWORD=/);
  assert.throws(() => v.buildReleaseRecord({ ...record, fn: 'demox-function-api', approver: '' }), /批准人/);
});

test('runtime-plan prints bootstrapped versions and placeholder still stops before credentials', () => {
  const plan = execFileSync(process.execPath, ['scripts/ci/scf-function-api.cjs', 'runtime-plan'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(plan, /demox-function-api app=0\.1\.2 runtime=0\.1\.0/);
  assert.match(plan, /demox-user-nodejs app=0\.1\.0 runtime=0\.1\.0/);
  assert.match(plan, /不部署/);
  assert.match(plan, /Chief 批准/);
  assert.doesNotMatch(plan, /缺少凭证|AssumeRole/);

  const entry = v.deployEntry(v.loadManifest());
  assert.doesNotThrow(() => v.assertNotPlaceholder(entry));
  assert.throws(
    () => v.assertNotPlaceholder({ ...entry, appVersion: '0.0.0-placeholder', runtimeVersion: '0.0.0-placeholder' }),
    /占位版本/
  );

  let runtimeOut = '';
  try {
    execFileSync(process.execPath, ['scripts/ci/scf-function-api.cjs', 'deploy', '--with-runtime', '--zip', 'missing.zip'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH }
    });
    assert.fail('expected --with-runtime to be refused');
  } catch (error) {
    runtimeOut = `${error.stdout || ''}\n${error.stderr || ''}`;
    assert.notEqual(error.status, 0);
  }
  assert.match(runtimeOut, /不会在这里自动发布/);
  assert.match(runtimeOut, /Chief 批准/);
  assert.doesNotMatch(runtimeOut, /缺少凭证|AssumeRole/);
});
