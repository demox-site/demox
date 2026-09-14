'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { executeNodejsPayload, createScfNodeInvoker, createHttpNodeInvoker, workerEnv, resetNodeWorkerPool, sourceKey } = require('./runtime-nodejs.js');
const { main } = require('./runtime-nodejs-handler.js');
const { normalizeRuntime, runtimeTarget, SUPPORTED_RUNTIMES, PLANNED_RUNTIMES } = require('./runtimes.js');
const { platformFunctionSpecs, isFakeWrapperSource } = require('./platform-site.js');

test('runtime registry only exposes Node.js; python and go stay planned', () => {
  assert.deepEqual(SUPPORTED_RUNTIMES, ['nodejs']);
  assert.deepEqual(PLANNED_RUNTIMES, ['python', 'go']);
  assert.equal(normalizeRuntime('node'), 'nodejs');
  assert.equal(normalizeRuntime('quickjs'), 'nodejs');
  const target = runtimeTarget('nodejs', { FUNCTIONS_NODE_RUNTIME: 'demox-user-nodejs', FUNCTIONS_RUNTIME_NAMESPACE: 'demox' });
  assert.equal(target.kind, 'scf');
  assert.equal(target.functionName, 'demox-user-nodejs');
});

test('Node worker env does not inherit router secrets', () => {
  process.env.JWT_SECRET = 'router-jwt';
  process.env.MYSQL_PASSWORD = 'router-mysql';
  const env = workerEnv({ JWT_SECRET: 'site-jwt', SITE_ID: 'site-a' });
  assert.equal(env.JWT_SECRET, 'site-jwt');
  assert.equal(env.SITE_ID, 'site-a');
  assert.equal(env.MYSQL_PASSWORD, undefined);
  assert.ok(env.NODE_PATH);
});

test('local Node payload can require jsonwebtoken without seeing parent env', async () => {
  process.env.PARENT_SECRET = 'from-router';
  const result = await executeNodejsPayload({
    source: `module.exports = async function(request, env) {
      const jwt = require('jsonwebtoken');
      return {
        leaked: process.env.PARENT_SECRET == null ? null : process.env.PARENT_SECRET,
        hasJwt: typeof jwt.sign === 'function',
        site: process.env.SITE_ID
      };
    };`,
    request: { method: 'GET', path: '/' },
    env: { SITE_ID: 'site-a', JWT_SECRET: 'site-secret' },
    limits: { timeoutMs: 5000, memoryLimitBytes: 64 * 1024 * 1024 }
  });
  assert.deepEqual(result, { leaked: null, hasJwt: true, site: 'site-a' });
});

