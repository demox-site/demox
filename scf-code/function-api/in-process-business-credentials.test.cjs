'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const logGuard = require('../../scripts/log-leak-guard.cjs').installLogLeakGuard();
const { InMemoryBundleStore } = require('./bundle-store.js');
const { CosBundleStore } = require('./bundle-store.js');
const { InMemoryFunctionRepository } = require('./repository.js');
const { createFunctionHttpHandler, createPlatformHandler, gatewayBundleCosOptions } = require('./index.js');
const {
  BUSINESS_ROLE_ARN,
  BUSINESS_SESSION_POLICY,
  createBusinessCredentialProvider,
  tencentClientCredentials
} = require('./business-credentials.js');
const { assumedPlatformSesCredentials } = require('../../scf-deploy-packages/auth-api/ses-credentials.cjs');

const dbModulePath = require.resolve('../website-api/shared/db.js');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: {
    query: async () => [],
    transaction: async (callback) => callback({ query: async () => [[], []] })
  }
};

const REJECTED_ROLE_ARNS = [
  'qcs::cam::uin/100021031865:roleName/demox-runtime-b1',
  'qcs::cam::uin/100021031865:roleName/demox-gateway-role',
  'qcs::cam::uin/100021031865:roleName/demox-platform-ses',
  'qcs::cam::uin/100021031866:roleName/demox-runtime-role'
];
const SES_ROLE_ARN = 'qcs::cam::uin/100021031865:roleName/demox-platform-ses';
const ROLE_ENV = {
  TENCENTCLOUD_SECRETID: 'gw-id',
  TENCENTCLOUD_SECRETKEY: 'gw-key',
  TENCENTCLOUD_SESSIONTOKEN: 'gw-token',
  BUSINESS_ROLE_ARN: BUSINESS_ROLE_ARN,
  BUSINESS_CREDENTIALS_MODE: undefined,
  PLATFORM_SES_ROLE_ARN: SES_ROLE_ARN,
  FUNCTIONS_PLATFORM_RUNTIME_PREFIXES: undefined,
  FUNCTIONS_PLATFORM_SITE_MODE: undefined
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

function installHttpsCapture() {
  const seen = [];
  const original = https.request;
  https.request = function capture(options, callback) {
    seen.push({
      host: options.host,
      action: options.headers['X-TC-Action'],
      authorization: options.headers.Authorization,
      token: options.headers['X-TC-Token'] || ''
    });
    const response = new EventEmitter();
    response.statusCode = 200;
    response.setEncoding = () => {};
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {
      if (typeof callback === 'function') callback(response);
      process.nextTick(() => {
        response.emit('data', JSON.stringify({ Response: { RequestId: 'req-1' } }));
        response.emit('end');
      });
    };
    request.destroy = () => {};
    return request;
  };
  return {
    seen,
    restore() {
      https.request = original;
    }
  };
}

async function publishSystem(service, { name, slug, routes }) {
  const created = await service.createFunction({
    ownerId: 'owner-1',
    websiteId: 'EPX2UU43',
    name,
    slug,
    runtime: 'nodejs',
    routes
  });
  await service.createVersion({
    ownerId: 'owner-1',
    functionId: created.functionId,
    source: 'exports.main = async function () { return { statusCode: 200, body: "published" }; };'
  });
  await service.publishVersion({ ownerId: 'owner-1', functionId: created.functionId, version: 1 });
  return created;
}

async function exerciseClients(label) {
  const { resolveCreds } = require('../website-api/shared/buckets.js');
  const { CosProvider } = require('../website-api/shared/storage.js');
  const { callTencentCloudApi } = require('../website-api/index.js')._tencentApiForTest;
  const cfg = resolveCreds({
    hasOwnCreds: false,
    provider: 'cos',
    bucket: 'resource-game-1307257815',
    region: 'ap-chengdu'
  });
  const provider = new CosProvider(cfg);
  await callTencentCloudApi({
    service: 'teo',
    host: 'teo.tencentcloudapi.com',
    version: '2022-09-01',
    action: 'CreatePurgeTask',
    payload: { ZoneId: 'zone-test', Type: 'purge_prefix', Targets: ['https://example.com/a/'] }
  });
  await callTencentCloudApi({
    service: 'ims',
    host: 'ims.tencentcloudapi.com',
    version: '2020-12-29',
    action: 'ImageModeration',
    payload: { DataId: label }
  });
  return {
    label,
    secretId: provider.cos.options.SecretId,
    secretKey: provider.cos.options.SecretKey,
    token: provider.cos.options.SecurityToken || ''
  };
}

function harness({ assume, sesAssume, logger = console }) {
  const assumeCalls = [];
  let handlerCalls = 0;
  const seen = [];
  const business = createBusinessCredentialProvider({
    logger,
    assume: async (request) => {
      assumeCalls.push(request);
      if (assume) return assume(request);
      return {
        secretId: 'biz-id',
        secretKey: 'biz-key',
        token: 'biz-token',
        expiration: '2099-01-01T00:00:00Z'
      };
    }
  });
  const userHandler = createFunctionHttpHandler({
    repository: new InMemoryFunctionRepository(),
    bundleStore: new InMemoryBundleStore(),
    businessCredentials: business,
    logger,
    runtime: { async execute() { return { status: 200, headers: {}, body: 'user-runtime' }; } }
  });
  const platform = createPlatformHandler({
    logger,
    userHandler,
    platformSesCredentials: {
      async credentialsFor() {
        if (sesAssume) return sesAssume();
        return {
          TENCENTCLOUD_SECRETID: 'lin-ses-id',
          TENCENTCLOUD_SECRETKEY: 'lin-ses-key',
          TENCENTCLOUD_SESSIONTOKEN: 'lin-ses-token'
        };
      }
    },
    systemHandler: async (event) => {
      handlerCalls += 1;
      if (event.TriggerName === 'monthly-renew') {
        seen.push({
          label: 'cert-renew',
          creds: {
            secretId: process.env.TENCENTCLOUD_SECRETID || '',
            secretKey: process.env.TENCENTCLOUD_SECRETKEY || '',
            token: process.env.TENCENTCLOUD_SESSIONTOKEN || ''
          }
        });
        return { statusCode: 204, body: '' };
      }
      if (String(event.path || '').startsWith('/auth/send-code') || (event.body && event.body.action === 'send_code' && String(event.path || '').startsWith('/auth'))) {
        seen.push({ label: 'send-code', creds: assumedPlatformSesCredentials() });
        return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"success":true}' };
      }
      seen.push(await exerciseClients(event.path || ''));
      return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"success":true}' };
    }
  });
  return {
    platform,
    service: userHandler.service,
    seen,
    assumeCalls,
    handlerCalls: () => handlerCalls
  };
}

