'use strict';

const crypto = require('crypto');
const { createJwtAuthenticator } = require('./auth.js');
const { InMemoryBundleStore } = require('./bundle-store.js');
const { InMemoryFunctionRepository } = require('./repository.js');
const { NodejsFunctionRuntime, createLocalNodeInvoker, createScfNodeInvoker, createHttpNodeInvoker } = require('./runtime-nodejs.js');
const { FunctionService } = require('./service.js');
const { FunctionApiError, badRequest, unauthorized } = require('./errors.js');
const { CosBundleStore, MemoryCachedBundleStore } = require('./bundle-store.js');
const { createMysqlFunctionRepository } = require('./repository.js');
const {
  loadSystemManifest,
  resolveSystemFunction,
  createSystemFunctionRouter,
  applySiteScope
} = require('./system-router.js');
const { readWebsiteScope, requireWebsiteId, isPlatformSite, publicSystemFunctions, platformWebsiteId } = require('./site-binding.js');
const { isTimerEvent, timerNameOf } = require('./function-events.js');
const { seedPlatformSiteFunctions, systemFunctionSlug } = require('./platform-site.js');

function createDefaultRuntime({ logger = console, nodeInvoke = null } = {}) {
  return new NodejsFunctionRuntime({ invoke: nodeInvoke || createLocalNodeInvoker({ logger }), logger });
}

