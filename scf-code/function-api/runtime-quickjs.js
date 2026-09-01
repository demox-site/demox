'use strict';

const { getQuickJS } = require('quickjs-emscripten');

class FunctionRuntimeError extends Error {
  constructor(message, code = 'FUNCTION_RUNTIME_ERROR', details = undefined) {
    super(message);
    this.name = 'FunctionRuntimeError';
    this.code = code;
    this.details = details;
  }
}

class QuickJSFunctionRuntime {
  constructor({ quickjsLoader = getQuickJS, logger = console, fetch: fetchImpl = globalThis.fetch } = {}) {
    this.quickjsLoader = quickjsLoader;
    this.logger = logger;
    this.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.quickjsPromise = null;
  }

  async getQuickJS() {
    if (!this.quickjsPromise) this.quickjsPromise = Promise.resolve().then(() => this.quickjsLoader());
    return this.quickjsPromise;
  }

  async execute({ source, request, env = {}, limits }) {
    const code = Buffer.isBuffer(source) ? source.toString('utf8') : String(source || '');
    const timeoutMs = Number(limits?.timeoutMs || 1000);
    const maxCodeBytes = Number(limits?.maxCodeBytes || 256 * 1024);
    const memoryLimitBytes = Number(limits?.memoryLimitBytes || 16 * 1024 * 1024);
    if (Buffer.byteLength(code) > maxCodeBytes) {
      throw new FunctionRuntimeError('函数代码超过大小限制', 'CODE_TOO_LARGE');
    }

    const QuickJS = await this.getQuickJS();
    const runtime = QuickJS.newRuntime();
    const context = runtime.newContext();
    let moduleNamespace = null;
    let moduleObject = null;
    let exportsObject = null;
    let handler = null;
    const pendingFetches = new Set();

    runtime.setMemoryLimit(memoryLimitBytes);
    runtime.setMaxStackSize(Math.min(Math.max(memoryLimitBytes / 8, 128 * 1024), 4 * 1024 * 1024));
    const deadline = Date.now() + timeoutMs;
    runtime.setInterruptHandler(() => Date.now() >= deadline);
    runtime.setModuleLoader((moduleName) => {
      throw new Error(`不允许导入外部模块: ${moduleName}`);
    });

    try {
      this.installConsole(context);
      this.installFetch(context, {
        deadline,
        maxBodyBytes: Number(limits?.maxResponseBytes || 256 * 1024),
        pendingFetches
      });

      // Expose a CommonJS-shaped object as a compatibility convenience. It is
      // still evaluated by QuickJS and has no access to Node.js host APIs.
      moduleObject = context.newObject();
      exportsObject = context.newObject();
      context.setProp(moduleObject, 'exports', exportsObject);
      context.setProp(context.global, 'module', moduleObject);
      context.setProp(context.global, 'exports', exportsObject);

      const sourceResult = context.evalCode(code, 'function.mjs', { type: 'module' });
      if (sourceResult.error) {
        throw this.toRuntimeError(
          context,
          sourceResult.error,
          Date.now() >= deadline ? 'FUNCTION_TIMEOUT' : 'FUNCTION_COMPILE_ERROR',
          Date.now() >= deadline ? '函数执行超时' : '函数代码无法编译'
        );
      }
      moduleNamespace = sourceResult.value;

      const commonJsExport = context.getProp(moduleObject, 'exports');
      if (context.typeof(commonJsExport) === 'function') {
        handler = commonJsExport;
      } else {
        commonJsExport.dispose();
        const defaultExport = context.getProp(moduleNamespace, 'default');
        if (context.typeof(defaultExport) === 'function') {
          handler = defaultExport;
        } else {
          defaultExport.dispose();
          throw new FunctionRuntimeError(
            '函数必须导出 handler：module.exports = async function(request, env) {}',
            'INVALID_ENTRYPOINT'
          );
        }
      }

      const requestHandle = this.jsonHandle(context, request);
      const envHandle = this.jsonHandle(context, env);
      const callResult = context.callFunction(handler, context.undefined, requestHandle, envHandle);
      requestHandle.dispose();
      envHandle.dispose();
      if (callResult.error) {
        throw this.toRuntimeError(
          context,
          callResult.error,
          Date.now() >= deadline ? 'FUNCTION_TIMEOUT' : 'FUNCTION_EXECUTION_ERROR',
          Date.now() >= deadline ? '函数执行超时' : '函数执行出错'
        );
      }

      const resultHandle = callResult.value;
      return await this.settle(context, runtime, resultHandle, deadline);
    } finally {
      if (handler?.alive) handler.dispose();
      if (moduleNamespace?.alive) moduleNamespace.dispose();
      if (moduleObject?.alive) moduleObject.dispose();
      if (exportsObject?.alive) exportsObject.dispose();
      if (context.alive) context.dispose();
      if (runtime.alive) runtime.dispose();
    }
  }

