'use strict';

const { badRequest } = require('./errors.js');

const SUPPORTED_RUNTIMES = Object.freeze(['nodejs']);
const PLANNED_RUNTIMES = Object.freeze(['python', 'go']);

const RUNTIME_ALIASES = Object.freeze({
  node: 'nodejs',
  'node.js': 'nodejs',
  js: 'nodejs',
  javascript: 'nodejs',
  quickjs: 'nodejs'
});

function normalizeRuntime(value, { fallback = 'nodejs' } = {}) {
  const raw = String(value == null ? fallback : value).trim().toLowerCase();
  const runtime = RUNTIME_ALIASES[raw] || raw || fallback;
  if (SUPPORTED_RUNTIMES.includes(runtime)) return runtime;
  if (PLANNED_RUNTIMES.includes(runtime)) {
    throw badRequest(`运行时 ${runtime} 尚未上线，当前只支持 Node.js`, 'RUNTIME_NOT_AVAILABLE');
  }
  throw badRequest('不支持的运行时', 'UNSUPPORTED_RUNTIME');
}

function defaultEntrypointFor(runtime) {
  normalizeRuntime(runtime);
  return 'index.js';
}

function isAllowedEntrypoint(runtime, entrypoint) {
  normalizeRuntime(runtime);
  const value = String(entrypoint || 'index.js');
  return value === 'index.js' || value === 'index.cjs' || value === 'index.mjs';
}

function runtimeTarget(runtime, env = process.env) {
  const name = normalizeRuntime(runtime);
  return {
    runtime: name,
    kind: 'scf',
    functionName: String(env.FUNCTIONS_NODE_RUNTIME || env.FUNCTIONS_RUNTIME_NODEJS || 'demox-user-nodejs').trim(),
    namespace: String(env.FUNCTIONS_RUNTIME_NAMESPACE || 'demox').trim()
  };
}

class CompositeFunctionRuntime {
  constructor({ runtimes = {} } = {}) {
    this.runtimes = runtimes;
  }

  async execute(opts = {}) {
    const name = normalizeRuntime(opts.runtime);
    const impl = this.runtimes[name];
    if (!impl || typeof impl.execute !== 'function') {
      const error = new Error(`运行时未配置: ${name}`);
      error.code = 'RUNTIME_NOT_CONFIGURED';
      throw error;
    }
    return impl.execute(opts);
  }
}

module.exports = {
  SUPPORTED_RUNTIMES,
  PLANNED_RUNTIMES,
  normalizeRuntime,
  defaultEntrypointFor,
  isAllowedEntrypoint,
  runtimeTarget,
  CompositeFunctionRuntime
};
