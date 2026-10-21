'use strict';

/**
 * 把一次执行送到用户池或平台池。平台池没配好时抛 PLATFORM_RUNTIME_NOT_CONFIGURED，
 * 调用方回落到进程内，不会改走用户池。
 */
function createPoolRoutingRuntime({ userRuntime, platformRuntime } = {}) {
  if (!userRuntime || typeof userRuntime.execute !== 'function') {
    throw new TypeError('缺少用户池 runtime');
  }
  return {
    async execute(opts = {}) {
      if (opts.pool === 'platform') {
        if (!platformRuntime || typeof platformRuntime.execute !== 'function') {
          const error = new Error('平台运行时池未配置');
          error.code = 'PLATFORM_RUNTIME_NOT_CONFIGURED';
          throw error;
        }
        return platformRuntime.execute(opts);
      }
      return userRuntime.execute({ ...opts, pool: 'user' });
    }
  };
}

module.exports = { createPoolRoutingRuntime };
