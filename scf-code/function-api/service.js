'use strict';

const { createFunctionId, isFunctionId, normalizeName, normalizeSlug } = require('./ids.js');
const { requireWebsiteId } = require('./site-binding.js');
const { bundleKey, sha256 } = require('./bundle-store.js');
const { normalizeLimits } = require('./limits.js');
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

  async createFunction({ ownerId, websiteId, name, slug, limits, env } = {}) {
    const owner = requireOwnerId(ownerId);
    const siteId = requireWebsiteId(websiteId);
    let normalizedName;
    let normalizedSlug;
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
        limits: normalizeLimits(limits),
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

  async listFunctions(websiteId) {
    return (await this.repository.listFunctions(requireWebsiteId(websiteId))).map((item) => this.publicFunction(item));
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

  async resolveRuntimeEnv(functionRecord) {
    const siteEnv = typeof this.repository.getWebsiteEnv === 'function'
      ? normalizeEnv(await this.repository.getWebsiteEnv(functionRecord.websiteId))
      : {};
    return {
      ...siteEnv,
      ...normalizeEnv(functionRecord.env),
      SITE_ID: String(functionRecord.websiteId || ''),
      FUNCTION_SLUG: String(functionRecord.slug || '')
    };
  }

  async createVersion({ ownerId, functionId, source, sourceBase64, entrypoint = 'index.mjs' } = {}) {
    const owner = requireOwnerId(ownerId);
    const functionRecord = await this.getOwnedFunction(owner, functionId);
    if (entrypoint !== 'index.mjs') throw badRequest('当前运行时只支持 index.mjs 入口', 'UNSUPPORTED_ENTRYPOINT');

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
      entrypoint,
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
    return this.publicVersion(version);
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
    return { function: this.publicFunction(result.function), version: this.publicVersion(result.version) };
  }

  async invokeBySlug({ websiteId, slug, event, context } = {}) {
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
    return this.invoke({ functionId: record.functionId, event, context });
  }

  async invoke({ functionId, event, context } = {}) {
    if (!isFunctionId(functionId)) throw notFound();
    const functionRecord = await this.repository.getFunction(functionId);
    if (!functionRecord) throw notFound();
    if (functionRecord.status !== 'active') throw notFound('函数已停用');
    if (!functionRecord.publishedVersion) throw badRequest('函数尚未发布版本', 'FUNCTION_NOT_PUBLISHED');

    const request = normalizeInvocationRequest(event);
    if (request.bodyBytes > functionRecord.limits.maxBodyBytes) {
      throw badRequest('请求体超过大小限制', 'REQUEST_TOO_LARGE', { maxBodyBytes: functionRecord.limits.maxBodyBytes });
    }
    const rateKey = `${functionId}:${request.clientKey}`;
    this.consumeRateLimit(rateKey, functionRecord.limits.maxInvocationsPerMinute);

    const version = await this.repository.getVersion(functionId, functionRecord.publishedVersion);
    if (!version || version.status !== 'published') throw internalError('已发布函数版本不存在');
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
      output = await this.runtime.execute({
        source,
        request: request.value,
        env: await this.resolveRuntimeEnv(functionRecord),
        limits: functionRecord.limits,
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

  publicFunction(record) {
    return {
      functionId: record.functionId,
      kind: 'user',
      runtime: 'quickjs',
      websiteId: record.websiteId,
      name: record.name,
      slug: record.slug,
      status: record.status,
      publishedVersion: record.publishedVersion,
      limits: record.limits,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      editable: true,
      invokeUrl: record.websiteId
        ? `${this.publicBaseUrl}/${encodeURIComponent(record.websiteId)}/${encodeURIComponent(process.env.FUNCTION_ENV || 'production')}/api/${encodeURIComponent(record.slug)}`
        : `${this.publicBaseUrl}/functions/${encodeURIComponent(record.functionId)}/invoke`
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
  'JWT_SECRET',
  'MYSQL_HOST',
  'MYSQL_USER',
  'MYSQL_PASSWORD',
  'MYSQL_DATABASE',
  'MYSQL_PORT',
  'ENCRYPTION_KEY',
  'GITHUB_CLIENT_SECRET',
  'FEISHU_APP_SECRET'
]);
const RESERVED_ENV_PREFIXES = [
  'MYSQL_',
  'JWT_',
  'FUNCTIONS_',
  'TENCENT',
  'DEMOX_',
  'AWS_',
  'COS_',
  'SCF_',
  'ACME_'
];

function normalizeEnv(env) {
  if (env === undefined || env === null) return {};
  if (typeof env !== 'object' || Array.isArray(env)) throw badRequest('env 必须是对象', 'INVALID_ENV');
  const entries = Object.entries(env);
  if (entries.length > 32) throw badRequest('环境变量不能超过 32 个', 'ENV_TOO_LARGE');
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

function normalizeInvocationRequest(event = {}) {
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

module.exports = {
  FunctionService,
  normalizeEnv,
  assertAllowedEnv,
  normalizeInvocationRequest,
  normalizeFunctionResponse
};