  jsonHandle(context, value) {
    const serialized = JSON.stringify(value === undefined ? null : value);
    const result = context.evalCode(`JSON.parse(${JSON.stringify(serialized)})`, 'input.json');
    if (result.error) throw this.toRuntimeError(context, result.error, 'INVALID_INPUT', '请求数据无法传入函数');
    return result.value;
  }

  installFetch(context, { deadline, maxBodyBytes, pendingFetches }) {
    const fetchFn = context.newFunction('fetch', (urlHandle, initHandle) => {
      const deferred = context.newPromise();
      pendingFetches.add(deferred);
      let url;
      let init = {};
      try {
        url = context.getString(urlHandle);
        if (initHandle) init = context.dump(initHandle) || {};
      } catch (error) {
        const message = context.newString(error.message || 'fetch 参数无效');
        deferred.reject(message);
        if (message.alive) message.dispose();
        pendingFetches.delete(deferred);
        return deferred.handle;
      }
      this.hostFetch(url, init, { deadline, maxBodyBytes })
        .then((result) => {
          if (!context.alive || !deferred.alive) return;
          const value = this.jsonHandle(context, result);
          deferred.resolve(value);
          if (value.alive) value.dispose();
        })
        .catch((error) => {
          if (!context.alive || !deferred.alive) return;
          const message = context.newString(error.message || '出站请求失败');
          deferred.reject(message);
          if (message.alive) message.dispose();
        })
        .finally(() => {
          pendingFetches.delete(deferred);
          if (context.runtime?.alive) context.runtime.executePendingJobs();
        });
      deferred.settled.then(() => {
        if (context.runtime?.alive) context.runtime.executePendingJobs();
      });
      return deferred.handle;
    });
    context.setProp(context.global, 'fetch', fetchFn);
    fetchFn.dispose();
  }

  async hostFetch(url, init = {}, { deadline, maxBodyBytes } = {}) {
    let parsed;
    try {
      parsed = new URL(String(url || ''));
    } catch {
      throw new FunctionRuntimeError('出站地址非法', 'FUNCTION_FETCH_ERROR');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new FunctionRuntimeError('只允许 http/https 出站请求', 'FUNCTION_FETCH_ERROR');
    }
    const method = String(init.method || 'GET').toUpperCase();
    const headers = {};
    if (init.headers && typeof init.headers === 'object' && !Array.isArray(init.headers)) {
      for (const [key, value] of Object.entries(init.headers)) {
        if (typeof value === 'string' || typeof value === 'number') headers[String(key)] = String(value);
      }
    }
    let body = init.body;
    if (body != null && typeof body !== 'string') {
      try { body = JSON.stringify(body); } catch { body = String(body); }
    }
    const remainingMs = Math.max(1, Number(deadline || Date.now()) - Date.now());
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(remainingMs)
      : undefined;
    const result = await this.fetchImpl(parsed.toString(), {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: 'follow',
      ...(signal ? { signal } : {})
    });
    if (result && typeof result.text === 'function') {
      const text = await result.text();
      const headersOut = {};
      if (result.headers && typeof result.headers.forEach === 'function') {
        result.headers.forEach((value, key) => { headersOut[String(key)] = String(value); });
      }
      return normalizeFetchResult({ status: result.status, ok: result.ok, headers: headersOut, body: text }, maxBodyBytes);
    }
    return normalizeFetchResult(result, maxBodyBytes);
  }

