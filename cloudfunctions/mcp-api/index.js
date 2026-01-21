const tcb = require('@cloudbase/node-sdk');

/**
 * MCP API 云函数
 * 作为 HTTP 代理，允许 MCP Server 调用其他云函数
 *
 * HTTP API 接口：
 * POST /
 *
 * 认证方式：
 * Authorization: Bearer <access_token>
 *
 * 支持的云函数：
 * - deploy-website
 * - oauth-token-manager
 */

exports.main = async (event, context) => {
  console.log('[MCP API] 收到请求');

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

    const { functionName } = requestData;

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

    // 从 Token 中提取 userId
    let userId;
    try {
      const tokenParts = accessToken.split('.');
      if (tokenParts.length !== 3) {
        throw new Error('Invalid token format');
      }

      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      userId = payload.sub || payload.user_id;

      if (!userId) {
        throw new Error('Cannot extract userId from token');
      }

      console.log('[MCP API] Token 解析成功，用户 ID:', userId);
    } catch (error) {
      console.error('[MCP API] Token 解析失败:', error.message);
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

    console.log(`[MCP API] 用户 ${userId} 调用云函数: ${functionName}`);

    // 调用目标云函数
    const app = tcb.init({
      env: context.namespace || process.env.TCB_ENV
    });

    const result = await app.callFunction({
      name: functionName,
      data: {
        ...requestData.data,
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

  } catch (error) {
    console.error('[MCP API] 调用失败:', error);
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