function createFunctionHttpHandler({
  repository = new InMemoryFunctionRepository(),
  bundleStore = new InMemoryBundleStore(),
  runtime = createDefaultRuntime(),
  authenticate = null,
  publicBaseUrl = process.env.FUNCTION_PUBLIC_BASE_URL || 'https://api.demox.site',
  logger = console
} = {}) {
  const service = new FunctionService({ repository, bundleStore, runtime, authenticate, publicBaseUrl, logger });
  const authenticateManagement = authenticate || lazyJwtAuthenticator();

  async function main(event = {}, context = {}) {
    try {
      event = applySiteScope(event);
      const method = String(event.httpMethod || event.requestContext?.http?.method || 'POST').toUpperCase();
      if (method === 'OPTIONS') return response(204, {}, '');
      const body = parseBody(event);
      const path = normalizePath(event.path || event.rawPath || event.requestContext?.http?.path || body.path || '/');
      const action = body.action;

      if (isInvokeRoute(path, action)) {
        const functionId = routeFunctionId(path) || body.functionId;
        return responseFromInvoke(await service.invoke({
          functionId,
          event: { ...event, body: event.body },
          context,
          alias: body.alias || event.queryStringParameters?.alias
        }));
      }

      const scope = readWebsiteScope(event, body);
      if (isSiteApiRoute(path, action)) {
        return responseFromInvoke(await service.invokeBySlug({
          websiteId: requireWebsiteId(scope.websiteId),
          slug: siteApiSlug(path) || body.slug,
          event: { ...event, body: event.body },
          context,
          alias: scope.env || 'production'
        }));
      }
      if (isListRoute(path, action, method) && scope.kind === 'system') {
        const functions = isPlatformSite(scope) ? publicSystemFunctions(publicBaseUrl, scope.websiteId || null) : [];
        return jsonResponse(200, { success: true, functions, kind: 'system' });
      }

      const user = await getManagementUser(authenticateManagement, event);
      if (isListRoute(path, action, method)) {
        const websiteId = requireWebsiteId(scope.websiteId);
        const functions = await service.listFunctions(websiteId);
        return jsonResponse(200, { success: true, functions, websiteId });
      }
      if (isCreateRoute(path, action, method)) {
        const created = await service.createFunction({
          ownerId: user.userId,
          websiteId: scope.websiteId,
          name: body.name,
          slug: body.slug,
          runtime: body.runtime,
          routes: body.routes,
          triggers: body.triggers,
          timerName: body.timerName || body.timer_name,
          limits: body.limits,
          env: body.env
        });
        return jsonResponse(201, { success: true, function: created });
      }
      if (isGetEnvRoute(path, action, method)) {
        const websiteId = requireWebsiteId(scope.websiteId);
        await service.assertWebsiteOwner(user.userId, websiteId);
        const env = await service.getWebsiteEnv(websiteId);
        return jsonResponse(200, { success: true, websiteId, env });
      }
      if (isPutEnvRoute(path, action, method)) {
        const websiteId = requireWebsiteId(scope.websiteId);
        await service.assertWebsiteOwner(user.userId, websiteId);
        const env = await service.putWebsiteEnv(websiteId, body.env);
        return jsonResponse(200, { success: true, websiteId, env });
      }

      const functionId = routeFunctionId(path) || body.functionId;
      if (!functionId) throw badRequest('缺少 functionId', 'MISSING_FUNCTION_ID');
      if (isVersionCreateRoute(path, action, method)) {
        const version = await service.createVersion({ ownerId: user.userId, functionId, source: body.source, sourceBase64: body.sourceBase64, entrypoint: body.entrypoint });
        return jsonResponse(201, { success: true, version });
      }
      if (isVersionListRoute(path, action, method)) {
        const versions = await service.listVersions({ ownerId: user.userId, functionId });
        return jsonResponse(200, { success: true, versions });
      }
      if (isSourceRoute(path, action, method)) {
        const source = await service.getSource({
          ownerId: user.userId,
          functionId,
          version: body.version || event.queryStringParameters?.version
        });
        return jsonResponse(200, { success: true, ...source });
      }
      if (isPublishRoute(path, action, method)) {
        const published = await service.publishVersion({ ownerId: user.userId, functionId, version: body.version });
        return jsonResponse(200, { success: true, ...published });
      }
      if (isGetFunctionEnvRoute(path, action, method)) {
        const env = await service.getFunctionEnv({ ownerId: user.userId, functionId });
        return jsonResponse(200, { success: true, functionId, env });
      }
      if (isPutFunctionEnvRoute(path, action, method)) {
        const env = await service.putFunctionEnv({ ownerId: user.userId, functionId, env: body.env });
        return jsonResponse(200, { success: true, functionId, env });
      }
      if (isAliasListRoute(path, action, method)) {
        const aliases = await service.listAliases({ ownerId: user.userId, functionId });
        return jsonResponse(200, { success: true, functionId, aliases });
      }
      if (isAliasDeleteRoute(path, action, method)) {
        const deleted = await service.deleteAlias({
          ownerId: user.userId,
          functionId,
          alias: aliasNameFromPath(path) || body.alias
        });
        return jsonResponse(200, { success: true, ...deleted });
      }
      if (isAliasSetRoute(path, action, method)) {
        const alias = await service.setAlias({
          ownerId: user.userId,
          functionId,
          alias: aliasNameFromPath(path) || body.alias,
          version: body.version
        });
        return jsonResponse(200, { success: true, alias });
      }
      throw badRequest('无法识别的函数接口', 'UNKNOWN_FUNCTION_ROUTE');
    } catch (error) {
      // User code errors may contain secrets; keep them out of platform logs.
      logger.error?.('函数接口请求失败:', error.code || 'INTERNAL_ERROR');
      return errorResponse(error, event);
    }
  }

  main.service = service;
  main.tryInvokeUserRoute = (event, context) => tryInvokeUserRoute(service, event, context);
  return main;
}

function isManagementPath(path) {
  return path === '/functions' || path.startsWith('/functions/') || path === '/env';
}

