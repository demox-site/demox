'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const logGuard = require('../../scripts/log-leak-guard.cjs').installLogLeakGuard();
const { InMemoryBundleStore } = require('./bundle-store.js');
const { InMemoryFunctionRepository } = require('./repository.js');
const { createFunctionHttpHandler, createPlatformHandler } = require('./index.js');

const PLATFORM_ID = 'EPX2UU43';
const IN_PROCESS_BODY = JSON.stringify({
  success: false,
  error: 'NOT_FOUND',
  availableEndpoints: ['/health']
});
const CLOSED_PREFIX = {
  FUNCTIONS_PLATFORM_RUNTIME_PREFIXES: undefined,
  FUNCTIONS_PLATFORM_SITE_MODE: undefined,
  DEMOX_PLATFORM_WEBSITE_ID: undefined
};

function withEnv(extra, fn) {
  const previous = {};
  for (const key of Object.keys(extra)) {
    previous[key] = process.env[key];
    if (extra[key] == null) delete process.env[key];
    else process.env[key] = extra[key];
  }
  const finish = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') return result.finally(finish);
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}

function captureLogger() {
  const warnings = [];
  return {
    warnings,
    warn(...args) { warnings.push(args); },
    error() {}
  };
}

function fallbackWarn(logger) {
  return logger.warnings.filter((item) => item[0] === 'platform publish fallback');
}

async function harness({ execute } = {}) {
  const repository = new InMemoryFunctionRepository();
  const bundleStore = new InMemoryBundleStore();
  const executed = [];
  const userHandler = createFunctionHttpHandler({
    repository,
    bundleStore,
    runtime: {
      async execute(opts) {
        executed.push(opts);
        if (execute) return execute(opts);
        return { status: 200, headers: {}, body: JSON.stringify({ from: 'pool' }) };
      }
    },
    authenticate: () => ({ userId: 'owner-1' }),
    businessCredentials: {
      async credentialsFor() {
        return {
          TENCENTCLOUD_SECRETID: 'ses-id',
          TENCENTCLOUD_SECRETKEY: 'ses-key',
          TENCENTCLOUD_SESSIONTOKEN: 'ses-token'
        };
      }
    }
  });
  const logger = captureLogger();
  let systemCalls = 0;
  const platform = createPlatformHandler({
    userHandler,
    logger,
    systemHandler: async () => {
      systemCalls += 1;
      return {
        statusCode: 404,
        headers: { 'content-type': 'application/json', 'x-demox-dispatch': 'spoofed-by-handler' },
        body: IN_PROCESS_BODY
      };
    }
  });
  return {
    platform,
    service: userHandler.service,
    bundleStore,
    executed,
    logger,
    systemCalls: () => systemCalls
  };
}

async function publishMcp(service) {
  const created = await service.createFunction({
    ownerId: 'owner-1',
    websiteId: PLATFORM_ID,
    name: 'MCP',
    slug: 'mcp',
    runtime: 'nodejs',
    routes: ['/mcp']
  });
  await service.createVersion({
    ownerId: 'owner-1',
    functionId: created.functionId,
    source: 'exports.main = async function () { return { statusCode: 200, body: "published" }; };'
  });
  await service.publishVersion({ ownerId: 'owner-1', functionId: created.functionId, version: 1 });
  return created;
}

function mcpEvent(path = '/mcp') {
  return { path, httpMethod: 'GET', headers: {} };
}

