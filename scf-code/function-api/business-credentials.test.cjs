'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const logGuard = require('../../scripts/log-leak-guard.cjs').installLogLeakGuard();
const { InMemoryBundleStore } = require('./bundle-store.js');
const { InMemoryFunctionRepository } = require('./repository.js');
const { FunctionService } = require('./service.js');
const { executeNodejsPayload, createScfNodeInvoker, resetNodeWorkerPool } = require('./runtime-nodejs.js');
const {
  BUSINESS_ROLE_ARN,
  BUSINESS_ROLE_ENV,
  BUSINESS_CREDENTIALS_MODE_ENV,
  BUSINESS_CREDENTIALS_LEGACY_MODE,
  BUSINESS_ROLE_SESSION_SECONDS,
  BUSINESS_SESSION_POLICY,
  assumeBusinessRole,
  buildAssumeRoleRequest,
  createBusinessCredentialProvider,
  credentialKind,
  inProcessBusinessCredentialMode,
  resolveBusinessRoleArn,
  roleCredentialEnv,
  runWithBusinessCredentials,
  sessionPolicyAllowsSes,
  sessionPolicyAllowsSsl,
  tencentClientCredentials
} = require('./business-credentials.js');

const PLATFORM_ID = 'EPX2UU43';
const ROLE_ENV = {
  TENCENTCLOUD_SECRETID: 'gw-id',
  TENCENTCLOUD_SECRETKEY: 'gw-key',
  TENCENTCLOUD_SESSIONTOKEN: 'gw-token'
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

function serviceWith(businessCredentials) {
  const repository = new InMemoryFunctionRepository();
  const bundleStore = new InMemoryBundleStore();
  const seen = [];
  const service = new FunctionService({
    repository,
    bundleStore,
    runtime: {
      async execute(opts) {
        seen.push(opts);
        return { status: 200, headers: {}, body: 'ok' };
      }
    },
    publicBaseUrl: 'https://functions.test',
    businessCredentials
  });
  return { service, repository, seen };
}

async function publish(service, { websiteId, slug, routes, timerName }) {
  const created = await service.createFunction({
    ownerId: 'owner-1',
    websiteId,
    name: slug,
    slug,
    runtime: 'nodejs',
    routes,
    timerName
  });
  await service.createVersion({
    ownerId: 'owner-1',
    functionId: created.functionId,
    source: 'exports.main = async function () { return { statusCode: 200, body: "published" }; };'
  });
  await service.publishVersion({ ownerId: 'owner-1', functionId: created.functionId, version: 1 });
  return created;
}

function policyActions(statementIndex) {
  return BUSINESS_SESSION_POLICY.statement[statementIndex].action;
}

test('business session policy covers COS EO DNS CLS and not SSL or SES', () => {
  assert.equal(sessionPolicyAllowsSsl(BUSINESS_SESSION_POLICY), false);
  assert.equal(sessionPolicyAllowsSes(BUSINESS_SESSION_POLICY), false);
  assert.equal(JSON.stringify(BUSINESS_SESSION_POLICY).includes('DEMOX_BIZ_'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(BUSINESS_SESSION_POLICY)) <= 2048);
  assert.equal(BUSINESS_ROLE_SESSION_SECONDS, 900);
  assert.equal(BUSINESS_ROLE_ARN, 'qcs::cam::uin/100021031865:roleName/demox-runtime-role');
  const actions = BUSINESS_SESSION_POLICY.statement.flatMap((item) => item.action).join(' ');
  for (const service of ['cos:', 'teo:', 'dnspod:', 'ims:ImageModeration', 'cls:']) {
    assert.equal(actions.includes(service), true, service);
  }
  assert.equal(/ses:/i.test(actions), false);
  assert.equal(/ses:/i.test(JSON.stringify(BUSINESS_SESSION_POLICY)), false);
  assert.equal(actions.includes('scf:'), false);
  assert.equal(actions.includes('cam:'), false);
  assert.equal(policyActions(0).includes('name/cos:PutObject'), true);
  assert.equal(policyActions(1).includes('name/cos:PutObject'), false);
  assert.equal(policyActions(1).includes('name/cos:DeleteObject'), false);
  assert.equal(credentialKind('auth'), 'business');
  assert.equal(credentialKind('website'), 'business');
  assert.equal(credentialKind('mcp'), 'business');
  assert.equal(credentialKind('cert-renew'), 'certificate');
  assert.equal(credentialKind('hello'), '');
});

test('business session policy contains no ses action', () => {
  const actions = BUSINESS_SESSION_POLICY.statement.flatMap((item) => item.action);
  assert.ok(actions.length > 0);
  for (const action of actions) {
    assert.equal(/ses:/i.test(String(action)), false, String(action));
  }
  assert.equal(sessionPolicyAllowsSes(BUSINESS_SESSION_POLICY), false);
  assert.equal(/ses:/i.test(JSON.stringify(BUSINESS_SESSION_POLICY)), false);
});

test('AssumeRole sends the session policy and returns a different token from the role', async () => {
  const seen = [];
  const result = await assumeBusinessRole({
    secretId: 'gw-id',
    secretKey: 'gw-key',
    token: 'gw-token',
    roleSessionName: 'plat-EPX2UU43-fn_auth',
    timestamp: 1_700_000_000,
    post: async (request) => {
      seen.push(request);
      return JSON.stringify({
        Response: {
          Expiration: '2026-10-21T15:15:00Z',
          Credentials: {
            TmpSecretId: 'ses-id',
            TmpSecretKey: 'ses-key',
            Token: 'ses-token'
          }
        }
      });
    }
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].host, 'sts.tencentcloudapi.com');
  assert.equal(seen[0].headers['X-TC-Action'], 'AssumeRole');
  assert.equal(seen[0].headers['X-TC-Version'], '2018-08-13');
  assert.equal(seen[0].headers['X-TC-Token'], 'gw-token');
  assert.match(seen[0].headers.Authorization, /Credential=gw-id\//);
  const body = JSON.parse(seen[0].body);
  const policy = JSON.parse(body.Policy);
  assert.equal(body.RoleArn, BUSINESS_ROLE_ARN);
  assert.equal(body.RoleSessionName, 'plat-EPX2UU43-fn_auth');
  assert.equal(body.DurationSeconds, 900);
  assert.equal(sessionPolicyAllowsSsl(policy), false);
  assert.equal(sessionPolicyAllowsSes(policy), false);
  assert.equal(/ses:/i.test(body.Policy), false);
  assert.equal(result.secretId, 'ses-id');
  assert.equal(result.token, 'ses-token');
  assert.notEqual(result.token, 'gw-token');
  const other = buildAssumeRoleRequest({
    secretId: 'gw-id',
    secretKey: 'other-key',
    token: 'gw-token',
    roleSessionName: 'plat-EPX2UU43-fn_auth',
    timestamp: 1_700_000_000
  });
  assert.notEqual(other.headers.Authorization, seen[0].headers.Authorization);
});

test('a session policy that grants SSL is refused before the request is sent', () => {
  assert.throws(() => buildAssumeRoleRequest({
    secretId: 'gw-id',
    secretKey: 'gw-key',
    roleSessionName: 'plat-test',
    policy: {
      version: '2.0',
      statement: [{ effect: 'allow', action: ['ssl:UploadCertificate'], resource: ['*'] }]
    }
  }), (error) => error.code === 'BUSINESS_ROLE_POLICY_REJECTED');
});

test('certificate credentials are the role credentials and do not call AssumeRole', async () => {
  const source = { ...ROLE_ENV };
  let assumed = 0;
  const provider = createBusinessCredentialProvider({
    env: source,
    assume: async () => {
      assumed += 1;
      return { secretId: 'ses-id', secretKey: 'ses-key', token: 'ses-token', expiration: '' };
    }
  });
  const certificate = await provider.credentialsFor({ kind: 'certificate', slug: 'cert-renew', sourceEnv: source });
  assert.deepEqual(certificate, ROLE_ENV);
  assert.deepEqual(roleCredentialEnv(source), ROLE_ENV);
  assert.equal(assumed, 0);
  assert.deepEqual(source, ROLE_ENV);
  await assert.rejects(
    provider.credentialsFor({ kind: 'certificate', sourceEnv: { TENCENTCLOUD_SECRETID: 'gw-id' } }),
    (error) => error.code === 'CERT_ROLE_CREDENTIALS_MISSING'
  );
  assert.equal(assumed, 0);
});

test('business credentials are cached for at most 900 seconds and are not the role token', async () => {
  let now = 1_700_000_000_000;
  const assumeCalls = [];
  const source = { ...ROLE_ENV };
  const provider = createBusinessCredentialProvider({
    clock: () => now,
    env: source,
    assume: async (request) => {
      assumeCalls.push(request);
      return {
        secretId: 'ses-id',
        secretKey: 'ses-key',
        token: 'ses-token',
        expiration: new Date(now + 2 * 60 * 60 * 1000).toISOString()
      };
    }
  });
  const request = { kind: 'business', slug: 'website', functionId: 'fn_web', websiteId: PLATFORM_ID, sourceEnv: source };
  const first = await provider.credentialsFor(request);
  const second = await provider.credentialsFor(request);
  assert.equal(assumeCalls.length, 1);
  assert.equal(assumeCalls[0].token, 'gw-token');
  assert.equal(assumeCalls[0].roleArn, BUSINESS_ROLE_ARN);
  assert.equal(sessionPolicyAllowsSsl(assumeCalls[0].policy), false);
  assert.equal(sessionPolicyAllowsSes(assumeCalls[0].policy), false);
  assert.equal(assumeCalls[0].durationSeconds, 900);
  assert.equal(first.TENCENTCLOUD_SECRETID, 'ses-id');
  assert.equal(first.TENCENTCLOUD_SESSIONTOKEN, 'ses-token');
  assert.deepEqual(second, first);
  assert.deepEqual(source, ROLE_ENV);
  now += 719_000;
  await provider.credentialsFor(request);
  assert.equal(assumeCalls.length, 1);
  now += 1_000;
  await provider.credentialsFor(request);
  assert.equal(assumeCalls.length, 2);
});

test('AssumeRole failure does not fall back to the role credentials', async () => {
  const provider = createBusinessCredentialProvider({
    env: { ...ROLE_ENV },
    assume: async () => {
      const error = new Error('denied');
      error.code = 'AuthFailure.UnauthorizedOperation';
      throw error;
    }
  });
  await assert.rejects(
    provider.credentialsFor({
      kind: 'business',
      slug: 'auth',
      functionId: 'fn_auth',
      websiteId: PLATFORM_ID,
      sourceEnv: { ...ROLE_ENV }
    }),
    (error) => error.code === 'BUSINESS_ROLE_ASSUME_FAILED'
  );
  await assert.rejects(
    provider.credentialsFor({ kind: 'business', slug: 'mcp', functionId: 'fn_mcp', websiteId: PLATFORM_ID, sourceEnv: {} }),
    (error) => error.code === 'BUSINESS_ROLE_SOURCE_MISSING'
  );
});

test('platform invoke gives business functions session credentials and cert-renew the role credentials', async () => {
  await withEnv({
    ...ROLE_ENV,
    FUNCTIONS_PLATFORM_RUNTIME_PREFIXES: '/auth,/website,/mcp,timer:monthly-renew',
    FUNCTIONS_PLATFORM_SITE_MODE: 'user-runtime',
    DEMOX_PLATFORM_WEBSITE_ID: undefined
  }, async () => {
    const assumeCalls = [];
    const provider = createBusinessCredentialProvider({
      assume: async (request) => {
        assumeCalls.push(request);
        return { secretId: 'ses-id', secretKey: 'ses-key', token: 'ses-token', expiration: '2099-01-01T00:00:00Z' };
      }
    });
    const { service, repository, seen } = serviceWith(provider);
    const auth = await publish(service, { websiteId: PLATFORM_ID, slug: 'auth', routes: ['/auth'] });
    repository.functions.get(auth.functionId).env.DEMOX_BIZ_SECRET_ID = 'long-lived';
    repository.functions.get(auth.functionId).env.TENCENTCLOUD_SECRETID = 'planted-id';
    repository.functions.get(auth.functionId).env.TENCENTCLOUD_SESSIONTOKEN = 'planted-token';
    await service.invoke({
      functionId: auth.functionId,
      event: { httpMethod: 'POST', path: '/auth/login', headers: {} }
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].pool, 'platform');
    assert.equal(seen[0].env.TENCENTCLOUD_SECRETID, 'ses-id');
    assert.equal(seen[0].env.TENCENTCLOUD_SECRETKEY, 'ses-key');
    assert.equal(seen[0].env.TENCENTCLOUD_SESSIONTOKEN, 'ses-token');
    assert.equal(seen[0].env.DEMOX_BIZ_SECRET_ID, undefined);
    assert.notEqual(seen[0].env.TENCENTCLOUD_SECRETID, 'gw-id');
    assert.notEqual(seen[0].env.TENCENTCLOUD_SECRETID, 'planted-id');
    assert.equal(assumeCalls.length, 1);
    assert.equal(sessionPolicyAllowsSsl(assumeCalls[0].policy), false);
    assert.equal(sessionPolicyAllowsSes(assumeCalls[0].policy), false);
    assert.equal(assumeCalls[0].token, 'gw-token');

    const renew = await publish(service, {
      websiteId: PLATFORM_ID,
      slug: 'cert-renew',
      routes: [],
      timerName: 'monthly-renew'
    });
    repository.functions.get(renew.functionId).env.TENCENTCLOUD_SESSIONTOKEN = 'planted-session-policy-token';
    await service.invoke({
      functionId: renew.functionId,
      event: { Type: 'Timer', TriggerName: 'monthly-renew' }
    });
    assert.equal(assumeCalls.length, 1);
    assert.equal(seen[1].pool, 'platform');
    assert.equal(seen[1].env.TENCENTCLOUD_SECRETID, 'gw-id');
    assert.equal(seen[1].env.TENCENTCLOUD_SECRETKEY, 'gw-key');
    assert.equal(seen[1].env.TENCENTCLOUD_SESSIONTOKEN, 'gw-token');
    assert.notEqual(seen[1].env.TENCENTCLOUD_SESSIONTOKEN, 'ses-token');
    assert.notEqual(seen[1].env.TENCENTCLOUD_SESSIONTOKEN, 'planted-session-policy-token');
    assert.equal(process.env.TENCENTCLOUD_SECRETID, 'gw-id');
    assert.equal(process.env.TENCENTCLOUD_SESSIONTOKEN, 'gw-token');
  });
});

test('prefixes off and the user pool do not assume or replace the gateway role credentials', async () => {
  await withEnv({
    ...ROLE_ENV,
    FUNCTIONS_PLATFORM_RUNTIME_PREFIXES: undefined,
    FUNCTIONS_PLATFORM_SITE_MODE: 'user-runtime',
    DEMOX_PLATFORM_WEBSITE_ID: undefined
  }, async () => {
    let assumed = 0;
    const provider = createBusinessCredentialProvider({
      assume: async () => {
        assumed += 1;
        throw new Error('should not assume');
      }
    });
    const { service, seen } = serviceWith(provider);
    const auth = await publish(service, { websiteId: PLATFORM_ID, slug: 'auth', routes: ['/auth'] });
    await service.invoke({
      functionId: auth.functionId,
      event: { httpMethod: 'POST', path: '/auth/login', headers: {} }
    });
    assert.equal(assumed, 0);
    assert.equal(seen[0].pool, 'user');
    assert.equal(seen[0].env.TENCENTCLOUD_SECRETID, 'gw-id');
    delete process.env.FUNCTIONS_PLATFORM_SITE_MODE;
    await assert.rejects(
      service.invoke({
        functionId: auth.functionId,
        event: { httpMethod: 'POST', path: '/auth/login', headers: {} }
      }),
      (error) => error.code === 'PLATFORM_SITE_IN_PROCESS'
    );
    assert.equal(assumed, 0);
    assert.equal(process.env.TENCENTCLOUD_SESSIONTOKEN, 'gw-token');
    const userSite = await publish(service, { websiteId: 'site-a', slug: 'hello', routes: ['/hello'] });
    process.env.FUNCTIONS_PLATFORM_RUNTIME_PREFIXES = '/hello';
    await service.invoke({
      functionId: userSite.functionId,
      event: { httpMethod: 'GET', path: '/hello', headers: {} }
    });
    assert.equal(assumed, 0);
    assert.equal(seen[1].pool, 'user');
    assert.equal(seen[1].env.TENCENTCLOUD_SECRETID, undefined);
  });
});

test('a failed business assume does not run the function with role credentials', async () => {
  await withEnv({
    ...ROLE_ENV,
    FUNCTIONS_PLATFORM_RUNTIME_PREFIXES: '/website',
    DEMOX_PLATFORM_WEBSITE_ID: undefined
  }, async () => {
    const provider = createBusinessCredentialProvider({
      assume: async () => {
        const error = new Error('denied');
        error.code = 'InternalError';
        throw error;
      }
    });
    const { service, seen } = serviceWith(provider);
    const website = await publish(service, { websiteId: PLATFORM_ID, slug: 'website', routes: ['/website'] });
    await assert.rejects(
      service.invoke({
        functionId: website.functionId,
        event: { httpMethod: 'POST', path: '/website/list', headers: {} }
      }),
      (error) => error.code === 'BUSINESS_ROLE_ASSUME_FAILED'
    );
    assert.equal(seen.length, 0);
    assert.equal(process.env.TENCENTCLOUD_SECRETID, 'gw-id');
    assert.equal(process.env.TENCENTCLOUD_SESSIONTOKEN, 'gw-token');
  });
});

test('DEMOX_BIZ_* cannot be stored as function or website env', async () => {
  const { service } = serviceWith({ async credentialsFor() { return {}; } });
  const created = await service.createFunction({
    ownerId: 'owner-1',
    websiteId: PLATFORM_ID,
    name: 'Auth',
    slug: 'auth'
  });
  await assert.rejects(
    service.putFunctionEnv({
      ownerId: 'owner-1',
      functionId: created.functionId,
      env: { DEMOX_BIZ_SECRET_ID: 'long-lived' }
    }),
    (error) => error.code === 'LONG_LIVED_BIZ_KEY'
  );
  await assert.rejects(
    service.putFunctionEnv({
      ownerId: 'owner-1',
      functionId: created.functionId,
      env: { DEMOX_BIZ_SECRET_KEY: { type: 'secret', value: 'long-lived' } }
    }),
    (error) => error.code === 'LONG_LIVED_BIZ_KEY'
  );
  await assert.rejects(
    service.putWebsiteEnv(PLATFORM_ID, { DEMOX_BIZ_SESSION_TOKEN: 'long-lived' }),
    (error) => error.code === 'LONG_LIVED_BIZ_KEY'
  );
});

test('the worker and the platform invoke payload receive the invocation credentials only', async () => {
  const previous = {
    TENCENTCLOUD_SECRETID: process.env.TENCENTCLOUD_SECRETID,
    TENCENTCLOUD_SECRETKEY: process.env.TENCENTCLOUD_SECRETKEY,
    TENCENTCLOUD_SESSIONTOKEN: process.env.TENCENTCLOUD_SESSIONTOKEN
  };
  process.env.TENCENTCLOUD_SECRETID = 'gw-id';
  process.env.TENCENTCLOUD_SECRETKEY = 'gw-key';
  process.env.TENCENTCLOUD_SESSIONTOKEN = 'gw-token';
  try {
    const result = await executeNodejsPayload({
      source: `module.exports = async function () {
        return {
          id: process.env.TENCENTCLOUD_SECRETID || null,
          key: process.env.TENCENTCLOUD_SECRETKEY || null,
          token: process.env.TENCENTCLOUD_SESSIONTOKEN || null,
          biz: process.env.DEMOX_BIZ_SECRET_ID || null
        };
      };`,
      request: { method: 'POST', path: '/auth/login' },
      env: {
        TENCENTCLOUD_SECRETID: 'ses-id',
        TENCENTCLOUD_SECRETKEY: 'ses-key',
        TENCENTCLOUD_SESSIONTOKEN: 'ses-token'
      },
      limits: { timeoutMs: 5000, memoryLimitBytes: 64 * 1024 * 1024 }
    });
    assert.deepEqual(result, { id: 'ses-id', key: 'ses-key', token: 'ses-token', biz: null });
    const calls = [];
    const invoke = createScfNodeInvoker({
      functionName: 'demox-platform-nodejs',
      namespace: 'demox',
      invoke: async (request) => {
        calls.push(request);
        return { ok: true, result: { status: 200, body: 'remote' } };
      }
    });
    await invoke({
      source: 'module.exports = () => null',
      request: { method: 'POST', path: '/website' },
      env: {
        TENCENTCLOUD_SECRETID: 'ses-id',
        TENCENTCLOUD_SECRETKEY: 'ses-key',
        TENCENTCLOUD_SESSIONTOKEN: 'ses-token'
      },
      limits: { timeoutMs: 1000 }
    });
    assert.equal(calls[0].functionName, 'demox-platform-nodejs');
    assert.equal(calls[0].payload.env.TENCENTCLOUD_SECRETID, 'ses-id');
    assert.equal(calls[0].payload.env.TENCENTCLOUD_SESSIONTOKEN, 'ses-token');
    assert.equal(calls[0].payload.env.DEMOX_BIZ_SECRET_ID, undefined);
  } finally {
    resetNodeWorkerPool();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('role ARN is only the pinned demox-runtime-role and session mode does not read env without ALS', async () => {
  const rejected = [
    'qcs::cam::uin/100021031865:roleName/demox-runtime-b1',
    'qcs::cam::uin/100021031865:roleName/demox-gateway-role',
    'qcs::cam::uin/100021031865:roleName/demox-platform-ses',
    'qcs::cam::uin/100021031866:roleName/demox-runtime-role',
    'not-an-arn'
  ];
  assert.equal(BUSINESS_ROLE_ENV, 'BUSINESS_ROLE_ARN');
  assert.equal(BUSINESS_CREDENTIALS_MODE_ENV, 'BUSINESS_CREDENTIALS_MODE');
  assert.equal(BUSINESS_CREDENTIALS_LEGACY_MODE, 'execution-role');
  assert.equal(inProcessBusinessCredentialMode({}), 'legacy');
  assert.equal(inProcessBusinessCredentialMode({ BUSINESS_ROLE_ARN: BUSINESS_ROLE_ARN }), 'session');
  assert.equal(inProcessBusinessCredentialMode({
    BUSINESS_ROLE_ARN: BUSINESS_ROLE_ARN,
    BUSINESS_CREDENTIALS_MODE: 'execution-role'
  }), 'legacy');
  for (const arn of rejected) {
    assert.equal(inProcessBusinessCredentialMode({ BUSINESS_ROLE_ARN: arn }), 'invalid');
    assert.throws(
      () => resolveBusinessRoleArn({ BUSINESS_ROLE_ARN: arn }),
      (error) => error.code === 'BUSINESS_ROLE_ARN_INVALID'
    );
  }
  assert.equal(inProcessBusinessCredentialMode({ BUSINESS_CREDENTIALS_MODE: 'session' }), 'missing');
  assert.equal(resolveBusinessRoleArn({}), BUSINESS_ROLE_ARN);
  assert.equal(resolveBusinessRoleArn({ BUSINESS_ROLE_ARN: BUSINESS_ROLE_ARN }), BUSINESS_ROLE_ARN);

  const beforeId = process.env.TENCENTCLOUD_SECRETID;
  const beforeToken = process.env.TENCENTCLOUD_SESSIONTOKEN;
  const sessionEnv = { ...ROLE_ENV, BUSINESS_ROLE_ARN: BUSINESS_ROLE_ARN };
  const assumeCalls = [];
  const provider = createBusinessCredentialProvider({
    env: sessionEnv,
    assume: async (request) => {
      assumeCalls.push(request);
      return { secretId: 'biz-id', secretKey: 'biz-key', token: 'biz-token', expiration: '2099-01-01T00:00:00Z' };
    }
  });
  const issued = await provider.credentialsFor({
    kind: 'business',
    slug: 'website',
    functionId: 'fn_web',
    websiteId: PLATFORM_ID,
    sourceEnv: sessionEnv
  });
  assert.equal(assumeCalls[0].roleArn, BUSINESS_ROLE_ARN);
  assert.equal(issued.TENCENTCLOUD_SECRETID, 'biz-id');
  assert.equal(typeof issued.expiresAt, 'number');
  assert.equal(process.env.TENCENTCLOUD_SECRETID, beforeId);
  assert.equal(process.env.TENCENTCLOUD_SESSIONTOKEN, beforeToken);
  const rejectedProvider = createBusinessCredentialProvider({
    env: { ...ROLE_ENV, BUSINESS_ROLE_ARN: rejected[0] },
    assume: async () => {
      throw new Error('should not assume');
    }
  });
  await assert.rejects(
    rejectedProvider.credentialsFor({
      kind: 'business',
      slug: 'website',
      functionId: 'fn_rejected',
      websiteId: PLATFORM_ID,
      sourceEnv: { ...ROLE_ENV, BUSINESS_ROLE_ARN: rejected[1] }
    }),
    (error) => error.code === 'BUSINESS_ROLE_ARN_INVALID'
  );

  let seen = null;
  await runWithBusinessCredentials({ secretId: 'biz-id', secretKey: 'biz-key', token: 'biz-token' }, () => {
    seen = tencentClientCredentials(sessionEnv);
    assert.equal(process.env.TENCENTCLOUD_SECRETID, beforeId);
  });
  assert.deepEqual(seen, { secretId: 'biz-id', secretKey: 'biz-key', token: 'biz-token' });
  assert.throws(
    () => tencentClientCredentials(sessionEnv),
    (error) => error.code === 'BUSINESS_CREDENTIALS_MISSING'
  );
  for (const arn of rejected) {
    assert.throws(
      () => tencentClientCredentials({ ...ROLE_ENV, BUSINESS_ROLE_ARN: arn }),
      (error) => error.code === 'BUSINESS_ROLE_ARN_INVALID'
    );
  }
  assert.throws(
    () => tencentClientCredentials({ ...ROLE_ENV, BUSINESS_CREDENTIALS_MODE: 'session' }),
    (error) => error.code === 'BUSINESS_ROLE_ARN_MISSING'
  );
  assert.equal(tencentClientCredentials({
    ...ROLE_ENV,
    BUSINESS_ROLE_ARN: rejected[0],
    BUSINESS_CREDENTIALS_MODE: 'execution-role'
  }).secretId, 'gw-id');
  assert.equal(tencentClientCredentials(ROLE_ENV).secretId, 'gw-id');
  assert.equal(tencentClientCredentials().secretId, beforeId || '');
});

test('no token reached any console log in this suite', () => {
  logGuard.assertNoLeaks();
});
