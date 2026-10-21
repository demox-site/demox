#!/usr/bin/env node

// 打印平台运行时池 demox-platform-nodejs 的期望配置。
// 不调用云 API，不创建函数，不改用户池，不切换流量。
// 基础设施负责人按输出填写 VPC、CAM 角色和 PLATFORM_SECRETS_KEY。

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { PLATFORM_POOL_SPEC } = require('../scf-code/function-api/platform-pool-spec.js');

if (process.argv.includes('--apply') || process.argv.includes('--deploy')) {
  console.error('拒绝：这个命令不创建云资源，也不切换流量。平台池只写在 functions.json 里，由基础设施负责人另行开通。');
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(path.join(root, 'functions.json'), 'utf8'));
const pool = (manifest.functions || []).find((item) => item.name === 'demox-platform-nodejs');
const userPool = (manifest.functions || []).find((item) => item.name === 'demox-user-nodejs');
if (!pool || pool.releaseVia !== 'none') {
  console.error('functions.json 里的 demox-platform-nodejs 必须存在，且 releaseVia=none。');
  process.exit(1);
}
if (!userPool || JSON.stringify(userPool.runtime.environmentNames) !== JSON.stringify(['FUNCTION_RUNTIME', 'RUNTIME_INVOKE_SECRET'])) {
  console.error('用户池环境变量名被改过。平台密钥不能进用户池。');
  process.exit(1);
}

console.log(JSON.stringify({
  ...PLATFORM_POOL_SPEC,
  manifest: {
    releaseVia: pool.releaseVia,
    memoryMB: pool.runtime.memoryMB,
    timeoutSec: pool.runtime.timeoutSec,
    environmentNames: pool.runtime.environmentNames,
    network: pool.network,
    camRole: pool.camRole,
    capacity: pool.capacity
  }
}, null, 2));
