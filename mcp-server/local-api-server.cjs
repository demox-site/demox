/**
 * 本地 API 代理服务器
 *
 * 用于在本地开发环境模拟 OAuth Token 交换
 * 不依赖云函数，直接生成测试 Token
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = 8082;

// 中间件
app.use(cors());
app.use(express.json());

/**
 * 生成随机字符串
 */
function generateRandomString(length) {
  return crypto.randomBytes(length).toString('base64')
    .replace(/[/+=]/g, '')
    .substring(0, length);
}

/**
 * POST /api/mcp/exchange_token
 * 交换授权码获取 Token（本地模拟版本）
 */
app.post('/api/mcp/exchange_token', async (req, res) => {
  try {
    const { code, client_id, redirect_uri } = req.body;

    console.log('[API] 收到 Token 交换请求');
    console.log('  code:', code?.substring(0, 20) + '...');
    console.log('  client_id:', client_id);
    console.log('  redirect_uri:', redirect_uri);

    // 验证参数
    if (!code || !client_id || !redirect_uri) {
      return res.status(400).json({
        error: {
          code: 'INVALID_PARAMS',
          message: '缺少必需参数: code, client_id, redirect_uri'
        }
      });
    }

    // 验证客户端 ID
    if (client_id !== 'demox-mcp-client') {
      return res.status(400).json({
        error: {
          code: 'INVALID_CLIENT',
          message: '无效的客户端 ID'
        }
      });
    }

    // 生成测试 Token（实际环境中应该调用云函数验证授权码）
    const accessToken = generateRandomString(64);
    const refreshToken = generateRandomString(64);
    const userId = 'test_user_' + generateRandomString(16);

    const responseData = {
      accessToken,
      refreshToken,
      expiresIn: 30 * 24 * 3600, // 30 天（秒）
      tokenType: 'Bearer',
      scopes: ['website:deploy', 'website:list', 'website:delete', 'website:update'],
      userId
    };

    console.log('[API] Token 交换成功');
    console.log('  userId:', userId);
    console.log('  expiresIn:', responseData.expiresIn + '秒');

    res.json(responseData);

  } catch (error) {
    console.error('[API] Token 交换失败:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * 健康检查
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Demox MCP Local API Server (Test Mode)',
    timestamp: new Date().toISOString(),
    note: '本地测试模式 - Token 为模拟生成'
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log('\n========================================');
  console.log(`🚀 本地 API 代理服务器已启动`);
  console.log(`📍 地址: http://localhost:${PORT}`);
  console.log(`\n可用端点:`);
  console.log(`  - POST /api/mcp/exchange_token`);
  console.log(`  - GET  /api/health`);
  console.log(`\n⚠️  注意：当前为本地测试模式`);
  console.log(`   Token 为模拟生成，不调用云函数`);
  console.log(`\n提示：运行 MCP 命令前请先启动此服务器`);
  console.log(`========================================\n`);
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n[API] 服务器关闭\n');
  process.exit(0);
});

// 捕获未处理的错误
process.on('uncaughtException', (error) => {
  console.error('[API] 未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[API] 未处理的 Promise 拒绝:', reason);
});
