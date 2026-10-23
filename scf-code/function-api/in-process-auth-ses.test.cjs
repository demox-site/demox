'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryBundleStore } = require('./bundle-store.js');
const { InMemoryFunctionRepository } = require('./repository.js');
const { createFunctionHttpHandler, createPlatformHandler } = require('./index.js');
const { BUSINESS_ROLE_ARN, createBusinessCredentialProvider } = require('./business-credentials.js');
const {
  PLATFORM_SES_ROLE_ENV,
  PLATFORM_SES_ROLE_NAME,
  PLATFORM_SES_SESSION_POLICY,
  readPlatformSesRoleArn,
  createPlatformSesCredentialProvider
} = require('./platform-ses-credentials.js');
const { currentSesCredentials } = require('../../scf-deploy-packages/auth-api/ses-credentials.cjs');

const SES_ROLE_ARN = `qcs::cam::uin/100021031865:roleName/${PLATFORM_SES_ROLE_NAME}`;
const ROLE_ENV = {
  TENCENTCLOUD_SECRETID: 'gw-id',
  TENCENTCLOUD_SECRETKEY: 'gw-key',
  TENCENTCLOUD_SESSIONTOKEN: 'gw-token',
  PLATFORM_SES_ROLE_ARN: SES_ROLE_ARN,
  BUSINESS_ROLE_ARN: undefined,
  BUSINESS_CREDENTIALS_MODE: undefined,
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

function policyActions(policy) {
  return policy.statement.flatMap((statement) => statement.action);
}

function harness({ sesAssume, logger }) {
  let runtimeRoleAssumed = 0;
  const business = createBusinessCredentialProvider({
    logger,
    assume: async () => {
      runtimeRoleAssumed += 1;
      const error = new Error('demox-runtime-role must not be assumed for mail');
      error.code = 'UNEXPECTED_RUNTIME_ROLE';
      throw error;
    }
  });
  const ses = createPlatformSesCredentialProvider({ logger, assume: sesAssume });
  const seen = [];
  let handlerCalls = 0;
  const userHandler = createFunctionHttpHandler({
    repository: new InMemoryFunctionRepository(),
    bundleStore: new InMemoryBundleStore(),
    businessCredentials: business,
    logger,
    runtime: {
      async execute(opts) {
        seen.push({ pool: opts.pool, env: { ...(opts.env || {}) } });
        return { status: 200, headers: {}, body: 'user-runtime' };
      }
    }
  });
  const platform = createPlatformHandler({
    logger,
    userHandler,
    platformSesCredentials: ses,
    systemHandler: async (event) => {
      handlerCalls += 1;
      seen.push({ path: event.path, creds: currentSesCredentials() });
      return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"success":true}' };
    }
  });
  return {
    platform,
    service: userHandler.service,
    seen,
    handlerCalls: () => handlerCalls,
    runtimeRoleAssumed: () => runtimeRoleAssumed
  };
}

test('platform SES role ARN is env-only and rejects demox-runtime-role', () => {
  assert.equal(PLATFORM_SES_ROLE_ENV, 'PLATFORM_SES_ROLE_ARN');
  assert.equal(PLATFORM_SES_ROLE_NAME, 'demox-platform-ses');
  assert.equal(readPlatformSesRoleArn({}), '');
  assert.equal(readPlatformSesRoleArn({ PLATFORM_SES_ROLE_ARN: BUSINESS_ROLE_ARN }), '');
  assert.equal(readPlatformSesRoleArn({ PLATFORM_SES_ROLE_ARN: 'role/demox-platform-ses' }), '');
  assert.equal(readPlatformSesRoleArn({ PLATFORM_SES_ROLE_ARN: SES_ROLE_ARN }), SES_ROLE_ARN);
  const actions = policyActions(PLATFORM_SES_SESSION_POLICY);
  assert.deepEqual(actions.sort(), ['ses:GetEmailIdentity', 'ses:GetEmailTemplate', 'ses:SendEmail']);
  assert.deepEqual(PLATFORM_SES_SESSION_POLICY.statement.map((statement) => statement.resource), [['*']]);
  const text = JSON.stringify(PLATFORM_SES_SESSION_POLICY);
  assert.equal(/cos:|teo:|dnspod:|cls:|ssl:/i.test(text), false);
  assert.equal(text.includes('demox-runtime-role'), false);
  assert.equal(text.includes('ap-hongkong'), false);
});

