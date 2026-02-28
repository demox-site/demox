/**
 * MCP API 云函数 - SCF 版本
 *
 * 提供 MCP Server 调用后端 API 的代理接口
 * 使用 JWT 认证，不依赖 CloudBase
 */

const https = require('https');
const { verify, extractToken } = require('./shared/jwt.js');

// API 端点配置
const AUTH_API_URL = process.env.AUTH_API_URL || 'https://1307257815-le6wrbbwdx.ap-guangzhou.tencentscf.com';
const WEBSITE_API_URL = process.env.WEBSITE_API_URL || 'https://1307257815-3empxtnzn9.ap-guangzhou.tencentscf.com';

/**
 * 发送 HTTP 请求
 */
function httpRequest(url, options, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    };

    const req = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          resolve({ statusCode: res.statusCode, body: result });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * 获取 CORS 头
 */
function getCORSHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

/**
 * 验证 JWT Token
 */
function verifyToken(event) {
  const token = extractToken(event);
  if (!token) {
    return null;
  }
  try {
    return verify(token);
  } catch (error) {
    console.error('Token 验证失败:', error.message);
    return null;
  }
}

/**
 * SCF 云函数入口
 */
exports.main = async (event, context) => {
  console.log('[MCP API] 收到请求:', {
    method: event.httpMethod,
    path: event.path
  });

  // 处理 OPTIONS 预检请求
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: ''
    };
  }

  try {
    // 解析请求体
    let requestData = {};
    if (event.body) {
      try {
        requestData = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      } catch (error) {
        return {
          statusCode: 400,
          headers: getCORSHeaders(),
          body: JSON.stringify({
            error: { code: 'INVALID_JSON', message: '请求体 JSON 格式错误' }
          })
        };
      }
    }

    const path = event.path || '/';
    const method = event.httpMethod || 'POST';

    // ==========================================
    // GET /health - 健康检查
    // ==========================================
    if (method === 'GET' && path.includes('health')) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({
          status: 'ok',
          service: 'Demox MCP API (SCF)',
          timestamp: new Date().toISOString()
        })
      };
    }

    // ==========================================
    // POST /deploy - 部署网站
    // ==========================================
    if (method === 'POST' && (path.includes('deploy') || requestData.action === 'deploy')) {
      const user = verifyToken(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: getCORSHeaders(),
          body: JSON.stringify({
            error: { code: 'UNAUTHORIZED', message: '未登录或 Token 已过期' }
          })
        };
      }

      console.log('[MCP API] 部署请求，用户:', user.userId);

      // 调用 website-api 部署接口
      const token = extractToken(event);
      const result = await httpRequest(`${WEBSITE_API_URL}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      }, {
        action: 'upload_and_deploy',
        fileContentBase64: requestData.fileContentBase64,
        fileName: requestData.fileName,
        websiteId: requestData.websiteId
      });

      return {
        statusCode: result.statusCode,
        headers: getCORSHeaders(),
        body: JSON.stringify(result.body)
      };
    }

    // ==========================================
    // POST /websites - 获取网站列表
    // ==========================================
    if (method === 'POST' && (path.includes('websites') || requestData.action === 'list')) {
      const user = verifyToken(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: getCORSHeaders(),
          body: JSON.stringify({
            error: { code: 'UNAUTHORIZED', message: '未登录或 Token 已过期' }
          })
        };
      }

      const token = extractToken(event);
      const action = requestData.action === 'list_all' ? 'list_all' : 'list';
      const result = await httpRequest(`${WEBSITE_API_URL}/list`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      }, { action });

      return {
        statusCode: result.statusCode,
        headers: getCORSHeaders(),
        body: JSON.stringify(result.body)
      };
    }

    // ==========================================
    // POST /delete - 删除网站
    // ==========================================
    if (method === 'POST' && (path.includes('delete') || requestData.action === 'delete')) {
      const user = verifyToken(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: getCORSHeaders(),
          body: JSON.stringify({
            error: { code: 'UNAUTHORIZED', message: '未登录或 Token 已过期' }
          })
        };
      }

      const token = extractToken(event);
      const result = await httpRequest(`${WEBSITE_API_URL}/delete`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      }, {
        action: 'delete',
        websiteId: requestData.websiteId || requestData.id
      });

      return {
        statusCode: result.statusCode,
        headers: getCORSHeaders(),
        body: JSON.stringify(result.body)
      };
    }

    // ==========================================
    // POST /send-code - 发送验证码
    // ==========================================
    if (method === 'POST' && (path.includes('send-code') || requestData.action === 'send_code')) {
      const result = await httpRequest(AUTH_API_URL, {
        method: 'POST'
      }, {
        action: 'send_code',
        email: requestData.email,
        type: requestData.type || 'login'
      });

      return {
        statusCode: result.statusCode,
        headers: getCORSHeaders(),
        body: JSON.stringify(result.body)
      };
    }

    // ==========================================
    // POST /login - 密码登录
    // ==========================================
    if (method === 'POST' && (path.includes('login') || requestData.action === 'login')) {
      const result = await httpRequest(AUTH_API_URL, {
        method: 'POST'
      }, {
        action: 'login',
        email: requestData.email,
        password: requestData.password
      });

      return {
        statusCode: result.statusCode,
        headers: getCORSHeaders(),
        body: JSON.stringify(result.body)
      };
    }

    // ==========================================
    // POST /login-code - 验证码登录
    // ==========================================
    if (method === 'POST' && (path.includes('login-code') || requestData.action === 'login_code')) {
      const result = await httpRequest(AUTH_API_URL, {
        method: 'POST'
      }, {
        action: 'login_code',
        email: requestData.email,
        code: requestData.code,
        register: requestData.register
      });

      return {
        statusCode: result.statusCode,
        headers: getCORSHeaders(),
        body: JSON.stringify(result.body)
      };
    }

    // ==========================================
    // POST /register - 注册
    // ==========================================
    if (method === 'POST' && (path.includes('register') || requestData.action === 'register')) {
      const result = await httpRequest(AUTH_API_URL, {
        method: 'POST'
      }, {
        action: 'register',
        email: requestData.email,
        password: requestData.password
      });

      return {
        statusCode: result.statusCode,
        headers: getCORSHeaders(),
        body: JSON.stringify(result.body)
      };
    }

    // ==========================================
    // POST /me - 获取当前用户
    // ==========================================
    if (method === 'POST' && (path.includes('/me') || requestData.action === 'me')) {
      const token = extractToken(event);
      if (!token) {
        return {
          statusCode: 401,
          headers: getCORSHeaders(),
          body: JSON.stringify({
            error: { code: 'UNAUTHORIZED', message: '未登录' }
          })
        };
      }

      const result = await httpRequest(AUTH_API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      }, { action: 'me' });

      return {
        statusCode: result.statusCode,
        headers: getCORSHeaders(),
        body: JSON.stringify(result.body)
      };
    }

    // ==========================================
    // 未知路径
    // ==========================================
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({
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
      })
    };

  } catch (error) {
    console.error('[MCP API] 处理请求失败:', error);
    return {
      statusCode: 500,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: error.message }
      })
    };
  }
};
