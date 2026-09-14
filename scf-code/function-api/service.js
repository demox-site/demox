'use strict';

const { createFunctionId, isFunctionId, normalizeName, normalizeSlug } = require('./ids.js');
const { requireWebsiteId } = require('./site-binding.js');
const { bundleKey, sha256 } = require('./bundle-store.js');
const { normalizeLimits } = require('./limits.js');
const { normalizeRuntime, defaultEntrypointFor, isAllowedEntrypoint } = require('./runtimes.js');
const { isTimerEvent } = require('./function-events.js');
const { routeMatches } = require('./system-router.js');
const { mergeLiveCredentials, packageNameFor } = require('./platform-site.js');
const {
  badRequest,
  forbidden,
  internalError,
  notFound,
  tooManyRequests,
  unauthorized
} = require('./errors.js');

class FunctionService {
  constructor({ repository, bundleStore, runtime, authenticate = null, publicBaseUrl = 'https://api.demox.site', clock = () => Date.now(), logger = console } = {}) {
    if (!repository || !bundleStore || !runtime) throw new TypeError('FunctionService 缺少 repository、bundleStore 或 runtime');
    this.repository = repository;
    this.bundleStore = bundleStore;
    this.runtime = runtime;
    this.authenticate = authenticate;
    this.publicBaseUrl = String(publicBaseUrl).replace(/\/+$/, '');
    this.clock = clock;
    this.logger = logger;
    this.rateBuckets = new Map();
  }