test('in-process send-code assumes demox-platform-ses and not demox-runtime-role', async () => {
  const assumeCalls = [];
  const logs = [];
  const logger = {
    warn: (...args) => logs.push(args),
    error: (...args) => logs.push(args)
  };
  await withEnv(ROLE_ENV, async () => {
    const app = harness({
      logger,
      sesAssume: async (request) => {
        assumeCalls.push(request);
        return assumedCredentials();
      }
    });
    await publishSystem(app.service, { name: 'Auth', slug: 'auth', routes: ['/auth'] });
    await publishSystem(app.service, { name: 'Website', slug: 'website', routes: ['/website'] });
    await publishSystem(app.service, { name: 'MCP', slug: 'mcp', routes: ['/send-code'] });

    const login = await app.platform({
      httpMethod: 'POST',
      path: '/auth/login',
      headers: {},
      body: { action: 'login', email: 'user@example.com' }
    });
    assert.equal(login.statusCode, 200);
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
    assert.equal(assumeCalls[0].roleArn, 'qcs::cam::uin/100021031865:roleName/demox-platform-ses');
    assert.equal(assumeCalls[0].roleArn, SES_ROLE_ARN);
    assert.equal(assumeCalls[0].roleArn.includes('demox-runtime-role'), false);
    assert.notEqual(assumeCalls[0].roleArn, BUSINESS_ROLE_ARN);
    assert.equal(assumeCalls[0].policy, PLATFORM_SES_SESSION_POLICY);
    assert.deepEqual(
      [...assumeCalls[0].policy.statement[0].action].sort(),
      ['ses:GetEmailIdentity', 'ses:GetEmailTemplate', 'ses:SendEmail']
    );
    assert.deepEqual(assumeCalls[0].policy.statement[0].resource, ['*']);
    assert.equal(assumeCalls[0].token, 'gw-token');
    assert.equal(app.seen[1].creds.secretId, 'lin-ses-id');
    assert.equal(app.seen[1].creds.secretKey, 'lin-ses-key');
    assert.equal(app.seen[1].creds.token, 'lin-ses-token');
    assert.equal(process.env.TENCENTCLOUD_SECRETID, 'gw-id');
    assert.equal(process.env.TENCENTCLOUD_SESSIONTOKEN, 'gw-token');
    assert.equal(app.runtimeRoleAssumed(), 0);

    const second = await app.platform({
      httpMethod: 'POST',
      path: '/auth/send-code',
      headers: {},
      body: { action: 'send_code', email: 'user@example.com' }
    });
    assert.equal(second.statusCode, 200);
    assert.equal(assumeCalls.length, 1, 'the second send-code reuses the cached assumption');
    assert.equal(app.seen[2].creds.secretId, 'lin-ses-id');

    const website = await app.platform({
      httpMethod: 'POST',
      path: '/website',
      headers: {},
      body: { action: 'list' }
    });
    assert.equal(website.statusCode, 200);
    assert.equal(assumeCalls.length, 1);
    assert.equal(app.seen[3].creds.secretId, 'gw-id');

    const mcp = await app.platform({
      httpMethod: 'POST',
      path: '/send-code',
      headers: {},
      body: { action: 'send_code', email: 'user@example.com' }
    });
    assert.equal(mcp.statusCode, 200);
    assert.equal(assumeCalls.length, 1);
    assert.equal(app.seen[4].creds.secretId, 'gw-id');
    assert.equal(app.runtimeRoleAssumed(), 0);
    assert.equal(logs.some((line) => JSON.stringify(line).includes('lin-ses')), false);
    assert.equal(logs.some((line) => JSON.stringify(line).includes('gw-token')), false);
  });
});

