'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { FunctionRuntimeError } = require('./runtime-error.js');
const { runtimeTarget } = require('./runtimes.js');
const { invokeScfFunction, invokeRuntimeHttp } = require('./scf-invoke.js');

const WORKER_PATH = path.join(__dirname, 'runtime-nodejs-worker.cjs');
const WORKER_ENV_BLOCKLIST = new Set([
  'PATH',
  'NODE_PATH',
  'NODE_OPTIONS',
  'HOME',
  'FUNCTIONS_COS_BUCKET',
  'FUNCTIONS_COS_REGION',
  'FUNCTIONS_COS_SECRET_ID',
  'FUNCTIONS_COS_SECRET_KEY'
]);
const MAX_WORKERS = 16;
const WORKER_IDLE_MS = 5 * 60 * 1000;

function existingDirs(candidates) {
  return candidates.filter((dir) => {
    try {
      return fs.existsSync(dir);
    } catch {
      return false;
    }
  });
}

function defaultNodePath() {
  return existingDirs([
    path.join(__dirname, 'node_modules'),
    path.join(__dirname, '..', 'website-api', 'node_modules'),
    path.join(__dirname, '..', '..', 'scf-deploy-packages', 'auth-api', 'node_modules'),
    path.join(__dirname, '..', 'mcp-api', 'node_modules'),
    path.join(__dirname, '..', 'cert-renew', 'node_modules'),
    path.join(__dirname, '..', '..', 'node_modules')
  ]).join(path.delimiter);
}

function platformAliases() {
  return {
    'demox-auth': path.join(__dirname, '..', '..', 'scf-deploy-packages', 'auth-api', 'index.cjs'),
    'demox-website': path.join(__dirname, '..', 'website-api', 'index.js'),
    'demox-mcp': path.join(__dirname, '..', 'mcp-api', 'index.js'),
    'demox-cert-renew': path.join(__dirname, '..', 'cert-renew', 'index.js')
  };
}

function workerEnv(siteEnv = {}) {
  const env = {
    PATH: process.env.PATH || '/usr/bin:/bin',
    LANG: process.env.LANG || 'en_US.UTF-8',
    TZ: process.env.TZ || 'UTC',
    NODE_ENV: 'production'
  };
  for (const [key, value] of Object.entries(siteEnv || {})) {
    if (WORKER_ENV_BLOCKLIST.has(key)) continue;
    if (typeof value === 'string') env[key] = value;
  }
  env.NODE_PATH = defaultNodePath();
  env.PATH = process.env.PATH || env.PATH;
  env.HOME = os.tmpdir();
  delete env.NODE_OPTIONS;
  return env;
}

function sourceKey(source, entrypoint, extra = '') {
  const hash = crypto.createHash('sha256')
    .update(String(entrypoint || 'index.js'))
    .update('\0')
    .update(source);
  if (extra) hash.update('\0').update(String(extra));
  return hash.digest('hex');
}

function payloadKeyExtra(payload = {}) {
  return [payload.packageName, payload.callingConvention].filter(Boolean).join('\0');
}

class NodeWorkerPool {
  constructor({
    workerPath = WORKER_PATH,
    logger = console,
    maxWorkers = MAX_WORKERS,
    idleMs = WORKER_IDLE_MS
  } = {}) {
    this.workerPath = workerPath;
    this.logger = logger;
    this.maxWorkers = maxWorkers;
    this.idleMs = idleMs;
    this.slots = new Map();
    this.nextId = 1;
  }

  async execute(payload = {}) {
    const source = Buffer.isBuffer(payload.source) ? payload.source.toString('utf8') : String(payload.source || '');
    const entrypoint = payload.entrypoint || 'index.js';
    const extra = payloadKeyExtra(payload);
    const key = source ? sourceKey(source, entrypoint, extra) : String(payload.sourceHash || '');
    if (!key) throw new FunctionRuntimeError('函数代码不能为空', 'EMPTY_SOURCE');
    const timeoutMs = Math.max(1, Number(payload.limits?.timeoutMs || 30_000));
    const memoryMb = Math.max(32, Math.ceil(Number(payload.limits?.memoryLimitBytes || 128 * 1024 * 1024) / (1024 * 1024)));
    if (!source) {
      const existing = this.slots.get(key);
      if (!existing?.child?.connected) {
        throw new FunctionRuntimeError('运行时需要源码', 'SOURCE_REQUIRED');
      }
      this.touch(existing);
      return this.invokeSlot(existing, payload.request || {}, payload.env || {}, timeoutMs);
    }
    const slot = await this.ensureSlot(key, {
      source,
      entrypoint,
      env: payload.env || {},
      aliases: payload.aliases || platformAliases(),
      packageName: payload.packageName || '',
      callingConvention: payload.callingConvention || '',
      memoryMb,
      timeoutMs
    });
    return this.invokeSlot(slot, payload.request || {}, payload.env || {}, timeoutMs);
  }