async function tryInvokeUserRoute(service, event = {}, context = {}) {
  if (isTimerEvent(event)) {
    const record = await service.findPublishedByTimer(timerNameOf(event));
    if (!record) return null;
    return responseFromInvoke(await service.invoke({ functionId: record.functionId, event, context }));
  }

  const body = parseBody(event);
  const path = normalizePath(event.path || event.rawPath || event.requestContext?.http?.path || body.path || '/');
  if (isManagementPath(path)) return null;

  const scope = readWebsiteScope(event, body);
  let websiteId = scope.websiteId;
  if (!websiteId && path.startsWith('/api/')) return null;
  if (!websiteId) websiteId = platformWebsiteId();

  if (isSiteApiRoute(path, body.action)) {
    try {
      return responseFromInvoke(await service.invokeBySlug({
        websiteId: requireWebsiteId(websiteId || scope.websiteId),
        slug: siteApiSlug(path) || body.slug,
        event,
        context,
        alias: scope.env || 'production'
      }));
    } catch (error) {
      if (error?.statusCode === 404) return null;
      throw error;
    }
  }

  if (!websiteId) return null;
  const record = await service.findPublishedByRoute(websiteId, path);
  if (!record) return null;
  return responseFromInvoke(await service.invoke({
    functionId: record.functionId,
    event,
    context,
    alias: scope.env || 'production'
  }));
}

async function invokePublishedSystemFunction(service, entry, event, context) {
  if (!service || typeof service.invokeBySlug !== 'function') return null;
  const slug = systemFunctionSlug(entry);
  if (!slug) return null;
  try {
    return responseFromInvoke(await service.invokeBySlug({
      websiteId: platformWebsiteId(),
      slug,
      event,
      context
    }));
  } catch (error) {
    if (error?.statusCode === 404 || error?.code === 'FUNCTION_NOT_PUBLISHED' || error?.code === 'BUNDLE_MISSING') {
      return null;
    }
    throw error;
  }
}

/**
 * Route user-authored functions and Demox system backends through one HTTP
 * entry. Manifest paths (/auth, /website, /deploy, platform timers) prefer
 * the published platform-site function source, then fall back in-process.
 */
function createPlatformHandler({
  userHandler = null,
  systemHandler = null,
  systemEntries = loadSystemManifest(),
  systemRouterOptions = {},
  logger = console,
  seedPlatformSite = false,
  ...functionOptions
} = {}) {
  const resolvedUserHandler = userHandler || createFunctionHttpHandler({ logger, ...functionOptions });
  const resolvedSystemHandler = systemHandler || createSystemFunctionRouter({
    ...systemRouterOptions,
    entries: systemEntries,
    logger
  });

  let seedOnce = null;
  async function platformMain(event = {}, context = {}) {
    if (seedPlatformSite && resolvedUserHandler.service && !seedOnce) {
      seedOnce = seedPlatformSiteFunctions({
        service: resolvedUserHandler.service,
        logger
      }).catch((error) => {
        seedOnce = null;
        logger.warn?.('平台站点函数种子失败:', error.message);
      });
    }
    if (seedOnce) await seedOnce.catch(() => {});

    const scopedEvent = applySiteScope(event, systemEntries);
    const systemEntry = resolveSystemFunction(scopedEvent, systemEntries);
    if (systemEntry) {
      const published = await invokePublishedSystemFunction(
        resolvedUserHandler.service,
        systemEntry,
        scopedEvent,
        context
      );
      if (published) return published;
      return resolvedSystemHandler(scopedEvent, context);
    }
    if (typeof resolvedUserHandler.tryInvokeUserRoute === 'function') {
      const userHit = await resolvedUserHandler.tryInvokeUserRoute(scopedEvent, context);
      if (userHit) return userHit;
    }
    if (isTimerEvent(scopedEvent)) {
      return resolvedSystemHandler(scopedEvent, context);
    }
    return resolvedUserHandler(scopedEvent, context);
  }

  if (!systemHandler) bindInProcessSystemBackends(platformMain, logger);
  return platformMain;
}

function bindInProcessSystemBackends(invoke, logger = console) {
  try {
    const mcp = require(require('path').join(__dirname, '..', 'mcp-api'));
    if (typeof mcp.setBackendInvoker !== 'function') return false;
    mcp.setBackendInvoker(async (url, data, token) => {
      const target = new URL(String(url), 'https://api.demox.site');
      return invoke({
        httpMethod: 'POST',
        path: target.pathname || '/',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: data
      }, {});
    });
    return true;
  } catch (error) {
    logger.warn?.('系统函数进程内回源未启用:', error.message);
    return false;
  }
}