  async createFunction({ ownerId, websiteId, name, slug, limits, env, runtime, routes, triggers, timerName } = {}) {
    const owner = requireOwnerId(ownerId);
    const siteId = requireWebsiteId(websiteId);
    let normalizedName;
    let normalizedSlug;
    const normalizedRuntime = normalizeRuntime(runtime);
    try {
      normalizedName = normalizeName(name);
      normalizedSlug = normalizeSlug(slug);
    } catch (error) {
      throw badRequest(error.message, 'INVALID_FUNCTION_NAME');
    }
    let record;
    try {
      record = await this.repository.createFunction({
        functionId: createFunctionId(),
        ownerId: owner,
        websiteId: siteId,
        name: normalizedName,
        slug: normalizedSlug,
        runtime: normalizedRuntime,
        routes: normalizeRoutes(routes),
        triggers: normalizeTriggers(triggers, timerName),
        timerName: normalizeTimerName(timerName),
        limits: normalizeLimits(limits, normalizedRuntime),
        env: assertAllowedEnv(normalizeEnv(env))
      });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY' || /已存在|duplicate/i.test(error?.message || '')) {
        throw badRequest('该函数标识已存在', 'DUPLICATE_FUNCTION_SLUG');
      }
      throw error;
    }
    return this.publicFunction(record);
  }

  async assertWebsiteOwner(userId, websiteId) {
    const siteId = requireWebsiteId(websiteId);
    if (typeof this.repository.getWebsiteOwner !== 'function') return;
    const owner = await this.repository.getWebsiteOwner(siteId);
    if (owner && String(owner) !== String(userId)) throw forbidden('没有权限操作此站点环境变量');
  }

  async listFunctions(websiteId) {
    const records = await this.repository.listFunctions(requireWebsiteId(websiteId));
    return Promise.all(records.map(async (item) => this.publicFunction(item, await this.aliasesFor(item))));
  }

  async getWebsiteEnv(websiteId) {
    const siteId = requireWebsiteId(websiteId);
    if (typeof this.repository.getWebsiteEnv !== 'function') return {};
    return normalizeEnv(await this.repository.getWebsiteEnv(siteId));
  }

  async putWebsiteEnv(websiteId, env) {
    const siteId = requireWebsiteId(websiteId);
    if (typeof this.repository.putWebsiteEnv !== 'function') {
      throw internalError('当前存储不支持站点环境变量');
    }
    const normalized = assertAllowedEnv(normalizeEnv(env));
    return this.repository.putWebsiteEnv(siteId, normalized);
  }

  async getFunctionEnv({ ownerId, functionId } = {}) {
    const functionRecord = await this.getOwnedFunction(requireOwnerId(ownerId), functionId);
    return normalizeEnv(functionRecord.env);
  }

  async putFunctionEnv({ ownerId, functionId, env } = {}) {
    const functionRecord = await this.getOwnedFunction(requireOwnerId(ownerId), functionId);
    if (typeof this.repository.putFunctionEnv !== 'function') {
      throw internalError('当前存储不支持函数环境变量');
    }
    return this.repository.putFunctionEnv(functionRecord.functionId, assertAllowedEnv(normalizeEnv(env)));
  }

  async listAliases({ ownerId, functionId } = {}) {
    const functionRecord = await this.getOwnedFunction(requireOwnerId(ownerId), functionId);
    return this.aliasesFor(functionRecord);
  }

  async setAlias({ ownerId, functionId, alias, version } = {}) {
    const functionRecord = await this.getOwnedFunction(requireOwnerId(ownerId), functionId);
    const name = normalizeAliasName(alias);
    const versionNumber = parseVersion(version);
    const versionRecord = await this.repository.getVersion(functionRecord.functionId, versionNumber);
    if (!versionRecord || versionRecord.status === 'failed') throw notFound('函数版本不存在');
    if (versionRecord.status === 'draft') throw badRequest('该版本还不能被别名引用', 'VERSION_NOT_READY');
    const record = await this.repository.setAlias(functionRecord.functionId, name, versionNumber);
    if (!record) throw notFound('函数版本不存在');
    return record;
  }

  async deleteAlias({ ownerId, functionId, alias } = {}) {
    const functionRecord = await this.getOwnedFunction(requireOwnerId(ownerId), functionId);
    const name = normalizeAliasName(alias);
    if (DEFAULT_ALIASES.includes(name)) throw badRequest('不能删除默认别名', 'RESERVED_ALIAS');
    await this.repository.deleteAlias(functionRecord.functionId, name);
    return { alias: name, deleted: true };
  }

  async aliasesFor(functionRecord) {
    if (typeof this.repository.listAliases !== 'function') return [];
    let aliases = await this.repository.listAliases(functionRecord.functionId);
    const missingDefault = DEFAULT_ALIASES.some((name) => !aliases.some((item) => item.alias === name));
    if (missingDefault && functionRecord.publishedVersion && typeof this.repository.ensureDefaultAliases === 'function') {
      aliases = await this.repository.ensureDefaultAliases(functionRecord.functionId, functionRecord.publishedVersion);
    }
    return aliases;
  }

  async resolveRuntimeEnv(functionRecord) {
    const siteEnv = typeof this.repository.getWebsiteEnv === 'function'
      ? normalizeEnv(await this.repository.getWebsiteEnv(functionRecord.websiteId))
      : {};
    const merged = mergeLiveCredentials({
      ...siteEnv,
      ...normalizeEnv(functionRecord.env)
    }, functionRecord.websiteId);
    return {
      ...merged,
      SITE_ID: String(functionRecord.websiteId || ''),
      FUNCTION_SLUG: String(functionRecord.slug || '')
    };
  }

  async createVersion({ ownerId, functionId, source, sourceBase64, entrypoint } = {}) {
    const owner = requireOwnerId(ownerId);
    const functionRecord = await this.getOwnedFunction(owner, functionId);
    const resolvedEntrypoint = entrypoint || defaultEntrypointFor(functionRecord.runtime);
    if (!isAllowedEntrypoint(functionRecord.runtime, resolvedEntrypoint)) {
      throw badRequest('当前运行时不支持该入口文件', 'UNSUPPORTED_ENTRYPOINT');
    }

    let sourceBuffer;
    if (sourceBase64 !== undefined) {
      const encoded = String(sourceBase64).replace(/\s+/g, '');
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
        throw badRequest('sourceBase64 不是有效代码', 'INVALID_SOURCE');
      }
      sourceBuffer = Buffer.from(encoded, 'base64');
    } else if (typeof source === 'string' || Buffer.isBuffer(source)) {
      sourceBuffer = Buffer.isBuffer(source) ? Buffer.from(source) : Buffer.from(source, 'utf8');
    } else {
      throw badRequest('缺少函数代码 source', 'MISSING_SOURCE');
    }

    if (sourceBuffer.length === 0) throw badRequest('函数代码不能为空', 'EMPTY_SOURCE');
    if (sourceBuffer.length > functionRecord.limits.maxCodeBytes) {
      throw badRequest('函数代码超过大小限制', 'CODE_TOO_LARGE', { maxCodeBytes: functionRecord.limits.maxCodeBytes });
    }

    const digest = sha256(sourceBuffer);
    const version = await this.repository.createVersion({
      functionId: functionRecord.functionId,
      sha256: digest,
      sizeBytes: sourceBuffer.length,
      entrypoint: resolvedEntrypoint,
      bundleKeyFactory: (versionNumber) => bundleKey(functionRecord.functionId, versionNumber)
    });
    if (!version) throw notFound();

    try {
      await this.bundleStore.put(version.bundleKey, sourceBuffer, { contentType: 'application/javascript; charset=utf-8' });
    } catch (error) {
      const failedVersion = this.repository.markVersionFailed?.(functionRecord.functionId, version.version);
      if (failedVersion) await Promise.resolve(failedVersion).catch(() => {});
      throw internalError('函数代码保存失败', { cause: error.message });
    }
    const previousPublished = Number(functionRecord.publishedVersion || 0);
    const available = this.repository.markVersionAvailable
      ? await this.repository.markVersionAvailable(functionRecord.functionId, version.version)
      : version;
    if (typeof this.repository.ensureDefaultAliases === 'function') {
      const existing = typeof this.repository.listAliases === 'function'
        ? await this.repository.listAliases(functionRecord.functionId)
        : [];
      if (!existing.length) {
        await this.repository.ensureDefaultAliases(
          functionRecord.functionId,
          previousPublished || available.version || 1
        );
      }
    }
    return this.publicVersion(available || version);
  }

  async listVersions({ ownerId, functionId } = {}) {
    const functionRecord = await this.getOwnedFunction(requireOwnerId(ownerId), functionId);
    return (await this.repository.listVersions(functionRecord.functionId)).map((item) => this.publicVersion(item));
  }

  async getSource({ ownerId, functionId, version } = {}) {
    const functionRecord = await this.getOwnedFunction(requireOwnerId(ownerId), functionId);
    const versionNumber = version == null || version === ''
      ? Number(functionRecord.publishedVersion || 0)
      : parseVersion(version);
    if (!versionNumber) throw badRequest('函数尚未发布版本', 'FUNCTION_NOT_PUBLISHED');
    const versionRecord = await this.repository.getVersion(functionRecord.functionId, versionNumber);
    if (!versionRecord) throw notFound('函数版本不存在');
    let bundle;
    try {
      bundle = await this.bundleStore.getBuffer(versionRecord.bundleKey);
    } catch {
      throw internalError('函数代码读取失败', { code: 'BUNDLE_MISSING' });
    }
    if (sha256(bundle) !== versionRecord.sha256) throw internalError('函数代码校验失败', { code: 'BUNDLE_CHECKSUM_MISMATCH' });
    return {
      functionId: functionRecord.functionId,
      version: versionNumber,
      source: bundle.toString('utf8')
    };
  }

  async publishVersion({ ownerId, functionId, version } = {}) {
    const functionRecord = await this.getOwnedFunction(requireOwnerId(ownerId), functionId);
    const versionNumber = parseVersion(version);
    const versionRecord = await this.repository.getVersion(functionRecord.functionId, versionNumber);
    if (!versionRecord) throw notFound('函数版本不存在');
    if (versionRecord.status === 'failed') throw badRequest('函数代码保存失败，不能发布', 'VERSION_FAILED');
    let bundle;
    try {
      bundle = await this.bundleStore.getBuffer(versionRecord.bundleKey);
    } catch {
      throw internalError('函数代码缺失，不能发布', { code: 'BUNDLE_MISSING' });
    }
    if (sha256(bundle) !== versionRecord.sha256) throw internalError('函数代码校验失败，不能发布', { code: 'BUNDLE_CHECKSUM_MISMATCH' });
    const result = await this.repository.publishVersion(functionRecord.functionId, versionNumber);
    if (!result) throw notFound('函数版本不存在');
    return {
      function: this.publicFunction(result.function, await this.aliasesFor(result.function)),
      version: this.publicVersion(result.version)
    };
  }

  async invokeBySlug({ websiteId, slug, event, context, alias } = {}) {
    const siteId = requireWebsiteId(websiteId);
    let normalizedSlug;
    try {
      normalizedSlug = normalizeSlug(slug);
    } catch {
      throw notFound();
    }
    const record = typeof this.repository.getFunctionByWebsiteSlug === 'function'
      ? await this.repository.getFunctionByWebsiteSlug(siteId, normalizedSlug)
      : (await this.repository.listFunctions(siteId)).find((item) => item.slug === normalizedSlug);
    if (!record) throw notFound('函数不存在');
    return this.invoke({ functionId: record.functionId, event, context, alias });
  }

  async findPublishedByRoute(websiteId, pathValue) {
    const siteId = requireWebsiteId(websiteId);
    const functions = await this.repository.listFunctions(siteId);
    let best = null;
    let bestLength = -1;
    for (const record of functions) {
      if (record.status !== 'active') continue;
      if (!record.publishedVersion && typeof this.repository.listAliases === 'function') {
        const aliases = await this.repository.listAliases(record.functionId);
        if (!aliases.length) continue;
      } else if (!record.publishedVersion) continue;
      for (const route of record.routes || []) {
        if (routeMatches(pathValue, route) && String(route).length > bestLength) {
          best = record;
          bestLength = String(route).length;
        }
      }
    }
    return best;
  }

  async findPublishedByTimer(timerName) {
    const name = String(timerName || '').trim();
    if (!name || typeof this.repository.getFunctionByTimerName !== 'function') return null;
    const record = await this.repository.getFunctionByTimerName(name);
    if (!record || record.status !== 'active') return null;
    return record;
  }

  async resolveAliasVersion(functionRecord, aliasName) {
    if (typeof this.repository.getAlias === 'function') {
      const pointed = await this.repository.getAlias(functionRecord.functionId, aliasName);
      if (pointed?.version) return Number(pointed.version);
      if (functionRecord.publishedVersion && DEFAULT_ALIASES.includes(aliasName)) {
        await this.repository.ensureDefaultAliases(functionRecord.functionId, functionRecord.publishedVersion);
        const created = await this.repository.getAlias(functionRecord.functionId, aliasName);
        if (created?.version) return Number(created.version);
      }
    }
    return Number(functionRecord.publishedVersion || 0) || null;
  }

  async invoke({ functionId, event, context, alias } = {}) {
    if (!isFunctionId(functionId)) throw notFound();
    const functionRecord = await this.repository.getFunction(functionId);
    if (!functionRecord) throw notFound();
    if (functionRecord.status !== 'active') throw notFound('函数已停用');

    const aliasName = normalizeAliasName(alias || 'production');
    const versionNumber = await this.resolveAliasVersion(functionRecord, aliasName);
    if (!versionNumber) throw badRequest('函数别名未指向版本', 'ALIAS_NOT_FOUND');

    const request = normalizeInvocationRequest(event);
    if (request.bodyBytes > functionRecord.limits.maxBodyBytes) {
      throw badRequest('请求体超过大小限制', 'REQUEST_TOO_LARGE', { maxBodyBytes: functionRecord.limits.maxBodyBytes });
    }
    const rateKey = `${functionId}:${request.clientKey}`;
    this.consumeRateLimit(rateKey, functionRecord.limits.maxInvocationsPerMinute);

    const version = await this.repository.getVersion(functionId, versionNumber);
    if (!version || version.status === 'failed' || version.status === 'draft') {
      throw internalError('别名指向的函数版本不可用');
    }
    let source;
    try {
      source = await this.bundleStore.getBuffer(version.bundleKey);
    } catch {
      throw internalError('函数代码读取失败', { code: 'BUNDLE_MISSING' });
    }
    if (sha256(source) !== version.sha256) throw internalError('函数代码校验失败', { code: 'BUNDLE_CHECKSUM_MISMATCH' });

    const startedAt = this.clock();
    let output;
    let status = 'success';
    let errorCode = null;
    try {
      const packageName = packageNameFor(functionRecord);
      output = await this.runtime.execute({
        source,
        request: request.value,
        env: await this.resolveRuntimeEnv(functionRecord),
        limits: functionRecord.limits,
        runtime: functionRecord.runtime,
        entrypoint: version.entrypoint,
        packageName,
        callingConvention: packageName ? 'scf-event' : undefined,
        context
      });
      const response = normalizeFunctionResponse(output, functionRecord.limits.maxResponseBytes);
      this.recordInvocation({ functionRecord, version, status, startedAt, requestBytes: request.bodyBytes, responseBytes: Buffer.byteLength(response.body), errorCode });
      return response;
    } catch (error) {
      status = 'error';
      errorCode = error.code || 'FUNCTION_ERROR';
      this.recordInvocation({ functionRecord, version, status, startedAt, requestBytes: request.bodyBytes, responseBytes: 0, errorCode });
      throw error;
    }
  }

  consumeRateLimit(key, limit) {
    const now = this.clock();
    const cutoff = now - 60_000;
    const recent = (this.rateBuckets.get(key) || []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= limit) throw tooManyRequests('函数调用超过每分钟配额');
    recent.push(now);
    this.rateBuckets.set(key, recent);
  }

  async getOwnedFunction(ownerId, functionId) {
    if (!isFunctionId(functionId)) throw notFound();
    const record = await this.repository.getFunction(functionId);
    if (!record) throw notFound();
    if (String(record.ownerId) !== String(ownerId)) throw forbidden();
    return record;
  }

  publicFunction(record, aliases = []) {
    const envName = process.env.FUNCTION_ENV || 'production';
    const route = (record.routes || [])[0];
    const invokeUrl = record.websiteId
      ? `${this.publicBaseUrl}/${encodeURIComponent(record.websiteId)}/${encodeURIComponent(envName)}${route || `/api/${encodeURIComponent(record.slug)}`}`
      : `${this.publicBaseUrl}/functions/${encodeURIComponent(record.functionId)}/invoke`;
    return {
      functionId: record.functionId,
      kind: 'user',
      runtime: record.runtime && record.runtime !== 'quickjs' ? record.runtime : 'nodejs',
      websiteId: record.websiteId,
      name: record.name,
      slug: record.slug,
      status: record.status,
      publishedVersion: record.publishedVersion,
      routes: [...(record.routes || [])],
      triggers: [...(record.triggers || ['http'])],
      timerName: record.timerName || null,
      aliases: (aliases || []).map((item) => ({ alias: item.alias, version: item.version })),
      limits: record.limits,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      editable: true,
      invokeUrl
    };
  }

  publicVersion(record) {
    return {
      version: record.version,
      status: record.status,
      sha256: record.sha256,
      sizeBytes: record.sizeBytes,
      entrypoint: record.entrypoint,
      createdAt: record.createdAt
    };
  }

  recordInvocation(record) {
    if (typeof this.repository.recordInvocation !== 'function') return;
    Promise.resolve(this.repository.recordInvocation({
      functionId: record.functionRecord.functionId,
      version: record.version.version,
      ownerId: record.functionRecord.ownerId,
      status: record.status,
      durationMs: Math.max(0, this.clock() - record.startedAt),
      requestBytes: record.requestBytes,
      responseBytes: record.responseBytes,
      errorCode: record.errorCode
    })).catch((error) => this.logger.warn?.('记录函数调用失败:', error.message));
  }
}