test('in-process auth and website assume the business role and SDK clients get the session', async () => {
  const http = installHttpsCapture();
  const logs = [];
  const logger = { warn: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) };
  try {
    await withEnv(ROLE_ENV, async () => {
      const app = harness({ logger });
      await publishSystem(app.service, { name: 'Auth', slug: 'auth', routes: ['/auth'] });
      await publishSystem(app.service, { name: 'Website', slug: 'website', routes: ['/website'] });
      await publishSystem(app.service, { name: 'MCP', slug: 'mcp', routes: ['/mcp'] });

      const login = await app.platform({ httpMethod: 'POST', path: '/auth/login', headers: {}, body: { action: 'login' } });
      assert.equal(login.statusCode, 200);
      assert.equal(login.headers['x-demox-dispatch'], 'fallback:PLATFORM_SITE_IN_PROCESS');
      assert.equal(app.assumeCalls.length, 1);
      assert.equal(app.assumeCalls[0].roleArn, BUSINESS_ROLE_ARN);
      for (const arn of REJECTED_ROLE_ARNS) {
        assert.notEqual(app.assumeCalls[0].roleArn, arn);
      }
      assert.equal(app.assumeCalls[0].token, 'gw-token');
      assert.equal(app.assumeCalls[0].policy, BUSINESS_SESSION_POLICY);
      assert.equal(app.assumeCalls[0].policy.statement.some((item) => item.action.includes('ims:ImageModeration')), true);
      assert.equal(app.seen[0].secretId, 'biz-id');
      assert.equal(app.seen[0].secretKey, 'biz-key');
      assert.equal(app.seen[0].token, 'biz-token');

      const website = await app.platform({ httpMethod: 'POST', path: '/website', headers: {}, body: { action: 'list' } });
      assert.equal(website.statusCode, 200);
      assert.equal(app.assumeCalls.length, 2);
      assert.equal(app.assumeCalls[1].roleArn, BUSINESS_ROLE_ARN);
      assert.equal(app.seen[1].secretId, 'biz-id');
      assert.equal(app.seen[1].token, 'biz-token');

      const again = await app.platform({ httpMethod: 'POST', path: '/website', headers: {}, body: { action: 'list' } });
      assert.equal(again.statusCode, 200);
      assert.equal(app.assumeCalls.length, 2, 'cached session is reused');

      const mcp = await app.platform({ httpMethod: 'POST', path: '/mcp', headers: {}, body: {} });
      assert.equal(mcp.statusCode, 200);
      assert.equal(app.assumeCalls.length, 3);
      assert.equal(app.seen[3].secretId, 'biz-id');

      const rollup = await app.platform({ Type: 'Timer', TriggerName: 'analytics-rollup-5m' });
      assert.equal(rollup.statusCode, 200);
      assert.equal(app.assumeCalls.length, 3, 'website timer reuses the inproc-website session');
      assert.equal(app.seen[4].secretId, 'biz-id');
      assert.equal(app.seen[4].token, 'biz-token');

      const renew = await app.platform({ Type: 'Timer', TriggerName: 'monthly-renew' });
      assert.equal(renew.statusCode, 204);
      assert.equal(app.assumeCalls.length, 3, 'cert-renew does not assume the business role');
      assert.equal(app.seen[5].creds.secretId, 'gw-id');
      assert.equal(app.seen[5].creds.token, 'gw-token');

      const teo = http.seen.filter((item) => item.action === 'CreatePurgeTask');
      const ims = http.seen.filter((item) => item.action === 'ImageModeration');
      assert.equal(teo.length, 5);
      assert.equal(ims.length, 5);
      for (const call of [...teo, ...ims]) {
        assert.match(call.authorization, /Credential=biz-id\//);
        assert.equal(call.authorization.includes('gw-id'), false);
        assert.equal(call.token, 'biz-token');
        assert.notEqual(call.token, 'gw-token');
      }
      assert.equal(process.env.TENCENTCLOUD_SECRETID, 'gw-id');
      assert.equal(process.env.TENCENTCLOUD_SESSIONTOKEN, 'gw-token');
      assert.throws(
        () => tencentClientCredentials(),
        (error) => error.code === 'BUSINESS_CREDENTIALS_MISSING'
      );
      assert.equal(logs.some((line) => line.includes('biz-') || line.includes('gw-token') || line.includes('gw-id')), false);
    });
  } finally {
    http.restore();
  }
});

