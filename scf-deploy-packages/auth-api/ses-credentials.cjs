'use strict';

const { AsyncLocalStorage } = require('async_hooks');

/**
 * 进程内 /auth/send-code 的 SES 凭证。
 * 网关在调用 auth 之前把「磷 demox-runtime-role + 业务会话策略」的临时密钥放进这里。
 * 不写 process.env，避免盖掉网关自己的角色凭证（带会话策略的 token 不能调 SSL）。
 * 独立进程的 auth 没有这个上下文，仍读进程环境变量。
 */
const store = new AsyncLocalStorage();

function runWithSesCredentials(credentials, fn) {
  return store.run({
    secretId: credentials && credentials.secretId,
    secretKey: credentials && credentials.secretKey,
    token: (credentials && credentials.token) || ''
  }, fn);
}

function currentSesCredentials(env = process.env) {
  const stored = store.getStore();
  if (stored && stored.secretId && stored.secretKey) {
    return {
      secretId: stored.secretId,
      secretKey: stored.secretKey,
      token: stored.token || ''
    };
  }
  const source = env || {};
  return {
    secretId: source.TENCENTCLOUD_SECRETID || source.TENCENT_SECRET_ID || '',
    secretKey: source.TENCENTCLOUD_SECRETKEY || source.TENCENT_SECRET_KEY || '',
    token: source.TENCENTCLOUD_SESSIONTOKEN || ''
  };
}

module.exports = {
  runWithSesCredentials,
  currentSesCredentials
};
