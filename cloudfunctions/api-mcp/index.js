/**
 * MCP API 云函数
 *
 * 提供通用的云函数调用代理，支持 Token 交换和调用其他云函数
 * 通过 HTTP 触发器访问
 */

const tcb = require('@cloudbase/node-sdk');

/**
 * 主函数入口
 */
exports.main = async (event, context) => {
  console.log('[MCP API] 收到请求:', {
    method: event.httpMethod,
    path: event.path,
    bodyLength: event.body?.length || 0
  });

  try {
    // 解析请求体
    let requestData;
    try {
      requestData = event.body ? JSON.parse(event.body) : {};
    } catch (error) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: {
            code: 'INVALID_JSON',
            message: '请求体 JSON 格式错误'
          }
        }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    // 从 Authorization 头获取 access_token
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    const accessToken = authHeader?.replace('Bearer ', '') || requestData.accessToken;

    const { action, functionName, code, client_id, clientId, redirect_uri, redirectUri, data } = requestData;

    // 支持两种参数命名方式
    const normalizedClientId = clientId || client_id;
    const normalizedRedirectUri = redirectUri || redirect_uri;

    // ==========================================
    // POST /api/mcp/exchange_token - Token 交换
    // ==========================================
    if (event.httpMethod === 'POST' &&
        (event.path?.includes('exchange_token') || action === 'exchange_token')) {

      console.log('[MCP API] 处理 Token 交换请求');

      const app = tcb.init({
        env: context.namespace || process.env.TCB_ENV
      });

      const result = await app.callFunction({
        name: 'oauth-token-manager',
        data: {
          action: 'exchange_token',
          code,
          clientId: normalizedClientId,
          redirectUri: normalizedRedirectUri,
        },
      });

      const responseData = result?.result;

      if (responseData?.error) {
        return {
          statusCode: 400,
          body: JSON.stringify(responseData),
          headers: { 'Content-Type': 'application/json' }
        };
      }

      if (!responseData?.accessToken || !responseData?.refreshToken) {
        return {
          statusCode: 500,
          body: JSON.stringify({
            error: {
              code: 'TOKEN_EXCHANGE_FAILED',
              message: 'Token 交换失败：云函数未返回有效 Token'
            }
          }),
          headers: { 'Content-Type': 'application/json' }
        };
      }

      console.log('[MCP API] Token 交换成功');

      return {
        statusCode: 200,
        body: JSON.stringify(responseData),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    // ==========================================
    // POST /api/mcp/call - 通用云函数调用
    // ==========================================
    if (event.httpMethod === 'POST' &&
        (event.path?.includes('call') || action === 'call')) {

      console.log('[MCP API] 处理云函数调用请求:', functionName);

      if (!functionName) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: {
              code: 'MISSING_FUNCTION_NAME',
              message: '缺少 functionName 参数'
            }
          }),
          headers: { 'Content-Type': 'application/json' }
        };
      }

      if (!accessToken) {
        return {
          statusCode: 401,
          body: JSON.stringify({
            error: {
              code: 'UNAUTHORIZED',
              message: '缺少认证令牌'
            }
          }),
          headers: { 'Content-Type': 'application/json' }
        };
      }

      const app = tcb.init({
        env: context.namespace || process.env.TCB_ENV
      });

      // 验证 token
      let userInfo;
      try {
        const auth = app.auth();
        const result = await auth.getEndUserInfo(accessToken);
        userInfo = result.userInfo || result;
      } catch (error) {
        console.error('[MCP API] Token 验证失败:', error.message);
        return {
          statusCode: 401,
          body: JSON.stringify({
            error: {
              code: 'TOKEN_INVALID',
              message: '访问令牌无效或已过期'
            }
          }),
          headers: { 'Content-Type': 'application/json' }
        };
      }

      const userId = userInfo?.uid || userInfo?.openId;
      if (!userId) {
        return {
          statusCode: 401,
          body: JSON.stringify({
            error: {
              code: 'TOKEN_INVALID',
              message: '无法从 Token 中获取用户身份'
            }
          }),
          headers: { 'Content-Type': 'application/json' }
        };
      }

      console.log('[MCP API] 用户身份验证成功:', userId);

      // 调用目标云函数
      const result = await app.callFunction({
        name: functionName,
        data: {
          ...data,
          accessToken,
          __userId: userId,
        },
      });

      const responseData = result?.result;

      if (responseData?.error) {
        console.error('[MCP API] 云函数返回错误:', responseData.error);
        return {
          statusCode: 400,
          body: JSON.stringify(responseData),
          headers: { 'Content-Type': 'application/json' }
        };
      }

      console.log('[MCP API] 云函数调用成功');

      return {
        statusCode: 200,
        body: JSON.stringify(responseData || {}),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    // ==========================================
    // GET /api/health - 健康检查
    // ==========================================
    if (event.httpMethod === 'GET' && event.path?.includes('health')) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          status: 'ok',
          service: 'Demox MCP API (Cloud Function)',
          timestamp: new Date().toISOString(),
          env: context.namespace
        }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    // ==========================================
    // 未知路径
    // ==========================================
    return {
      statusCode: 404,
      body: JSON.stringify({
        error: {
          code: 'NOT_FOUND',
          message: '未找到请求的 API 端点',
          availableEndpoints: [
            'POST /api/mcp/exchange_token',
            'POST /api/mcp/call',
            'GET  /api/mcp/health'
          ]
        }
      }),
      headers: { 'Content-Type': 'application/json' }
    };

  } catch (error) {
    console.error('[MCP API] 处理请求失败:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message || '内部服务器错误'
        }
      }),
      headers: { 'Content-Type': 'application/json' }
    };
  }
};
