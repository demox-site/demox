'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HOMEPAGE,
  BUCKET1_COS,
  loadLiveSource,
  loadNextSource,
  runOfflineMatrix,
  runWwwChain,
  openNetwork
} = require('../scripts/edge/preprod-diff.cjs');

test('www re-entry sends GET to COS and returns the homepage for POST/PUT/OPTIONS', async () => {
  const next = await runWwwChain(loadNextSource(), 'strict');
  assert.equal(next.GET.status, 200);
  assert.equal(next.GET.body, HOMEPAGE);
  assert.deepEqual(next.GET.cos, ['GET']);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    assert.equal(next[method].status, 200, method);
    assert.equal(next[method].body, HOMEPAGE, method);
    assert.deepEqual(next[method].cos, ['GET'], method + ' must not be forwarded to COS');
  }
  assert.equal(next.HEAD.status, 200);
  assert.equal(next.HEAD.body, '');
  assert.deepEqual(next.HEAD.cos, ['HEAD']);
  assert.match(next.OPTIONS.route, /origin-guard=(internal|allow)/);
});

test('live 0e706f11 fetch(url, req) is sent as GET and www POST is the homepage', async () => {
  const liveSource = loadLiveSource();
  assert.match(liveSource, /originFetch\(buildOriginUrl\(req, originPath, u\.search, originHost\), req\)/);
  const live = await runWwwChain(liveSource, 'strict');
  for (const method of ['POST', 'PUT', 'OPTIONS']) {
    assert.deepEqual(live[method].cos, ['GET'], method);
    assert.equal(live[method].status, 200, method);
    assert.equal(live[method].body, HOMEPAGE, method);
    assert.equal(live[method].hops.some((hop) => hop.via === 'network'), false, method);
    assert.ok(live[method].hops.some((hop) => hop.via === 'local-router' && hop.host === 'sites.demox.site' && hop.method === 'GET'), method);
  }
  assert.equal(live.GET.status, 200);
  assert.equal(live.GET.body, HOMEPAGE);
});

test('www without a guard secret still fetches the document as GET', async () => {
  const next = await runWwwChain(loadNextSource(), 'strict', { secret: false });
  assert.equal(next.POST.status, 200);
  assert.equal(next.POST.body, HOMEPAGE);
  assert.deepEqual(next.POST.cos, ['GET']);
  assert.equal(next.HEAD.body, '');
  assert.deepEqual(next.HEAD.cos, ['HEAD']);
  assert.ok(next.POST.hops.some((hop) => hop.via === 'local-router' && hop.method === 'GET'));
  assert.ok(next.POST.hops.some((hop) => hop.via === 'mock-origin' && hop.host === BUCKET1_COS));
  assert.equal(next.POST.hops.some((hop) => hop.via === 'network'), false);
});

test('real-network open refuses EO hosts and unknown hosts', async () => {
  await assert.rejects(() => openNetwork('sites.demox.site', 'https://sites.demox.site/', 'GET', {}), /EO host/);
  await assert.rejects(() => openNetwork('evil.example', 'https://evil.example/', 'GET', {}), /allowlisted/);
});

test('offline p0 matrix has no unexpected diff against the live body', async () => {
  const report = await runOfflineMatrix();
  if (report.unexpected.length) {
    const sample = report.unexpected.slice(0, 8).map((item) => {
      const row = item.row;
      return row.scheme + ' ' + row.method + ' ' + row.host + row.path + ' old=' + item.oldR.status + ' new=' + item.newR.status;
    });
    assert.fail('unexpected diffs\n' + sample.join('\n'));
  }
  assert.equal(report.unexpected.length, 0);
  assert.ok(report.expected.length > 0, 'banned and lookup rows must differ');
  assert.ok(report.same.some((item) => item.row.host === 'www.demox.site' && item.row.method === 'POST' && item.row.path === '/'));
  assert.ok(report.same.some((item) => item.row.host === 'www.demox.site' && item.row.method === 'OPTIONS' && item.row.path === '/'));
});
