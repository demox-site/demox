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

test('console can create a Node.js function with custom routes and a timer name', () => {
  const api = fs.readFileSync(path.join(__dirname, '../../src/api.ts'), 'utf8');
  assert.match(api, /runtime\?: string/);
  assert.match(api, /timerName\?: string/);

  const page = readFunctionsUi();
  assert.match(page, /runtime: "nodejs"/);
  assert.match(page, /createRoutes/);
  assert.match(page, /createTimer/);
  assert.match(page, /functionsApi\.create\(websiteId, name, slug,/);
  assert.match(page, /howToCall/);
  assert.match(page, /copySnippet/);
  assert.match(page, /advanced/);
  assert.doesNotMatch(page, /quickjs/);
  assert.doesNotMatch(page, /站点/);
});