  async ensureSlot(key, boot) {
    const existing = this.slots.get(key);
    if (existing?.child?.connected) {
      this.touch(existing);
      return existing;
    }
    if (existing) this.evict(key);
    while (this.slots.size >= this.maxWorkers) {
      const oldest = this.slots.keys().next().value;
      this.evict(oldest);
    }
    const slot = this.spawn(key, boot);
    this.slots.set(key, slot);
    await this.bootSlot(slot, boot);
    return slot;
  }

  spawn(key, boot) {
    const child = fork(this.workerPath, [], {
      cwd: os.tmpdir(),
      env: workerEnv(boot.env),
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      execArgv: [`--max-old-space-size=${boot.memoryMb}`, '--no-warnings'],
      serialization: 'json'
    });
    child.unref();
    child.stderr?.unref();
    if (child.channel && typeof child.channel.unref === 'function') child.channel.unref();
    const slot = {
      key,
      child,
      queue: Promise.resolve(),
      pending: new Map(),
      idleTimer: null
    };
    child.on('message', (message) => {
      const id = message?.id;
      const waiter = slot.pending.get(id);
      if (!waiter) return;
      slot.pending.delete(id);
      if (!message || message.ok !== true) {
        waiter.reject(new FunctionRuntimeError(
          message?.error?.message || '函数执行出错',
          message?.error?.code || 'FUNCTION_EXECUTION_ERROR'
        ));
        return;
      }
      waiter.resolve(message.ready ? true : message.value);
    });
    child.on('error', (error) => {
      this.failSlot(slot, new FunctionRuntimeError(error.message || '无法启动运行时进程', 'FUNCTION_EXECUTION_ERROR'));
    });
    child.on('exit', () => {
      this.failSlot(slot, new FunctionRuntimeError('函数进程退出', 'FUNCTION_EXECUTION_ERROR'));
      if (this.slots.get(key) === slot) this.slots.delete(key);
    });
    child.stderr?.on('data', (chunk) => {
      try {
        this.logger.warn?.('[demox-user-nodejs]', String(chunk).trimEnd());
      } catch {
        // Logging must never change function behavior.
      }
    });
    return slot;
  }

  bootSlot(slot, boot) {
    return this.send(slot, {
      type: 'boot',
      source: boot.source,
      entrypoint: boot.entrypoint,
      aliases: boot.aliases,
      env: boot.env,
      packageName: boot.packageName || '',
      callingConvention: boot.callingConvention || ''
    }, boot.timeoutMs);
  }

  invokeSlot(slot, request, env, timeoutMs) {
    const run = () => this.send(slot, { type: 'invoke', request, env }, timeoutMs);
    const queued = slot.queue.then(run, run);
    slot.queue = queued.catch(() => {});
    return queued;
  }

  send(slot, message, timeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (!slot.child?.connected) {
        reject(new FunctionRuntimeError('运行时进程不可用', 'FUNCTION_EXECUTION_ERROR'));
        return;
      }
      const timer = setTimeout(() => {
        slot.pending.delete(id);
        this.evict(slot.key);
        reject(new FunctionRuntimeError('函数执行超时', 'FUNCTION_TIMEOUT'));
      }, timeoutMs);
      slot.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          this.touch(slot);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
      try {
        slot.child.send({ ...message, id });
      } catch (error) {
        clearTimeout(timer);
        slot.pending.delete(id);
        reject(new FunctionRuntimeError(error.message || '无法向运行时发送请求', 'FUNCTION_EXECUTION_ERROR'));
      }
    });
  }

  touch(slot) {
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.idleTimer = setTimeout(() => this.evict(slot.key), this.idleMs);
    if (typeof slot.idleTimer.unref === 'function') slot.idleTimer.unref();
    this.slots.delete(slot.key);
    this.slots.set(slot.key, slot);
  }

  failSlot(slot, error) {
    for (const waiter of slot.pending.values()) waiter.reject(error);
    slot.pending.clear();
  }

  evict(key) {
    const slot = this.slots.get(key);
    if (!slot) return;
    this.slots.delete(key);
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    this.failSlot(slot, new FunctionRuntimeError('运行时进程已关闭', 'FUNCTION_EXECUTION_ERROR'));
    try {
      slot.child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }

  reset() {
    for (const key of [...this.slots.keys()]) this.evict(key);
  }
}

let defaultPool = null;

