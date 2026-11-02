'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  EXECUTABLE_SUFFIXES,
  EXECUTABLE_FILE_CODE,
  executableSuffix,
  findExecutableFile,
  findExecutableZipEntry,
  executableRejectMessage,
  summarizeExecutableKeys
} = require('./executable-files.js');
const inventory = require('../../../scripts/inventory-executable-sites.cjs');

const ROOT = path.join(__dirname, '../../..');
const FIXTURE = path.join(ROOT, 'scripts/fixtures/executable-site-keys.json');

test('website-api inlines the executable matcher (functions push only ships index.js)', () => {
  const mod = fs.readFileSync(path.join(__dirname, 'executable-files.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
  const body = mod.slice(mod.indexOf('const EXECUTABLE_SUFFIXES'), mod.indexOf('module.exports')).trim();
  assert.ok(body.includes('function summarizeExecutableKeys'));
  assert.ok(index.includes(body), 'index.js must inline executable-files.js verbatim');
  assert.equal(index.includes("require('./shared/executable-files.js')"), false);
});

test('suffix match is case-insensitive and ignores lookalikes', () => {
  assert.deepEqual(EXECUTABLE_SUFFIXES, ['.exe', '.msi', '.dmg', '.apk', '.bat', '.ps1']);
  assert.equal(EXECUTABLE_FILE_CODE, 'EXECUTABLE_FILE_REJECTED');
  for (const suffix of EXECUTABLE_SUFFIXES) {
    assert.equal(executableSuffix(`bin/Setup${suffix.toUpperCase()}`), suffix);
    assert.equal(executableSuffix(`setup${suffix}.`), suffix);
    assert.equal(executableSuffix(`setup${suffix} `), suffix);
  }
  assert.equal(executableSuffix('app.js'), '');
  assert.equal(executableSuffix('file.exe.txt'), '');
  assert.equal(executableSuffix('run.BAT.bak'), '');
  assert.equal(executableSuffix('payload.exe.zip'), '');
  assert.equal(executableSuffix('sites/u/SITE/app.exe/index.html'), '');
  assert.equal(executableSuffix('setup．exe'), '.exe');
  assert.equal(executableSuffix('dir/file.exe%00.txt'), '.exe');
  assert.equal(executableSuffix('report%2Epdf'), '');
});

test('zip members are rejected with a short Chinese reason and a GitHub Releases hint', () => {
  const outer = findExecutableFile('Setup.EXE');
  assert.equal(outer.inArchive, false);
  assert.match(executableRejectMessage(outer), /发布失败：Setup\.EXE 是可执行文件（\.exe）/);
  assert.match(executableRejectMessage(outer), /GitHub Releases/);
  assert.match(executableRejectMessage(outer), /外部下载链接/);

  const packed = findExecutableZipEntry([
    { entryName: 'index.html', isDirectory: false },
    { entryName: 'tools.exe/', isDirectory: true },
    { entryName: '__MACOSX/._app.exe', isDirectory: false },
    { entryName: 'payload/setup.msi', isDirectory: false }
  ]);
  assert.equal(packed.fileName, '__MACOSX/._app.exe');
  assert.equal(packed.inArchive, true);
  assert.match(executableRejectMessage(packed), /压缩包内的 __MACOSX\/\._app\.exe/);

  assert.equal(findExecutableZipEntry([
    { entryName: 'index.html', isDirectory: false },
    { entryName: 'app.js', isDirectory: false },
    { entryName: 'tools.exe/', isDirectory: true }
  ]), null);
  assert.equal(findExecutableFile('dist.zip'), null);
});

test('offline fixture counts sites, not non-site keys', () => {
  const keys = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).keys;
  const report = summarizeExecutableKeys(keys);
  assert.equal(report.mutate, false);
  assert.equal(report.siteCount, 4);
  assert.equal(report.objectCount, 7);
  assert.equal(report.ignoredNonSite, 2);
  assert.deepEqual(report.suffixCounts, {
    '.exe': 1,
    '.msi': 2,
    '.dmg': 1,
    '.apk': 1,
    '.bat': 1,
    '.ps1': 1
  });
  assert.deepEqual(report.sites.map((site) => site.websiteId), ['SITE0001', 'SITE0003', 'SITE0005', 'SITE0006']);
  assert.deepEqual(report.sites[0].sampleKeys, [
    'sites/u1/SITE0001/dist/app.EXE',
    'sites/u1/SITE0001/dist/tool.PS1'
  ]);
});

test('inventory script dry-run and fixture do not list or mutate', () => {
  let listed = 0;
  const dry = inventory.main([], {}, {
    stdout: () => {},
    stderr: () => {},
    listObjects: async () => { listed += 1; return []; }
  });
  return dry.then((code) => {
    assert.equal(code, 0);
    assert.equal(listed, 0);
    const secret = 'unit-test-secret-value';
    let err = '';
    return inventory.main(['--live'], { COS_SECRET_KEY: secret }, {
      stdout: () => {},
      stderr: (text) => { err += text; },
      listObjects: async () => { listed += 1; return []; }
    }).then((liveCode) => {
      assert.equal(liveCode, 2);
      assert.equal(listed, 0);
      assert.equal(err.includes(secret), false);
      assert.match(err, /未访问云端/);
    });
  });
});

test('inventory --live summarizes injected keys and blocks write methods', async () => {
  const secret = 'live-test-secret-value';
  let seen = null;
  let out = '';
  const code = await inventory.main(['--live', '--bucket', 'resource-game-1307257815'], {
    COS_SECRET_ID: 'test-secret-id',
    COS_SECRET_KEY: secret
  }, {
    stdout: (text) => { out += text; },
    stderr: (text) => { throw new Error(text); },
    listObjects: async (opts) => {
      seen = { ...opts, secretKey: opts.secretKey ? 'present' : '' };
      return ['sites/u1/SITE0001/dist/app.exe', 'sites/u1/SITE0001/dist/index.html'];
    }
  });
  assert.equal(code, 0);
  assert.equal(seen.secretKey, 'present');
  assert.equal(seen.bucket, 'resource-game-1307257815');
  assert.equal(out.includes(secret), false);
  const report = JSON.parse(out);
  assert.equal(report.mode, 'live');
  assert.equal(report.mutate, false);
  assert.equal(report.siteCount, 1);
  assert.equal(report.objectCount, 1);

  const calls = [];
  class FakeCos {
    getBucket(params, callback) {
      calls.push(params.Marker || '');
      const page = params.Marker
        ? { Contents: [{ Key: 'sites/u/S/b.bat' }], IsTruncated: false }
        : { Contents: [{ Key: 'sites/u/S/a.exe' }], IsTruncated: true, NextMarker: 'sites/u/S/a.exe' };
      callback(null, page);
    }

    deleteObject() {
      throw new Error('delete should be locked');
    }
  }
  const locked = { deleteObject() { return 'deleted'; }, getBucket() {} };
  inventory.lockReadOnly(locked);
  assert.throws(() => locked.deleteObject(), /read-only/);

  const keys = await inventory.listAllObjects({
    Cos: FakeCos,
    secretId: 'id',
    secretKey: 'secret',
    bucket: 'resource-game-1307257815',
    region: 'ap-chengdu',
    prefix: 'sites/'
  });
  assert.deepEqual(keys, ['sites/u/S/a.exe', 'sites/u/S/b.bat']);
  assert.deepEqual(calls, ['', 'sites/u/S/a.exe']);
  await assert.rejects(
    () => inventory.listAllObjects({
      Cos: FakeCos,
      secretId: 'id',
      secretKey: 'secret',
      bucket: 'b',
      region: 'ap-chengdu',
      prefix: ''
    }),
    /sites\//
  );
});

test('inventory CLI fixture matches the read-only report and refuses deletes', () => {
  const run = (args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/inventory-executable-sites.cjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  const fixture = run(['--fixture', 'scripts/fixtures/executable-site-keys.json']);
  assert.equal(fixture.status, 0, fixture.stderr);
  const report = JSON.parse(fixture.stdout);
  assert.equal(report.mode, 'fixture');
  assert.equal(report.mutate, false);
  assert.equal(report.live, false);
  assert.equal(report.siteCount, 4);
  assert.equal(report.objectCount, 7);
  const dry = run([]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).siteCount, null);
  const removed = run(['--delete']);
  assert.equal(removed.status, 2);
  assert.match(removed.stderr, /只读/);
});
