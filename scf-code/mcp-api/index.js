/**
 * Demox MCP API proxy for SCF.
 *
 * The public /deploy endpoint authenticates callers and forwards deploy actions
 * to website-api. Chunk payloads must stay intact because each request is
 * independently validated and persisted by website-api.
 */

/* demox-log-redact:begin v1
 * 日志脱敏：任何 console 输出里的 token / JWT / PAT / OAuth code / 邮箱都替换成占位符，原文不进日志。
 * 同一份代码内联在 website-api、auth-api、mcp-api 的入口和 function-api/log-redact.js；
 * `demox functions push` 只上传入口文件，所以不能 require 新的共享文件。
 * scripts/check-log-redaction.test.mjs 会校验几份完全一致。 */
const LOG_REDACT_MARK = Symbol.for('demox.logRedact.v1');
const LOG_REDACT_SENSITIVE_KEYS = /^(?:access_?token|refresh_?token|id_?token|token|tokens|jwt|pat|client_?secret|secret|password|current_?password|new_?password|code_?verifier|code_?challenge|auth(?:orization)?_?code|oauth_?code|verification_?code|ticket|authorization|cookie|set-cookie|x-demox-runtime-token|runtime_?invoke_?secret|secret_?key|secret_?id|session_?token|email|emails|to|mail)$/i;
const LOG_REDACT_RULES = [
  // JWT（网页登录、PAT、OAuth access token 都是 HS256 JWT）
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, '[jwt]'],
  // GitHub token
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '[token]'],
  // Authorization 头
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 [token]'],
  // key=value / "key":"value" 形式的敏感字段
  [/((?:^|[?&#"'\s{,(])(?:access_?token|refresh_?token|id_?token|token|client_?secret|password|code_?verifier|ticket|secret_?key|session_?token)["']?\s*[:=]\s*["']?)(?!\[)[^"'&\s,;})]{4,}/gi, '$1[redacted]'],
  // OAuth 授权码（64 位随机串）和邮箱验证码（4–8 位数字）
  [/((?:^|[?&#"'\s{,(])code["']?\s*[:=]\s*["']?)(?:\d{4,8}|(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,})(?=$|["'&\s,;})])/gi, '$1[code]'],
  [/(验证码[^0-9\n]{0,40})\d{4,8}/g, '$1[code]'],
  // 邮箱
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '[email]'],
  // 40 位以上的不透明随机串（refresh token、OAuth code、密钥）
  [/\b[A-Za-z0-9]{40,}\b/g, '[opaque]']
];

function redactLogText(input) {
  let text = String(input);
  for (const [pattern, replacement] of LOG_REDACT_RULES) text = text.replace(pattern, replacement);
  return text;
}

function redactLogValue(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return redactLogText(value);
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value;
  if (typeof value === 'symbol' || typeof value === 'function') return value;
  if (Buffer.isBuffer(value)) return `[buffer ${value.length}B]`;
  if (value instanceof Error) {
    const code = value.code ? `[${value.code}] ` : '';
    return redactLogText(`${code}${value.stack || `${value.name}: ${value.message}`}`);
  }
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return redactLogText(String(value));
  if (seen.has(value)) return '[circular]';
  if (depth >= 6) return '[object]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactLogValue(item, depth + 1, seen));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (LOG_REDACT_SENSITIVE_KEYS.test(key) && item !== null && item !== undefined && item !== '') {
      out[key] = typeof item === 'boolean' || typeof item === 'number' ? item : '[redacted]';
    } else {
      out[key] = redactLogValue(item, depth + 1, seen);
    }
  }
  return out;
}

function installLogRedaction(target = console) {
  if (!target || target[LOG_REDACT_MARK]) return target;
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    const original = target[method];
    if (typeof original !== 'function') continue;
    target[method] = function redactedConsoleMethod(...args) {
      let safe;
      try {
        safe = args.map((arg) => redactLogValue(arg));
      } catch {
        safe = ['[log redaction failed]'];
      }
      return original.apply(target, safe);
    };
  }
  Object.defineProperty(target, LOG_REDACT_MARK, { value: true, enumerable: false });
  return target;
}
/* demox-log-redact:end */
installLogRedaction(console);

const https = require('https');
const { verify, extractToken } = require('./shared/jwt.js');

const CHUNKED_DEPLOY_ACTIONS = new Set([
  'init_deploy_upload',
  'upload_deploy_chunk',
  'complete_deploy_upload',
  'abort_deploy_upload'
]);
const DEPLOY_ACTIONS = new Set(['upload_and_deploy', ...CHUNKED_DEPLOY_ACTIONS]);

function requiredEnv(name) {
  const value = (process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value.replace(/\/+$/, '');
}

const AUTH_API_URL = requiredEnv('AUTH_API_URL');
const WEBSITE_API_URL = requiredEnv('WEBSITE_API_URL');

let backendInvoker = null;

function setBackendInvoker(invoker) {
  backendInvoker = typeof invoker === 'function' ? invoker : null;
}

function httpRequest(url, options, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'POST',
      timeout: Number(process.env.WEBSITE_REQUEST_TIMEOUT_MS || 115000),
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
        } catch (_error) {
          resolve({ statusCode: res.statusCode, body });
        }
      });
    });

    req.on('timeout', () => req.destroy(new Error('website-api 请求超时')));
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

function getCORSHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: getCORSHeaders(),
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function verifyToken(event) {
  const token = extractToken(event);
  if (!token) return null;
  try {
    return verify(token);
  } catch (error) {
    console.error('Token 验证失败:', error.message);
    return null;
  }
}

function unauthorized(message = '未登录或 Token 已过期') {
  return response(401, { error: { code: 'UNAUTHORIZED', message } });
}

function normalizeDeployPayload(requestData) {
  const action = String(requestData.action || '').trim();
  // deploySource 只用于 website-api 的部署埋点（统计渠道），不参与鉴权。
  if (CHUNKED_DEPLOY_ACTIONS.has(action)) {
    return { ...requestData, action, deploySource: 'mcp' };
  }
  if (!action || action === 'deploy' || action === 'upload_and_deploy') {
    return {
      action: 'upload_and_deploy',
      fileContentBase64: requestData.fileContentBase64,
      fileName: requestData.fileName,
      websiteId: requestData.websiteId,
      projectId: requestData.projectId,
      deploySource: 'mcp'
    };
  }
  return null;
}

function isDeployRequest(path, requestData) {
  const action = String(requestData.action || '').trim();
  return path.includes('deploy') || action === 'deploy' || DEPLOY_ACTIONS.has(action);
}

async function proxy(url, data, token) {
  if (backendInvoker) {
    const result = await backendInvoker(url, data, token);
    const raw = result && result.body;
    let parsed = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    }
    return response(result?.statusCode || 500, parsed === undefined ? '' : parsed);
  }
  const result = await httpRequest(url, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  }, data);
  return response(result.statusCode, result.body);
}

exports.main = async (event) => {
  console.log('[MCP API] 收到请求:', {
    method: event.httpMethod,
    path: event.path
  });

  if (event.httpMethod === 'OPTIONS') return response(200, '');

  try {
    let requestData = {};
    if (event.body) {
      try {
        requestData = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      } catch (_error) {
        return response(400, {
          error: { code: 'INVALID_JSON', message: '请求体 JSON 格式错误' }
        });
      }
    }

    const path = event.path || '/';
    const method = event.httpMethod || 'POST';

    if (method === 'GET' && path.includes('health')) {
      return response(200, {
        status: 'ok',
        service: 'Demox MCP API (SCF)',
        timestamp: new Date().toISOString()
      });
    }

    if (method === 'POST' && isDeployRequest(path, requestData)) {
      const deployPayload = normalizeDeployPayload(requestData);
      if (!deployPayload) {
        return response(400, {
          error: { code: 'INVALID_DEPLOY_ACTION', message: '不支持的部署 action' }
        });
      }
      const user = verifyToken(event);
      if (!user) return unauthorized();

      console.log('[MCP API] 部署请求，用户:', user.userId);
      const token = extractToken(event);
      return proxy(`${WEBSITE_API_URL}/upload`, deployPayload, token);
    }

    if (method === 'POST' && (path.includes('websites') || requestData.action === 'list')) {
      if (!verifyToken(event)) return unauthorized();
      const action = requestData.action === 'list_all' ? 'list_all' : 'list';
      return proxy(`${WEBSITE_API_URL}/list`, { action }, extractToken(event));
    }

    if (method === 'POST' && (path.includes('delete') || requestData.action === 'delete')) {
      if (!verifyToken(event)) return unauthorized();
      return proxy(`${WEBSITE_API_URL}/delete`, {
        action: 'delete',
        websiteId: requestData.websiteId || requestData.id
      }, extractToken(event));
    }

    if (method === 'POST' && (path.includes('send-code') || requestData.action === 'send_code')) {
      return proxy(AUTH_API_URL, {
        action: 'send_code',
        email: requestData.email,
        type: requestData.type || 'login'
      });
    }

    if (method === 'POST' && (path.includes('login-code') || requestData.action === 'login_code')) {
      return proxy(AUTH_API_URL, {
        action: 'login_code',
        email: requestData.email,
        code: requestData.code,
        register: requestData.register
      });
    }

    if (method === 'POST' && (path.includes('login') || requestData.action === 'login')) {
      return proxy(AUTH_API_URL, {
        action: 'login',
        email: requestData.email,
        password: requestData.password
      });
    }

    if (method === 'POST' && (path.includes('register') || requestData.action === 'register')) {
      return proxy(AUTH_API_URL, {
        action: 'register',
        email: requestData.email,
        password: requestData.password
      });
    }

    if (method === 'POST' && (path.includes('/me') || requestData.action === 'me')) {
      const token = extractToken(event);
      if (!token) return unauthorized('未登录');
      return proxy(AUTH_API_URL, { action: 'me' }, token);
    }

    return response(404, {
      error: {
        code: 'NOT_FOUND',
        message: '未找到请求的 API 端点',
        availableEndpoints: [
          'POST /deploy - 部署网站',
          'POST /websites - 获取网站列表',
          'POST /delete - 删除网站',
          'POST /send-code - 发送验证码',
          'POST /login - 密码登录',
          'POST /login-code - 验证码登录',
          'POST /register - 注册',
          'POST /me - 获取当前用户',
          'GET /health - 健康检查'
        ]
      }
    });
  } catch (error) {
    console.error('[MCP API] 处理请求失败:', error);
    return response(500, {
      error: { code: 'INTERNAL_ERROR', message: error.message }
    });
  }
};

exports.setBackendInvoker = setBackendInvoker;
exports.__private = { normalizeDeployPayload, isDeployRequest };
exports._logRedactForTest = { redactLogText, redactLogValue, installLogRedaction };
