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
  openNetwork,
  resolvePreprodLimits,
  parseBannedPath,
  isReservedIPv4,
  runBannedEnvSelfTest,
  verdict,
  guardRouteOnlyDifference,
  httpBypassReason,
  liveIsPreFunction301,
  createHandle,
  invoke,
  WWW_ASSET_CACHE
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

test('published router www POST is GET to origin and returns the homepage', async () => {
  const liveSource = loadLiveSource();
  assert.match(liveSource, /function wwwDocumentMethod/);
  assert.match(liveSource, /function wwwUnsignedDocumentInit/);
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

test('preprod request cap and interval clamp to the allowed range', () => {
  assert.deepEqual(
    (({ cap, gap, clamped }) => ({ cap, gap, clamped }))(resolvePreprodLimits({})),
    { cap: 240, gap: 80, clamped: false }
  );
  const high = resolvePreprodLimits({ DEMOX_PREPROD_MAX_REQUESTS: '900', DEMOX_PREPROD_GAP_MS: '10' });
  assert.equal(high.cap, 300);
  assert.equal(high.gap, 50);
  assert.equal(high.clamped, true);
  const inside = resolvePreprodLimits({ DEMOX_PREPROD_MAX_REQUESTS: '100', DEMOX_PREPROD_GAP_MS: '120' });
  assert.equal(inside.cap, 100);
  assert.equal(inside.gap, 120);
  assert.equal(inside.clamped, false);
});

test('reserved resolver answers and a banned id from DEMOX_BANNED_PATH', async () => {
  assert.equal(isReservedIPv4('198.18.0.1'), true);
  assert.equal(isReservedIPv4('10.0.0.1'), true);
  assert.equal(isReservedIPv4('127.0.0.1'), true);
  assert.equal(isReservedIPv4('43.169.13.139'), false);
  assert.equal(parseBannedPath('/sites/owner-9/VMPZGKSR/dist/index.html').id, 'VMPZGKSR');
  const previous = process.env.DEMOX_BANNED_PATH;
  process.env.DEMOX_BANNED_PATH = '/sites/owner-9/VMPZGKSR/dist/index.html';
  try {
    const parsed = await runBannedEnvSelfTest(process.env.DEMOX_BANNED_PATH);
    assert.equal(parsed.id, 'VMPZGKSR');
  } finally {
    if (previous == null) delete process.env.DEMOX_BANNED_PATH;
    else process.env.DEMOX_BANNED_PATH = previous;
  }
});

test('real-network open refuses EO hosts and unknown hosts', async () => {
  await assert.rejects(() => openNetwork('sites.demox.site', 'https://sites.demox.site/', 'GET', {}), /EO host/);
  await assert.rejects(() => openNetwork('evil.example', 'https://evil.example/', 'GET', {}), /allowlisted/);
});

test('www cache change matches the origin directive set; no-store is unexpected', () => {
  const asset = {
    scheme: 'https', host: 'www.demox.site', method: 'GET', path: '/assets/index-DxCBZomZ.js', cookie: false, kind: 'noid'
  };
  const old = { status: 200, sha: 'abc', cache: 'public, max-age=60' };
  assert.equal(verdict(asset, old, { status: 200, sha: 'abc', cache: 'immutable, public, max-age=31536000' }, []), 'expected-cache-change');
  assert.equal(verdict(asset, old, { status: 200, sha: 'abc', cache: 'no-store' }, []), 'unexpected');
  assert.equal(verdict(asset, old, { status: 200, sha: 'abc', cache: 'private, max-age=31536000, immutable' }, []), 'unexpected');
  const html = {
    scheme: 'https', host: 'www.demox.site', method: 'GET', path: '/index.html', cookie: false, kind: 'public'
  };
  assert.equal(verdict(html, { status: 200, sha: 'abc', cache: 'public, max-age=10' }, { status: 200, sha: 'abc', cache: 'max-age=60, public' }, []), 'expected-cache-change');
  assert.equal(verdict(html, old, { status: 200, sha: 'abc', cache: 'public, max-age=30' }, []), 'unexpected');
  assert.equal(verdict(
    { scheme: 'https', host: 'coverage.demox.site', method: 'GET', path: '/', cookie: false, kind: 'public' },
    old,
    { status: 200, sha: 'abc', cache: WWW_ASSET_CACHE },
    []
  ), 'unexpected');
});

test('NOSUCH01 HEAD is an empty body while GET still has one', async () => {
  const handle = createHandle(loadNextSource(), { secret: false });
  const head = await invoke(handle, 'https://sites.demox.site/sites/owner-1/NOSUCH01/dist/index.html', 'HEAD', '');
  assert.equal(head.status, 404);
  assert.equal(head.length, 0);
  assert.equal(head.cache, 'no-store');
  const get = await invoke(handle, 'https://sites.demox.site/sites/owner-1/NOSUCH01/dist/index.html', 'GET', '');
  assert.equal(get.status, 404);
  assert.ok(get.length > 0);
  assert.equal(get.cache, 'no-store');
});

test('guard internal and allow match only with identical status, cache, length, and sha', () => {
  const live = {
    status: 200,
    route: 'origin-guard=internal',
    cache: 'public, max-age=60',
    length: 8,
    sha: 'abc'
  };
  const local = {
    status: 200,
    route: 'origin-guard=allow',
    cache: 'public, max-age=60',
    length: 8,
    sha: 'abc'
  };
  assert.equal(guardRouteOnlyDifference(live, local), true);
  assert.equal(guardRouteOnlyDifference(live, Object.assign({}, local, { sha: 'def' })), false);
  assert.equal(guardRouteOnlyDifference(live, Object.assign({}, local, { cache: 'no-store' })), false);
  assert.equal(guardRouteOnlyDifference(live, Object.assign({}, local, { length: 9 })), false);
  assert.equal(guardRouteOnlyDifference(live, Object.assign({}, local, { status: 404 })), false);
  assert.equal(guardRouteOnlyDifference(live, Object.assign({}, local, { route: 'origin-guard=deny' })), false);
});

test('site-3 http is excluded by hostname; any other non-301 http row fails closed', () => {
  assert.match(httpBypassReason('site-3.demox.site'), /不经过边缘函数/);
  assert.equal(httpBypassReason('www.demox.site'), '');
  assert.equal(httpBypassReason('sites.demox.site'), '');
  assert.equal(liveIsPreFunction301({
    status: 301,
    headers: new Headers({ location: 'https://www.demox.site/' })
  }), true);
  assert.equal(liveIsPreFunction301({
    status: 200,
    headers: new Headers({ location: 'https://www.demox.site/' })
  }), false);
  assert.equal(liveIsPreFunction301({
    status: 302,
    headers: new Headers({ location: 'https://www.demox.site/' })
  }), false);
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
  const guarded = report.results.filter((item) => item.row.kind === 'banned' || item.row.kind === 'private' || item.row.kind === 'lookup');
  assert.ok(guarded.length > 0);
  assert.ok(guarded.every((item) => item.mark === 'same' && item.oldR.status === item.newR.status));
  const missing = report.results.filter((item) => item.mark === 'missing-site-404');
  assert.ok(missing.length > 0, 'unknown site ids must be classified missing-site-404');
  for (const item of missing) {
    assert.equal(item.newR.status, 404);
    assert.equal(String(item.newR.cache).toLowerCase(), 'no-store');
    assert.equal(item.newR.cdnCache || '', '');
    assert.equal(item.newR.expires || '', '');
  }
  assert.ok(report.same.some((item) => item.row.host === 'www.demox.site' && item.row.method === 'POST' && item.row.path === '/'));
  assert.ok(report.same.some((item) => item.row.host === 'www.demox.site' && item.row.method === 'OPTIONS' && item.row.path === '/'));
});