function lazyJwtAuthenticator() {
  let authenticator = null;
  return (event) => {
    if (!authenticator) authenticator = createJwtAuthenticator();
    return authenticator(event);
  };
}

function parseBody(event) {
  if (event.body && typeof event.body === 'object' && !Buffer.isBuffer(event.body)) return event.body;
  if (!event.body) return {};
  let raw = String(event.body);
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizePath(path) {
  const value = String(path || '/').replace(/\/+/g, '/');
  if (value.length > 1 && value.endsWith('/')) return value.slice(0, -1);
  return value || '/';
}

function routeFunctionId(path) {
  const match = String(path).match(/^\/functions\/((?:fn_)[A-Za-z0-9_-]{8,32})(?:\/|$)/);
  return match ? match[1] : null;
}

function isInvokeRoute(path, action) {
  return action === 'invoke_function' || /^\/functions\/fn_[A-Za-z0-9_-]{8,32}\/invoke$/.test(path);
}

function isSiteApiRoute(path, action) {
  return action === 'invoke_site_function' || /^\/api\/[a-z0-9][a-z0-9_-]{1,62}(?:\/|$)/i.test(path);
}

function siteApiSlug(path) {
  const match = String(path || '').match(/^\/api\/([a-z0-9][a-z0-9_-]{1,62})(?:\/|$)/i);
  return match ? match[1].toLowerCase() : '';
}

function isCreateRoute(path, action, method) {
  return (action === 'create_function' || (path === '/functions' && method === 'POST'));
}

function isListRoute(path, action, method) {
  return action === 'list_functions' || (path === '/functions' && method === 'GET');
}

function isGetEnvRoute(path, action, method) {
  return action === 'get_website_env' || (path === '/env' && method === 'GET');
}

function isPutEnvRoute(path, action, method) {
  return action === 'put_website_env' || (path === '/env' && method === 'POST');
}

function isVersionCreateRoute(path, action, method) {
  return action === 'create_function_version' || (/^\/functions\/fn_[A-Za-z0-9_-]{8,32}\/versions$/.test(path) && method === 'POST');
}

function isVersionListRoute(path, action, method) {
  return action === 'list_function_versions' || (/^\/functions\/fn_[A-Za-z0-9_-]{8,32}\/versions$/.test(path) && method === 'GET');
}

function isPublishRoute(path, action, method) {
  return action === 'publish_function' || (/^\/functions\/fn_[A-Za-z0-9_-]{8,32}\/publish$/.test(path) && method === 'POST');
}

function isGetFunctionEnvRoute(path, action, method) {
  return action === 'get_function_env' || (/^\/functions\/fn_[A-Za-z0-9_-]{8,32}\/env$/.test(path) && method === 'GET');
}

function isPutFunctionEnvRoute(path, action, method) {
  return action === 'put_function_env' || (/^\/functions\/fn_[A-Za-z0-9_-]{8,32}\/env$/.test(path) && method === 'POST');
}

function isAliasListRoute(path, action, method) {
  return action === 'list_function_aliases' || (/^\/functions\/fn_[A-Za-z0-9_-]{8,32}\/aliases$/.test(path) && method === 'GET');
}

function isAliasSetRoute(path, action, method) {
  return action === 'set_function_alias' || (
    method === 'POST' && (
      /^\/functions\/fn_[A-Za-z0-9_-]{8,32}\/aliases$/.test(path)
      || /^\/functions\/fn_[A-Za-z0-9_-]{8,32}\/aliases\/[a-z][a-z0-9-]{0,31}$/.test(path)
    )
  );
}

function isAliasDeleteRoute(path, action, method) {
  return action === 'delete_function_alias' || (
    method === 'DELETE' && /^\/functions\/fn_[A-Za-z0-9_-]{8,32}\/aliases\/[a-z][a-z0-9-]{0,31}$/.test(path)
  );
}

function aliasNameFromPath(path) {
  const match = String(path || '').match(/^\/functions\/fn_[A-Za-z0-9_-]{8,32}\/aliases\/([a-z][a-z0-9-]{0,31})$/);
  return match ? match[1] : '';
}

function isSourceRoute(path, action, method) {
  return action === 'get_function_source' || (/^\/functions\/fn_[A-Za-z0-9_-]{8,32}\/source$/.test(path) && method === 'GET');
}

async function getManagementUser(authenticate, event) {
  if (typeof authenticate !== 'function') throw unauthorized();
  const value = await authenticate(event);
  const userId = typeof value === 'string' || typeof value === 'number'
    ? value
    : value?.userId ?? value?.user_id ?? value?.sub;
  if (userId === undefined || userId === null || userId === '') throw unauthorized();
  return { ...(value && typeof value === 'object' ? value : {}), userId: String(userId) };
}

function responseFromInvoke(result) {
  return {
    statusCode: result.statusCode,
    headers: { ...corsHeaders(), ...(result.headers || {}) },
    body: result.body,
    isBase64Encoded: !!result.isBase64Encoded
  };
}

function jsonResponse(statusCode, payload) {
  return response(statusCode, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify(payload));
}

function response(statusCode, headers, body) {
  return { statusCode, headers: { ...corsHeaders(), ...headers }, body, isBase64Encoded: false };
}

function errorResponse(error, event) {
  const requestId = event.requestId || event.requestContext?.requestId || crypto.randomBytes(8).toString('hex');
  const statusCode = error instanceof FunctionApiError
    ? error.statusCode
    : (error?.code === 'FUNCTION_TIMEOUT' ? 504 : (error?.code === 'FUNCTION_EXECUTION_ERROR' ? 502 : 500));
  const code = error instanceof FunctionApiError ? error.code : (error?.code || 'INTERNAL_ERROR');
  const message = error instanceof FunctionApiError
    ? error.message
    : (statusCode === 504 ? '函数执行超时' : (statusCode === 502 ? '函数执行失败' : '函数服务暂时不可用'));
  return {
    statusCode,
    headers: { ...corsHeaders(), 'x-demox-request-id': requestId },
    body: JSON.stringify({ success: false, error: code, message, requestId }),
    isBase64Encoded: false
  };
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization'
  };
}

