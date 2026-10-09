'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkPreconditions, envDigest, parseInvokeStatus, createDeployer, CONFIG } = require('./scf-function-api.cjs');

const ENV = [{ Key: 'JWT_SECRET', Value: 'x'.repeat(40) }, { Key: 'MYSQL_HOST', Value: '10.0.0.1' }];
const endpoints = (q) => ['/', '/*', '/auth/*'].map((p) => ({ Namespace: 'demox', FunctionName: CONFIG.functionName, Qualifier: q, PathMatch: p }));
const timers = (q) => [{ Type: 'timer', TriggerName: 'analytics-rollup-5m', Enable: 1, Qualifier: q }];

function fakeScf({ qualifier = 'production', prodVersion = '3', healthStatus = { '/health': 200, '/': 401, '/auth/login': 204 }, mutateEnvOnUpdate = false } = {}) {
  const calls = [];
  let env = ENV.map((x) => ({ ...x }));
  let versions = Number(prodVersion);
  const aliases = [{ Name: 'production', FunctionVersion: prodVersion }];
  const fn = () => ({ FunctionName: CONFIG.functionName, Handler: 'index.main', Runtime: 'Nodejs18.15', Status: 'Active', Type: 'Event',
    Environment: { Variables: env }, Triggers: [...timers(qualifier), { Type: 'http', TriggerName: 'h', Qualifier: '$LATEST', Enable: 1 }] });
  const api = new Proxy({}, { get: (_t, name) => async (params) => {
    calls.push({ name, params });
    switch (name) {
      case 'GetFunction': return params.FunctionName === CONFIG.runtimeFunctionName
        ? { Handler: 'runtime-nodejs.main', Status: 'Active', Environment: { Variables: [] } } : fn();
      case 'GetCustomDomain': return { EndpointsConfig: endpoints(qualifier) };
      case 'ListAliases': return { Aliases: aliases };
      case 'UpdateFunctionCode': if (mutateEnvOnUpdate) env = [...env, { Key: 'NEW', Value: '1' }]; return {};
      case 'PublishVersion': versions += 1; return { FunctionVersion: String(versions) };
      case 'Invoke': {
        const ev = JSON.parse(params.ClientContext);
        return { Result: { InvokeResult: 0, RetMsg: JSON.stringify({ statusCode: healthStatus[ev.path] }) } };
      }
      case 'UpdateAlias': { const a = aliases.find((x) => x.Name === params.Name); a.FunctionVersion = params.FunctionVersion; return {}; }
      case 'CreateAlias': aliases.push({ Name: params.Name, FunctionVersion: params.FunctionVersion }); return {};
      default: return {};
    }
  } });
  return { api, calls, aliases };
}

const okFetch = async (url) => ({ status: url.endsWith('/health') ? 200 : 401, ok: true });
const fakeCos = { putObject: (_p, cb) => cb(null, {}) };
const zip = () => { const p = path.join(os.tmpdir(), `t-${process.pid}.zip`); fs.writeFileSync(p, 'zip'); return p; };
const quiet = () => {};

test('preconditions refuse traffic on $LATEST and missing alias', () => {
  const r = checkPreconditions({ fn: { Handler: 'index.main', Runtime: 'Nodejs18.15', Status: 'Active', Triggers: timers('$LATEST') }, domain: { EndpointsConfig: endpoints('$LATEST') }, aliases: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('别名 production 不存在')));
  assert.ok(r.errors.some((e) => e.includes('入口不在别名')));
  assert.ok(r.errors.some((e) => e.includes('定时触发器')));
});

test('preconditions pass when domain and timers use the alias', () => {
  const r = checkPreconditions({ fn: { Handler: 'index.main', Runtime: 'Nodejs18.15', Status: 'Active', Triggers: timers('production') }, domain: { EndpointsConfig: endpoints('production') }, aliases: [{ Name: 'production', FunctionVersion: '3' }] });
  assert.equal(r.ok, true);
  assert.equal(r.productionVersion, '3');
});

