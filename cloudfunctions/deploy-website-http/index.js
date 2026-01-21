const tcb = require('@cloudbase/node-sdk');

/**
 * Deploy Website HTTP 云函数
 *
 * HTTP API 接口：
 * POST /
 *
 * 用于 MCP Server 部署网站、列出网站、删除网站等
 *
 * 认证方式：
 * Authorization: Bearer <access_token>
 */

exports.main = async (event, context) => {
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

    const { action } = requestData;

    // 调用原始的 deploy-website 云函数
    const app = tcb.init({
      env: context.namespace || process.env.TCB_ENV
    });

    const result = await app.callFunction({
      name: 'deploy-website',
      data: {
        ...requestData,
        accessToken,
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

    return {
      statusCode: 200,
      body: JSON.stringify(responseData),
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
