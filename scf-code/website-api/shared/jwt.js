const jwt = require('jsonwebtoken');

const MIN_SECRET_LENGTH = 32;

/**
 * 读取 JWT 签名密钥。没有配置或长度不足时直接报错，绝不回退到代码里的默认值
 * （仓库是公开的，任何写在代码里的默认密钥都等于没有密钥）。
 */
function getJwtSecret(env = process.env) {
  const secret = typeof env.JWT_SECRET === 'string' ? env.JWT_SECRET.trim() : '';
  if (!secret) {
    throw new Error('缺少 JWT_SECRET 环境变量，拒绝签发或校验 token');
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET 长度不足 ${MIN_SECRET_LENGTH} 位，拒绝签发或校验 token`);
  }
  return secret;
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

/**
 * 生成JWT token
 */
function sign(payload, expiresIn = JWT_EXPIRES_IN) {
  return jwt.sign(payload, getJwtSecret(), { algorithm: 'HS256', expiresIn });
}

/**
 * 验证JWT token
 */
function verify(token) {
  const secret = getJwtSecret();
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] });
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
  getJwtSecret,
  MIN_SECRET_LENGTH,
  sign,
  verify,
  extractToken,
  authenticate,
  getUserId
};