test('BUSINESS_CREDENTIALS_MODE=execution-role keeps the old env credentials', async () => {
  const http = installHttpsCapture();
  try {
    await withEnv({ ...ROLE_ENV, BUSINESS_CREDENTIALS_MODE: 'execution-role' }, async () => {
      let assumed = 0;
      const app = harness({
        assume: async () => {
          assumed += 1;
          throw new Error('should not assume');
        }
      });
      await publishSystem(app.service, { name: 'Website', slug: 'website', routes: ['/website'] });
      await publishSystem(app.service, { name: 'Auth', slug: 'auth', routes: ['/auth'] });
      const website = await app.platform({ httpMethod: 'POST', path: '/website', headers: {}, body: { action: 'list' } });
      const login = await app.platform({ httpMethod: 'POST', path: '/auth/login', headers: {}, body: { action: 'login' } });
      assert.equal(website.statusCode, 200);
      assert.equal(login.statusCode, 200);
      assert.equal(assumed, 0);
      assert.equal(app.seen[0].secretId, 'gw-id');
      assert.equal(app.seen[0].token, 'gw-token');
      assert.equal(app.seen[1].secretId, 'gw-id');
      assert.match(http.seen[0].authorization, /Credential=gw-id\//);
      assert.equal(http.seen[0].token, 'gw-token');
      assert.equal(process.env.TENCENTCLOUD_SECRETID, 'gw-id');
    });
  } finally {
    http.restore();
  }
});

test('without BUSINESS_ROLE_ARN the in-process path does not assume', async () => {
  const http = installHttpsCapture();
  try {
    await withEnv({ ...ROLE_ENV, BUSINESS_ROLE_ARN: undefined }, async () => {
      const app = harness({
        assume: async () => {
          throw new Error('should not assume');
        }
      });
      await publishSystem(app.service, { name: 'Auth', slug: 'auth', routes: ['/auth'] });
      const login = await app.platform({ httpMethod: 'POST', path: '/auth/login', headers: {}, body: {} });
      assert.equal(login.statusCode, 200);
      assert.equal(app.assumeCalls.length, 0);
      assert.equal(app.seen[0].secretId, 'gw-id');
    });
  } finally {
    http.restore();
  }
});

test('an explicit session mode without an ARN fails closed', async () => {
  await withEnv({ ...ROLE_ENV, BUSINESS_ROLE_ARN: undefined, BUSINESS_CREDENTIALS_MODE: 'session' }, async () => {
    const app = harness({});
    await publishSystem(app.service, { name: 'Website', slug: 'website', routes: ['/website'] });
    const response = await app.platform({ httpMethod: 'POST', path: '/website', headers: {}, body: {} });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 500);
    assert.equal(body.error, 'BUSINESS_ROLE_ARN_MISSING');
    assert.equal(app.handlerCalls(), 0);
    assert.equal(app.assumeCalls.length, 0);
    assert.equal(JSON.stringify(body).includes('gw-'), false);
  });
});

