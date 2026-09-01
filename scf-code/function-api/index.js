'use strict';

const crypto = require('crypto');
const { createJwtAuthenticator } = require('./auth.js');
const { InMemoryBundleStore } = require('./bundle-store.js');
const { InMemoryFunctionRepository } = require('./repository.js');
const { QuickJSFunctionRuntime } = require('./runtime-quickjs.js');
const { FunctionService } = require('./service.js');
const { FunctionApiError, badRequest, unauthorized } = require('./errors.js');
const { CosBundleStore } = require('./bundle-store.js');
const { createMysqlFunctionRepository } = require('./repository.js');
const {
  loadSystemManifest,
  resolveSystemFunction,
  createSystemFunctionRouter,
  applySiteScope
} = require('./system-router.js');
const { readWebsiteScope, requireWebsiteId, isPlatformSite, publicSystemFunctions } = require('./site-binding.js');

function createFunctionHttpHandler({
  repository = new InMemoryFunctionRepository(),
  bundleStore = new InMemoryBundleStore(),
  runtime = new QuickJSFunctionRuntime(),
  authenticate = null,
  publicBaseUrl = process.env.FUNCTION_PUBLIC_BASE_URL || 'https://api.demox.site',
  logger = console
} = {}) {
  const service = new FunctionService({ repository, bundleStore, runtime, authenticate, publicBaseUrl, logger });
  const authenticateManagement = authenticate || lazyJwtAuthenticator();

  return async function main(event = {}, context = {}) {
    try {
      event = applySiteScope(event);
      const method = String(event.httpMethod || event.requestContext?.http?.method || 'POST').toUpperCase();
      if (method === 'OPTIONS') return response(204, {}, '');
      const body = parseBody(event);
      const path = normalizePath(event.path || event.rawPath || event.requestContext?.http?.path || body.path || '/');
      const action = body.action;

      if (isInvokeRoute(path, action)) {
        const functionId = routeFunctionId(path) || body.functionId;
        return responseFromInvoke(await service.invoke({ functionId, event: { ...event, body: event.body }, context }));
      }

      const scope = readWebsiteScope(event, body);
      if (isSiteApiRoute(path, action)) {
        return responseFromInvoke(await service.invokeBySlug({
          websiteId: requireWebsiteId(scope.websiteId),
          slug: siteApiSlug(path) || body.slug,
          event: { ...event, body: event.body },
          context
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
          limits: body.limits,
          env: body.env
        });
        return jsonResponse(201, { success: true, function: created });
      }
      if (isGetEnvRoute(path, action, method)) {
        const websiteId = requireWebsiteId(scope.websiteId);
        const env = await service.getWebsiteEnv(websiteId);
        return jsonResponse(200, { success: true, websiteId, env });
      }
      if (isPutEnvRoute(path, action, method)) {
        const websiteId = requireWebsiteId(scope.websiteId);
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
      throw badRequest('无法识别的函数接口', 'UNKNOWN_FUNCTION_ROUTE');
    } catch (error) {
      // User code errors may contain secrets; keep them out of platform logs.
      logger.error?.('函数接口请求失败:', error.code || 'INTERNAL_ERROR');
      return errorResponse(error, event);
    }
  };
}

/**
 * Route Demox's trusted system functions and user-authored functions through
 * one SCF handler. System entries are selected only from the checked-in
 * manifest; user requests can never select a trusted Node.js runtime.
 */
function createPlatformHandler({
  userHandler = null,
  systemHandler = null,
  systemEntries = loadSystemManifest(),
  systemRouterOptions = {},
  logger = console,
  ...functionOptions
} = {}) {
  const resolvedUserHandler = userHandler || createFunctionHttpHandler({ logger, ...functionOptions });
  const resolvedSystemHandler = systemHandler || createSystemFunctionRouter({
    ...systemRouterOptions,
    entries: systemEntries,
    logger
  });
  if (!systemHandler) bindInProcessSystemBackends(resolvedSystemHandler, logger);

  return async function platformMain(event = {}, context = {}) {
    const scopedEvent = applySiteScope(event, systemEntries);
    const systemEntry = resolveSystemFunction(scopedEvent, systemEntries);
    if (systemEntry || isTimerEvent(scopedEvent)) {
      return resolvedSystemHandler(scopedEvent, context);
    }
    return resolvedUserHandler(scopedEvent, context);
  };
}

function bindInProcessSystemBackends(systemHandler, logger = console) {
  try {
    const mcp = require(require('path').join(__dirname, '..', 'mcp-api'));
    if (typeof mcp.setBackendInvoker !== 'function') return false;
    mcp.setBackendInvoker(async (url, data, token) => {
      const target = new URL(String(url), 'https://api.demox.site');
      return systemHandler({
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

function isTimerEvent(event = {}) {
  const type = String(event.Type || event.type || event.triggerType || '').trim().toLowerCase();
  if (type) return type === 'timer' || type === 'timed' || type === 'schedule';
  return Boolean(
    (event.TriggerName || event.triggerName) &&
    !event.httpMethod &&
    !event.path &&
    !event.rawPath &&
    !event.requestContext?.http
  );
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

function createProductionHandler({ publicBaseUrl, logger = console, database, bundleStore } = {}) {
  const databaseAdapter = database || createMysqlDatabaseFromEnv();
  const repository = createMysqlFunctionRepository(databaseAdapter);
  const bucket = process.env.FUNCTIONS_COS_BUCKET;
  const region = process.env.FUNCTIONS_COS_REGION || process.env.COS_REGION;
  if (!bundleStore && (!bucket || !region)) throw new Error('生产函数服务缺少 FUNCTIONS_COS_BUCKET/FUNCTIONS_COS_REGION');
  const productionBundleStore = bundleStore || new CosBundleStore({
    bucket,
    region,
    secretId: process.env.FUNCTIONS_COS_SECRET_ID || process.env.COS_SECRET_ID || process.env.TENCENTCLOUD_SECRETID,
    secretKey: process.env.FUNCTIONS_COS_SECRET_KEY || process.env.COS_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY,
    securityToken: process.env.TENCENTCLOUD_SESSIONTOKEN || process.env.COS_SESSION_TOKEN
  });
  return createFunctionHttpHandler({
    repository,
    bundleStore: productionBundleStore,
    runtime: new QuickJSFunctionRuntime({ logger }),
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
      return createPlatformHandler({ userHandler: createProductionHandler() });
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
  createMysqlDatabaseFromEnv,
  parseBody,
  normalizePath,
  routeFunctionId,
  isTimerEvent,
  ensureWebsiteBinding
};
