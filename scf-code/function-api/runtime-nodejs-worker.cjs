'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { pathToFileURL } = require('url');

const BLOCKED_MODULES = new Set([
  'child_process',
  'node:child_process',
  'cluster',
  'node:cluster',
  'worker_threads',
  'node:worker_threads',
  'inspector',
  'node:inspector',
  'dgram',
  'node:dgram'
]);
const KEEP_ENV = new Set(['PATH', 'NODE_PATH', 'HOME', 'LANG', 'TZ', 'NODE_ENV']);

let handler = null;
let booted = false;
let callingConvention = 'request';

function deny(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function deniedPath(value) {
  const resolved = path.resolve(String(value || ''));
  if (/^\/proc\/\d+(?:\/|$)/.test(resolved)) return true;
  if (resolved === '/sys' || resolved.startsWith('/sys/')) return true;
  return false;
}

function wrapFsMethod(target, name) {
  if (typeof target[name] !== 'function') return;
  const original = target[name];
  target[name] = function patchedFsMethod(...args) {
    const candidate = args[0];
    if (typeof candidate === 'string' && deniedPath(candidate)) {
      deny('不允许访问该路径', 'FUNCTION_FS_DENIED');
    }
    return original.apply(this, args);
  };
}

function patchFs() {
  for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream', 'realpath', 'realpathSync', 'stat', 'statSync', 'access', 'accessSync']) {
    wrapFsMethod(fs, name);
  }
  if (fs.promises) {
    for (const name of ['readFile', 'open', 'realpath', 'stat', 'access']) wrapFsMethod(fs.promises, name);
  }
}

function installRequireHook(aliases = {}) {
  const original = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (BLOCKED_MODULES.has(String(request))) {
      deny(`不允许导入模块: ${request}`, 'FUNCTION_MODULE_DENIED');
    }
    const alias = aliases[request];
    if (alias) return original.call(this, alias, parent, isMain, options);
    return original.call(this, request, parent, isMain, options);
  };
}

function looksLikeEsm(source, entrypoint) {
  if (String(entrypoint || '').endsWith('.mjs')) return true;
  return /\bexport\s+default\b|\bexport\s+\{/.test(String(source || ''));
}

async function loadHandler(file, entrypoint) {
  if (String(entrypoint || '').endsWith('.mjs')) {
    const loaded = await import(pathToFileURL(file).href);
    return loaded.default || loaded.handler || loaded.main;
  }
  const loaded = require(file);
  if (typeof loaded === 'function') return loaded;
  return loaded?.default || loaded?.handler || loaded?.main;
}

function applyEnv(next = {}) {
  for (const key of Object.keys(process.env)) {
    if (!KEEP_ENV.has(key)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === 'string') process.env[key] = value;
  }
}

function reply(message) {
  if (typeof process.send === 'function') process.send(message);
}

function linkPackageRoot(packageRoot, workDir, entrypoint) {
  if (!packageRoot) return;
  let entries;
  try {
    entries = fs.readdirSync(packageRoot);
  } catch {
    return;
  }
  const skip = new Set(['node_modules', '.git', '.bin', entrypoint]);
  for (const name of entries) {
    if (skip.has(name) || /\.test\.(?:c?js|mjs)$/.test(name)) continue;
    const from = path.join(packageRoot, name);
    const to = path.join(workDir, name);
    try {
      fs.symlinkSync(from, to);
    } catch {
      try {
        fs.cpSync(from, to, { recursive: true, dereference: true });
      } catch {
        // Optional package files must not block booting the published entrypoint.
      }
    }
  }
}

function toScfEvent(request = {}) {
  if (request.method === 'TIMER' || (request.trigger && request.trigger.type === 'timer')) {
    return {
      Type: 'Timer',
      TriggerName: (request.trigger && request.trigger.name) || (request.body && request.body.TriggerName) || ''
    };
  }
  return {
    httpMethod: request.method,
    path: request.path,
    headers: request.headers || {},
    queryStringParameters: request.query || {},
    queryString: request.query || {},
    body: request.body,
    isBase64Encoded: false
  };
}

function packageRootFrom(payload = {}) {
  const aliases = payload.aliases || {};
  const name = String(payload.packageName || '').trim();
  if (!name || !aliases[name]) return '';
  return path.dirname(aliases[name]);
}

async function boot(payload = {}) {
  if (booted) return;
  installRequireHook(payload.aliases || {});
  patchFs();
  applyEnv(payload.env || {});
  callingConvention = payload.callingConvention === 'scf-event' ? 'scf-event' : 'request';
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demox-node-'));
  const source = String(payload.source || '');
  const requested = path.basename(String(payload.entrypoint || 'index.js'));
  const entrypoint = looksLikeEsm(source, requested)
    ? (requested.endsWith('.mjs') ? requested : 'index.mjs')
    : requested;
  linkPackageRoot(packageRootFrom(payload), workDir, entrypoint);
  const file = path.join(workDir, entrypoint);
  fs.writeFileSync(file, source, 'utf8');
  handler = await loadHandler(file, entrypoint);
  if (typeof handler !== 'function') {
    deny('函数必须导出 handler：module.exports = async function(request, env) {}', 'INVALID_ENTRYPOINT');
  }
  booted = true;
}

async function invoke(payload = {}) {
  if (!booted || typeof handler !== 'function') {
    deny('运行时尚未初始化', 'FUNCTION_RUNTIME_ERROR');
  }
  applyEnv(payload.env || {});
  const request = payload.request || {};
  const value = callingConvention === 'scf-event'
    ? await handler(toScfEvent(request), {})
    : await handler(request, payload.env || {});
  return value === undefined ? null : value;
}

process.on('message', async (payload = {}) => {
  const id = payload.id;
  const type = payload.type || 'invoke';
  try {
    if (type === 'boot') {
      await boot(payload);
      reply({ ok: true, ready: true, id });
      return;
    }
    const value = await invoke(payload);
    reply({ ok: true, value, id });
  } catch (error) {
    reply({
      ok: false,
      id,
      error: {
        message: error.message || '函数执行出错',
        code: error.code || 'FUNCTION_EXECUTION_ERROR'
      }
    });
    if (type === 'boot') process.exit(1);
  }
});