test('an invalid BUSINESS_ROLE_ARN fails closed and execution-role still rolls back', async () => {
  for (const arn of REJECTED_ROLE_ARNS) {
    await withEnv({ ...ROLE_ENV, BUSINESS_ROLE_ARN: arn }, async () => {
      const app = harness({});
      await publishSystem(app.service, { name: 'Website', slug: 'website', routes: ['/website'] });
      const denied = await app.platform({ httpMethod: 'POST', path: '/website', headers: {}, body: {} });
      assert.equal(JSON.parse(denied.body).error, 'BUSINESS_ROLE_ARN_INVALID');
      assert.equal(app.handlerCalls(), 0);
      assert.equal(app.assumeCalls.length, 0);
    });
  }
  const http = installHttpsCapture();
  try {
    await withEnv({
      ...ROLE_ENV,
      BUSINESS_ROLE_ARN: 'not-an-arn',
      BUSINESS_CREDENTIALS_MODE: 'execution-role'
    }, async () => {
      const app = harness({
        assume: async () => {
          throw new Error('should not assume');
        }
      });
      await publishSystem(app.service, { name: 'Website', slug: 'website', routes: ['/website'] });
      const response = await app.platform({ httpMethod: 'POST', path: '/website', headers: {}, body: {} });
      assert.equal(response.statusCode, 200);
      assert.equal(app.assumeCalls.length, 0);
      assert.equal(app.seen[0].secretId, 'gw-id');
    });
  } finally {
    http.restore();
  }
});

test('a failed business assume does not call the handler or fall back to the execution role', async () => {
  const logs = [];
  const logger = { warn: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) };
  await withEnv(ROLE_ENV, async () => {
    const app = harness({
      logger,
      assume: async () => {
        const error = new Error('secret gw-token denied');
        error.code = 'AuthFailure.UnauthorizedOperation';
        throw error;
      }
    });
    await publishSystem(app.service, { name: 'Website', slug: 'website', routes: ['/website'] });
    const response = await app.platform({ httpMethod: 'POST', path: '/website', headers: {}, body: {} });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 500);
    assert.equal(body.error, 'BUSINESS_ROLE_ASSUME_FAILED');
    assert.equal(body.message, '业务云凭证不可用');
    assert.equal(app.handlerCalls(), 0);
    assert.equal(JSON.stringify(body).includes('gw-'), false);
    assert.equal(JSON.stringify(body).includes('biz-'), false);
    assert.equal(process.env.TENCENTCLOUD_SECRETID, 'gw-id');
    assert.ok(logs.some((line) => line.includes('BUSINESS_ROLE_ASSUME_FAILED')));
    assert.equal(logs.some((line) => line.includes('gw-token') || line.includes('secret')), false);
  });
});

