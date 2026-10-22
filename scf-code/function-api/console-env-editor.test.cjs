'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readFunctionsUi() {
  const dir = path.join(__dirname, '../../src/pages/console/functions');
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => fs.readFileSync(path.join(dir, name), 'utf8'))
    .join('\n');
}

test('console functions page saves and loads per-function env and aliases', () => {
  const api = fs.readFileSync(path.join(__dirname, '../../src/api.ts'), 'utf8');
  assert.match(api, /getFunctionEnv:\s*\(functionId:\s*string\)/);
  assert.match(api, /putFunctionEnv:\s*\(functionId:\s*string,\s*env:\s*Record<string,\s*string>\)/);
  assert.match(api, /listAliases:\s*\(functionId:\s*string\)/);
  assert.match(api, /setAlias:\s*\(functionId:\s*string,\s*alias:\s*string,\s*version:\s*number\)/);

  const page = readFunctionsUi();
  assert.match(page, /functionsApi\.getFunctionEnv\(selected\.functionId\)/);
  assert.match(page, /functionsApi\.putFunctionEnv\(selected\.functionId,\s*env\)/);
  assert.match(page, /functionsApi\.setAlias/);
  assert.match(page, /siteEnvTitle/);
  assert.match(page, /aliasTitle/);
  assert.match(page, /functionInvokeUrl/);
  assert.match(page, /functionsApi\.baseUrl/);
  assert.doesNotMatch(page, /functionPublicUrl\(/);
  assert.doesNotMatch(page, /aigc\.sx\.cn/);
});
