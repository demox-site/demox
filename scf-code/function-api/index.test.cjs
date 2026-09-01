'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFunctionHttpHandler, createPlatformHandler, main: defaultMain } = require('./index.js');
const { InMemoryBundleStore } = require('./bundle-store.js');
const { InMemoryFunctionRepository } = require('./repository.js');
const { createMysqlFunctionRepository } = require('./repository.js');
const { QuickJSFunctionRuntime } = require('./runtime-quickjs.js');
const { FunctionService } = require('./service.js');

function makeApp({ userId = 'user-1', limits, runtime } = {}) {
  const repository = new InMemoryFunctionRepository();
  const bundleStore = new InMemoryBundleStore();
  const authenticate = () => ({ userId });
  const handler = createFunctionHttpHandler({ repository, bundleStore, runtime, authenticate, publicBaseUrl: 'https://functions.test' });
  return { handler, repository, bundleStore };
}

function event(path, method, body, extra = {}) {
  const url = new URL(path, 'https://functions.test');
  return {
    path: url.pathname,
    httpMethod: method,
    body,
    queryStringParameters: Object.fromEntries(url.searchParams),
    headers: { 'content-type': 'application/json' },
    ...extra
  };
}

const siteA = { websiteId: 'site-a' };

test('default SCF entrypoint refuses unconfigured persistence instead of using memory', async () => {
  const response = await defaultMain(event('/functions', 'GET', {}));
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, 'FUNCTION_SERVICE_NOT_CONFIGURED');
});

test('platform handler routes manifest system paths and timer events before user functions', async () => {
  const calls = [];
  const systemEntries = [{ name: 'system-test', routePrefixes: ['/system'], timerTriggers: ['system-tick'] }];
  const handler = createPlatformHandler({
    systemEntries,
    systemHandler: async (request) => {
      calls.push(['system', request.path || request.TriggerName]);
      return { statusCode: 207, body: 'system' };
    },
    userHandler: async (request) => {
      calls.push(['user', request.path]);
      return { statusCode: 208, body: 'user' };
    }
  });

  assert.equal((await handler(event('/system/check', 'GET', {}))).statusCode, 207);
  assert.equal((await handler({ Type: 'Timer', TriggerName: 'system-tick' })).statusCode, 207);
  assert.equal((await handler({ TriggerName: 'unknown-tick' })).statusCode, 207);
  assert.equal((await handler(event('/functions', 'GET', {}))).statusCode, 208);
  assert.deepEqual(calls, [['system', '/system/check'], ['system', 'system-tick'], ['system', 'unknown-tick'], ['user', '/functions']]);
});

test('creates, versions, publishes and invokes a function through one shared handler', async () => {
  const { handler } = makeApp();
  const createdResponse = await handler(event('/functions', 'POST', { ...siteA, name: 'Hello', slug: 'hello', env: { GREETING: 'hi' } }));
  assert.equal(createdResponse.statusCode, 201);
  const created = JSON.parse(createdResponse.body).function;
  assert.match(created.functionId, /^fn_/);
  assert.equal(created.invokeUrl, 'https://functions.test/site-a/production/api/hello');

  const source = `export default async function(request, env) {
    return { status: 201, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ greeting: env.GREETING, input: request.body }) };
  }`;
  const versionResponse = await handler(event(`/functions/${created.functionId}/versions`, 'POST', { source }));
  assert.equal(versionResponse.statusCode, 201);
  const version = JSON.parse(versionResponse.body).version;
  assert.equal(version.version, 1);

  const publishResponse = await handler(event(`/functions/${created.functionId}/publish`, 'POST', { version: 1 }));
  assert.equal(publishResponse.statusCode, 200);
  assert.equal(JSON.parse(publishResponse.body).function.publishedVersion, 1);

  const invokeResponse = await handler(event(`/functions/${created.functionId}/invoke`, 'POST', { hello: 'world' }));
  assert.equal(invokeResponse.statusCode, 201);
  assert.deepEqual(JSON.parse(invokeResponse.body), { greeting: 'hi', input: { hello: 'world' } });

  const siteApiResponse = await handler(event('/site-a/production/api/hello', 'POST', { hello: 'world' }));
  assert.equal(siteApiResponse.statusCode, 201);
  assert.deepEqual(JSON.parse(siteApiResponse.body), { greeting: 'hi', input: { hello: 'world' } });

  const sourceResponse = await handler(event(`/functions/${created.functionId}/source`, 'GET'));
  assert.equal(sourceResponse.statusCode, 200);
  assert.equal(JSON.parse(sourceResponse.body).source, source);
});