function getDefaultPool(options = {}) {
  if (!defaultPool) defaultPool = new NodeWorkerPool(options);
  return defaultPool;
}

function resetNodeWorkerPool() {
  if (defaultPool) defaultPool.reset();
  defaultPool = null;
}

function executeNodejsPayload(payload = {}, options = {}) {
  const pool = options.pool || getDefaultPool(options);
  return pool.execute(payload);
}

function createLocalNodeInvoker(options = {}) {
  const pool = options.pool || getDefaultPool(options);
  return (payload) => pool.execute(payload);
}

function createScfNodeInvoker({
  functionName,
  namespace,
  invoke = invokeScfFunction,
  logger = console
} = {}) {
  const target = runtimeTarget('nodejs');
  const resolvedName = functionName || target.functionName;
  const resolvedNamespace = namespace || target.namespace;
  return async (payload) => {
    const timeoutMs = Math.max(1, Number(payload.limits?.timeoutMs || 30_000));
    const response = await invoke({
      functionName: resolvedName,
      namespace: resolvedNamespace,
      payload: runtimeExecutePayload(payload, { includeSource: true }),
      timeoutMs
    });
    return unwrapRuntimeResponse(response);
  };
}

function createHttpNodeInvoker({
  url,
  secret,
  post = invokeRuntimeHttp,
  logger = console,
  warmLimit = 1024
} = {}) {
  const resolvedUrl = String(url || '').trim();
  const resolvedSecret = String(secret || '').trim();
  if (!resolvedUrl || !resolvedSecret) {
    throw new FunctionRuntimeError('缺少运行时内网地址或调用密钥', 'RUNTIME_INVOKE_NOT_CONFIGURED');
  }
  const warm = new Set();
  return async (payload) => {
    const source = Buffer.isBuffer(payload.source) ? payload.source.toString('utf8') : String(payload.source || '');
    const entrypoint = payload.entrypoint || 'index.js';
    const extra = payloadKeyExtra(payload);
    const hash = source ? sourceKey(source, entrypoint, extra) : String(payload.sourceHash || '');
    const timeoutMs = Math.max(1, Number(payload.limits?.timeoutMs || 30_000));
    const send = (includeSource) => post({
      url: resolvedUrl,
      secret: resolvedSecret,
      payload: runtimeExecutePayload({ ...payload, source, sourceHash: hash, entrypoint }, { includeSource }),
      timeoutMs
    });
    let includeSource = Boolean(source) && !warm.has(hash);
    let response = await send(includeSource);
    if (response?.error?.code === 'SOURCE_REQUIRED' && source && !includeSource) {
      warm.delete(hash);
      includeSource = true;
      response = await send(true);
    }
    const result = unwrapRuntimeResponse(response);
    if (hash) {
      warm.add(hash);
      while (warm.size > warmLimit) warm.delete(warm.values().next().value);
    }
    return result;
  };
}

function runtimeExecutePayload(payload = {}, { includeSource = true } = {}) {
  const source = Buffer.isBuffer(payload.source) ? payload.source.toString('utf8') : String(payload.source || '');
  const entrypoint = payload.entrypoint || 'index.js';
  const extra = payloadKeyExtra(payload);
  const body = {
    type: 'demox.runtime.execute',
    runtime: 'nodejs',
    sourceHash: payload.sourceHash || (source ? sourceKey(source, entrypoint, extra) : ''),
    request: payload.request || {},
    env: payload.env || {},
    limits: payload.limits || {},
    entrypoint,
    packageName: payload.packageName || '',
    callingConvention: payload.callingConvention || ''
  };
  if (includeSource) body.source = source;
  return body;
}

function unwrapRuntimeResponse(response) {
  if (!response || response.ok !== true) {
    throw new FunctionRuntimeError(
      response?.error?.message || 'Node 运行时执行失败',
      response?.error?.code || 'FUNCTION_EXECUTION_ERROR'
    );
  }
  return response.result;
}

class NodejsFunctionRuntime {
  constructor({ invoke = null, logger = console } = {}) {
    this.invoke = invoke || createLocalNodeInvoker({ logger });
    this.logger = logger;
  }

  async execute({ source, request, env = {}, limits, entrypoint, packageName, callingConvention } = {}) {
    return this.invoke({
      source,
      request,
      env,
      limits,
      entrypoint: entrypoint || 'index.js',
      packageName,
      callingConvention
    });
  }
}

module.exports = {
  NodejsFunctionRuntime,
  NodeWorkerPool,
  executeNodejsPayload,
  createLocalNodeInvoker,
  createScfNodeInvoker,
  createHttpNodeInvoker,
  resetNodeWorkerPool,
  workerEnv,
  platformAliases,
  defaultNodePath,
  sourceKey
};
