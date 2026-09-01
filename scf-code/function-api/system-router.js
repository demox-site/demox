'use strict';

const fs = require('fs');
const path = require('path');

const manifest = require('./system-functions.json');

function loadSystemManifest() {
  return manifest.map((item) => ({
    ...item,
    routePrefixes: [...(item.routePrefixes || [])],
    triggers: [...(item.triggers || [])],
    timerTriggers: [...(item.timerTriggers || [])],
    requiredEnvironment: [...(item.requiredEnvironment || [])]
  }));
}

function reservedFirstSegments(entries = manifest) {
  const reserved = new Set(['functions', 'health', 'api', 'env']);
  for (const entry of entries) {
    for (const prefix of entry.routePrefixes || []) {
      const first = normalizeRoutePath(prefix).split('/').filter(Boolean)[0];
      if (first) reserved.add(first.toLowerCase());
    }
  }
  return reserved;
}

function parseSiteScopedPath(pathValue, entries = manifest) {
  const normalized = normalizeRoutePath(pathValue);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [websiteId, envName, ...rest] = parts;
  if (reservedFirstSegments(entries).has(String(websiteId).toLowerCase())) return null;
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(websiteId)) return null;
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(envName)) return null;
  return {
    websiteId,
    env: envName,
    rest: rest.length ? `/${rest.join('/')}` : '/'
  };
}

function applySiteScope(event = {}, entries = manifest) {
  const bodyPath = event.body && typeof event.body === 'object'
    ? event.body.path
    : parseBodyPath(event.body);
  const rawPath = String(event.path || event.rawPath || event.requestContext?.http?.path || bodyPath || '/').split('?')[0];
  const raw = normalizeRoutePath(rawPath);
  const scoped = parseSiteScopedPath(raw, entries);
  if (!scoped) return event;
  const { readQuery } = require('./site-binding.js');
  const query = readQuery(event);
  if (!query.websiteId && !query.website_id) query.websiteId = scoped.websiteId;
  if (!query.env) query.env = scoped.env;
  return {
    ...event,
    path: scoped.rest,
    rawPath: scoped.rest,
    queryStringParameters: query
  };
}

function resolveSystemFunction(event = {}, entries = manifest) {
  const triggerName = String(event.TriggerName || event.triggerName || '').trim();
  if (triggerName) {
    return entries.find((item) => (item.timerTriggers || []).includes(triggerName)) || null;
  }
  const scoped = applySiteScope(event, entries);
  const bodyPath = scoped.body && typeof scoped.body === 'object'
    ? scoped.body.path
    : parseBodyPath(scoped.body);
  const pathValue = normalizeRoutePath(scoped.path || scoped.rawPath || scoped.requestContext?.http?.path || bodyPath || '/');
  return entries.find((item) => (item.routePrefixes || []).some((prefix) => (
    routeMatches(pathValue, prefix)
  ))) || null;
}

function parseBodyPath(body) {
  if (typeof body !== 'string' || body.length > 16 * 1024) return '';
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? parsed.path : '';
  } catch {
    return '';
  }
}

function createSystemFunctionRouter({ entries = loadSystemManifest(), loaders = {}, logger = console, baseDir = path.resolve(__dirname, '..', '..') } = {}) {
  const cache = new Map();
  const rootDir = path.resolve(baseDir);

  const loadHandler = (entry) => {
    if (cache.has(entry.name)) return cache.get(entry.name);
    const customLoader = loaders[entry.name] || loaders[entry.slug];
    if (customLoader) {
      const handler = typeof customLoader === 'function' ? customLoader() : customLoader;
      const promise = Promise.resolve(handler).then(normalizeHandler(entry));
      cache.set(entry.name, promise);
      return promise;
    }
    if (entry.sourcePresent === false) {
      throw new Error(entry.migrationBlocker || `系统函数源码不存在: ${entry.name}`);
    }
    const sourceDir = path.resolve(rootDir, entry.sourceDir);
    if (!sourceDir.startsWith(`${rootDir}${path.sep}`)) throw new Error(`系统函数路径越界: ${entry.name}`);
    const modulePath = path.join(sourceDir, entry.entrypoint);
    if (!fs.existsSync(modulePath)) throw new Error(`系统函数入口不存在: ${modulePath}`);
    const loaded = require(modulePath);
    const promise = Promise.resolve(loaded).then(normalizeHandler(entry));
    cache.set(entry.name, promise);
    return promise;
  };

  return async function systemMain(event = {}, context = {}) {
    const scoped = applySiteScope(event, entries);
    const entry = resolveSystemFunction(scoped, entries);
    if (!entry) return { statusCode: 404, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ success: false, error: 'SYSTEM_FUNCTION_ROUTE_NOT_FOUND' }) };
    try {
      const handler = await loadHandler(entry);
      return await handler(scoped, context);
    } catch (error) {
      logger.error?.('系统函数路由失败:', entry.name, error.code || 'SYSTEM_FUNCTION_ERROR');
      return {
        statusCode: error.statusCode && Number.isInteger(error.statusCode) ? error.statusCode : 503,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: false, error: error.code || 'SYSTEM_FUNCTION_ERROR', message: '系统函数暂时不可用' })
      };
    }
  };
}

function normalizeRoutePath(value) {
  const pathValue = String(value || '/').replace(/\\+/g, '/');
  if (pathValue.length > 1 && pathValue.endsWith('/')) return pathValue.slice(0, -1);
  return pathValue || '/';
}

function routeMatches(pathValue, prefix) {
  const normalizedPrefix = normalizeRoutePath(prefix);
  if (normalizedPrefix === '/') return pathValue === '/';
  return pathValue === normalizedPrefix || pathValue.startsWith(`${normalizedPrefix}/`);
}

function normalizeHandler(entry) {
  return (loaded) => {
    const handler = loaded?.[entry.handler] || loaded?.main || loaded;
    if (typeof handler !== 'function') throw new Error(`系统函数入口没有可调用的 ${entry.handler}: ${entry.name}`);
    return handler;
  };
}

module.exports = {
  loadSystemManifest,
  resolveSystemFunction,
  createSystemFunctionRouter,
  normalizeHandler,
  normalizeRoutePath,
  routeMatches,
  parseBodyPath,
  parseSiteScopedPath,
  applySiteScope
};