function requireOwnerId(ownerId) {
  if (ownerId === undefined || ownerId === null || ownerId === '') throw unauthorized();
  return String(ownerId);
}

function parseVersion(value) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version <= 0) throw badRequest('version 必须是正整数', 'INVALID_VERSION');
  return version;
}

const RESERVED_ENV_KEYS = new Set([
  'SITE_ID',
  'FUNCTION_SLUG',
  'PATH',
  'NODE_PATH',
  'NODE_OPTIONS',
  'HOME'
]);
const RESERVED_ENV_PREFIXES = [
  'FUNCTIONS_'
];

function normalizeEnv(env) {
  if (env === undefined || env === null) return {};
  if (typeof env !== 'object' || Array.isArray(env)) throw badRequest('env 必须是对象', 'INVALID_ENV');
  const entries = Object.entries(env);
  if (entries.length > 128) throw badRequest('环境变量不能超过 128 个', 'ENV_TOO_LARGE');
  const output = {};
  for (const [key, value] of entries) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key)) throw badRequest(`环境变量名非法: ${key}`, 'INVALID_ENV_KEY');
    if (typeof value !== 'string' || Buffer.byteLength(value) > 2048) throw badRequest(`环境变量值非法: ${key}`, 'INVALID_ENV_VALUE');
    output[key] = value;
  }
  return output;
}

