'use strict';

const crypto = require('crypto');
const { installLogRedaction } = require('./log-redact.js');

installLogRedaction(console);
const { createJwtAuthenticator } = require('./auth.js');
const { InMemoryBundleStore } = require('./bundle-store.js');
const { InMemoryFunctionRepository } = require('./repository.js');
const { NodejsFunctionRuntime, createLocalNodeInvoker, createScfNodeInvoker, createHttpNodeInvoker } = require('./runtime-nodejs.js');
const { FunctionService } = require('./service.js');
const { FunctionApiError, badRequest, unauthorized, isClientError, corsHeaders, typedErrorResponse } = require('./errors.js');
const { runWithSesCredentials } = require('../../scf-deploy-packages/auth-api/ses-credentials.cjs');
const { createPlatformSesCredentialProvider } = require('./platform-ses-credentials.js');
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
const { isPlatformPoolFallback, USER_POOL_FUNCTION, PLATFORM_POOL_FUNCTION } = require('./platform-secrets.js');
const { createPoolRoutingRuntime } = require('./platform-pool.js');

function createDefaultRuntime({ logger = console, nodeInvoke = null } = {}) {
  return new NodejsFunctionRuntime({ invoke: nodeInvoke || createLocalNodeInvoker({ logger }), logger });
}

function createFunctionHttpHandler({
  repository = new InMemoryFunctionRepository(),
  bundleStore = new InMemoryBundleStore(),
  runtime = createDefaultRuntime(),
  authenticate = null,
  publicBaseUrl = process.env.FUNCTION_PUBLIC_BASE_URL || 'https://api.demox.site',
  logger = console,
  businessCredentials = null
} = {}) {
  const service = new FunctionService({ repository, bundleStore, runtime, authenticate, publicBaseUrl, logger, businessCredentials });
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
      if (isInvocationListRoute(path, action, method)) {
        const invocations = await service.listInvocations({
          ownerId: user.userId,
          functionId,
          limit: body.limit || queryValue(event, 'limit'),
          since: body.since || queryValue(event, 'since'),
          status: body.status || queryValue(event, 'status')
        });
        return jsonResponse(200, { success: true, functionId, invocations });
      }
      if (isInvocationStatsRoute(path, action, method)) {
        const stats = await service.invocationStats({
          ownerId: user.userId,
          functionId,
          range: body.range || queryValue(event, 'range')
        });
        return jsonResponse(200, { success: true, functionId, ...stats });
      }
      if (isUpdateFunctionRoute(path, action, method)) {
        const updated = await service.updateFunction({
          ownerId: user.userId,
          functionId,
          name: body.name,
          routes: body.routes,
          triggers: body.triggers,
          timerName: body.timerName !== undefined ? body.timerName : body.timer_name,
          limits: body.limits
        });
        return jsonResponse(200, { success: true, function: updated });
      }
      if (isDeleteFunctionRoute(path, action, method)) {
        const deleted = await service.deleteFunction({ ownerId: user.userId, functionId });
        return jsonResponse(200, { success: true, ...deleted });
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

// #42：平台站点函数被 service.invoke 拦下（PLATFORM_SITE_IN_PROCESS）时返回 null，让平台入口回落到进程内处理，而不是报错。
function isPlatformInProcessError(error) {
  // 平台池没配好或缺解密密钥时也回落到进程内，不把请求送到用户池。
  return isPlatformPoolFallback(error);
}

async function tryInvokeUserRoute(service, event = {}, context = {}) {
  if (isTimerEvent(event)) {
    const record = await service.findPublishedByTimer(timerNameOf(event));
    if (!record) return null;
    try {
      return responseFromInvoke(await service.invoke({ functionId: record.functionId, event, context }));
    } catch (error) {
      if (isPlatformInProcessError(error)) return null;
      throw error;
    }
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
  try {
    return responseFromInvoke(await service.invoke({
      functionId: record.functionId,
      event,
      context,
      alias: scope.env || 'production'
    }));
  } catch (error) {
    if (isPlatformInProcessError(error)) return null;
    throw error;
  }
}

// 系统函数先尝试已发布版本。进池前的软失败仍回落到进程内，但不再静默：
// warn `platform publish fallback` 带 { code, slug, path }（code 优先用 error.code，否则用 statusCode）。
// 响应头 x-demox-dispatch：
//   platform          平台池已执行（由 service.invoke 在 pool===platform 时写上）
//   fallback:<code>   软失败后的进程内回落，code 与 warn 相同
//   in-process        没有尝试已发布函数（无 service / 无 slug）
const DISPATCH_HEADER = 'x-demox-dispatch';

function dispatchPath(event = {}) {
  const raw = event.path || event.rawPath || event.requestContext?.http?.path || event.TriggerName || event.triggerName || '';
  return String(raw).split('?')[0].slice(0, 256);
}

function fallbackToken(error) {
  const fromCode = error?.code != null && String(error.code).trim() !== '' ? String(error.code).trim() : '';
  const fromStatus = error?.statusCode != null && String(error.statusCode).trim() !== '' ? String(error.statusCode).trim() : '';
  const raw = fromCode || fromStatus || 'UNKNOWN';
  return /^[A-Za-z0-9._:-]{1,64}$/.test(raw) ? raw : 'UNKNOWN';
}

function isSoftPublishFallback(error) {
  return isPlatformPoolFallback(error) || error?.statusCode === 404 || error?.code === 'FUNCTION_NOT_PUBLISHED' || error?.code === 'BUNDLE_MISSING';
}

function withDispatchHeader(response, dispatch) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return response;
  const headers = { ...(response.headers || {}) };
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() === DISPATCH_HEADER) delete headers[key];
  }
  headers[DISPATCH_HEADER] = dispatch;
  return { ...response, headers };
}

