'use strict';

const { AsyncLocalStorage } = require('async_hooks');

/**
 * 平台发信（验证码、停用通知）的 SES 临时密钥。
 * 网关或平台池 AssumeRole 到磷的 demox-platform-ses（PLATFORM_SES_ROLE_ARN）之后，
 * 放进 AsyncLocalStorage。不写 process.env，因此不会盖掉 TENCENTCLOUD_*。
 * 同一进程里的 website 入口用 Symbol.for 读同一份存储，不要求能 require 到这个文件。
 * 没有这份上下文时，发信必须失败，不能改用 TENCENTCLOUD_*（那可能是业务会话）。
 * 验证码以外的发信同样只读这份上下文，不回落到进程里的环境凭证。
 */
const ALS_KEY = Symbol.for('demox.platformSes.als');
if (!globalThis[ALS_KEY]) globalThis[ALS_KEY] = new AsyncLocalStorage();
const store = globalThis[ALS_KEY];

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

module.exports = {
  runWithSesCredentials,
  assumedBusinessCredentials
};
