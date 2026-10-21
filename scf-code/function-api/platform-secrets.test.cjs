'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const logGuard = require('../../scripts/log-leak-guard.cjs').installLogLeakGuard();
const { InMemoryBundleStore } = require('./bundle-store.js');
const { InMemoryFunctionRepository, createMysqlFunctionRepository } = require('./repository.js');
const { FunctionService } = require('./service.js');
const { createFunctionHttpHandler, createPlatformHandler } = require('./index.js');
const { createPoolRoutingRuntime } = require('./platform-pool.js');
const {
  encryptPlatformSecret,
  decryptPlatformSecret,
  platformDispatchPool,
  PLATFORM_POOL_FUNCTION,
  USER_POOL_FUNCTION
} = require('./platform-secrets.js');
const { PLATFORM_POOL_SPEC } = require('./platform-pool-spec.js');

const PLATFORM_ID = 'EPX2UU43';
const SECRET_VALUE = 'plat-secret-value';
const KEY = 'platform-secrets-test-key';

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

function serviceWith(runtime, extras = {}) {
  const repository = new InMemoryFunctionRepository();
  const bundleStore = new InMemoryBundleStore();
  const seen = [];
  const recording = runtime || {
    async execute(opts) {
      seen.push(opts);
      return { status: 200, headers: {}, body: 'ok' };
    }
  };
  const service = new FunctionService({
    repository,
    bundleStore,
    runtime: recording,
    publicBaseUrl: 'https://functions.test',
    ...extras
  });
  return { service, repository, bundleStore, seen };
}

async function publish(service, { websiteId, slug, routes, source, timerName }) {
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
    source: source || 'exports.main = async function () { return { statusCode: 200, body: "published" }; };'
  });
  await service.publishVersion({ ownerId: 'owner-1', functionId: created.functionId, version: 1 });
  return created;
}

test('AES-256-GCM ciphertext carries the key id and does not use ENCRYPTION_KEY', () => {
  withEnv({
    PLATFORM_SECRETS_KEY: KEY,
    PLATFORM_SECRETS_KEY_ID: 'k1',
    PLATFORM_SECRETS_KEYRING: undefined,
    ENCRYPTION_KEY: 'encryption-key-should-not-be-used'
  }, () => {
    const cipher = encryptPlatformSecret(SECRET_VALUE);
    assert.match(cipher, /^ds1:k1:/);
    assert.equal(cipher.includes(SECRET_VALUE), false);
    assert.equal(decryptPlatformSecret(cipher), SECRET_VALUE);
    const other = encryptPlatformSecret(SECRET_VALUE);
    assert.notEqual(cipher, other);
  });
  withEnv({
    PLATFORM_SECRETS_KEY: undefined,
    PLATFORM_SECRETS_KEYRING: undefined,
    ENCRYPTION_KEY: 'encryption-key-should-not-be-used'
  }, () => {
    assert.throws(() => encryptPlatformSecret(SECRET_VALUE), (error) => error.code === 'PLATFORM_SECRET_KEY_MISSING');
  });
});

test('key id rotation decrypts old ciphertext and stamps the new id', () => {
  const oldKey = 'platform-secrets-old-key';
  const nextKey = 'platform-secrets-new-key';
  let cipher;
  withEnv({ PLATFORM_SECRETS_KEY: oldKey, PLATFORM_SECRETS_KEY_ID: 'k1', PLATFORM_SECRETS_KEYRING: undefined }, () => {
    cipher = encryptPlatformSecret(SECRET_VALUE);
  });
  withEnv({
    PLATFORM_SECRETS_KEY: nextKey,
    PLATFORM_SECRETS_KEY_ID: 'k2',
    PLATFORM_SECRETS_KEYRING: JSON.stringify({ k1: oldKey })
  }, () => {
    assert.equal(decryptPlatformSecret(cipher), SECRET_VALUE);
    assert.match(encryptPlatformSecret('rotated-value'), /^ds1:k2:/);
  });
  withEnv({ PLATFORM_SECRETS_KEY: nextKey, PLATFORM_SECRETS_KEY_ID: 'k2', PLATFORM_SECRETS_KEYRING: undefined }, () => {
    assert.throws(() => decryptPlatformSecret(cipher), (error) => error.code === 'PLATFORM_SECRET_KEY_MISSING');
  });
});