test('does not allow another user to manage a function', async () => {
  const first = makeApp({ userId: 'owner' });
  const created = JSON.parse((await first.handler(event('/functions', 'POST', { ...siteA, name: 'Private', slug: 'private' }))).body).function;
  const second = makeApp({ userId: 'other' });
  // Reuse the repository/store to isolate the ownership check from routing.
  const secondHandler = createFunctionHttpHandler({
    repository: first.repository,
    bundleStore: first.bundleStore,
    authenticate: () => ({ userId: 'other' }),
    publicBaseUrl: 'https://functions.test'
  });
  const response = await secondHandler(event(`/functions/${created.functionId}/versions`, 'POST', { source: 'export default () => "nope"' }));
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).error, 'FORBIDDEN');
  assert.ok(second);
});

test('rejects missing management auth while keeping invocation public', async () => {
  const repository = new InMemoryFunctionRepository();
  const bundleStore = new InMemoryBundleStore();
  const service = new FunctionService({ repository, bundleStore, runtime: new QuickJSFunctionRuntime() });
  const record = await service.createFunction({ ownerId: 'owner', websiteId: 'site-a', name: 'Public', slug: 'public' });
  await service.createVersion({ ownerId: 'owner', functionId: record.functionId, source: 'module.exports = () => "ok"' });
  await service.publishVersion({ ownerId: 'owner', functionId: record.functionId, version: 1 });
  const handler = createFunctionHttpHandler({ repository, bundleStore, runtime: new QuickJSFunctionRuntime(), authenticate: () => null });
  const management = await handler(event('/functions', 'GET', {}));
  assert.equal(management.statusCode, 401);
  const invocation = await handler(event(`/functions/${record.functionId}/invoke`, 'GET', undefined, { headers: {} }));
  assert.equal(invocation.statusCode, 200);
  assert.equal(invocation.body, 'ok');
});

test('enforces request, response and rate limits', async () => {
  const repository = new InMemoryFunctionRepository();
  const bundleStore = new InMemoryBundleStore();
  const service = new FunctionService({ repository, bundleStore, runtime: new QuickJSFunctionRuntime() });
  const record = await service.createFunction({
    ownerId: 'owner', websiteId: 'site-a', name: 'Limited', slug: 'limited',
    limits: { maxBodyBytes: 4, maxResponseBytes: 4, maxInvocationsPerMinute: 10 }
  });
  await service.createVersion({ ownerId: 'owner', functionId: record.functionId, source: 'module.exports = () => "12345"' });
  await service.publishVersion({ ownerId: 'owner', functionId: record.functionId, version: 1 });
  await assert.rejects(
    service.invoke({ functionId: record.functionId, event: { httpMethod: 'POST', body: '12345', headers: {} } }),
    (error) => error.code === 'REQUEST_TOO_LARGE'
  );
  await assert.rejects(
    service.invoke({ functionId: record.functionId, event: { httpMethod: 'GET', headers: {} } }),
    (error) => error.code === 'RESPONSE_TOO_LARGE'
  );
  const normal = await service.createFunction({ ownerId: 'owner', websiteId: 'site-a', name: 'Rate', slug: 'rate', limits: { maxInvocationsPerMinute: 1 } });
  await service.createVersion({ ownerId: 'owner', functionId: normal.functionId, source: 'module.exports = () => "ok"' });
  await service.publishVersion({ ownerId: 'owner', functionId: normal.functionId, version: 1 });
  await service.invoke({ functionId: normal.functionId, event: { httpMethod: 'GET', headers: {} } });
  await assert.rejects(
    service.invoke({ functionId: normal.functionId, event: { httpMethod: 'GET', headers: {} } }),
    (error) => error.code === 'RATE_LIMITED'
  );
});

test('QuickJS runtime blocks imports and interrupts infinite loops', async () => {
  const runtime = new QuickJSFunctionRuntime();
  await assert.rejects(
    runtime.execute({
      source: 'import fs from "node:fs"; export default () => fs.readFileSync("/etc/passwd")',
      request: {}, env: {}, limits: { timeoutMs: 1000, memoryLimitBytes: 16 * 1024 * 1024, maxCodeBytes: 10000 }
    }),
    (error) => error.code === 'FUNCTION_COMPILE_ERROR'
  );
  await assert.rejects(
    runtime.execute({
      source: 'export default () => { while (true) {} }',
      request: {}, env: {}, limits: { timeoutMs: 20, memoryLimitBytes: 16 * 1024 * 1024, maxCodeBytes: 10000 }
    }),
    (error) => error.code === 'FUNCTION_TIMEOUT'
  );
});

