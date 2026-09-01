'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('console functions page saves and loads site env through the same /env API', () => {
  const api = fs.readFileSync(path.join(__dirname, '../../src/api.ts'), 'utf8');
  assert.match(api, /getEnv:\s*\(websiteId:\s*string\)/);
  assert.match(api, /putEnv:\s*\(websiteId:\s*string,\s*env:\s*Record<string,\s*string>\)/);
  assert.match(api, /scopedFunctionPath\(websiteId,\s*"\/env"\)/);

  const page = fs.readFileSync(path.join(__dirname, '../../src/pages/console/FunctionsPage.tsx'), 'utf8');
  assert.match(page, /functionsApi\.getEnv\(websiteId\)/);
  assert.match(page, /functionsApi\.putEnv\(websiteId,\s*env\)/);
  assert.match(page, /siteEnvTitle/);
  assert.match(page, /siteEnvSave/);
});
