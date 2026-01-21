const tcb = require('@cloudbase/node-sdk');

/**
 * OAuth Token 管理云函数
 *
 * 功能：
 * - create_auth_code: 创建授权码
 * - exchange_token: 交换授权码获取 Token
 * - refresh_token: 刷新 Access Token
 * - verify_token: 验证 Token 有效性
 * - revoke_token: 撤销 Refresh Token
 */
exports.main = async (event, context) => {
  const { action, code, clientId, redirectUri, refreshToken, accessToken, state, scopes } = event;

  const app = tcb.init({
    env: context.namespace || process.env.TCB_ENV
  });
  const db = app.database();
  const auth = app.auth();

  const now = new Date();
  const _ = db.command;

  // ==========================================
  // 错误响应辅助函数
  // ==========================================
  const respondError = (code, message, suggestion = '') => ({
    error: {
      code,
      message,
      suggestion,
      timestamp: now.toISOString()
    }
  });

  // ==========================================
  // 1. 创建授权码
  // ==========================================
  if (action === 'create_auth_code') {
    try {
      // 验证客户端
      const client = await db.collection('oauth_clients').doc(clientId).get();
      if (!client.data || client.data.length === 0) {
        return respondError('INVALID_CLIENT', '无效的客户端 ID');
      }

      const clientData = client.data[0];
      if (!clientData.isActive) {
        return respondError('CLIENT_INACTIVE', '客户端未激活');
      }

      // 验证回调地址
      if (!clientData.redirectUris.includes(redirectUri)) {
        return respondError('INVALID_REDIRECT_URI', '无效的回调地址');
      }

      // 验证权限范围
      const requestedScopes = scopes || [];
      const validScopes = requestedScopes.filter(s => clientData.allowedScopes.includes(s));

      // 生成授权码
      const authCodeId = 'auth_' + generateRandomString(32);
      const authCode = generateRandomString(64);

      // 保存授权码（10 分钟有效）
      await db.collection('oauth_auth_codes').add({
        _id: authCodeId,
        code: authCode,
        clientId,
        userId: context.userInfo?.uid,
        redirectUri,
        scopes: validScopes,
        state,
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000), // 10 分钟
        usedAt: null,
        createdAt: now
      });

      console.log(`授权码已创建: ${authCodeId}`);

      return {
        code: authCode,
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString()
      };

    } catch (error) {
      console.error('创建授权码失败:', error);
      return respondError('INTERNAL_ERROR', error.message);
    }
  }

  // ==========================================
  // 2. 交换 Token
  // ==========================================
  if (action === 'exchange_token') {
    try {
      // 查找授权码
      const authCodeRes = await db.collection('oauth_auth_codes')
        .where({
          code,
          clientId,
          redirectUri,
          usedAt: null
        })
        .get();

      if (!authCodeRes.data || authCodeRes.data.length === 0) {
        return respondError('INVALID_CODE', '无效的授权码', '授权码可能已过期或已被使用');
      }

      const authCodeData = authCodeRes.data[0];

      // 检查是否过期
      if (new Date(authCodeData.expiresAt) < now) {
        return respondError('EXPIRED_CODE', '授权码已过期', '请重新登录');
      }

      // 标记授权码已使用
      await db.collection('oauth_auth_codes').doc(authCodeData._id).update({
        usedAt: now
      });

      // 获取 CloudBase Access Token
      let cloudbaseToken;
      try {
        const userInfo = await auth.getEndUserInfo(authCodeData.userId);
        // 生成临时的自定义登录票据
        const ticket = auth.createTicket(authCodeData.userId, {
          expire: 30 * 24 * 3600 * 1000 // 30 天
        });

        // 使用票据登录
        await auth.signInWithCustomTicket(ticket);
        cloudbaseToken = await auth.getAccessToken();
      } catch (error) {
        console.error('获取 CloudBase Token 失败:', error);
        return respondError('TOKEN_GENERATION_FAILED', '生成访问令牌失败');
      }

      // 生成 Refresh Token
      const refreshTokenId = 'rt_' + generateRandomString(32);
      const refreshTokenValue = generateRandomString(64);

      // 保存 Refresh Token（90 天有效）
      await db.collection('oauth_refresh_tokens').add({
        _id: refreshTokenId,
        token: refreshTokenValue,
        clientId,
        userId: authCodeData.userId,
        scopes: authCodeData.scopes,
        expiresAt: new Date(now.getTime() + 90 * 24 * 3600 * 1000), // 90 天
        lastUsedAt: now,
        createdAt: now
      });

      // 记录会话（用于审计）
      await db.collection('mcp_sessions').add({
        _id: 'session_' + generateRandomString(32),
        userId: authCodeData.userId,
        clientId,
        accessTokenHash: hashToken(cloudbaseToken),
        createdAt: now,
        lastSeenAt: now,
        usageCount: 0,
        isActive: true
      });

      console.log(`Token 交换成功: userId=${authCodeData.userId}`);

      return {
        accessToken: cloudbaseToken,
        refreshToken: refreshTokenValue,
        expiresIn: 30 * 24 * 3600, // 30 天（秒）
        tokenType: 'Bearer',
        scopes: authCodeData.scopes,
        userId: authCodeData.userId
      };

    } catch (error) {
      console.error('Token 交换失败:', error);
      return respondError('INTERNAL_ERROR', error.message);
    }
  }

  // ==========================================
  // 3. 刷新 Token
  // ==========================================
  if (action === 'refresh_token') {
    try {
      // 查找 Refresh Token
      const tokenRes = await db.collection('oauth_refresh_tokens')
        .where({
          token: refreshToken,
          clientId
        })
        .get();

      if (!tokenRes.data || tokenRes.data.length === 0) {
        return respondError('INVALID_REFRESH_TOKEN', '无效的刷新令牌');
      }

      const tokenData = tokenRes.data[0];

      // 检查是否过期
      if (new Date(tokenData.expiresAt) < now) {
        return respondError('EXPIRED_REFRESH_TOKEN', '刷新令牌已过期', '请重新登录');
      }

      // 获取新的 CloudBase Access Token
      let newAccessToken;
      try {
        const ticket = auth.createTicket(tokenData.userId, {
          expire: 30 * 24 * 3600 * 1000
        });
        await auth.signInWithCustomTicket(ticket);
        newAccessToken = await auth.getAccessToken();
      } catch (error) {
        console.error('刷新 Access Token 失败:', error);
        return respondError('TOKEN_REFRESH_FAILED', '刷新令牌失败');
      }

      // 可选：轮换 Refresh Token（提高安全性）
      const newRefreshTokenValue = generateRandomString(64);
      await db.collection('oauth_refresh_tokens').doc(tokenData._id).update({
        token: newRefreshTokenValue,
        lastUsedAt: now
      });

      // 更新会话
      await db.collection('mcp_sessions')
        .where({
          userId: tokenData.userId,
          isActive: true
        })
        .update({
          lastSeenAt: now,
          usageCount: _.inc(1)
        });

      console.log(`Token 刷新成功: userId=${tokenData.userId}`);

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshTokenValue,
        expiresIn: 30 * 24 * 3600,
        tokenType: 'Bearer'
      };

    } catch (error) {
      console.error('刷新 Token 失败:', error);
      return respondError('INTERNAL_ERROR', error.message);
    }
  }

  // ==========================================
  // 4. 验证 Token
  // ==========================================
  if (action === 'verify_token') {
    try {
      // 验证 CloudBase Access Token
      let userInfo;
      try {
        const result = await auth.getEndUserInfo(accessToken);
        userInfo = result.userInfo;
      } catch (error) {
        return respondError('TOKEN_INVALID', '无效的访问令牌', '请重新登录');
      }

      // 查找用户会话
      const sessionRes = await db.collection('mcp_sessions')
        .where({
          userId: userInfo.uid,
          isActive: true
        })
        .get();

      let scopes = [];
      if (sessionRes.data && sessionRes.data.length > 0) {
        const tokenRes = await db.collection('oauth_refresh_tokens')
          .where({ userId: userInfo.uid })
          .get();
        if (tokenRes.data && tokenRes.data.length > 0) {
          scopes = tokenRes.data[0].scopes || [];
        }
      }

      return {
        valid: true,
        userId: userInfo.uid,
        scopes,
        expiresAt: new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString()
      };

    } catch (error) {
      console.error('Token 验证失败:', error);
      return respondError('INTERNAL_ERROR', error.message);
    }
  }

  // ==========================================
  // 5. 撤销 Token
  // ==========================================
  if (action === 'revoke_token') {
    try {
      // 删除 Refresh Token
      await db.collection('oauth_refresh_tokens')
        .where({
          token: refreshToken,
          clientId
        })
        .remove();

      // 停用相关会话
      await db.collection('mcp_sessions')
        .where({
          clientId,
          isActive: true
        })
        .update({
          isActive: false
        });

      console.log('Token 已撤销');

      return {
        success: true,
        message: 'Token 已撤销'
      };

    } catch (error) {
      console.error('撤销 Token 失败:', error);
      return respondError('INTERNAL_ERROR', error.message);
    }
  }

  // ==========================================
  // 未知操作
  // ==========================================
  return respondError('INVALID_ACTION', '未知操作', '请检查 action 参数');
};

// ==========================================
// 辅助函数
// ==========================================

/**
 * 生成随机字符串
 */
function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 生成 Token 哈希值（用于隐私保护）
 */
function hashToken(token) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token).digest('hex');
}