test('MySQL adapter keeps version allocation and publication behind repository methods', async () => {
  const queries = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (/FROM demox_functions WHERE function_id/.test(sql)) {
      return [{
        function_id: 'fn_abcdefghijk', owner_user_id: 'owner', website_id: 'site-a', name: 'Hello', slug: 'hello', status: 'active', published_version: null,
        timeout_ms: 1000, memory_limit_bytes: 16777216, max_body_bytes: 65536, max_response_bytes: 262144,
        max_code_bytes: 262144, max_invocations_per_minute: 60, env_json: '{}', allowed_outbound_hosts_json: '[]'
      }];
    }
    return [];
  };
  const transaction = async (callback) => callback({
    query: async (sql) => {
      if (/FROM demox_functions WHERE function_id/.test(sql)) return [[{ id: 1 }]];
      if (/COALESCE\(MAX/.test(sql)) return [[{ latest: 0 }]];
      if (/SELECT id, function_id/.test(sql)) return [[{ id: 1, function_id: 'fn_abcdefghijk', version: 1, bundle_key: 'functions/fn_abcdefghijk/1/bundle.mjs', sha256: 'a'.repeat(64), size_bytes: 10, entrypoint: 'index.mjs', status: 'draft', created_at: new Date() }]];
      return [[]];
    }
  });
  const repository = createMysqlFunctionRepository({ query, transaction });
  const created = await repository.createVersion({
    functionId: 'fn_abcdefghijk', sha256: 'a'.repeat(64), sizeBytes: 10,
    bundleKeyFactory: (version) => `functions/fn_abcdefghijk/${version}/bundle.mjs`
  });
  assert.equal(created.version, 1);
  assert.equal(created.bundleKey, 'functions/fn_abcdefghijk/1/bundle.mjs');
  assert.ok(queries.some((item) => /FROM demox_functions WHERE function_id/.test(item.sql)) === false);
});

test('published bundle checksum is verified again at invocation time', async () => {
  const repository = new InMemoryFunctionRepository();
  const bundleStore = new InMemoryBundleStore();
  const service = new FunctionService({ repository, bundleStore, runtime: new QuickJSFunctionRuntime() });
  const record = await service.createFunction({ ownerId: 'owner', websiteId: 'site-a', name: 'Checksum', slug: 'checksum' });
  await service.createVersion({ ownerId: 'owner', functionId: record.functionId, source: 'module.exports = () => "ok"' });
  await service.publishVersion({ ownerId: 'owner', functionId: record.functionId, version: 1 });
  const version = await repository.getVersion(record.functionId, 1);
  bundleStore.objects.set(version.bundleKey, Buffer.from('tampered'));
  await assert.rejects(
    service.invoke({ functionId: record.functionId, event: { httpMethod: 'GET', headers: {} } }),
    (error) => error.code === 'BUNDLE_CHECKSUM_MISMATCH'
  );
});

test('default platform manifest keeps monthly-renew on the system path', async () => {
  const { loadSystemManifest, resolveSystemFunction } = require('./system-router.js');
  const calls = [];
  const handler = createPlatformHandler({
    systemEntries: loadSystemManifest(),
    systemHandler: async (request) => {
      calls.push(request.TriggerName || request.path);
      return { statusCode: 204, body: '' };
    },
    userHandler: async () => ({ statusCode: 418, body: 'user' })
  });
  const response = await handler({ Type: 'Timer', TriggerName: 'monthly-renew' });
  assert.equal(response.statusCode, 204);
  assert.deepEqual(calls, ['monthly-renew']);
  assert.equal(resolveSystemFunction({ Type: 'Timer', TriggerName: 'monthly-renew' }).name, 'demox-system-cert-renew');
});

test('functions belong to a website and keep slugs unique per site', async () => {
  const { handler } = makeApp();
  const first = JSON.parse((await handler(event('/functions', 'POST', { websiteId: 'site-a', name: 'Hello', slug: 'hello' }))).body).function;
  assert.equal(first.websiteId, 'site-a');
  const second = await handler(event('/functions', 'POST', { websiteId: 'site-b', name: 'Hello', slug: 'hello' }));
  assert.equal(second.statusCode, 201);
  const duplicate = await handler(event('/functions', 'POST', { websiteId: 'site-a', name: 'Other', slug: 'hello' }));
  assert.equal(duplicate.statusCode, 400);
  const listed = JSON.parse((await handler(event('/functions?websiteId=site-a', 'GET'))).body).functions;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].functionId, first.functionId);
  const listedByPath = JSON.parse((await handler(event('/site-a/production/functions', 'GET'))).body).functions;
  assert.equal(listedByPath.length, 1);
  assert.equal(listedByPath[0].functionId, first.functionId);
  const listedByQueryString = JSON.parse((await handler({
    path: '/functions',
    httpMethod: 'GET',
    queryString: 'websiteId=site-a',
    headers: { 'content-type': 'application/json' }
  })).body).functions;
  assert.equal(listedByQueryString.length, 1);
  const missingSite = await handler(event('/functions', 'POST', { name: 'Nope', slug: 'nope' }));
  assert.equal(missingSite.statusCode, 400);
  assert.equal(JSON.parse(missingSite.body).error, 'MISSING_WEBSITE_ID');
});