test('missing platform SES role is a clean 5xx and does not call auth or demox-runtime-role', async () => {
  const assumeCalls = [];
  const logs = [];
  const logger = {
    warn: (...args) => logs.push(args.join(' ')),
    error: (...args) => logs.push(args.join(' '))
  };
  await withEnv({ ...ROLE_ENV, PLATFORM_SES_ROLE_ARN: undefined }, async () => {
    const app = harness({
      logger,
      sesAssume: async (request) => {
        assumeCalls.push(request);
        return assumedCredentials();
      }
    });
    await publishSystem(app.service, { name: 'Auth', slug: 'auth', routes: ['/auth'] });
    const response = await app.platform({
      httpMethod: 'POST',
      path: '/auth/send-code',
      headers: {},
      body: { email: 'user@example.com' }
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 500);
    assert.equal(body.error, 'PLATFORM_SES_ROLE_MISSING');
    assert.equal(body.message, '验证码暂时无法发送');
    assert.equal(assumeCalls.length, 0);
    assert.equal(app.handlerCalls(), 0);
    assert.equal(app.runtimeRoleAssumed(), 0);
    assert.equal(response.headers['x-demox-dispatch'], 'fallback:PLATFORM_SITE_IN_PROCESS');
    assert.equal(process.env.TENCENTCLOUD_SECRETID, 'gw-id');
    assert.ok(logs.some((line) => line.includes('PLATFORM_SES_ROLE_MISSING')));
  });
});

test('a demox-runtime-role ARN is refused before AssumeRole', async () => {
  const assumeCalls = [];
  await withEnv({ ...ROLE_ENV, PLATFORM_SES_ROLE_ARN: BUSINESS_ROLE_ARN }, async () => {
    const app = harness({
      logger: { warn() {}, error() {} },
      sesAssume: async (request) => {
        assumeCalls.push(request);
        return assumedCredentials();
      }
    });
    await publishSystem(app.service, { name: 'Auth', slug: 'auth', routes: ['/auth'] });
    const response = await app.platform({
      httpMethod: 'POST',
      path: '/auth/send-code',
      headers: {},
      body: { email: 'user@example.com' }
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 500);
    assert.equal(body.error, 'PLATFORM_SES_ROLE_MISSING');
    assert.equal(assumeCalls.length, 0);
    assert.equal(app.handlerCalls(), 0);
    assert.equal(app.runtimeRoleAssumed(), 0);
  });
});

test('a failed platform SES assume is a clean 5xx and does not call auth', async () => {
  const logs = [];
  const logger = {
    warn: (...args) => logs.push(args.join(' ')),
    error: (...args) => logs.push(args.join(' '))
  };
  await withEnv(ROLE_ENV, async () => {
    const app = harness({
      logger,
      sesAssume: async () => {
        const error = new Error('请检查Region参数');
        error.code = 'InvalidParameter';
        throw error;
      }
    });
    await publishSystem(app.service, { name: 'Auth', slug: 'auth', routes: ['/auth'] });
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
    assert.equal(JSON.stringify(body).includes('demox-runtime-role'), false);
    assert.equal(response.headers['x-demox-dispatch'], 'fallback:PLATFORM_SITE_IN_PROCESS');
    assert.equal(app.handlerCalls(), 0);
    assert.equal(app.runtimeRoleAssumed(), 0);
    assert.equal(process.env.TENCENTCLOUD_SECRETID, 'gw-id');
    assert.equal(process.env.TENCENTCLOUD_SESSIONTOKEN, 'gw-token');
    assert.ok(logs.some((line) => line.includes('BUSINESS_ROLE_ASSUME_FAILED')));
    assert.equal(logs.some((line) => line.includes('请检查Region参数')), false);
    assert.equal(logs.some((line) => line.includes('gw-id') || line.includes('gw-token')), false);
  });
});