test('Node runtime SCF handler only accepts demox.runtime.execute payloads', async () => {
  const rejected = await main({ foo: 1 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'UNSUPPORTED_RUNTIME_PAYLOAD');

  const accepted = await main({
    type: 'demox.runtime.execute',
    runtime: 'nodejs',
    source: 'module.exports = async () => ({ status: 201, body: "ok" });',
    request: { method: 'GET', path: '/' },
    env: {},
    limits: { timeoutMs: 5000, memoryLimitBytes: 64 * 1024 * 1024 }
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.result.status, 201);
  assert.equal(accepted.result.body, 'ok');
});

test('HTTP runtime handler requires invoke token and unwraps the body', async () => {
  const previous = process.env.RUNTIME_INVOKE_SECRET;
  process.env.RUNTIME_INVOKE_SECRET = 'test-runtime-secret';
  try {
    const denied = await main({
      httpMethod: 'POST',
      path: '/',
      headers: {},
      body: JSON.stringify({
        type: 'demox.runtime.execute',
        runtime: 'nodejs',
        source: 'module.exports = async () => ({ status: 201, body: "ok" });',
        request: {},
        env: {},
        limits: { timeoutMs: 5000 }
      })
    });
    assert.equal(denied.statusCode, 401);
    assert.equal(JSON.parse(denied.body).error.code, 'UNAUTHORIZED');

    const accepted = await main({
      httpMethod: 'POST',
      path: '/',
      headers: { 'x-demox-runtime-token': 'test-runtime-secret' },
      body: JSON.stringify({
        type: 'demox.runtime.execute',
        runtime: 'nodejs',
        source: 'module.exports = async () => ({ status: 202, body: "http" });',
        request: {},
        env: {},
        limits: { timeoutMs: 5000, memoryLimitBytes: 64 * 1024 * 1024 }
      })
    });
    assert.equal(accepted.statusCode, 200);
    assert.equal(JSON.parse(accepted.body).result.status, 202);
  } finally {
    if (previous === undefined) delete process.env.RUNTIME_INVOKE_SECRET;
    else process.env.RUNTIME_INVOKE_SECRET = previous;
  }
});

test('warm Node workers accept sourceHash without source', async () => {
  resetNodeWorkerPool();
  const source = `let n = 0;
module.exports = async function() {
  n += 1;
  return { n };
};`;
  const limits = { timeoutMs: 5000, memoryLimitBytes: 64 * 1024 * 1024 };
  const hash = sourceKey(source, 'index.js');
  await assert.rejects(
    () => executeNodejsPayload({ sourceHash: hash, request: {}, env: {}, limits }),
    (error) => error.code === 'SOURCE_REQUIRED'
  );
  const first = await executeNodejsPayload({ source, request: {}, env: {}, limits });
  const second = await executeNodejsPayload({ sourceHash: hash, request: {}, env: {}, limits });
  assert.equal(first.n, 1);
  assert.equal(second.n, 2);
});

test('HTTP Node invoker omits source after the runtime is warm', async () => {
  const calls = [];
  const known = new Set();
  const source = 'module.exports = () => ({ status: 200, body: "remote" })';
  const hash = sourceKey(source, 'index.js');
  const post = async (request) => {
    calls.push(request.payload);
    if (!request.payload.source && !known.has(request.payload.sourceHash)) {
      return { ok: false, error: { code: 'SOURCE_REQUIRED', message: '运行时需要源码' } };
    }
    if (request.payload.source) known.add(request.payload.sourceHash);
    return { ok: true, result: { status: 200, body: 'remote' } };
  };
  const run = createHttpNodeInvoker({ url: 'http://runtime.internal', secret: 's', post });
  const payload = { source, request: { method: 'GET', path: '/api/hello' }, env: {}, limits: { timeoutMs: 1000 } };
  await run(payload);
  const second = await run(payload);
  assert.equal(second.body, 'remote');
  assert.equal(calls[0].source, source);
  assert.equal(calls[0].sourceHash, hash);
  assert.equal(calls[1].source, undefined);
  assert.equal(calls[1].sourceHash, hash);
  assert.equal(calls.length, 2);
});

test('HTTP Node invoker resends source when a new runtime instance needs it', async () => {
  const calls = [];
  let warm = true;
  const source = 'module.exports = () => ({ status: 200, body: "retry" })';
  const post = async (request) => {
    calls.push(Boolean(request.payload.source));
    if (!request.payload.source && !warm) {
      return { ok: false, error: { code: 'SOURCE_REQUIRED', message: '运行时需要源码' } };
    }
    return { ok: true, result: { status: 200, body: 'retry' } };
  };
  const run = createHttpNodeInvoker({ url: 'http://runtime.internal', secret: 's', post });
  const payload = { source, request: {}, env: {}, limits: { timeoutMs: 1000 } };
  await run(payload);
  warm = false;
  const second = await run(payload);
  assert.equal(second.body, 'retry');
  assert.deepEqual(calls, [true, false, true]);
});

test('Node workers stay warm and keep module state across invokes', async () => {
  resetNodeWorkerPool();
  const source = `let n = 0;
module.exports = async function() {
  n += 1;
  return { n, pid: process.pid };
};`;
  const limits = { timeoutMs: 5000, memoryLimitBytes: 64 * 1024 * 1024 };
  const first = await executeNodejsPayload({ source, request: {}, env: { SITE_ID: 'a' }, limits });
  const second = await executeNodejsPayload({ source, request: {}, env: { SITE_ID: 'b' }, limits });
  assert.equal(first.n, 1);
  assert.equal(second.n, 2);
  assert.equal(first.pid, second.pid);
  const envSource = `module.exports = async function() { return process.env.SITE_ID; };`;
  const firstEnv = await executeNodejsPayload({ source: envSource, request: {}, env: { SITE_ID: 'one' }, limits });
  const secondEnv = await executeNodejsPayload({ source: envSource, request: {}, env: { SITE_ID: 'two' }, limits });
  assert.equal(firstEnv, 'one');
  assert.equal(secondEnv, 'two');
});

test('platform function specs store real backend source, not require() wrappers', () => {
  const specs = platformFunctionSpecs();
  const auth = specs.find((item) => item.slug === 'auth');
  const website = specs.find((item) => item.slug === 'website');
  assert.ok(auth && website);
  assert.equal(isFakeWrapperSource(auth.source), false);
  assert.equal(isFakeWrapperSource(website.source), false);
  assert.match(auth.source, /exports\.main/);
  assert.match(website.source, /require\('\.\/shared\/db\.js'\)/);
  assert.ok(auth.source.length > 10_000);
  assert.ok(website.source.length > 50_000);
  assert.equal(auth.packageName, 'demox-auth');
  assert.equal(auth.entrypoint, 'index.cjs');
});

test('Node worker can require sibling files from a package root and call SCF main', async () => {
  resetNodeWorkerPool();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demox-pkg-'));
  fs.writeFileSync(path.join(dir, 'helper.js'), 'module.exports = { ok: true, n: 3 };');
  const source = `const helper = require('./helper.js');
exports.main = async function(event) {
  return { ...helper, method: event.httpMethod, path: event.path };
};`;
  const result = await executeNodejsPayload({
    source,
    request: { method: 'GET', path: '/auth/me', query: {}, headers: {} },
    env: {},
    limits: { timeoutMs: 5000, memoryLimitBytes: 64 * 1024 * 1024 },
    packageName: 'demox-helper',
    callingConvention: 'scf-event',
    aliases: { 'demox-helper': path.join(dir, 'index.js') }
  });
  assert.deepEqual(result, { ok: true, n: 3, method: 'GET', path: '/auth/me' });
});

test('SCF Node invoker sends a typed runtime payload', async () => {
  const calls = [];
  const invoke = async (request) => {
    calls.push(request);
    return { ok: true, result: { status: 200, body: 'remote' } };
  };
  const run = createScfNodeInvoker({ functionName: 'demox-user-nodejs', namespace: 'demox', invoke });
  const result = await run({
    source: 'module.exports = () => "x"',
    request: { method: 'POST', path: '/auth' },
    env: { JWT_SECRET: 'site' },
    limits: { timeoutMs: 1000 }
  });
  assert.equal(result.body, 'remote');
  assert.equal(calls[0].functionName, 'demox-user-nodejs');
  assert.equal(calls[0].payload.type, 'demox.runtime.execute');
  assert.equal(calls[0].payload.runtime, 'nodejs');
  assert.equal(calls[0].payload.env.JWT_SECRET, 'site');
});