test('unified MCP deploy dispatches to the website system function in process', async () => {
  process.env.AUTH_API_URL = process.env.AUTH_API_URL || 'https://auth.example.test';
  process.env.WEBSITE_API_URL = process.env.WEBSITE_API_URL || 'https://website.example.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-for-proxy-tests';
  const { sign } = require('../mcp-api/shared/jwt.js');
  const calls = [];
  const handler = createPlatformHandler({
    systemRouterOptions: {
      loaders: {
        'demox-system-website': () => ({
          main: async (request) => {
            calls.push({ path: request.path, body: request.body });
            return { statusCode: 200, body: JSON.stringify({ ok: true }) };
          }
        }),
        'demox-system-auth': () => ({ main: async () => ({ statusCode: 200, body: '{}' }) }),
        'demox-system-cert-renew': () => ({ main: async () => ({ statusCode: 204, body: '' }) })
      }
    },
    userHandler: async () => ({ statusCode: 418, body: 'user' })
  });
  const response = await handler(event('/deploy', 'POST', {
    action: 'init_deploy_upload',
    fileName: 'site.zip',
    websiteId: 'HF4ODMTF',
    totalSize: 1,
    sha256: 'a'.repeat(64),
    requestId: 'r1'
  }, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sign({ userId: 'user-1' })}`
    }
  }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
  assert.equal(calls[0].path, '/upload');
  assert.equal(calls[0].body.action, 'init_deploy_upload');
});

test('site-scoped paths dispatch to the same backends as /auth /website /deploy', async () => {
  const calls = [];
  const handler = createPlatformHandler({
    systemEntries: [
      { name: 'demox-system-auth', routePrefixes: ['/auth'] },
      { name: 'demox-system-website', routePrefixes: ['/website'] }
    ],
    systemHandler: async (request) => {
      calls.push(request.path);
      return { statusCode: 200, body: request.path };
    },
    userHandler: async () => ({ statusCode: 418, body: 'user' })
  });
  assert.equal((await handler(event('/EPX2UU43/production/auth/login', 'POST'))).body, '/auth/login');
  assert.equal((await handler(event('/EPX2UU43/production/website/list', 'POST'))).body, '/website/list');
  assert.deepEqual(calls, ['/auth/login', '/website/list']);
});

test('platform site lists Demox system functions without touching user storage', async () => {
  const { handler } = makeApp();
  const platform = JSON.parse((await handler(event('/functions?kind=system&host=www.demox.site', 'GET'))).body);
  assert.equal(platform.functions.length, 4);
  assert.equal(platform.functions[0].kind, 'site');
  assert.equal(platform.functions[0].editable, false);
  assert.ok(platform.functions.some((item) => item.slug === 'system-auth' && item.invokeUrl === 'https://functions.test/EPX2UU43/production/auth'));
  const other = JSON.parse((await handler(event('/functions?kind=system&host=blog.example', 'GET'))).body);
  assert.deepEqual(other.functions, []);
});

test('system function list does not require a management token', async () => {
  const handler = createFunctionHttpHandler({
    repository: new InMemoryFunctionRepository(),
    bundleStore: new InMemoryBundleStore(),
    runtime: new QuickJSFunctionRuntime(),
    authenticate: () => {
      throw new Error('should not authenticate');
    },
    publicBaseUrl: 'https://functions.test'
  });
  const response = await handler(event('/functions?kind=system&host=www.demox.site', 'GET'));
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).functions.length, 4);
});

test('maps function failures to gateway errors without exposing host details', async () => {
  const { handler } = makeApp();
  const created = JSON.parse((await handler(event('/functions', 'POST', { ...siteA, name: 'Failure', slug: 'failure' }))).body).function;
  await handler(event(`/functions/${created.functionId}/versions`, 'POST', { source: 'module.exports = () => { throw new Error("secret host path") }' }));
  await handler(event(`/functions/${created.functionId}/publish`, 'POST', { version: 1 }));
  const response = await handler(event(`/functions/${created.functionId}/invoke`, 'GET', undefined, { headers: {} }));
  assert.equal(response.statusCode, 502);
  const payload = JSON.parse(response.body);
  assert.equal(payload.error, 'FUNCTION_EXECUTION_ERROR');
  assert.equal(payload.message, '函数执行失败');
  assert.doesNotMatch(response.body, /secret host path/);
});
