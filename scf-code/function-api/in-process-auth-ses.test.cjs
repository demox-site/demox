'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryBundleStore } = require('./bundle-store.js');
const { InMemoryFunctionRepository } = require('./repository.js');
const { createFunctionHttpHandler, createPlatformHandler } = require('./index.js');
const {
  BUSINESS_ROLE_ARN,
  BUSINESS_SESSION_POLICY,
  createBusinessCredentialProvider
} = require('./business-credentials.js');
const { currentSesCredentials } = require('../../scf-deploy-packages/auth-api/ses-credentials.cjs');

const ROLE_ENV = {
  TENCENTCLOUD_SECRETID: 'gw-id',
  TENCENTCLOUD_SECRETKEY: 'gw-key',
  TENCENTCLOUD_SESSIONTOKEN: 'gw-token',
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

function assumedCredentials() {
  return {
    secretId: 'lin-ses-id',
    secretKey: 'lin-ses-key',
    token: 'lin-ses-token',
    expiration: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  };
}

async function publishAuth(service) {
  const created = await service.createFunction({
    ownerId: 'owner-1',
    websiteId: 'EPX2UU43',
    name: 'Auth',
    slug: 'auth',
    runtime: 'nodejs',
    routes: ['/auth']
  });
  await service.createVersion({
    ownerId: 'owner-1',
    functionId: created.functionId,
    source: 'exports.main = async function () { return { statusCode: 200, body: "published" }; };'
  });
  await service.publishVersion({ ownerId: 'owner-1', functionId: created.functionId, version: 1 });
  return created;
}

function harness({ assume, logger }) {
  const provider = createBusinessCredentialProvider({ logger, assume });
  const seen = [];
  let handlerCalls = 0;
  const userHandler = createFunctionHttpHandler({
    repository: new InMemoryFunctionRepository(),
    bundleStore: new InMemoryBundleStore(),
    businessCredentials: provider,
    logger,
    runtime: {
      async execute() {
        throw new Error('platform pool must not run');
      }
    }
  });
  const platform = createPlatformHandler({
    logger,
    userHandler,
    systemHandler: async (event) => {
      handlerCalls += 1;
      seen.push({ path: event.path, creds: currentSesCredentials() });
      return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"success":true}' };
    }
  });
  return { platform, service: userHandler.service, seen, handlerCalls: () => handlerCalls };
}

test('in-process send-code uses the assumed role credentials and caches them', async () => {
  const assumeCalls = [];
  const logs = [];
  const logger = {
    warn: (...args) => logs.push(args),
    error: (...args) => logs.push(args)
  };
  await withEnv(ROLE_ENV, async () => {
    const app = harness({
      logger,
      assume: async (request) => {
        assumeCalls.push(request);
        return assumedCredentials();
      }
    });
    await publishAuth(app.service);

    const login = await app.platform({
      httpMethod: 'POST',
      path: '/auth/login',
      headers: {},
      body: { action: 'login', email: 'user@example.com' }
    });
    assert.equal(login.statusCode, 200);
    assert.equal(login.headers['x-demox-dispatch'], 'fallback:PLATFORM_SITE_IN_PROCESS');
    assert.equal(assumeCalls.length, 0);
    assert.equal(app.seen[0].creds.secretId, 'gw-id');

    const first = await app.platform({
      httpMethod: 'POST',
      path: '/auth/send-code',
      headers: {},
      body: { email: 'user@example.com', type: 'login' }
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers['x-demox-dispatch'], 'fallback:PLATFORM_SITE_IN_PROCESS');
    assert.equal(assumeCalls.length, 1);
    assert.equal(assumeCalls[0].roleArn, BUSINESS_ROLE_ARN);
    assert.equal(assumeCalls[0].policy, BUSINESS_SESSION_POLICY);
    assert.equal(assumeCalls[0].token, 'gw-token');
    assert.equal(sessionHasSes(assumeCalls[0].policy), true);
    assert.equal(app.seen[1].creds.secretId, 'lin-ses-id');
    assert.equal(app.seen[1].creds.secretKey, 'lin-ses-key');
    assert.equal(app.seen[1].creds.token, 'lin-ses-token');
    assert.notEqual(app.seen[1].creds.secretId, 'gw-id');
    assert.equal(process.env.TENCENTCLOUD_SECRETID, 'gw-id');
    assert.equal(process.env.TENCENTCLOUD_SESSIONTOKEN, 'gw-token');

    const second = await app.platform({
      httpMethod: 'POST',
      path: '/auth/send-code',
      headers: {},
      body: { action: 'send_code', email: 'user@example.com' }
    });
    assert.equal(second.statusCode, 200);
    assert.equal(assumeCalls.length, 1, 'the second send-code reuses the cached assumption');
    assert.equal(app.seen[2].creds.secretId, 'lin-ses-id');
    assert.equal(logs.some((line) => JSON.stringify(line).includes('lin-ses')), false);
  });
});

test('a failed in-process assume is a clean 5xx and does not call auth', async () => {
  const logs = [];
  const logger = {
    warn: (...args) => logs.push(args.join(' ')),
    error: (...args) => logs.push(args.join(' '))
  };
  await withEnv(ROLE_ENV, async () => {
    const app = harness({
      logger,
      assume: async () => {
        const error = new Error('请检查Region参数');
        error.code = 'InvalidParameter';
        throw error;
      }
    });
    await publishAuth(app.service);
    const response = await app.platform({
      httpMethod: 'POST',
      path: '/auth/send-code',
      headers: {},
      body: { email: 'user@example.com' }
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 500);
    assert.equal(body.error, 'BUSINESS_ROLE_ASSUME_FAILED');
    assert.equal(body.message, '验证码暂时无法发送');
    assert.equal(JSON.stringify(body).includes('请检查Region参数'), false);
    assert.equal(JSON.stringify(body).includes('gw-'), false);
    assert.equal(response.headers['x-demox-dispatch'], 'fallback:PLATFORM_SITE_IN_PROCESS');
    assert.equal(app.handlerCalls(), 0);
    assert.equal(process.env.TENCENTCLOUD_SECRETID, 'gw-id');
    assert.equal(process.env.TENCENTCLOUD_SESSIONTOKEN, 'gw-token');
    assert.ok(logs.some((line) => line.includes('BUSINESS_ROLE_ASSUME_FAILED')));
    assert.equal(logs.some((line) => line.includes('请检查Region参数')), false);
    assert.equal(logs.some((line) => line.includes('gw-id') || line.includes('gw-token')), false);
  });
});

function sessionHasSes(policy) {
  return policy.statement.some((statement) => (
    Array.isArray(statement.action) && statement.action.includes('ses:SendEmail')
  ));
}
