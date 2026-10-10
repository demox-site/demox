'use strict';

/**
 * 测试专用：运行时生成 JWT，源码里不出现任何 JWT 字面量（避免 GitGuardian / gitleaks 报警）。
 * 密钥每次进程启动随机生成，不是任何环境的真实密钥。
 */

const crypto = require('node:crypto');

const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function randomTestSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function signTestJwt(payload = { userId: 'test-user' }, secret = randomTestSecret()) {
  const head = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

module.exports = { randomTestSecret, signTestJwt };
