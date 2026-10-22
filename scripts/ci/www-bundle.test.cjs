'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { bundleFromHtml } = require('./www-bundle.cjs');

test('reads the first assets js from the built index', () => {
  const html = '<script type="module" src="/assets/index-Abc123.js"></script><link href="/assets/index-Abc123.css">';
  assert.equal(bundleFromHtml(html), 'assets/index-Abc123.js');
});

test('rejects an index with no bundle', () => {
  assert.throws(() => bundleFromHtml('<div id="root"></div>'), /assets/);
});