function assertAllowedEnv(env) {
  for (const key of Object.keys(env || {})) {
    if (RESERVED_ENV_KEYS.has(key) || RESERVED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      throw badRequest(`环境变量名保留给平台使用: ${key}`, 'RESERVED_ENV_KEY');
    }
  }
  return env;
}

function normalizeRoutes(routes) {
  if (routes == null || routes === '') return [];
  const values = Array.isArray(routes)
    ? routes
    : String(routes).split(/[\s,]+/).filter(Boolean);
  if (values.length > 256) throw badRequest('自定义路径不能超过 256 条', 'ROUTES_TOO_LARGE');
  const output = [];
  for (const item of values) {
    const route = String(item || '').trim();
    if (!route) continue;
    if (!/^\/[A-Za-z0-9._/-]{0,127}$/.test(route) || route.includes('//')) {
      throw badRequest(`自定义路径非法: ${route}`, 'INVALID_ROUTE');
    }
    const first = route.split('/').filter(Boolean)[0];
    if (['functions', 'env'].includes(String(first || '').toLowerCase())) {
      throw badRequest(`自定义路径保留给平台使用: ${route}`, 'RESERVED_ROUTE');
    }
    output.push(route.length > 1 && route.endsWith('/') ? route.slice(0, -1) : route);
  }
  return [...new Set(output)];
}