  installConsole(context) {
    const consoleObject = context.newObject();
    for (const method of ['log', 'info', 'warn', 'error']) {
      const fn = context.newFunction(method, (...args) => {
        try {
          const values = args.map((arg) => {
            const type = context.typeof(arg);
            if (type === 'string') return context.getString(arg);
            if (type === 'number') return context.getNumber(arg);
            if (type === 'boolean') return context.dump(arg);
            return `[${type}]`;
          });
          const sink = this.logger?.[method] || this.logger?.log;
          if (typeof sink === 'function') sink.call(this.logger, '[demox-function]', ...values);
        } catch {
          // Logging must never change function behavior.
        }
      });
      context.setProp(consoleObject, method, fn);
      fn.dispose();
    }
    context.setProp(context.global, 'console', consoleObject);
    consoleObject.dispose();
  }

  async settle(context, runtime, resultHandle, deadline) {
    for (;;) {
      const state = context.getPromiseState(resultHandle);
      if (state.type === 'fulfilled') {
        const value = context.dump(state.value);
        // dump() serializes objects but does not release their root handle.
        if (state.value?.alive) state.value.dispose();
        if (!state.notAPromise && resultHandle.alive) resultHandle.dispose();
        return value;
      }
      if (state.type === 'rejected') {
        const error = context.dump(state.error);
        if (state.error?.alive) state.error.dispose();
        if (resultHandle.alive) resultHandle.dispose();
        throw new FunctionRuntimeError(error?.message || '函数执行出错', 'FUNCTION_EXECUTION_ERROR', error);
      }
      if (Date.now() >= deadline) {
        if (resultHandle.alive) resultHandle.dispose();
        throw new FunctionRuntimeError('函数执行超时', 'FUNCTION_TIMEOUT');
      }
      const jobs = runtime.executePendingJobs();
      if (jobs?.error) {
        const error = context.dump(jobs.error);
        if (jobs.error?.alive) jobs.error.dispose();
        if (resultHandle.alive) resultHandle.dispose();
        throw new FunctionRuntimeError(error?.message || '函数异步任务失败', 'FUNCTION_EXECUTION_ERROR', error);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  toRuntimeError(context, handle, code, fallbackMessage) {
    const details = context.dump(handle);
    if (handle?.alive) handle.dispose();
    const message = code === 'FUNCTION_TIMEOUT'
      ? fallbackMessage
      : (details?.message || (typeof details === 'string' ? details : fallbackMessage));
    return new FunctionRuntimeError(message, code, details);
  }
}

function normalizeFetchResult(result, maxBodyBytes = 256 * 1024) {
  if (result == null || typeof result !== 'object') {
    throw new FunctionRuntimeError('出站请求返回值非法', 'FUNCTION_FETCH_ERROR');
  }
  let body = '';
  if (typeof result.body === 'string') body = result.body;
  else if (typeof result.text === 'function') {
    // Host Response-like objects are normalized by the caller before this helper.
    body = '';
  } else if (result.body != null) {
    try { body = JSON.stringify(result.body); } catch { body = String(result.body); }
  }
  if (Buffer.byteLength(body) > maxBodyBytes) {
    body = Buffer.from(body, 'utf8').subarray(0, maxBodyBytes).toString('utf8');
  }
  const headers = {};
  if (result.headers && typeof result.headers.forEach === 'function') {
    result.headers.forEach((value, key) => { headers[String(key)] = String(value); });
  } else if (result.headers && typeof result.headers === 'object') {
    for (const [key, value] of Object.entries(result.headers)) {
      if (typeof value === 'string' || typeof value === 'number') headers[String(key)] = String(value);
    }
  }
  const status = Number(result.status) || 0;
  return {
    status,
    ok: result.ok !== undefined ? Boolean(result.ok) : (status >= 200 && status < 300),
    headers,
    body
  };
}

module.exports = { QuickJSFunctionRuntime, FunctionRuntimeError, normalizeFetchResult };
