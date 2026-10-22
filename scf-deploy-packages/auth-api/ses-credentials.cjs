'use strict';

const { AsyncLocalStorage } = require('async_hooks');

/**
 * 进程内 auth / website / mcp 的腾讯云临时凭证。
 * 网关在进入这三个系统函数之前，用 createBusinessCredentialProvider
 * AssumeRole 到磷的 demox-runtime-role（与平台池同一份会话策略和缓存），
 * 再把临时密钥放进这里。SES、COS、TEO 等客户端读这里，不读网关的 TENCENTCLOUD_*。
 * 不写 process.env，避免盖掉网关自己的角色凭证（带会话策略的 token 不能调 SSL）。
 * 没有这份上下文时（平台池、独立进程）仍读进程环境变量。
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
