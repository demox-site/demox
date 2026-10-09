// v13：日志脱敏代码在 4 个后端里必须是同一份，且 4 个入口都在加载时装上。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');
const BEGIN = '/* demox-log-redact:begin v1';
const END = '/* demox-log-redact:end */';

function block(source, rel) {
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  assert.ok(start >= 0 && end > start, `${rel} 缺少 demox-log-redact 代码块`);
  return source.slice(start, end + END.length);
}

const ENTRIES = [
  'scf-code/website-api/index.js',
  'scf-deploy-packages/auth-api/index.cjs',
  'scf-code/mcp-api/index.js'
];

test('inline log redaction blocks are identical to function-api/log-redact.js', () => {
  const canonical = block(read('scf-code/function-api/log-redact.js'), 'log-redact.js');
  for (const rel of ENTRIES) assert.equal(block(read(rel), rel), canonical, `${rel} 的脱敏代码和 log-redact.js 不一致`);
});

test('each backend entry installs redaction before any other code runs', () => {
  for (const rel of ENTRIES) {
    const source = read(rel);
    const install = source.indexOf('installLogRedaction(console);', source.indexOf(END));
    const firstRequire = source.search(/require\((?!['"]node:)/);
    assert.ok(install > 0, `${rel} 没有调用 installLogRedaction(console)`);
    assert.ok(firstRequire > install, `${rel} 在装上脱敏之前就 require 了其他模块`);
  }
  for (const rel of ['scf-code/function-api/index.js', 'scf-code/function-api/runtime-nodejs-handler.js']) {
    assert.match(read(rel), /installLogRedaction\(console\);/, `${rel} 没有装脱敏`);
  }
});

test('no console call prints a raw verification code, recipient or token variable', () => {
  const risky = /console\.(?:log|info|warn|error|debug)\([^;\n]*(?:\$\{(?:code|to|cleanEmail|email|token|accessToken|refreshToken|refresh_token)\}|,\s*(?:code|to|cleanEmail|email|token|accessToken|refreshToken)\s*[,)])/;
  for (const rel of [...ENTRIES, 'scf-code/function-api/index.js', 'scf-code/function-api/runtime-nodejs.js']) {
    const bad = read(rel).split('\n').map((line, i) => [i + 1, line]).filter(([, line]) => risky.test(line));
    assert.deepEqual(bad, [], `${rel} 有直接打印敏感变量的日志`);
  }
});

test('the leak guard itself catches a raw token or email (so a passing suite means something)', () => {
  const { installLogLeakGuard } = require('./log-leak-guard.cjs');
  const fake = { log() {}, warn() {}, error() {} };
  const guard = installLogLeakGuard({ target: fake });
  fake.log('ok line');
  assert.equal(guard.assertNoLeaks(), 1);
  fake.warn('login', 'person@example.com');
  fake.error('{"access_token":"eyJhbGciOiJIUzI1NiJ9.eyJ1IjoxfQ.c2lnbmF0dXJl"}');
  assert.throws(() => guard.assertNoLeaks(), /2 条日志/);
});