test('platform publish fallback observability', async (t) => {
  await t.test('BUNDLE_MISSING logs the code and marks fallback without invoking the pool', async () => {
    await withEnv({ ...CLOSED_PREFIX, FUNCTIONS_PLATFORM_RUNTIME_PREFIXES: '/mcp' }, async () => {
      const app = await harness();
      await publishMcp(app.service);
      app.bundleStore.objects.clear();
      const response = await app.platform(mcpEvent('/mcp'));
      assert.equal(response.statusCode, 404);
      assert.equal(response.body, IN_PROCESS_BODY);
      assert.equal(response.headers['x-demox-dispatch'], 'fallback:BUNDLE_MISSING');
      assert.equal(app.systemCalls(), 1);
      assert.equal(app.executed.length, 0);
      assert.deepEqual(fallbackWarn(app.logger), [[
        'platform publish fallback',
        { code: 'BUNDLE_MISSING', slug: 'mcp', path: '/mcp', statusCode: 500 }
      ]]);
    });
  });

  await t.test('NOT_FOUND is distinct from BUNDLE_MISSING when the mcp row is missing', async () => {
    await withEnv({ ...CLOSED_PREFIX, FUNCTIONS_PLATFORM_RUNTIME_PREFIXES: '/mcp' }, async () => {
      const app = await harness();
      const response = await app.platform(mcpEvent());
      assert.equal(response.headers['x-demox-dispatch'], 'fallback:NOT_FOUND');
      assert.equal(response.body, IN_PROCESS_BODY);
      assert.equal(app.executed.length, 0);
      assert.deepEqual(fallbackWarn(app.logger)[0][1], {
        code: 'NOT_FOUND',
        slug: 'mcp',
        path: '/mcp',
        statusCode: 404
      });
    });
  });

  await t.test('PLATFORM_SITE_IN_PROCESS is the code when the prefix switch is off', async () => {
    await withEnv(CLOSED_PREFIX, async () => {
      const app = await harness();
      await publishMcp(app.service);
      const response = await app.platform(mcpEvent());
      assert.equal(response.headers['x-demox-dispatch'], 'fallback:PLATFORM_SITE_IN_PROCESS');
      assert.equal(response.body, IN_PROCESS_BODY);
      assert.equal(app.executed.length, 0);
      assert.equal(fallbackWarn(app.logger)[0][1].code, 'PLATFORM_SITE_IN_PROCESS');
      assert.equal(fallbackWarn(app.logger)[0][1].slug, 'mcp');
      assert.equal(fallbackWarn(app.logger)[0][1].path, '/mcp');
      assert.equal(fallbackWarn(app.logger)[0][1].statusCode, 404);
    });
  });

  await t.test('a real platform-pool response sets platform and ignores a spoofed header', async () => {
    await withEnv({ ...CLOSED_PREFIX, FUNCTIONS_PLATFORM_RUNTIME_PREFIXES: '/mcp' }, async () => {
      const app = await harness({
        execute(opts) {
          assert.equal(opts.pool, 'platform');
          return {
            status: 200,
            headers: { 'content-type': 'application/json', 'x-demox-dispatch': 'spoofed' },
            body: JSON.stringify({ from: 'pool' })
          };
        }
      });
      await publishMcp(app.service);
      const response = await app.platform(mcpEvent());
      assert.equal(response.statusCode, 200);
      assert.deepEqual(JSON.parse(response.body), { from: 'pool' });
      assert.equal(response.headers['x-demox-dispatch'], 'platform');
      assert.equal(app.systemCalls(), 0);
      assert.equal(app.executed.length, 1);
      assert.equal(app.executed[0].pool, 'platform');
      assert.equal(fallbackWarn(app.logger).length, 0);
    });
  });

  await t.test('user-runtime rollback is not labeled platform', async () => {
    await withEnv({ ...CLOSED_PREFIX, FUNCTIONS_PLATFORM_SITE_MODE: 'user-runtime' }, async () => {
      const app = await harness();
      await publishMcp(app.service);
      const response = await app.platform(mcpEvent());
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['x-demox-dispatch'], undefined);
      assert.equal(app.systemCalls(), 0);
      assert.equal(app.executed[0].pool, 'user');
      assert.equal(fallbackWarn(app.logger).length, 0);
    });
  });

  await t.test('statusCode is used when the soft error has no code', async () => {
    const logger = captureLogger();
    const handler = createPlatformHandler({
      logger,
      userHandler: {
        service: {
          async invokeBySlug() {
            const error = new Error('missing');
            error.statusCode = 404;
            throw error;
          }
        }
      },
      systemHandler: async () => ({ statusCode: 404, body: IN_PROCESS_BODY })
    });
    const response = await handler(mcpEvent());
    assert.equal(response.headers['x-demox-dispatch'], 'fallback:404');
    assert.equal(response.body, IN_PROCESS_BODY);
    assert.deepEqual(fallbackWarn(logger)[0][1], {
      code: '404',
      slug: 'mcp',
      path: '/mcp',
      statusCode: 404
    });
  });

  await t.test('FUNCTION_NOT_PUBLISHED is kept as its code', async () => {
    const logger = captureLogger();
    const handler = createPlatformHandler({
      logger,
      userHandler: {
        service: {
          async invokeBySlug() {
            const error = new Error('unpublished');
            error.code = 'FUNCTION_NOT_PUBLISHED';
            error.statusCode = 400;
            throw error;
          }
        }
      },
      systemHandler: async () => ({ statusCode: 404, body: 'in-process' })
    });
    const response = await handler(mcpEvent('/mcp/tools'));
    assert.equal(response.statusCode, 404);
    assert.equal(response.body, 'in-process');
    assert.equal(response.headers['x-demox-dispatch'], 'fallback:FUNCTION_NOT_PUBLISHED');
    assert.equal(fallbackWarn(logger)[0][1].code, 'FUNCTION_NOT_PUBLISHED');
    assert.equal(fallbackWarn(logger)[0][1].slug, 'mcp');
    assert.equal(fallbackWarn(logger)[0][1].path, '/mcp/tools');
  });

  await t.test('timer soft fallback records the trigger name', async () => {
    const logger = captureLogger();
    const handler = createPlatformHandler({
      logger,
      userHandler: {
        service: {
          async invokeBySlug() {
            const error = new Error('missing');
            error.code = 'NOT_FOUND';
            error.statusCode = 404;
            throw error;
          }
        }
      },
      systemHandler: async () => ({ statusCode: 404, body: 'timer' })
    });
    const response = await handler({ Type: 'Timer', TriggerName: 'monthly-renew' });
    assert.equal(response.headers['x-demox-dispatch'], 'fallback:NOT_FOUND');
    assert.deepEqual(fallbackWarn(logger)[0][1], {
      code: 'NOT_FOUND',
      slug: 'cert-renew',
      path: 'monthly-renew',
      statusCode: 404
    });
  });

  await t.test('no published attempt is in-process and does not warn', async () => {
    const logger = captureLogger();
    const handler = createPlatformHandler({
      logger,
      userHandler: async () => ({ statusCode: 208, body: 'user' }),
      systemHandler: async () => ({ statusCode: 404, body: 'inproc' })
    });
    const response = await handler(mcpEvent());
    assert.equal(response.headers['x-demox-dispatch'], 'in-process');
    assert.equal(response.body, 'inproc');
    assert.equal(fallbackWarn(logger).length, 0);
  });

  await t.test('errors outside the soft set are not turned into a fallback header', async () => {
    const logger = captureLogger();
    let systemCalls = 0;
    const handler = createPlatformHandler({
      logger,
      userHandler: {
        service: {
          async invokeBySlug() {
            const error = new Error('assume failed');
            error.code = 'BUSINESS_ROLE_ASSUME_FAILED';
            error.statusCode = 500;
            throw error;
          }
        }
      },
      systemHandler: async () => {
        systemCalls += 1;
        return { statusCode: 404, body: 'inproc' };
      }
    });
    await assert.rejects(
      () => handler(mcpEvent()),
      (error) => error.code === 'BUSINESS_ROLE_ASSUME_FAILED'
    );
    assert.equal(systemCalls, 0);
    assert.equal(fallbackWarn(logger).length, 0);
  });
});

test('no token, JWT, OAuth code or email reached any console log in this suite', () => {
  logGuard.assertNoLeaks();
});