test('non-EPX2UU43 projects cannot create or read platform secrets', async () => {
  await withEnv({ PLATFORM_SECRETS_KEY: KEY, PLATFORM_SECRETS_KEY_ID: 'k1', DEMOX_PLATFORM_WEBSITE_ID: undefined }, async () => {
    const { service, repository } = serviceWith();
    const created = await service.createFunction({
      ownerId: 'owner-1', websiteId: 'site-a', name: 'Hello', slug: 'hello'
    });
    await assert.rejects(
      service.putFunctionEnv({
        ownerId: 'owner-1',
        functionId: created.functionId,
        env: { PLAIN: 'visible', MYSQL_PASSWORD: { type: 'secret', value: SECRET_VALUE } }
      }),
      (error) => error.code === 'PLATFORM_SECRET_FORBIDDEN'
    );
    await assert.rejects(
      service.createFunction({
        ownerId: 'owner-1',
        websiteId: 'site-b',
        name: 'Other',
        slug: 'other',
        env: { TOKEN: { type: 'secret', value: SECRET_VALUE } }
      }),
      (error) => error.code === 'PLATFORM_SECRET_FORBIDDEN'
    );
    const env = await service.getFunctionEnv({ ownerId: 'owner-1', functionId: created.functionId });
    assert.equal(JSON.stringify(env).includes(SECRET_VALUE), false);
    assert.equal(env.MYSQL_PASSWORD, undefined);
    const stored = await repository.getFunctionSecrets(created.functionId);
    assert.deepEqual(stored, {});
    assert.equal(JSON.stringify(repository.functions.get(created.functionId).env).includes(SECRET_VALUE), false);
  });
});

test('platform project stores ciphertext and reads back only the name', async () => {
  await withEnv({ PLATFORM_SECRETS_KEY: KEY, PLATFORM_SECRETS_KEY_ID: 'k9', DEMOX_PLATFORM_WEBSITE_ID: undefined }, async () => {
    const { service, repository } = serviceWith();
    const created = await service.createFunction({
      ownerId: 'owner-1',
      websiteId: PLATFORM_ID,
      name: 'Auth',
      slug: 'auth',
      env: { LOG_LEVEL: 'info', JWT_SECRET: { type: 'secret', value: SECRET_VALUE } }
    });
    const env = await service.getFunctionEnv({ ownerId: 'owner-1', functionId: created.functionId });
    assert.equal(env.LOG_LEVEL, 'info');
    assert.deepEqual(env.JWT_SECRET, { type: 'secret' });
    assert.equal(JSON.stringify(env).includes(SECRET_VALUE), false);
    const cipher = await repository.getFunctionSecrets(created.functionId);
    assert.match(cipher.JWT_SECRET, /^ds1:k9:/);
    assert.equal(cipher.JWT_SECRET.includes(SECRET_VALUE), false);
    assert.equal(repository.functions.get(created.functionId).env.JWT_SECRET, undefined);
    const kept = await service.putFunctionEnv({
      ownerId: 'owner-1',
      functionId: created.functionId,
      env: { LOG_LEVEL: 'debug', JWT_SECRET: { type: 'secret' } }
    });
    assert.equal(kept.LOG_LEVEL, 'debug');
    assert.deepEqual(kept.JWT_SECRET, { type: 'secret' });
    assert.equal((await repository.getFunctionSecrets(created.functionId)).JWT_SECRET, cipher.JWT_SECRET);
  });
});

