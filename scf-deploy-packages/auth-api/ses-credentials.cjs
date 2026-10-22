'use strict';

const { AsyncLocalStorage } = require('async_hooks');

/**
 * 进程内 /auth/send-code 的 SES 凭证。
 * 网关 AssumeRole 到磷的 demox-platform-ses（环境变量 PLATFORM_SES_ROLE_ARN）之后，
 * 把临时密钥放进这里。不写 process.env，也不给 website、mcp 或用户函数。
 * 没有这份上下文时才读进程环境变量（平台池 / 独立 auth 进程）。
 */
const store = new AsyncLocalStorage();

function runWithSesCredentials(credentials, fn) {
  return store.run({
    secretId: credentials && credentials.secretId,
    secretKey: credentials && credentials.secretKey,
    token: (credentials && credentials.token) || ''
  }, fn);
}

function assumedBusinessCredentials() {
  const stored = store.getStore();
  if (!stored || !stored.secretId || !stored.secretKey) return null;
  return {
    secretId: stored.secretId,
    secretKey: stored.secretKey,
    token: stored.token || ''
  };
}

function readTencentClientCredentials(env = process.env, extra = {}) {
  const assumed = assumedBusinessCredentials();
  if (assumed) return assumed;
  const source = env || {};
  return {
    secretId: source.TENCENTCLOUD_SECRETID || source.TENCENT_SECRET_ID || extra.secretId || '',
    secretKey: source.TENCENTCLOUD_SECRETKEY || source.TENCENT_SECRET_KEY || extra.secretKey || '',
    token: source.TENCENTCLOUD_SESSIONTOKEN || extra.token || ''
  };
}

function currentSesCredentials(env = process.env) {
  return readTencentClientCredentials(env);
}

module.exports = {
  runWithSesCredentials,
  assumedBusinessCredentials,
  readTencentClientCredentials,
  currentSesCredentials
};