test('in-process send-code still uses demox-platform-ses and does not assume the business role', async () => {
  let businessAssumes = 0;
  let sesAssumes = 0;
  await withEnv(ROLE_ENV, async () => {
    const app = harness({
      assume: async () => {
        businessAssumes += 1;
        throw new Error('business role must not be assumed for send-code');
      },
      sesAssume: async () => {
        sesAssumes += 1;
        return {
          TENCENTCLOUD_SECRETID: 'lin-ses-id',
          TENCENTCLOUD_SECRETKEY: 'lin-ses-key',
          TENCENTCLOUD_SESSIONTOKEN: 'lin-ses-token'
        };
      }
    });
    await publishSystem(app.service, { name: 'Auth', slug: 'auth', routes: ['/auth'] });
    const response = await app.platform({
      httpMethod: 'POST',
      path: '/auth/send-code',
      headers: {},
      body: { email: 'user@example.com', type: 'login' }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['x-demox-dispatch'], 'fallback:PLATFORM_SITE_IN_PROCESS');
    assert.equal(businessAssumes, 0);
    assert.equal(sesAssumes, 1);
    assert.equal(app.seen[0].creds.secretId, 'lin-ses-id');
    assert.equal(app.seen[0].creds.secretKey, 'lin-ses-key');
    assert.equal(app.seen[0].creds.token, 'lin-ses-token');
    assert.notEqual(app.seen[0].creds.secretId, 'gw-id');
    assert.notEqual(app.seen[0].creds.secretId, 'biz-id');
    assert.equal(process.env.TENCENTCLOUD_SECRETID, 'gw-id');
    assert.equal(process.env.TENCENTCLOUD_SESSIONTOKEN, 'gw-token');
  });
});

test('gateway function-bundle COS uses the business session only when the switch is on', async () => {
  const sessionCalls = [];
  const sessionOptions = gatewayBundleCosOptions({
    env: { ...ROLE_ENV },
    credentialsFor: async (request) => {
      sessionCalls.push(request);
      return {
        TENCENTCLOUD_SECRETID: 'biz-id',
        TENCENTCLOUD_SECRETKEY: 'biz-key',
        TENCENTCLOUD_SESSIONTOKEN: 'biz-token',
        expiresAt: 1_900_000_000_000
      };
    }
  });
  const sessionCreds = await new Promise((resolve, reject) => {
    try {
      sessionOptions.getAuthorization({}, (creds) => resolve(creds));
    } catch (error) {
      reject(error);
    }
  });
  assert.equal(sessionCalls.length, 1);
  assert.equal(sessionCalls[0].functionId, 'gateway-cos');
  assert.equal(sessionCalls[0].kind, 'business');
  assert.equal(sessionCreds.TmpSecretId, 'biz-id');
  assert.equal(sessionCreds.TmpSecretKey, 'biz-key');
  assert.equal(sessionCreds.SecurityToken, 'biz-token');
  assert.equal(sessionCreds.XCosSecurityToken, 'biz-token');
  assert.equal(sessionCreds.ExpiredTime, 1_900_000_000);

  const missingExpiry = gatewayBundleCosOptions({
    env: { ...ROLE_ENV },
    credentialsFor: async () => ({
      TENCENTCLOUD_SECRETID: 'biz-id',
      TENCENTCLOUD_SECRETKEY: 'biz-key',
      TENCENTCLOUD_SESSIONTOKEN: 'biz-token'
    })
  });
  const failedCreds = await new Promise((resolve, reject) => {
    try {
      missingExpiry.getAuthorization({}, (creds) => resolve(creds));
    } catch (error) {
      reject(error);
    }
  });
  assert.equal(failedCreds instanceof Error, true);
  assert.equal(failedCreds.code, 'BUSINESS_ROLE_ASSUME_FAILED');

  let legacyCalls = 0;
  const legacyOptions = gatewayBundleCosOptions({
    env: { ...ROLE_ENV, BUSINESS_CREDENTIALS_MODE: 'execution-role', FUNCTIONS_COS_SECRET_ID: 'cos-id', FUNCTIONS_COS_SECRET_KEY: 'cos-key' },
    credentialsFor: async () => {
      legacyCalls += 1;
      throw new Error('should not assume');
    }
  });
  const legacyCreds = await new Promise((resolve, reject) => {
    try {
      legacyOptions.getAuthorization({}, (creds) => resolve(creds));
    } catch (error) {
      reject(error);
    }
  });
  assert.equal(legacyCalls, 0);
  assert.equal(legacyCreds.TmpSecretId, 'cos-id');
  assert.equal(legacyCreds.TmpSecretKey, 'cos-key');
  assert.equal(legacyCreds.SecurityToken, 'gw-token');

  const store = new CosBundleStore({
    bucket: 'resource-game-1307257815',
    region: 'ap-chengdu',
    getAuthorization: sessionOptions.getAuthorization
  });
  assert.equal(store.cos.options.getAuthorization, sessionOptions.getAuthorization);
  assert.ok(!store.cos.options.SecretId);
});

test('no ARN: timer path unchanged', async () => {
  await withEnv({ ...ROLE_ENV, BUSINESS_ROLE_ARN: undefined, BUSINESS_CREDENTIALS_MODE: undefined }, async () => {
    const order = [];
    let assumes = 0;
    const userHandler = createFunctionHttpHandler({
      repository: new InMemoryFunctionRepository(),
      bundleStore: new InMemoryBundleStore(),
      businessCredentials: createBusinessCredentialProvider({
        assume: async () => {
          assumes += 1;
          throw new Error('should not assume');
        }
      }),
      logger: console,
      runtime: { async execute() { order.push('runtime'); return { status: 200, headers: {}, body: 'user-runtime' }; } }
    });
    const service = userHandler.service;
    const originalInvoke = service.invokeBySlug.bind(service);
    service.invokeBySlug = async (request) => {
      order.push(`invoke:${request.slug}`);
      return originalInvoke(request);
    };
    const originalTry = userHandler.tryInvokeUserRoute.bind(userHandler);
    userHandler.tryInvokeUserRoute = async (event, context) => {
      order.push(`user:${event.TriggerName || event.path || ''}`);
      return originalTry(event, context);
    };
    const platform = createPlatformHandler({
      userHandler,
      systemHandler: async (event) => {
        order.push(`system:${event.TriggerName || event.path || ''}`);
        return { statusCode: 204, body: event.TriggerName === 'monthly-renew' ? (process.env.TENCENTCLOUD_SECRETID || '') : '' };
      }
    });
    const renew = await platform({ Type: 'Timer', TriggerName: 'monthly-renew' });
    const rollup = await platform({ Type: 'Timer', TriggerName: 'analytics-rollup-5m' });
    const custom = await platform({ Type: 'Timer', TriggerName: 'site-cron' });
    assert.equal(renew.statusCode, 204);
    assert.equal(renew.body, 'gw-id');
    assert.equal(rollup.statusCode, 204);
    assert.equal(custom.statusCode, 204);
    assert.deepEqual(order, [
      'invoke:cert-renew',
      'system:monthly-renew',
      'invoke:website',
      'system:analytics-rollup-5m',
      'user:site-cron',
      'system:site-cron'
    ]);
    assert.equal(assumes, 0);
    assert.equal(order.includes('runtime'), false);
  });
});

test('gateway COS does not read env when the business ARN is invalid or session is required without one', async () => {
  let calls = 0;
  const credentialsFor = async () => {
    calls += 1;
    throw new Error('should not assume');
  };
  const invalidOptions = gatewayBundleCosOptions({
    env: { ...ROLE_ENV, BUSINESS_ROLE_ARN: REJECTED_ROLE_ARNS[1] },
    credentialsFor
  });
  const invalidCreds = await new Promise((resolve) => {
    invalidOptions.getAuthorization({}, (creds) => resolve(creds));
  });
  assert.equal(invalidCreds instanceof Error, true);
  assert.equal(invalidCreds.code, 'BUSINESS_ROLE_ARN_INVALID');
  const missingOptions = gatewayBundleCosOptions({
    env: { ...ROLE_ENV, BUSINESS_ROLE_ARN: undefined, BUSINESS_CREDENTIALS_MODE: 'session' },
    credentialsFor
  });
  const missingCreds = await new Promise((resolve) => {
    missingOptions.getAuthorization({}, (creds) => resolve(creds));
  });
  assert.equal(missingCreds instanceof Error, true);
  assert.equal(missingCreds.code, 'BUSINESS_ROLE_ARN_MISSING');
  assert.equal(calls, 0);
  const legacyOptions = gatewayBundleCosOptions({
    env: { ...ROLE_ENV, BUSINESS_ROLE_ARN: undefined },
    credentialsFor
  });
  const legacyCreds = await new Promise((resolve) => {
    legacyOptions.getAuthorization({}, (creds) => resolve(creds));
  });
  assert.equal(legacyCreds.TmpSecretId, 'gw-id');
  assert.equal(legacyCreds.SecurityToken, 'gw-token');
});

test('buckets load failure throws only outside legacy mode', async () => {
  const bucketsPath = require.resolve('../website-api/shared/buckets.js');
  const saved = require.cache[bucketsPath];
  delete require.cache[bucketsPath];
  const Module = require('node:module');
  const original = Module._resolveFilename;
  Module._resolveFilename = function resolveBlocked(request, parent, ...rest) {
    if (String(request).includes('function-api/business-credentials.js')) {
      const error = new Error('missing');
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    return original.call(this, request, parent, ...rest);
  };
  try {
    const buckets = require(bucketsPath);
    const envCreds = {
      TENCENTCLOUD_SECRETID: 'gw-id',
      TENCENTCLOUD_SECRETKEY: 'gw-key',
      TENCENTCLOUD_SESSIONTOKEN: 'gw-token'
    };
    assert.throws(
      () => buckets.tencentClientCredentials({ ...envCreds, BUSINESS_ROLE_ARN: BUSINESS_ROLE_ARN }),
      (error) => error.code === 'BUSINESS_CREDENTIALS_UNAVAILABLE'
    );
    assert.throws(
      () => buckets.tencentClientCredentials({ ...envCreds, BUSINESS_ROLE_ARN: REJECTED_ROLE_ARNS[0] }),
      (error) => error.code === 'BUSINESS_ROLE_ARN_INVALID'
    );
    assert.throws(
      () => buckets.tencentClientCredentials({ ...envCreds, BUSINESS_CREDENTIALS_MODE: 'session' }),
      (error) => error.code === 'BUSINESS_ROLE_ARN_MISSING'
    );
    assert.equal(buckets.tencentClientCredentials(envCreds).secretId, 'gw-id');
    assert.equal(buckets.tencentClientCredentials({
      ...envCreds,
      BUSINESS_ROLE_ARN: REJECTED_ROLE_ARNS[1],
      BUSINESS_CREDENTIALS_MODE: 'execution-role'
    }).secretId, 'gw-id');
    await withEnv({ ...envCreds, BUSINESS_ROLE_ARN: undefined, BUSINESS_CREDENTIALS_MODE: undefined }, () => {
      const resolved = buckets.resolveCreds({
        hasOwnCreds: false,
        provider: 'cos',
        bucket: 'resource-game-1307257815',
        region: 'ap-chengdu'
      });
      assert.equal(resolved.secretId, 'gw-id');
    });
  } finally {
    Module._resolveFilename = original;
    delete require.cache[bucketsPath];
    if (saved) require.cache[bucketsPath] = saved;
  }
});

test('no token reached any console log in this suite', () => {
  logGuard.assertNoLeaks();
});