test('user-pool dispatch never receives platform secrets', async () => {
  await withEnv({
    PLATFORM_SECRETS_KEY: KEY,
    PLATFORM_SECRETS_KEY_ID: 'k1',
    FUNCTIONS_PLATFORM_SITE_MODE: 'user-runtime',
    FUNCTIONS_PLATFORM_RUNTIME_PREFIXES: undefined,
    TENCENTCLOUD_SECRETID: 'gateway-temp-id',
    DEMOX_PLATFORM_WEBSITE_ID: undefined
  }, async () => {
    const { service, seen } = serviceWith();
    const created = await publish(service, { websiteId: PLATFORM_ID, slug: 'auth', routes: ['/auth'] });
    await service.putFunctionEnv({
      ownerId: 'owner-1',
      functionId: created.functionId,
      env: { JWT_SECRET: { type: 'secret', value: SECRET_VALUE }, PLAIN: 'ok' }
    });
    await service.invoke({
      functionId: created.functionId,
      event: { httpMethod: 'POST', path: '/auth/login', headers: {} }
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].pool, 'user');
    assert.equal(seen[0].env.PLAIN, 'ok');
    assert.equal(seen[0].env.JWT_SECRET, undefined);
    assert.equal(JSON.stringify(seen[0].env).includes(SECRET_VALUE), false);
    assert.equal(seen[0].env.TENCENTCLOUD_SECRETID, 'gateway-temp-id');
    const userSite = await publish(service, { websiteId: 'site-a', slug: 'hello', routes: ['/hello'] });
    await service.invoke({
      functionId: userSite.functionId,
      event: { httpMethod: 'GET', path: '/hello', headers: {} }
    });
    assert.equal(seen[1].pool, 'user');
    assert.equal(seen[1].env.JWT_SECRET, undefined);
  });
});

test('prefix switch defaults off and only the enabled prefix reaches the platform pool', async () => {
  await withEnv({
    PLATFORM_SECRETS_KEY: KEY,
    PLATFORM_SECRETS_KEY_ID: 'k1',
    FUNCTIONS_PLATFORM_SITE_MODE: undefined,
    FUNCTIONS_PLATFORM_RUNTIME_PREFIXES: undefined,
    TENCENTCLOUD_SECRETID: 'gateway-temp-id',
    TENCENTCLOUD_SECRETKEY: 'gateway-temp-key',
    TENCENTCLOUD_SESSIONTOKEN: 'gateway-temp-token',
    DEMOX_PLATFORM_WEBSITE_ID: undefined
  }, async () => {
    const cloudCalls = [];
    const { service, seen } = serviceWith(undefined, {
      businessCredentials: {
        async credentialsFor(request) {
          cloudCalls.push(`${request.kind}:${request.slug}`);
          if (request.kind === 'certificate') {
            return {
              TENCENTCLOUD_SECRETID: 'gw-id',
              TENCENTCLOUD_SECRETKEY: 'gw-key',
              TENCENTCLOUD_SESSIONTOKEN: 'gw-token'
            };
          }
          return {
            TENCENTCLOUD_SECRETID: 'ses-id',
            TENCENTCLOUD_SECRETKEY: 'ses-key',
            TENCENTCLOUD_SESSIONTOKEN: 'ses-token'
          };
        }
      }
    });
    const auth = await publish(service, { websiteId: PLATFORM_ID, slug: 'auth', routes: ['/auth'] });
    const mcp = await publish(service, { websiteId: PLATFORM_ID, slug: 'mcp', routes: ['/mcp', '/deploy'] });
    await service.putFunctionEnv({
      ownerId: 'owner-1',
      functionId: mcp.functionId,
      env: { WEBSITE_API_URL: { type: 'secret', value: SECRET_VALUE } }
    });
    await assert.rejects(
      service.invoke({ functionId: auth.functionId, event: { httpMethod: 'POST', path: '/auth/login', headers: {} } }),
      (error) => error.code === 'PLATFORM_SITE_IN_PROCESS'
    );
    assert.equal(seen.length, 0);
    assert.deepEqual(cloudCalls, []);
    assert.equal(platformDispatchPool({ websiteId: PLATFORM_ID }, { path: '/auth/login' }), 'in-process');
    process.env.FUNCTIONS_PLATFORM_RUNTIME_PREFIXES = '/mcp,/health,timer:monthly-renew';
    await assert.rejects(
      service.invoke({ functionId: auth.functionId, event: { httpMethod: 'POST', path: '/auth/login', headers: {} } }),
      (error) => error.code === 'PLATFORM_SITE_IN_PROCESS'
    );
    await assert.rejects(
      service.invoke({ functionId: auth.functionId, event: { httpMethod: 'GET', path: '/health', headers: {} } }),
      (error) => error.code === 'PLATFORM_SITE_IN_PROCESS'
    );
    await service.invoke({
      functionId: mcp.functionId,
      event: { httpMethod: 'POST', path: '/mcp/tools', headers: {} }
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].pool, 'platform');
    assert.equal(seen[0].env.WEBSITE_API_URL, SECRET_VALUE);
    assert.equal(seen[0].env.TENCENTCLOUD_SECRETID, 'ses-id');
    assert.equal(seen[0].env.TENCENTCLOUD_SECRETKEY, 'ses-key');
    assert.equal(seen[0].env.TENCENTCLOUD_SESSIONTOKEN, 'ses-token');
    assert.equal(Object.keys(seen[0].env).some((key) => key.startsWith('DEMOX_BIZ_')), false);
    const renew = await publish(service, {
      websiteId: PLATFORM_ID,
      slug: 'cert-renew',
      routes: [],
      timerName: 'monthly-renew'
    });
    await service.invoke({
      functionId: renew.functionId,
      event: { Type: 'Timer', TriggerName: 'monthly-renew' }
    });
    assert.equal(seen[1].pool, 'platform');
    assert.equal(seen[1].env.TENCENTCLOUD_SECRETID, 'gw-id');
    assert.equal(seen[1].env.TENCENTCLOUD_SESSIONTOKEN, 'gw-token');
    assert.notEqual(seen[1].env.TENCENTCLOUD_SESSIONTOKEN, seen[0].env.TENCENTCLOUD_SESSIONTOKEN);
    assert.deepEqual(cloudCalls, ['business:mcp', 'certificate:cert-renew']);
    assert.equal(process.env.TENCENTCLOUD_SECRETID, 'gateway-temp-id');
    assert.equal(process.env.TENCENTCLOUD_SESSIONTOKEN, 'gateway-temp-token');
    assert.equal(seen.length, 2);
  });
});