function normalizeTimerName(value) {
  if (value == null || value === '') return null;
  const name = String(value).trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) throw badRequest('定时触发名称非法', 'INVALID_TIMER_NAME');
  return name;
}

function normalizeTriggers(triggers, timerName) {
  const values = Array.isArray(triggers)
    ? triggers.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
    : [];
  const output = new Set(values.length ? values : ['http']);
  if (timerName) output.add('timer');
  for (const item of output) {
    if (item !== 'http' && item !== 'timer') throw badRequest(`不支持的触发方式: ${item}`, 'INVALID_TRIGGER');
  }
  return [...output];
}

function normalizeInvocationRequest(event = {}) {
  if (isTimerEvent(event)) {
    const name = String(event.TriggerName || event.triggerName || '').trim();
    return {
      bodyBytes: 0,
      clientKey: 'timer',
      value: {
        method: 'TIMER',
        url: '',
        path: '',
        query: {},
        headers: {},
        body: { TriggerName: name, Type: event.Type || event.type || 'Timer' },
        trigger: { type: 'timer', name }
      }
    };
  }
  const headers = {};
  for (const [key, value] of Object.entries(event.headers || {})) headers[String(key).toLowerCase()] = String(value);
  const method = String(event.httpMethod || event.requestContext?.http?.method || 'GET').toUpperCase();
  const query = { ...(event.queryStringParameters || event.queryString || event.query || {}) };
  let rawBody = event.body;
  if (rawBody === undefined || rawBody === null) rawBody = '';
  if (typeof rawBody === 'object' && !Buffer.isBuffer(rawBody)) rawBody = JSON.stringify(rawBody);
  let bodyBuffer = Buffer.isBuffer(rawBody) ? Buffer.from(rawBody) : Buffer.from(String(rawBody), event.isBase64Encoded ? 'base64' : 'utf8');
  const bodyText = bodyBuffer.toString('utf8');
  let body = bodyText;
  if (/^application\/json(?:\s*;|$)/i.test(headers['content-type'] || '')) {
    try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = bodyText; }
  }
  const path = String(event.path || event.rawPath || '/');
  const queryString = new URLSearchParams(query).toString();
  const host = headers.host || 'function.local';
  return {
    bodyBytes: bodyBuffer.length,
    clientKey: event.requestContext?.sourceIp || headers['x-forwarded-for']?.split(',')[0]?.trim() || 'anonymous',
    value: {
      method,
      url: `https://${host}${path}${queryString ? `?${queryString}` : ''}`,
      path,
      query,
      headers,
      body
    }
  };
}

