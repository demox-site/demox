'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadSystemManifest,
  parseSiteScopedPath,
  resolveSystemFunction,
  createSystemFunctionRouter,
  routeMatches
} = require('./system-router.js');

test('system manifest is copied without sharing mutable arrays', () => {
  const first = loadSystemManifest();
  const second = loadSystemManifest();
  first[0].routePrefixes.push('/mutated');
  first[0].timerTriggers.push('mutated');
  assert.notDeepEqual(first[0].routePrefixes, second[0].routePrefixes);
  assert.notDeepEqual(first[0].timerTriggers, second[0].timerTriggers);
  assert.ok(second.some((entry) => entry.timerTriggers.includes('analytics-rollup-5m')));
});

test('site /api paths stay as function routes instead of website ids', () => {
  assert.equal(parseSiteScopedPath('/api/hello'), null);
  assert.deepEqual(parseSiteScopedPath('/SITE1/production/api/hello'), {
    websiteId: 'SITE1',
    env: 'production',
    rest: '/api/hello'
  });
});

test('system routes match exact prefixes and nested paths, not lookalikes', () => {
  const entries = [{ name: 'auth', routePrefixes: ['/auth'], timerTriggers: [] }];
  assert.equal(resolveSystemFunction({ path: '/auth/login' }, entries).name, 'auth');
  assert.equal(resolveSystemFunction({ path: '/auth/' }, entries).name, 'auth');
  assert.equal(resolveSystemFunction({ body: JSON.stringify({ path: '/auth/login' }) }, entries).name, 'auth');
  assert.equal(resolveSystemFunction({ path: '/authentic' }, entries), null);
  assert.equal(resolveSystemFunction({ path: '/EPX2UU43/production/auth/login' }, entries).name, 'auth');
  assert.equal(routeMatches('/auth/login', '/auth'), true);
  assert.equal(routeMatches('/authentic', '/auth'), false);
});

test('checked-in manifest preserves legacy website and MCP paths', () => {
  const manifest = loadSystemManifest();
  assert.equal(resolveSystemFunction({ path: '/upload' }, manifest).name, 'demox-system-website');
  assert.equal(resolveSystemFunction({ path: '/website/list' }, manifest).name, 'demox-system-website');
  assert.equal(resolveSystemFunction({ path: '/deploy' }, manifest).name, 'demox-system-mcp');
  assert.equal(resolveSystemFunction({ path: '/websites' }, manifest).name, 'demox-system-mcp');
  assert.equal(resolveSystemFunction({ path: '/health' }, manifest).name, 'demox-system-mcp');
  assert.equal(resolveSystemFunction({ path: '/login' }, manifest).name, 'demox-system-mcp');
  assert.equal(resolveSystemFunction({ path: '/delete' }, manifest).name, 'demox-system-mcp');
  assert.equal(resolveSystemFunction({ path: '/website/delete' }, manifest).name, 'demox-system-website');
});

test('system router lazily loads handlers and dispatches timer events', async () => {
  let loads = 0;
  const entries = [{ name: 'rollup', routePrefixes: ['/internal/rollup'], timerTriggers: ['rollup-5m'], sourcePresent: true, handler: 'main' }];
  const router = createSystemFunctionRouter({
    entries,
    loaders: {
      rollup: () => {
        loads += 1;
        return { main: async (event) => ({ statusCode: 200, body: event.TriggerName || event.path }) };
      }
    }
  });
  assert.equal(loads, 0);
  const httpResponse = await router({ path: '/internal/rollup' }, {});
  assert.deepEqual(httpResponse, { statusCode: 200, body: '/internal/rollup' });
  assert.equal(loads, 1);
  const timerResponse = await router({ Type: 'Timer', TriggerName: 'rollup-5m' }, {});
  assert.deepEqual(timerResponse, { statusCode: 200, body: 'rollup-5m' });
  assert.equal(loads, 1);
});

test('missing system source is a controlled migration blocker', async () => {
  const logs = [];
  const router = createSystemFunctionRouter({
    entries: [{
      name: 'cert-renew',
      routePrefixes: [],
      timerTriggers: ['monthly-renew'],
      sourcePresent: false,
      migrationBlocker: 'live source required'
    }],
    logger: { error: (...args) => logs.push(args) }
  });
  const response = await router({ Type: 'timer', TriggerName: 'monthly-renew' }, {});
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, 'SYSTEM_FUNCTION_ERROR');
  assert.equal(JSON.parse(response.body).message, '系统函数暂时不可用');
  assert.equal(logs.length, 1);
});

test('checked-in manifest routes monthly-renew to recovered cert-renew', () => {
  const fs = require('fs');
  const path = require('path');
  const manifest = loadSystemManifest();
  const entry = resolveSystemFunction({ Type: 'Timer', TriggerName: 'monthly-renew' }, manifest);
  assert.equal(entry.name, 'demox-system-cert-renew');
  assert.equal(entry.sourcePresent, true);
  const modulePath = path.join(__dirname, '..', 'cert-renew', entry.entrypoint);
  assert.equal(fs.existsSync(modulePath), true);
  assert.equal(typeof require(modulePath).main, 'function');
});

test('system router rejects source paths outside the package root', async () => {
  const router = createSystemFunctionRouter({
    entries: [{ name: 'escape', routePrefixes: ['/escape'], sourceDir: '../outside', entrypoint: 'index.js', sourcePresent: true }]
  });
  const response = await router({ path: '/escape' }, {});
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, 'SYSTEM_FUNCTION_ERROR');
});
