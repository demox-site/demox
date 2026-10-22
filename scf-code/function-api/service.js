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
  cloudEnvFromCredentials,
  createBusinessCredentialProvider,
  credentialKind,
  stripLongLivedBizKeys
} = require('./business-credentials.js');
const {
  decryptPlatformSecret,
  encryptPlatformSecret,
  isPlatformProject,
  parseEnvAssignment,
  platformDispatchPool,
  publicEnvView
} = require('./platform-secrets.js');
const { clientIpInfo } = require('./client-ip.js');
const {
  badRequest,
  forbidden,
  internalError,
  notFound,
  tooManyRequests,
  unauthorized
} = require('./errors.js');

class FunctionService {
  constructor({ repository, bundleStore, runtime, authenticate = null, publicBaseUrl = 'https://api.demox.site', clock = () => Date.now(), logger = console, businessCredentials = null } = {}) {
    if (!repository || !bundleStore || !runtime) throw new TypeError('FunctionService 缺少 repository、bundleStore 或 runtime');
    this.repository = repository;
    this.bundleStore = bundleStore;
    this.runtime = runtime;
    this.authenticate = authenticate;
    this.publicBaseUrl = String(publicBaseUrl).replace(/\/+$/, '');
    this.clock = clock;
    this.logger = logger;
    this.rateBuckets = new Map();
    this.businessCredentials = businessCredentials || createBusinessCredentialProvider({
      clock: () => this.clock(),
      logger: this.logger
    });
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
    const assignment = splitPlainEnv(env, siteId);
    const plainEnv = assertAllowedEnv(normalizeEnv(assignment.plain));
    const cipher = await this.buildPlatformCipher(null, siteId, assignment);
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
        env: plainEnv
      });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY' || /已存在|duplicate/i.test(error?.message || '')) {
        throw badRequest('该函数标识已存在', 'DUPLICATE_FUNCTION_SLUG');
      }
      throw error;
    }
    if (Object.keys(cipher).length && typeof this.repository.replaceFunctionSecrets === 'function') {
      await this.repository.replaceFunctionSecrets(record.functionId, cipher);
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
    const plain = normalizeEnv(functionRecord.env);
    if (!isPlatformProject(functionRecord.websiteId)) return plain;
    return publicEnvView(plain, await this.readPlatformSecrets(functionRecord.functionId));
  }

  async putFunctionEnv({ ownerId, functionId, env } = {}) {
    const functionRecord = await this.getOwnedFunction(requireOwnerId(ownerId), functionId);
    if (typeof this.repository.putFunctionEnv !== 'function') {
      throw internalError('当前存储不支持函数环境变量');
    }
    const assignment = splitPlainEnv(env, functionRecord.websiteId);
    const plain = assertAllowedEnv(normalizeEnv(assignment.plain));
    const cipher = await this.buildPlatformCipher(functionRecord.functionId, functionRecord.websiteId, assignment);
    const stored = await this.repository.putFunctionEnv(functionRecord.functionId, plain);
    if (typeof this.repository.replaceFunctionSecrets === 'function') {
      await this.repository.replaceFunctionSecrets(functionRecord.functionId, cipher);
    } else if (Object.keys(cipher).length) {
      throw internalError('当前存储不支持平台密钥');
    }
    if (!isPlatformProject(functionRecord.websiteId)) return stored || plain;
    return publicEnvView(plain, cipher);
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

  async resolveRuntimeEnv(functionRecord, { pool = 'user' } = {}) {
    const siteEnv = typeof this.repository.getWebsiteEnv === 'function'
      ? normalizeEnv(await this.repository.getWebsiteEnv(functionRecord.websiteId))
      : {};
    const plain = {
      ...siteEnv,
      ...normalizeEnv(functionRecord.env)
    };
    // 用户池和 user-runtime 回滚都不解密平台密钥。网关临时密钥只在旧的 user-runtime 路径合并。
    const merged = pool === 'platform'
      ? plain
      : mergeLiveCredentials(plain, functionRecord.websiteId);
    const secrets = {};
    if (pool === 'platform' && isPlatformProject(functionRecord.websiteId)) {
      const cipher = await this.readPlatformSecrets(functionRecord.functionId);
      for (const [key, value] of Object.entries(cipher)) {
        secrets[key] = decryptPlatformSecret(value);
      }
    }
    const output = stripLongLivedBizKeys({
      ...merged,
      ...secrets,
      SITE_ID: String(functionRecord.websiteId || ''),
      FUNCTION_SLUG: String(functionRecord.slug || '')
    });
    if (pool === 'platform' && isPlatformProject(functionRecord.websiteId)) {
      const kind = credentialKind(functionRecord.slug);
      if (kind) Object.assign(output, await this.invocationCloudEnv(functionRecord, kind));
    }
    return output;
  }

  /**
   * 平台池业务函数拿会话策略临时凭证。cert-renew 拿角色凭证，不带会话策略。
   * 失败时不回落到网关角色凭证，避免把 SSL 可用的密钥交给业务函数。
   */
  async invocationCloudEnv(functionRecord, kind) {
    let cloud;
    try {
      cloud = await this.businessCredentials.credentialsFor({
        kind,
        slug: String(functionRecord.slug || ''),
        functionId: functionRecord.functionId,
        websiteId: functionRecord.websiteId,
        sourceEnv: process.env
      });
    } catch (error) {
      throw internalError('业务云凭证不可用', { code: error.code || 'BUSINESS_ROLE_ASSUME_FAILED' });
    }
    return cloudEnvFromCredentials(cloud, kind);
  }

  async readPlatformSecrets(functionId) {
    if (typeof this.repository.getFunctionSecrets !== 'function') return {};
    const stored = await this.repository.getFunctionSecrets(functionId);
    return stored && typeof stored === 'object' ? stored : {};
  }

  async buildPlatformCipher(functionId, websiteId, assignment) {
    const secretKeys = [...Object.keys(assignment.secrets || {}), ...assignment.keep];
    if (!secretKeys.length) return {};
    if (!isPlatformProject(websiteId)) throw platformSecretForbidden();
    assertAllowedEnv(Object.fromEntries(secretKeys.map((key) => [key, 'ok'])));
    const existing = assignment.keep.length ? await this.readPlatformSecrets(functionId) : {};
    const cipher = {};
    for (const key of assignment.keep) {
      if (typeof existing[key] !== 'string' || !existing[key]) {
        throw badRequest(`平台密钥没有现有值: ${key}`, 'PLATFORM_SECRET_MISSING');
      }
      cipher[key] = existing[key];
    }
    for (const [key, value] of Object.entries(assignment.secrets || {})) {
      cipher[key] = encryptPlatformSecret(value);
    }
    return cipher;
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
    const pool = platformDispatchPool(functionRecord, event || {});
    if (pool === 'in-process') {
      // 默认仍在进程内。前缀开关为空时走这里，不派发到任一运行时池。
      const error = notFound('平台站点函数在进程内执行');
      error.code = 'PLATFORM_SITE_IN_PROCESS';
      throw error;
    }

    const aliasName = normalizeAliasName(alias || 'production');
    const versionNumber = await this.resolveAliasVersion(functionRecord, aliasName);
    if (!versionNumber) throw badRequest('函数别名未指向版本', 'ALIAS_NOT_FOUND');

    const request = normalizeInvocationRequest(event);
    if (request.bodyBytes > functionRecord.limits.maxBodyBytes) {
      throw badRequest('请求体超过大小限制', 'REQUEST_TOO_LARGE', { maxBodyBytes: functionRecord.limits.maxBodyBytes });
    }
    // 每个来源 key 各扣一次：只伪造 XFF 或只伪造 x-scf-remote-addr 都绕不过（见 client-ip.js clientIpInfo）。
    this.consumeRateLimits((request.clientKeys || [request.clientKey]).map((key) => `${functionId}:${key}`), functionRecord.limits.maxInvocationsPerMinute);

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

    const runtimeEnv = await this.resolveRuntimeEnv(functionRecord, { pool });
    const startedAt = this.clock();
    let output;
    let status = 'success';
    let errorCode = null;
    try {
      const packageName = packageNameFor(functionRecord);
      output = await this.runtime.execute({
        source,
        request: request.value,
        env: runtimeEnv,
        limits: functionRecord.limits,
        runtime: functionRecord.runtime,
        entrypoint: version.entrypoint,
        packageName,
        callingConvention: packageName ? 'scf-event' : undefined,
        pool,
        context
      });
      const response = normalizeFunctionResponse(output, functionRecord.limits.maxResponseBytes);
      // 只在平台池真正执行后标记。进程内软回落在进 execute 之前就抛出，不会带到这个头。
      if (pool === 'platform') response.headers['x-demox-dispatch'] = 'platform';
      this.recordInvocation({ functionRecord, version, status, startedAt, requestBytes: request.bodyBytes, responseBytes: Buffer.byteLength(response.body), errorCode });
      return response;
    } catch (error) {
      status = 'error';
      errorCode = error.code || 'FUNCTION_ERROR';
      this.recordInvocation({ functionRecord, version, status, startedAt, requestBytes: request.bodyBytes, responseBytes: 0, errorCode });
      throw error;
    }
  }

  /** 先检查全部 key，任一超额就 429 且都不记；都没超才各记一次。 */
  consumeRateLimits(keys, limit) {
    const now = this.clock();
    const cutoff = now - 60_000;
    const unique = [...new Set(keys)];
    const buckets = unique.map((key) => [key, (this.rateBuckets.get(key) || []).filter((timestamp) => timestamp > cutoff)]);
    if (buckets.some(([, recent]) => recent.length >= limit)) throw tooManyRequests('函数调用超过每分钟配额');
    for (const [key, recent] of buckets) { recent.push(now); this.rateBuckets.set(key, recent); }
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
      errorCode: record.errorCode,
      createdAt: new Date(this.clock()).toISOString()
    })).catch((error) => this.logger.warn?.('记录函数调用失败:', error.message));
  }

  async listInvocations({ ownerId, functionId, limit, since, status } = {}) {
    const functionRecord = await this.getOwnedFunction(requireOwnerId(ownerId), functionId);
    if (typeof this.repository.listInvocations !== 'function') return [];
    const rows = await this.repository.listInvocations(functionRecord.functionId, { limit, since, status });
    return rows.map(publicInvocation);
  }

  async invocationStats({ ownerId, functionId, range } = {}) {
    const functionRecord = await this.getOwnedFunction(requireOwnerId(ownerId), functionId);
    const window = invocationWindow(range);
    const start = this.clock() - window.ms;
    const rows = typeof this.repository.listInvocations === 'function'
      ? await this.repository.listInvocations(functionRecord.functionId, { limit: 2000, since: new Date(start).toISOString() })
      : [];
    return summarizeInvocations(rows, window, start, this.clock());
  }

  async updateFunction({ ownerId, functionId, name, routes, triggers, timerName, limits } = {}) {
    const functionRecord = await this.getOwnedFunction(requireOwnerId(ownerId), functionId);
    if (typeof this.repository.updateFunctionSpec !== 'function') {
      throw internalError('当前存储不支持修改函数');
    }
    let normalizedName = functionRecord.name;
    if (name != null && String(name).trim()) {
      try {
        normalizedName = normalizeName(name);
      } catch (error) {
        throw badRequest(error.message, 'INVALID_FUNCTION_NAME');
      }
    }
    const nextTimer = timerName !== undefined ? normalizeTimerName(timerName) : functionRecord.timerName;
    const nextRoutes = routes !== undefined ? normalizeRoutes(routes) : functionRecord.routes;
    const nextTriggers = triggers !== undefined || timerName !== undefined
      ? normalizeTriggers(triggers === undefined ? functionRecord.triggers : triggers, nextTimer)
      : functionRecord.triggers;
    try {
      const updated = await this.repository.updateFunctionSpec(functionRecord.functionId, {
        name: normalizedName,
        routes: nextRoutes,
        triggers: nextTriggers,
        timerName: nextTimer,
        limits
      });
      if (!updated) throw notFound();
      return this.publicFunction(updated, await this.aliasesFor(updated));
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY' || /duplicate/i.test(error?.message || '')) {
        throw badRequest('定时触发名称已存在', 'DUPLICATE_TIMER_NAME');
      }
      throw error;
    }
  }

  async deleteFunction({ ownerId, functionId } = {}) {
    const functionRecord = await this.getOwnedFunction(requireOwnerId(ownerId), functionId);
    if (typeof this.repository.deleteFunction !== 'function') throw internalError('当前存储不支持删除函数');
    const removed = await this.repository.deleteFunction(functionRecord.functionId);
    if (!removed) throw notFound();
    for (const version of removed.versions || []) {
      if (!version.bundleKey || typeof this.bundleStore.delete !== 'function') continue;
      try {
        await this.bundleStore.delete(version.bundleKey);
      } catch {
        // 元数据已经删掉。代码对象删不掉时不把删除说成失败。
      }
    }
    return { functionId: functionRecord.functionId, deleted: true };
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
const LONG_LIVED_BIZ_PREFIX = 'DEMOX_BIZ_';

function platformSecretForbidden() {
  const error = forbidden('只有平台项目可以声明平台密钥');
  error.code = 'PLATFORM_SECRET_FORBIDDEN';
  return error;
}

function splitPlainEnv(env, websiteId) {
  const assignment = parseEnvAssignment(env);
  const secretKeys = [...Object.keys(assignment.secrets), ...assignment.keep];
  if (secretKeys.length && !isPlatformProject(websiteId)) throw platformSecretForbidden();
  return assignment;
}

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
    if (key.startsWith(LONG_LIVED_BIZ_PREFIX)) {
      throw badRequest(`不能写入长期业务云密钥: ${key}`, 'LONG_LIVED_BIZ_KEY');
    }
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

function invocationClientKeys(event, headers, scfRemoteAddr) {
  const ctx = event.requestContext || {};
  if (ctx.sourceIp) {
    const extra = Array.isArray(ctx.rateKeys) ? ctx.rateKeys.map(String).filter(Boolean) : [];
    const clientKeys = [String(ctx.sourceIp), ...extra.filter((k) => k !== String(ctx.sourceIp))];
    return { clientKey: String(ctx.sourceIp), clientKeys };
  }
  const info = clientIpInfo(headers, null, scfRemoteAddr);
  return { clientKey: info.primary || 'anonymous', clientKeys: info.keys.length ? info.keys : ['anonymous'] };
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
  let scfRemoteAddr = '';
  for (const [key, value] of Object.entries(event.headers || {})) {
    const name = String(key).toLowerCase();
    // x-scf-* 一律不转给用户函数：事件入口（API 网关/自定义域名）下客户端自带的 x-scf-remote-addr 等会原样到达，
    // 平台的 X-Scf-Secret-* 是运行角色临时密钥。Web 入口已在 web-server.js 去掉，这里对所有入口兜底。
    // remote-addr 单独留下做 clientKey（在 strip 之前读），不进入转给用户函数的 headers。
    if (name.startsWith('x-scf-')) {
      if (name === 'x-scf-remote-addr') scfRemoteAddr = String(value);
      continue;
    }
    headers[name] = String(value);
  }
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
    // 见 client-ip.js clientIpInfo：clientKey 是 XFF 优先的主地址；clientKeys 是限流要扣的全部 key（XFF 与 remote-addr 去重）。
    // Web 入口已在 web-server.js 算好放进 requestContext（sourceIp + rateKeys）；API 网关的 sourceIp 是平台给的，单独一个 key。
    ...invocationClientKeys(event, headers, scfRemoteAddr),
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

const INVOCATION_WINDOWS = Object.freeze({
  '15min': { name: '15min', ms: 15 * 60 * 1000, bucketSeconds: 60 },
  '1hr': { name: '1hr', ms: 60 * 60 * 1000, bucketSeconds: 300 },
  '3hr': { name: '3hr', ms: 3 * 60 * 60 * 1000, bucketSeconds: 900 },
  '1day': { name: '1day', ms: 24 * 60 * 60 * 1000, bucketSeconds: 3600 }
});

function invocationWindow(range) {
  return INVOCATION_WINDOWS[String(range || '')] || INVOCATION_WINDOWS['1hr'];
}

function publicInvocation(row) {
  return {
    id: row.id ?? null,
    version: Number(row.version || 0),
    status: row.status === 'error' ? 'error' : 'success',
    durationMs: Number(row.durationMs || 0),
    requestBytes: Number(row.requestBytes || 0),
    responseBytes: Number(row.responseBytes || 0),
    errorCode: row.errorCode || null,
    createdAt: row.createdAt || null
  };
}

function summarizeInvocations(rows, window, startMs, endMs) {
  const bucketMs = window.bucketSeconds * 1000;
  const start = Math.floor(startMs / bucketMs) * bucketMs;
  const buckets = new Map();
  for (let time = start; time <= endMs; time += bucketMs) {
    buckets.set(time, { bucket: new Date(time).toISOString(), success: 0, error: 0, durationTotal: 0, count: 0 });
  }
  let success = 0;
  let error = 0;
  let durationTotal = 0;
  for (const row of rows) {
    const time = new Date(row.createdAt || 0).getTime();
    if (!Number.isFinite(time)) continue;
    const key = Math.floor(time / bucketMs) * bucketMs;
    const slot = buckets.get(key) || { bucket: new Date(key).toISOString(), success: 0, error: 0, durationTotal: 0, count: 0 };
    const failed = row.status === 'error';
    if (failed) {
      slot.error += 1;
      error += 1;
    } else {
      slot.success += 1;
      success += 1;
    }
    const duration = Number(row.durationMs || 0);
    slot.durationTotal += duration;
    slot.count += 1;
    durationTotal += duration;
    buckets.set(key, slot);
  }
  const total = success + error;
  return {
    range: window.name,
    success,
    error,
    total,
    avgDurationMs: total ? Math.round(durationTotal / total) : 0,
    series: [...buckets.values()]
      .sort((a, b) => a.bucket.localeCompare(b.bucket))
      .map((item) => ({
        bucket: item.bucket,
        success: item.success,
        error: item.error,
        avgDurationMs: item.count ? Math.round(item.durationTotal / item.count) : 0
      }))
  };
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