function createProductionNodeInvoker(logger = console) {
  const mode = String(process.env.FUNCTIONS_NODE_RUNTIME_MODE || '').trim().toLowerCase();
  if (mode === 'local') return createLocalNodeInvoker({ logger });
  if (mode === 'scf') {
    return createScfNodeInvoker({
      functionName: process.env.FUNCTIONS_NODE_RUNTIME || 'demox-user-nodejs',
      namespace: process.env.FUNCTIONS_RUNTIME_NAMESPACE || 'demox',
      logger
    });
  }
  const url = String(process.env.FUNCTIONS_NODE_RUNTIME_URL || '').trim();
  const secret = String(process.env.RUNTIME_INVOKE_SECRET || '').trim();
  if (url && secret) return createHttpNodeInvoker({ url, secret, logger });
  return createLocalNodeInvoker({ logger });
}

function createProductionHandler({ publicBaseUrl, logger = console, database, bundleStore } = {}) {
  const databaseAdapter = database || createMysqlDatabaseFromEnv();
  const repository = createMysqlFunctionRepository(databaseAdapter);
  const bucket = process.env.FUNCTIONS_COS_BUCKET;
  const region = process.env.FUNCTIONS_COS_REGION || process.env.COS_REGION;
  if (!bundleStore && (!bucket || !region)) throw new Error('生产函数服务缺少 FUNCTIONS_COS_BUCKET/FUNCTIONS_COS_REGION');
  const productionBundleStore = new MemoryCachedBundleStore(bundleStore || new CosBundleStore({
    bucket,
    region,
    secretId: process.env.FUNCTIONS_COS_SECRET_ID || process.env.COS_SECRET_ID || process.env.TENCENTCLOUD_SECRETID,
    secretKey: process.env.FUNCTIONS_COS_SECRET_KEY || process.env.COS_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY,
    securityToken: process.env.TENCENTCLOUD_SESSIONTOKEN || process.env.COS_SESSION_TOKEN
  }));
  const nodeInvoke = createProductionNodeInvoker(logger);
  return createFunctionHttpHandler({
    repository,
    bundleStore: productionBundleStore,
    runtime: createDefaultRuntime({ logger, nodeInvoke }),
    authenticate: createJwtAuthenticator(),
    publicBaseUrl: publicBaseUrl || process.env.FUNCTION_PUBLIC_BASE_URL,
    logger
  });
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })
  ]);
}