function normalizeFunctionResponse(output, maxResponseBytes) {
  let status = 200;
  let headers = {};
  let body = output;
  if (output && typeof output === 'object' && !Buffer.isBuffer(output)) {
    status = output.status ?? output.statusCode ?? 200;
    headers = output.headers || {};
    body = output.body;
  }
  status = Number(status);
  if (!Number.isInteger(status) || status < 100 || status > 599) throw internalError('函数返回了非法状态码', { code: 'INVALID_RESPONSE' });
  if (body === undefined || body === null) body = '';
  if (typeof body !== 'string') {
    try { body = JSON.stringify(body); } catch { throw internalError('函数返回值无法序列化', { code: 'INVALID_RESPONSE' }); }
  }
  if (Buffer.byteLength(body) > maxResponseBytes) throw internalError('函数响应超过大小限制', { code: 'RESPONSE_TOO_LARGE' });
  const safeHeaders = {};
  let headerBytes = 0;
  for (const [key, value] of Object.entries(headers || {})) {
    if (Object.keys(safeHeaders).length >= 64) break;
    const normalizedKey = String(key).toLowerCase();
    if (!/^[a-z0-9-]{1,64}$/.test(normalizedKey)) continue;
    if (['connection', 'content-length', 'transfer-encoding', 'host'].includes(normalizedKey)) continue;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const safeValue = String(value).slice(0, 4096);
    if (headerBytes + Buffer.byteLength(normalizedKey) + Buffer.byteLength(safeValue) > 32 * 1024) break;
    safeHeaders[normalizedKey] = safeValue;
    headerBytes += Buffer.byteLength(normalizedKey) + Buffer.byteLength(safeValue);
  }
  if (!safeHeaders['content-type']) safeHeaders['content-type'] = 'text/plain; charset=utf-8';
  return { statusCode: status, headers: safeHeaders, body, isBase64Encoded: false };
}

const DEFAULT_ALIASES = Object.freeze(['production', 'develop']);
const RESERVED_ALIAS_NAMES = new Set(['functions', 'env', 'api']);

function normalizeAliasName(value) {
  const alias = String(value || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(alias) || RESERVED_ALIAS_NAMES.has(alias)) {
    throw badRequest('别名非法', 'INVALID_ALIAS');
  }
  return alias;
}

module.exports = {
  FunctionService,
  DEFAULT_ALIASES,
  normalizeAliasName,
  normalizeEnv,
  assertAllowedEnv,
  normalizeInvocationRequest,
  normalizeFunctionResponse,
  normalizeRoutes,
  normalizeTriggers,
  normalizeTimerName
};
