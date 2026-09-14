'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('console functions page saves and loads per-function env and aliases', () => {
  const api = fs.readFileSync(path.join(__dirname, '../../src/api.ts'), 'utf8');
  assert.match(api, /getFunctionEnv:\s*\(functionId:\s*string\)/);
  assert.match(api, /putFunctionEnv:\s*\(functionId:\s*string,\s*env:\s*Record<string,\s*string>\)/);
  assert.match(api, /listAliases:\s*\(functionId:\s*string\)/);
  assert.match(api, /setAlias:\s*\(functionId:\s*string,\s*alias:\s*string,\s*version:\s*number\)/);

  const page = fs.readFileSync(path.join(__dirname, '../../src/pages/console/FunctionsPage.tsx'), 'utf8');
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