function createMysqlDatabaseFromEnv() {
  return wrapMysqlDatabase(loadWebsiteMysqlAdapter() || createDedicatedMysqlAdapter());
}

function loadWebsiteMysqlAdapter() {
  try {
    const shared = require(require('path').join(__dirname, '../website-api/shared/db.js'));
    if (typeof shared.query === 'function' && typeof shared.transaction === 'function') return shared;
  } catch {
    // Local function-api-only packages do not ship the website database module.
  }
  return null;
}

function createDedicatedMysqlAdapter() {
  const required = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`函数服务缺少数据库环境变量: ${missing.join(', ')}`);
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    timezone: 'Z',
    waitForConnections: true,
    connectionLimit: Number(process.env.FUNCTIONS_DB_POOL_SIZE || 5),
    queueLimit: 0
  });
  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'").catch(() => {});
  });
  return {
    query: async (sql, params = []) => {
      const [rows] = await pool.query(sql, params);
      return rows;
    },
    transaction: async (callback) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    close: () => pool.end()
  };
}

function wrapMysqlDatabase(adapter) {
  let schemaReady = null;
  const ensureSchema = async () => {
    if (!schemaReady) {
      schemaReady = (async () => {
        try {
          const tables = await withTimeout(
            adapter.query("SHOW TABLES LIKE 'demox_functions'"),
            8000,
            '函数表检查超时'
          );
          if (!tables.length) {
            const fs = require('fs');
            const path = require('path');
            const sql = fs.readFileSync(path.join(__dirname, 'migrations/001_create_function_tables.sql'), 'utf8');
            for (const statement of sql.split(';').map((item) => item.trim()).filter(Boolean)) {
              await withTimeout(adapter.query(statement), 8000, '函数表创建超时');
            }
          }
          await withTimeout(ensureWebsiteBinding(adapter), 8000, '函数表迁移超时');
          await withTimeout(ensureWebsiteEnvTable(adapter), 8000, '站点环境变量表创建超时');
          await withTimeout(ensureRuntimeColumns(adapter), 8000, '函数运行时列迁移超时');
          await withTimeout(ensureFunctionAliasTable(adapter), 8000, '函数别名表创建超时');
        } catch (error) {
          schemaReady = null;
          throw error;
        }
      })();
    }
    await schemaReady;
  };
  return {
    query: async (sql, params = []) => {
      await ensureSchema();
      return adapter.query(sql, params);
    },
    transaction: async (callback) => {
      await ensureSchema();
      return adapter.transaction(callback);
    },
    close: () => (adapter.close ? adapter.close() : undefined)
  };
}

async function ensureFunctionAliasTable(adapter) {
  const tables = await adapter.query("SHOW TABLES LIKE 'demox_function_aliases'");
  if (tables.length) return;
  const fs = require('fs');
  const path = require('path');
  const sql = fs.readFileSync(path.join(__dirname, 'migrations/004_create_function_aliases.sql'), 'utf8');
  for (const statement of sql.split(';').map((item) => item.trim()).filter(Boolean)) {
    await adapter.query(statement);
  }
}

