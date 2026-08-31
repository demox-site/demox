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
  constructor({ quickjsLoader = getQuickJS, logger = console } = {}) {
    this.quickjsLoader = quickjsLoader;
    this.logger = logger;
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

    runtime.setMemoryLimit(memoryLimitBytes);
    runtime.setMaxStackSize(Math.min(Math.max(memoryLimitBytes / 8, 128 * 1024), 4 * 1024 * 1024));
    const deadline = Date.now() + timeoutMs;
    runtime.setInterruptHandler(() => Date.now() >= deadline);
    runtime.setModuleLoader((moduleName) => {
      throw new Error(`不允许导入外部模块: ${moduleName}`);
    });

    try {
      this.installConsole(context);

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

module.exports = { QuickJSFunctionRuntime, FunctionRuntimeError };
