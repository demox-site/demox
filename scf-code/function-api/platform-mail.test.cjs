'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const { InMemoryBundleStore } = require('./bundle-store.js');
const { InMemoryFunctionRepository } = require('./repository.js');
const { createFunctionHttpHandler, createPlatformHandler } = require('./index.js');
const { FunctionRuntimeError } = require('./runtime-error.js');
const { executeNodejsPayload, resetNodeWorkerPool } = require('./runtime-nodejs.js');
const { main } = require('./runtime-nodejs-handler.js');
const { sesCredentialsForPoolMail } = require('./platform-ses-credentials.js');

const PLATFORM_ID = 'EPX2UU43';
const SES_ROLE_ARN = 'qcs::cam::uin/100021031865:roleName/demox-platform-ses';
const POOL_ENV = {
  TENCENTCLOUD_SECRETID: 'pool-id',
  TENCENTCLOUD_SECRETKEY: 'pool-key',
  TENCENTCLOUD_SESSIONTOKEN: 'pool-token',
  PLATFORM_SES_ROLE_ARN: SES_ROLE_ARN
};
const BUSINESS_ENV = {
  TENCENTCLOUD_SECRETID: 'biz-id',
  TENCENTCLOUD_SECRETKEY: 'biz-key',
  TENCENTCLOUD_SESSIONTOKEN: 'biz-token',
  PLATFORM_SES_ROLE_ARN: SES_ROLE_ARN
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

function mailPayload(packageName, request) {
  return {
    type: 'demox.runtime.execute',
    runtime: 'nodejs',
    packageName,
    callingConvention: 'scf-event',
    entrypoint: 'index.cjs',
    source: packageName === 'demox-auth'
      ? `const { assumedPlatformSesCredentials } = require('./ses-credentials.cjs');
module.exports = async function () {
  const ses = assumedPlatformSesCredentials();
  return {
    secretId: ses && ses.secretId || null,
    token: ses && ses.token || null,
    envId: process.env.TENCENTCLOUD_SECRETID || null,
    envToken: process.env.TENCENTCLOUD_SESSIONTOKEN || null
  };
};`
      : `module.exports = async function () {
  const als = globalThis[Symbol.for('demox.platformSes.als')];
  const ses = als && typeof als.getStore === 'function' ? als.getStore() : null;
  return {
    secretId: ses && ses.secretId || null,
    token: ses && ses.token || null,
    envId: process.env.TENCENTCLOUD_SECRETID || null,
    envToken: process.env.TENCENTCLOUD_SESSIONTOKEN || null
  };
};`,
    request,
    env: { ...BUSINESS_ENV },
    limits: { timeoutMs: 5000, memoryLimitBytes: 64 * 1024 * 1024 }
  };
}

async function runPoolMail(packageName, request) {
  const payload = mailPayload(packageName, request);
  const assumeCalls = [];
  const creds = await sesCredentialsForPoolMail(payload, {
    env: POOL_ENV,
    assume: async (input) => {
      assumeCalls.push(input);
      return {
        secretId: 'lin-ses-id',
        secretKey: 'lin-ses-key',
        token: 'lin-ses-token',
        expiration: '2099-01-01T00:00:00Z'
      };
    }
  });
  const result = await executeNodejsPayload({ ...payload, sesCredentials: creds });
  return { assumeCalls, creds, result };
}

test('pool auth send-code assumes demox-platform-ses with the pool role and keeps business TENCENTCLOUD_*', async () => {
  const previous = process.env.TENCENTCLOUD_SECRETID;
  process.env.TENCENTCLOUD_SECRETID = 'parent-id';
  try {
    const { assumeCalls, result } = await runPoolMail('demox-auth', {
      method: 'POST',
      path: '/auth/send-code',
      body: JSON.stringify({ action: 'send_code', email: 'user@example.com' })
    });
    assert.equal(assumeCalls.length, 1);
    assert.equal(assumeCalls[0].roleArn, SES_ROLE_ARN);
    assert.equal(assumeCalls[0].secretId, 'pool-id');
    assert.equal(assumeCalls[0].token, 'pool-token');
    assert.equal(assumeCalls[0].policy.statement[0].action.includes('ses:SendEmail'), true);
    assert.equal(result.secretId, 'lin-ses-id');
    assert.equal(result.token, 'lin-ses-token');
    assert.equal(result.envId, 'biz-id');
    assert.equal(result.envToken, 'biz-token');
    assert.equal(process.env.TENCENTCLOUD_SECRETID, 'parent-id');
  } finally {
    resetNodeWorkerPool();
    if (previous === undefined) delete process.env.TENCENTCLOUD_SECRETID;
    else process.env.TENCENTCLOUD_SECRETID = previous;
  }
});

test('pool website disable notice assumes demox-platform-ses without overwriting TENCENTCLOUD_*', async () => {
  try {
    const { assumeCalls, result } = await runPoolMail('demox-website', {
      method: 'POST',
      path: '/website/update-visibility',
      body: { action: 'update_visibility', visibility: 'disabled', disableReason: '违规内容需要下线处理' }
    });
    assert.equal(assumeCalls.length, 1);
    assert.equal(assumeCalls[0].secretId, 'pool-id');
    assert.equal(assumeCalls[0].roleArn, SES_ROLE_ARN);
    assert.equal(result.secretId, 'lin-ses-id');
    assert.equal(result.envId, 'biz-id');
    assert.equal(result.envToken, 'biz-token');
  } finally {
    resetNodeWorkerPool();
  }
});

test('pool mail skips user functions and non-mail website calls', async () => {
  let assumed = 0;
  const assume = async () => {
    assumed += 1;
    throw new Error('should not assume');
  };
  const user = mailPayload('', {
    method: 'POST',
    path: '/auth/send-code',
    body: { action: 'send_code' }
  });
  user.packageName = '';
  assert.equal(await sesCredentialsForPoolMail(user, { env: POOL_ENV, assume }), null);
  const opened = mailPayload('demox-website', {
    method: 'POST',
    path: '/website/update-visibility',
    body: { action: 'update_visibility', visibility: 'public' }
  });
  assert.equal(await sesCredentialsForPoolMail(opened, { env: POOL_ENV, assume }), null);
  const login = mailPayload('demox-auth', {
    method: 'POST',
    path: '/auth/login',
    body: { action: 'login' }
  });
  assert.equal(await sesCredentialsForPoolMail(login, { env: POOL_ENV, assume }), null);
  assert.equal(assumed, 0);
});

test('pool runtime fails closed when PLATFORM_SES_ROLE_ARN is missing and ignores the invocation env', async () => {
  const original = https.request;
  let called = 0;
  https.request = () => {
    called += 1;
    throw new Error('should not call STS');
  };
  try {
    await withEnv({
      TENCENTCLOUD_SECRETID: 'pool-id',
      TENCENTCLOUD_SECRETKEY: 'pool-key',
      TENCENTCLOUD_SESSIONTOKEN: 'pool-token',
      PLATFORM_SES_ROLE_ARN: undefined
    }, async () => {
      const response = await main({
        type: 'demox.runtime.execute',
        runtime: 'nodejs',
        packageName: 'demox-auth',
        callingConvention: 'scf-event',
        entrypoint: 'index.cjs',
        source: 'module.exports = async function () { return { ran: true }; };',
        request: { method: 'POST', path: '/auth/send-code', body: { action: 'send_code' } },
        env: { ...BUSINESS_ENV },
        limits: { timeoutMs: 1000 }
      });
      assert.equal(response.ok, false);
      assert.equal(response.error.code, 'PLATFORM_SES_ROLE_MISSING');
      assert.equal(response.error.message, '平台发信角色未配置');
      assert.equal(response.result, undefined);
      assert.equal(called, 0);
      assert.equal(process.env.TENCENTCLOUD_SECRETID, 'pool-id');
    });
  } finally {
    https.request = original;
    resetNodeWorkerPool();
  }
});

test('gateway turns a pool mail credential failure into a clear 500 and leaves business credentials on the invocation', async () => {
  await withEnv({
    TENCENTCLOUD_SECRETID: 'gw-id',
    TENCENTCLOUD_SECRETKEY: 'gw-key',
    TENCENTCLOUD_SESSIONTOKEN: 'gw-token',
    FUNCTIONS_PLATFORM_RUNTIME_PREFIXES: '/auth,/website',
    FUNCTIONS_PLATFORM_SITE_MODE: undefined,
    DEMOX_PLATFORM_WEBSITE_ID: undefined,
    PLATFORM_SES_ROLE_ARN: undefined
  }, async () => {
    const seen = [];
    const repository = new InMemoryFunctionRepository();
    const bundleStore = new InMemoryBundleStore();
    const userHandler = createFunctionHttpHandler({
      repository,
      bundleStore,
      logger: { warn() {}, error() {} },
      runtime: {
        async execute(opts) {
          seen.push(opts);
          throw new FunctionRuntimeError('平台发信角色未配置', 'PLATFORM_SES_ROLE_MISSING');
        }
      },
      businessCredentials: {
        async credentialsFor() {
          return {
            TENCENTCLOUD_SECRETID: 'biz-id',
            TENCENTCLOUD_SECRETKEY: 'biz-key',
            TENCENTCLOUD_SESSIONTOKEN: 'biz-token'
          };
        }
      }
    });
    const handler = createPlatformHandler({
      logger: { warn() {}, error() {} },
      userHandler
    });
    const service = userHandler.service;
    async function publish(slug, routes) {
      const created = await service.createFunction({
        ownerId: 'owner-1',
        websiteId: PLATFORM_ID,
        name: slug,
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
    }
    await publish('auth', ['/auth']);
    await publish('website', ['/website']);

    const sendCode = await handler({
      httpMethod: 'POST',
      path: '/auth/send-code',
      headers: {},
      body: { email: 'user@example.com', type: 'login' }
    });
    const sendBody = JSON.parse(sendCode.body);
    assert.equal(sendCode.statusCode, 500);
    assert.equal(sendBody.error, 'PLATFORM_SES_ROLE_MISSING');
    assert.equal(sendBody.message, '验证码暂时无法发送');
    assert.equal(seen[0].env.TENCENTCLOUD_SECRETID, 'biz-id');
    assert.equal(seen[0].env.TENCENTCLOUD_SESSIONTOKEN, 'biz-token');
    assert.equal(JSON.stringify(seen[0].env).includes('lin-ses'), false);

    const disabled = await handler({
      httpMethod: 'POST',
      path: '/website/update-visibility',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'update_visibility', visibility: 'disabled' })
    });
    const disabledBody = JSON.parse(disabled.body);
    assert.equal(disabled.statusCode, 500);
    assert.equal(disabledBody.error, 'PLATFORM_SES_ROLE_MISSING');
    assert.equal(disabledBody.message, '停用通知暂时无法发送');

    await assert.rejects(
      handler({
        httpMethod: 'POST',
        path: '/auth/login',
        headers: {},
        body: { action: 'login', email: 'user@example.com' }
      }),
      (error) => error instanceof FunctionRuntimeError && error.code === 'PLATFORM_SES_ROLE_MISSING'
    );
    assert.equal(process.env.TENCENTCLOUD_SECRETID, 'gw-id');
  });
});
