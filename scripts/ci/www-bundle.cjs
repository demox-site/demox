#!/usr/bin/env node
'use strict';

const fs = require('fs');

function bundleFromHtml(html) {
  const found = [...String(html).matchAll(/assets\/[A-Za-z0-9._-]+\.js/g)].map((match) => match[0]);
  if (!found.length) throw new Error('dist/index.html 没有 assets/*.js');
  return found[0];
}

function main(argv = process.argv.slice(2)) {
  const file = argv[0];
  if (!file) throw new Error('用法: www-bundle.cjs <index.html>');
  const bundle = bundleFromHtml(fs.readFileSync(file, 'utf8'));
  if (!/^assets\/[A-Za-z0-9._-]{1,120}\.js$/.test(bundle)) throw new Error(`bundle 格式不正确：${bundle}`);
  process.stdout.write(`bundle=${bundle}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  }
}

module.exports = { bundleFromHtml };