async function ensureWebsiteEnvTable(adapter) {
  const tables = await adapter.query("SHOW TABLES LIKE 'demox_website_envs'");
  if (tables.length) return;
  const fs = require('fs');
  const path = require('path');
  const sql = fs.readFileSync(path.join(__dirname, 'migrations/002_create_website_envs.sql'), 'utf8');
  for (const statement of sql.split(';').map((item) => item.trim()).filter(Boolean)) {
    await adapter.query(statement);
  }
}

async function ensureRuntimeColumns(adapter) {
  const columns = await adapter.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demox_functions' AND COLUMN_NAME = 'runtime'`
  );
  if (columns.length) return;
  await adapter.query("ALTER TABLE demox_functions ADD COLUMN runtime VARCHAR(16) NOT NULL DEFAULT 'nodejs' AFTER slug");
  await adapter.query('ALTER TABLE demox_functions ADD COLUMN routes_json JSON NULL AFTER env_json');
  await adapter.query('ALTER TABLE demox_functions ADD COLUMN triggers_json JSON NULL AFTER routes_json');
  await adapter.query('ALTER TABLE demox_functions ADD COLUMN timer_name VARCHAR(64) NULL AFTER triggers_json');
  const timerIndex = await adapter.query("SHOW INDEX FROM demox_functions WHERE Key_name = 'uq_demox_functions_timer_name'");
  if (!timerIndex.length) {
    await adapter.query('ALTER TABLE demox_functions ADD UNIQUE KEY uq_demox_functions_timer_name (timer_name)');
  }
}

async function ensureWebsiteBinding(adapter) {
  const columns = await adapter.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demox_functions' AND COLUMN_NAME = 'website_id'`
  );
  if (!columns.length) {
    await adapter.query("ALTER TABLE demox_functions ADD COLUMN website_id VARCHAR(128) NULL AFTER owner_user_id");
    await adapter.query('ALTER TABLE demox_functions ADD KEY idx_demox_functions_website (website_id)');
  }
  const ownerSlug = await adapter.query("SHOW INDEX FROM demox_functions WHERE Key_name = 'uq_demox_functions_owner_slug'");
  if (ownerSlug.length) {
    await adapter.query('ALTER TABLE demox_functions DROP INDEX uq_demox_functions_owner_slug');
  }
  const websiteSlug = await adapter.query("SHOW INDEX FROM demox_functions WHERE Key_name = 'uq_demox_functions_website_slug'");
  if (!websiteSlug.length) {
    await adapter.query('ALTER TABLE demox_functions ADD UNIQUE KEY uq_demox_functions_website_slug (website_id, slug)');
  }
}

function createConfiguredDefaultHandler() {
  if (process.env.FUNCTIONS_LOCAL_MODE === 'true') {
    return createPlatformHandler({ userHandler: createFunctionHttpHandler() });
  }
  if (process.env.FUNCTIONS_COS_BUCKET && (process.env.FUNCTIONS_COS_REGION || process.env.COS_REGION)) {
    try {
      return createPlatformHandler({
        userHandler: createProductionHandler(),
        seedPlatformSite: process.env.FUNCTIONS_SEED_PLATFORM_SITE !== 'false'
      });
    } catch (error) {
      return async (event) => errorResponse(new FunctionApiError(error.message, 'FUNCTION_SERVICE_NOT_CONFIGURED', 503), event);
    }
  }
  return async (event) => errorResponse(
    new FunctionApiError('函数服务尚未配置持久化存储', 'FUNCTION_SERVICE_NOT_CONFIGURED', 503),
    event
  );
}

const defaultHandler = createConfiguredDefaultHandler();

module.exports = {
  main: defaultHandler,
  createFunctionHttpHandler,
  createPlatformHandler,
  bindInProcessSystemBackends,
  createProductionHandler,
  createProductionNodeInvoker,
  createMysqlDatabaseFromEnv,
  createDefaultRuntime,
  parseBody,
  normalizePath,
  routeFunctionId,
  isTimerEvent,
  tryInvokeUserRoute,
  ensureWebsiteBinding,
  ensureRuntimeColumns
};