async function invokePublishedSystemFunction(service, entry, event, context, logger) {
  if (!service || typeof service.invokeBySlug !== 'function') {
    return { response: null, dispatch: 'in-process' };
  }
  const slug = systemFunctionSlug(entry);
  if (!slug) return { response: null, dispatch: 'in-process' };
  try {
    return {
      response: responseFromInvoke(await service.invokeBySlug({
        websiteId: platformWebsiteId(),
        slug,
        event,
        context
      })),
      dispatch: null
    };
  } catch (error) {
    if (isSoftPublishFallback(error)) {
      const code = fallbackToken(error);
      const fields = { code, slug, path: dispatchPath(event) };
      if (Number.isInteger(error?.statusCode)) fields.statusCode = error.statusCode;
      logger?.warn?.('platform publish fallback', fields);
      return { response: null, dispatch: `fallback:${code}` };
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
  platformSesCredentials = null,
  ...functionOptions
} = {}) {
  const resolvedUserHandler = userHandler || createFunctionHttpHandler({ logger, ...functionOptions });
  const sesCredentials = platformSesCredentials || createPlatformSesCredentialProvider({ logger });
  const resolvedSystemHandler = systemHandler || createSystemFunctionRouter({
    ...systemRouterOptions,
    entries: systemEntries,
    logger
  });

  let seedOnce = null;
  // 用户函数/平台站点函数抛出的已知 4xx（如 RATE_LIMITED）在这里转成正常响应，
  // 事件入口和 Web 入口（web-server.js）拿到的状态码和 body 一样，不再冒泡成 500。
  async function platformMain(event = {}, context = {}) {
    try {
      return await routePlatform(event, context);
    } catch (error) {
      if (!isClientError(error)) throw error;
      logger.warn?.('平台入口请求被拒:', error.code);
      return errorResponse(error, event);
    }
  }

  function isAuthSendCodeEvent(entry, event) {
    if (!entry || systemFunctionSlug(entry) !== 'auth') return false;
    const method = String(event.httpMethod || event.requestContext?.http?.method || 'POST').toUpperCase();
    if (method !== 'POST') return false;
    const body = parseBody(event);
    const path = normalizePath(event.path || event.rawPath || event.requestContext?.http?.path || body.path || '/');
    return path === '/auth/send-code' || body.action === 'send_code';
  }

  // 只有进程内发验证码签发 demox-platform-ses（PLATFORM_SES_ROLE_ARN）。
  // 不 Assume demox-runtime-role，不把临时密钥写进 process.env，website / mcp / 用户函数拿不到。
  // 角色没配或签发失败直接 5xx，不回落到网关自己的 TENCENTCLOUD_*。
  async function dispatchInProcessSystem(entry, event, context, dispatch) {
    const runHandler = () => resolvedSystemHandler(event, context);
    if (!isAuthSendCodeEvent(entry, event)) {
      return withDispatchHeader(await runHandler(), dispatch);
    }
    let cloud;
    try {
      cloud = await sesCredentials.credentialsFor();
    } catch (error) {
      const code = /^[A-Za-z0-9._:-]{1,64}$/.test(String(error?.code || ''))
        ? String(error.code)
        : 'BUSINESS_ROLE_ASSUME_FAILED';
      logger.error?.('进程内验证码凭证签发失败:', code);
      const clean = new FunctionApiError('验证码暂时无法发送', code, 500);
      return withDispatchHeader(errorResponse(clean, event), dispatch);
    }
    const response = await runWithSesCredentials({
      secretId: cloud.TENCENTCLOUD_SECRETID,
      secretKey: cloud.TENCENTCLOUD_SECRETKEY,
      token: cloud.TENCENTCLOUD_SESSIONTOKEN || ''
    }, runHandler);
    return withDispatchHeader(response, dispatch);
  }

  async function routePlatform(event = {}, context = {}) {
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
        context,
        logger
      );
      if (published.response) return published.response;
      return dispatchInProcessSystem(systemEntry, scopedEvent, context, published.dispatch);
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

function isInvocationListRoute(path, action, method) {
  return action === 'list_function_invocations' || (/^\/functions\/fn_[A-Za-z0-9_-]{8,32}\/invocations$/.test(path) && method === 'GET');
}

function isInvocationStatsRoute(path, action, method) {
  return action === 'function_invocation_stats' || (/^\/functions\/fn_[A-Za-z0-9_-]{8,32}\/stats$/.test(path) && method === 'GET');
}

function isUpdateFunctionRoute(path, action, method) {
  return action === 'update_function' || (/^\/functions\/fn_[A-Za-z0-9_-]{8,32}$/.test(path) && method === 'PATCH');
}

function isDeleteFunctionRoute(path, action, method) {
  return action === 'delete_function' || (/^\/functions\/fn_[A-Za-z0-9_-]{8,32}$/.test(path) && method === 'DELETE');
}

function queryValue(event, key) {
  const query = event.queryStringParameters || {};
  const value = query[key];
  return Array.isArray(value) ? value[0] : value;
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
  if (error instanceof FunctionApiError) return typedErrorResponse(error, requestId);
  const statusCode = error?.code === 'FUNCTION_TIMEOUT' ? 504 : (error?.code === 'FUNCTION_EXECUTION_ERROR' ? 502 : 500);
  const code = error?.code || 'INTERNAL_ERROR';
  const message = statusCode === 504 ? '函数执行超时' : (statusCode === 502 ? '函数执行失败' : '函数服务暂时不可用');
  return {
    statusCode,
    headers: { ...corsHeaders(), 'x-demox-request-id': requestId },
    body: JSON.stringify({ success: false, error: code, message, requestId }),
    isBase64Encoded: false
  };
}

function createPlatformPoolInvoker(logger = console) {
  const mode = String(process.env.FUNCTIONS_PLATFORM_NODE_RUNTIME_MODE || '').trim().toLowerCase();
  const name = String(process.env.FUNCTIONS_PLATFORM_NODE_RUNTIME || PLATFORM_POOL_FUNCTION).trim();
  const url = String(process.env.FUNCTIONS_PLATFORM_NODE_RUNTIME_URL || '').trim();
  if (!mode && !url) return null;
  if (!name || name === USER_POOL_FUNCTION) return null;
  if (mode === 'scf') {
    return createScfNodeInvoker({
      functionName: name,
      namespace: process.env.FUNCTIONS_RUNTIME_NAMESPACE || 'demox',
      logger
    });
  }
  const secret = String(process.env.RUNTIME_INVOKE_SECRET || '').trim();
  if (url && secret) return createHttpNodeInvoker({ url, secret, logger });
  return null;
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
  const platformInvoke = createPlatformPoolInvoker(logger);
  return createFunctionHttpHandler({
    repository,
    bundleStore: productionBundleStore,
    runtime: createPoolRoutingRuntime({
      userRuntime: createDefaultRuntime({ logger, nodeInvoke }),
      platformRuntime: platformInvoke ? createDefaultRuntime({ logger, nodeInvoke: platformInvoke }) : null
    }),
    authenticate: createJwtAuthenticator(),
    publicBaseUrl: publicBaseUrl || process.env.FUNCTION_PUBLIC_BASE_URL,
    logger
  });
}

function createMysqlDatabaseFromEnv() {
  // 网关元数据库只用 GATEWAY_MYSQL_*（回落 MYSQL_*），不复用 website 业务库适配器，
  // 避免配置了 BUSINESS_MYSQL_* 之后网关误连业务账号。
  const adapter = createDedicatedMysqlAdapter();
  return {
    query: (sql, params = []) => adapter.query(sql, params),
    transaction: (callback) => adapter.transaction(callback),
    close: () => (adapter.close ? adapter.close() : undefined)
  };
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
  const { gatewayMysqlConfig, assertMysqlConfig } = require('../website-api/shared/env-pairs.js');
  const cfg = assertMysqlConfig(gatewayMysqlConfig(), '函数服务（网关）');
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
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
};