test('routing runtime never hands platform env to the user pool', async () => {
  const userCalls = [];
  const platformCalls = [];
  const runtime = createPoolRoutingRuntime({
    userRuntime: { async execute(opts) { userCalls.push(opts); return { ok: true }; } },
    platformRuntime: { async execute(opts) { platformCalls.push(opts); return { ok: true }; } }
  });
  await runtime.execute({ pool: 'platform', env: { JWT_SECRET: SECRET_VALUE } });
  await runtime.execute({ pool: 'user', env: { PLAIN: 'ok' } });
  assert.equal(userCalls.length, 1);
  assert.equal(platformCalls.length, 1);
  assert.equal(userCalls[0].env.JWT_SECRET, undefined);
  assert.equal(platformCalls[0].env.JWT_SECRET, SECRET_VALUE);
  const missing = createPoolRoutingRuntime({
    userRuntime: { async execute() { throw new Error('user pool must not run'); } }
  });
  await assert.rejects(
    missing.execute({ pool: 'platform', env: { JWT_SECRET: SECRET_VALUE } }),
    (error) => error.code === 'PLATFORM_RUNTIME_NOT_CONFIGURED'
  );
});

test('gateway admin alias changes do not call /auth or either runtime pool', async () => {
  await withEnv({
    FUNCTIONS_PLATFORM_RUNTIME_PREFIXES: '/auth',
    FUNCTIONS_PLATFORM_SITE_MODE: undefined,
    DEMOX_PLATFORM_WEBSITE_ID: undefined
  }, async () => {
    const repository = new InMemoryFunctionRepository();
    const bundleStore = new InMemoryBundleStore();
    const calls = { auth: 0, runtime: 0 };
    const userHandler = createFunctionHttpHandler({
      repository,
      bundleStore,
      runtime: {
        async execute() {
          calls.runtime += 1;
          return { status: 200, body: 'runtime' };
        }
      },
      authenticate: () => ({ userId: 'owner-1' }),
      publicBaseUrl: 'https://functions.test',
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
    const handler = createPlatformHandler({
      userHandler,
      systemHandler: async (event) => {
        if (String(event.path || '').startsWith('/auth')) calls.auth += 1;
        return { statusCode: 200, body: 'system' };
      }
    });
    const created = JSON.parse((await handler({
      path: '/functions',
      httpMethod: 'POST',
      body: { websiteId: PLATFORM_ID, name: 'Auth', slug: 'auth', routes: ['/auth'] },
      headers: { 'content-type': 'application/json' }
    })).body).function;
    await handler({
      path: `/functions/${created.functionId}/versions`,
      httpMethod: 'POST',
      body: { source: 'exports.main = async function () { return { statusCode: 200, body: "a" }; };' },
      headers: { 'content-type': 'application/json' }
    });
    const alias = await handler({
      path: `/functions/${created.functionId}/aliases/production`,
      httpMethod: 'POST',
      body: { version: 1 },
      headers: { 'content-type': 'application/json' }
    });
    assert.equal(alias.statusCode, 200);
    assert.equal(calls.auth, 0);
    assert.equal(calls.runtime, 0);
    const login = await handler({
      path: '/auth/login',
      httpMethod: 'POST',
      body: {},
      headers: { 'content-type': 'application/json' }
    });
    assert.equal(login.body, 'runtime');
    assert.equal(calls.auth, 0);
    assert.equal(calls.runtime, 1);
    delete process.env.FUNCTIONS_PLATFORM_NODE_RUNTIME_URL;
    const fallback = await handler({
      path: '/health',
      httpMethod: 'GET',
      body: {},
      headers: {}
    });
    assert.equal(fallback.body, 'system');
    assert.equal(calls.runtime, 1);
  });
});

test('mysql repository stores ciphertext only', async () => {
  await withEnv({ PLATFORM_SECRETS_KEY: KEY, PLATFORM_SECRETS_KEY_ID: 'k1' }, async () => {
    const queries = [];
    const row = {
      function_id: 'fn_platform01',
      owner_user_id: 'owner-1',
      website_id: PLATFORM_ID,
      name: 'Auth',
      slug: 'auth',
      status: 'active',
      published_version: 1,
      timeout_ms: 15000,
      memory_limit_bytes: 16777216,
      max_body_bytes: 65536,
      max_response_bytes: 262144,
      max_code_bytes: 262144,
      max_invocations_per_minute: 60,
      env_json: '{"LOG_LEVEL":"info"}',
      allowed_outbound_hosts_json: '[]',
      runtime: 'nodejs',
      routes_json: '["/auth"]',
      triggers_json: '["http"]',
      timer_name: null
    };
    let secretsJson = '{}';
    const query = async (sql, params) => {
      queries.push({ sql, params });
      if (/FROM demox_functions WHERE function_id/.test(sql)) return [row];
      if (/FROM demox_function_platform_secrets/.test(sql)) {
        return secretsJson === '{}' ? [] : [{ secrets_json: secretsJson }];
      }
      if (/INSERT INTO demox_function_platform_secrets/.test(sql)) {
        secretsJson = params[1];
        return { affectedRows: 1 };
      }
      if (/UPDATE demox_functions SET env_json/.test(sql)) {
        row.env_json = params[0];
        return { affectedRows: 1 };
      }
      return [];
    };
    const repository = createMysqlFunctionRepository({ query, transaction: async (fn) => fn({ query: async () => [[]] }) });
    const service = new FunctionService({
      repository,
      bundleStore: new InMemoryBundleStore(),
      runtime: { async execute() { return { status: 200, body: '' }; } }
    });
    const env = await service.putFunctionEnv({
      ownerId: 'owner-1',
      functionId: 'fn_platform01',
      env: { LOG_LEVEL: 'info', JWT_SECRET: { type: 'secret', value: SECRET_VALUE } }
    });
    assert.deepEqual(env.JWT_SECRET, { type: 'secret' });
    const write = queries.find((item) => /demox_function_platform_secrets/.test(item.sql) && /INSERT/.test(item.sql));
    assert.ok(write);
    assert.equal(String(write.params[1]).includes(SECRET_VALUE), false);
    assert.match(String(write.params[1]), /ds1:k1:/);
    assert.equal(row.env_json.includes(SECRET_VALUE), false);
  });
});

test('platform pool spec keeps the user pool free of secrets and refuses apply', () => {
  assert.equal(PLATFORM_POOL_SPEC.functionName, PLATFORM_POOL_FUNCTION);
  assert.notEqual(PLATFORM_POOL_SPEC.functionName, USER_POOL_FUNCTION);
  assert.equal(PLATFORM_POOL_SPEC.namespace, 'demox');
  assert.equal(PLATFORM_POOL_SPEC.memoryMB, 512);
  assert.equal(PLATFORM_POOL_SPEC.timeoutSec, 300);
  assert.equal(PLATFORM_POOL_SPEC.capacity.authProvisionedConcurrency, 0);
  assert.equal(PLATFORM_POOL_SPEC.capacity.reservedConcurrency, null);
  assert.equal(PLATFORM_POOL_SPEC.network.mysqlHostEnv, 'MYSQL_HOST');
  assert.equal(PLATFORM_POOL_SPEC.network.vpcId, 'REPLACE_ME_VPC_ID');
  assert.equal(PLATFORM_POOL_SPEC.camRole.name, 'demox-platform-runtime-role');
  assert.equal(PLATFORM_POOL_SPEC.gateway.secretKeyEnv, 'PLATFORM_SECRETS_KEY');
  assert.equal(PLATFORM_POOL_SPEC.gateway.kms, false);
  assert.equal(PLATFORM_POOL_SPEC.gateway.reuseEncryptionKey, false);
  assert.equal(PLATFORM_POOL_SPEC.gateway.prefixSwitchDefault, '');
  assert.equal(PLATFORM_POOL_SPEC.resources.edgeone.zoneId, 'zone-3kplfkbflnd6');
  assert.equal(PLATFORM_POOL_SPEC.resources.cls.topic, 'SCF_logtopic_yorder');
  assert.equal(PLATFORM_POOL_SPEC.resources.mail.action, 'ses:SendEmail');
  assert.equal(PLATFORM_POOL_SPEC.switches.userPoolReceivesPlatformSecrets, false);
  assert.equal(PLATFORM_POOL_SPEC.switches.businessSessionPolicy, 'cos-eo-dns-ses-cls');
  assert.equal(PLATFORM_POOL_SPEC.switches.certificateCredentials, 'role-without-session-policy');
  assert.equal(PLATFORM_POOL_SPEC.switches.longLivedBizKeys, false);
  const manifest = require('../../functions.json');
  const pool = manifest.functions.find((item) => item.name === 'demox-platform-nodejs');
  const user = manifest.functions.find((item) => item.name === 'demox-user-nodejs');
  assert.equal(pool.releaseVia, 'none');
  assert.deepEqual(pool.runtime.environmentNames, ['FUNCTION_RUNTIME', 'RUNTIME_INVOKE_SECRET']);
  assert.deepEqual(user.runtime.environmentNames, ['FUNCTION_RUNTIME', 'RUNTIME_INVOKE_SECRET']);
  assert.equal(pool.network.mysqlHostEnv, 'MYSQL_HOST');
  const script = path.join(__dirname, '../../scripts/platform-runtime-pool.mjs');
  const printed = execFileSync(process.execPath, [script], { encoding: 'utf8' });
  assert.match(printed, /demox-platform-runtime-role/);
  assert.doesNotMatch(printed, /ENCRYPTION_KEY/);
  let failed = '';
  try {
    execFileSync(process.execPath, [script, '--apply'], { encoding: 'utf8' });
    assert.fail('apply should refuse');
  } catch (error) {
    failed = `${error.stderr || ''}\n${error.stdout || ''}`;
    assert.notEqual(error.status, 0);
  }
  assert.match(failed, /不创建云资源/);
});

test.after(() => {
  logGuard.assertNoLeaks();
});
