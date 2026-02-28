const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'demox-prod-secret-2024';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

/**
 * 生成JWT token
 */
function sign(payload, expiresIn = JWT_EXPIRES_IN) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

/**
 * 验证JWT token
 */
function verify(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token已过期');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Token无效');
    }
    throw error;
  }
}

/**
 * 从请求中提取token
 */
function extractToken(event) {
  // 1. 从Authorization header获取
  const headers = event.headers || {};
  const authHeader = headers.Authorization || headers.authorization ||
                     headers['Authorization'] || headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // 2. 从query参数获取
  const queryString = event.queryString || event.queryStringParameters || event.query || {};
  if (queryString.token) {
    return queryString.token;
  }

  // 3. 从body获取
  const body = event.body || {};
  if (body.token) {
    return body.token;
  }

  return null;
}

/**
 * 验证token并返回用户信息
 */
function authenticate(event) {
  const token = extractToken(event);

  if (!token) {
    return null;
  }

  try {
    const decoded = verify(token);
    return decoded;
  } catch (error) {
    console.error('Token验证失败:', error.message);
    return null;
  }
}

/**
 * 获取用户ID（需要认证）
 */
function getUserId(event) {
  const user = authenticate(event);
  return user ? user.userId : null;
}

module.exports = {
  sign,
  verify,
  extractToken,
  authenticate,
  getUserId
};