test('envDigest never exposes values', () => {
  const d = envDigest({ Environment: { Variables: ENV } });
  assert.deepEqual(d.keys, ['JWT_SECRET', 'MYSQL_HOST']);
  assert.ok(!JSON.stringify(d).includes('xxxx'));
});

test('parseInvokeStatus reads statusCode only', () => {
  assert.equal(parseInvokeStatus({ Result: { InvokeResult: 0, RetMsg: '{"statusCode":401,"body":"secret"}' } }).statusCode, 401);
  assert.equal(parseInvokeStatus({ Result: { InvokeResult: 1, RetMsg: '' } }).statusCode, null);
});

test('deploy: code only, publish, health check, then switch alias', async () => {
  const s = fakeScf();
  const lines = [];
  const d = createDeployer({ scf: s.api, cos: fakeCos, fetchImpl: okFetch, log: (l) => lines.push(l), wait: async () => {} });
  const r = await d.deploy({ zipPath: zip(), sha: 'abc' });
  assert.deepEqual(r, { previous: '3', version: '4' });
  const names = s.calls.map((c) => c.name);
  assert.ok(!names.includes('UpdateFunctionConfiguration'));
  const update = s.calls.find((c) => c.name === 'UpdateFunctionCode');
  assert.equal(update.params.Environment, undefined);
  assert.ok(names.indexOf('PublishVersion') < names.indexOf('Invoke'));
  assert.ok(names.lastIndexOf('Invoke') < names.indexOf('UpdateAlias'));
  assert.equal(s.aliases.find((a) => a.Name === 'production').FunctionVersion, '4');
  assert.ok(!lines.join('\n').includes('xxxx'), 'no env values in output');
});

test('deploy refuses before any write when traffic is on $LATEST', async () => {
  const s = fakeScf({ qualifier: '$LATEST' });
  const d = createDeployer({ scf: s.api, cos: fakeCos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  await assert.rejects(d.deploy({ zipPath: zip() }), /前置条件不满足/);
  assert.ok(!s.calls.some((c) => ['UpdateFunctionCode', 'PublishVersion', 'UpdateAlias'].includes(c.name)));
});

test('deploy does not switch when health check fails', async () => {
  const s = fakeScf({ healthStatus: { '/health': 502, '/': 401, '/auth/login': 204 } });
  const d = createDeployer({ scf: s.api, cos: fakeCos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  await assert.rejects(d.deploy({ zipPath: zip() }), /健康检查失败.*production 仍是 v3/);
  assert.equal(s.aliases.find((a) => a.Name === 'production').FunctionVersion, '3');
});

test('deploy stops if env vars changed', async () => {
  const s = fakeScf({ mutateEnvOnUpdate: true });
  const d = createDeployer({ scf: s.api, cos: fakeCos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  await assert.rejects(d.deploy({ zipPath: zip() }), /环境变量摘要变化/);
  assert.ok(!s.calls.some((c) => c.name === 'PublishVersion'));
});

test('deploy rolls the alias back when the public check fails', async () => {
  const s = fakeScf();
  const d = createDeployer({ scf: s.api, cos: fakeCos, fetchImpl: async () => ({ status: 502 }), log: quiet, wait: async () => {} });
  await assert.rejects(d.deploy({ zipPath: zip() }), /已自动切回 v3/);
  assert.equal(s.aliases.find((a) => a.Name === 'production').FunctionVersion, '3');
});

test('rollback health-checks the target before switching', async () => {
  const s = fakeScf({ prodVersion: '5' });
  const d = createDeployer({ scf: s.api, cos: fakeCos, fetchImpl: okFetch, log: quiet, wait: async () => {} });
  const r = await d.rollback({ version: '4' });
  assert.deepEqual(r, { previous: '5', version: '4' });
  await assert.rejects(d.rollback({ version: 'abc' }), /--version/);
});
