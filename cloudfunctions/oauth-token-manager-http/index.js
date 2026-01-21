const tcb = require('@cloudbase/node-sdk');

/**
 * OAuth Token 管理云函数 (HTTP 触发器版本)
 *
 * HTTP API 接口：
 * POST /api/mcp/exchange_token
 *
 * 用于 MCP Server 交换授权码获取 Token
 *
 * 部署方式：
 * 1. 部署此云函数
 * 2. 在云函数控制台配置 HTTP 触发器
 * 3. 记录 HTTP 触发器的访问路径（例如：https://xxx.tcloudbase.com/api-mcp）
 */

exports.main = async (event, context) => {
  // HTTP 触发器传入的 event 结构：
  // {
  //   body: string,           // 请求体（JSON 字符串）
  //   headers: object,        // 请求头
  //   httpMethod: string,     // HTTP 方法
  //   path: string,           // 请求路径
  //   queryStringParameters: object  // 查询参数
  // }

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

    const { action, code, client_id, clientId, redirect_uri, redirectUri } = requestData;

    // 支持两种参数命名方式：snake_case 和 camelCase
    const normalizedClientId = clientId || client_id;
    const normalizedRedirectUri = redirectUri || redirect_uri;

    // ==========================================
    // POST /api/mcp/exchange_token
    // ==========================================
    if (action === 'exchange_token' || event.path?.includes('exchange_token')) {
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

      return {
        statusCode: 200,
        body: JSON.stringify(responseData),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    // ==========================================
    // 未知操作
    // ==========================================
    return {
      statusCode: 404,
      body: JSON.stringify({
        error: {
          code: 'NOT_FOUND',
          message: '未找到请求的 API 端点',
          availableEndpoints: [
            'POST /api/mcp/exchange_token'
          ]
        }
      }),
      headers: { 'Content-Type': 'application/json' }
    };

  } catch (error) {
    console.error('HTTP API 调用失败:', error);
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
