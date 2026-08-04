/**
 * Demox MCP API proxy for SCF.
 *
 * The public /deploy endpoint authenticates callers and forwards deploy actions
 * to website-api. Chunk payloads must stay intact because each request is
 * independently validated and persisted by website-api.
 */

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
  if (CHUNKED_DEPLOY_ACTIONS.has(action)) {
    return { ...requestData, action };
  }
  if (!action || action === 'deploy' || action === 'upload_and_deploy') {
    return {
      action: 'upload_and_deploy',
      fileContentBase64: requestData.fileContentBase64,
      fileName: requestData.fileName,
      websiteId: requestData.websiteId,
      projectId: requestData.projectId
    };
  }
  return null;
}

function isDeployRequest(path, requestData) {
  const action = String(requestData.action || '').trim();
  return path.includes('deploy') || action === 'deploy' || DEPLOY_ACTIONS.has(action);
}

async function proxy(url, data, token) {
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

exports.__private = { normalizeDeployPayload, isDeployRequest };
