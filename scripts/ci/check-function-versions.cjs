#!/usr/bin/env node
'use strict';

/**
 * PR 检查：平台函数的代码变了就要升 app，runtime 文件或配置变了就要升 runtime。
 * 不访问云，不发布。
 *
 *   node scripts/ci/check-function-versions.cjs --base origin/master
 */

const { changedFilesBetween, evaluateChanges, gitShow, loadManifest, repoRoot } = require('./function-versions.cjs');

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main(argv = process.argv.slice(2)) {
  const base = argValue(argv, '--base') || 'origin/master';
  const root = repoRoot();
  const headManifest = loadManifest(root);
  const baseText = gitShow(base, 'functions.json', root);
  const baseManifest = baseText ? JSON.parse(baseText) : null;
  const changedFiles = changedFilesBetween(base, root);
  const result = evaluateChanges({ baseManifest, headManifest, changedFiles });
  for (const warning of result.warnings) console.log(`::warning::${warning}`);
  for (const error of result.errors) console.error(`::error::${error}`);
  if (!result.ok) {
    console.error(`function version check failed（对照 ${base}，${changedFiles.length} 个文件）`);
    process.exitCode = 1;
    return;
  }
  const mode = baseManifest ? '对照 base 清单' : 'base 上还没有清单，按 seed 引入';
  console.log(`function version check ok（${mode}，${changedFiles.length} 个文件）`);
}

if (require.main === module) main();

module.exports = { main };
