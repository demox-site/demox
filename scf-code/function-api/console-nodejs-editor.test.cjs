'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('console can create a Node.js function with custom routes and a timer name', () => {
  const api = fs.readFileSync(path.join(__dirname, '../../src/api.ts'), 'utf8');
  assert.match(api, /runtime\?: string/);
  assert.match(api, /timerName\?: string/);

  const page = fs.readFileSync(path.join(__dirname, '../../src/pages/console/FunctionsPage.tsx'), 'utf8');
  assert.match(page, /runtime: "nodejs"/);
  assert.match(page, /createRoutes/);
  assert.match(page, /createTimer/);
  assert.match(page, /functionsApi\.create\(websiteId, name, slug,/);
  assert.match(page, /howToCall/);
  assert.match(page, /copySnippet/);
  assert.match(page, /advanced/);
  assert.doesNotMatch(page, /quickjs/);
});
