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
 * @param {Object} payload - token载荷
 * @param {String} expiresIn - 过期时间，默认30天
 */
function sign(payload, expiresIn = JWT_EXPIRES_IN) {
  return jwt.sign(payload, getJwtSecret(), { algorithm: 'HS256', expiresIn });
}

/**
 * 验证JWT token
 * @param {String} token - JWT token
 * @returns {Object} 解码后的payload
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
 * 从请求头中提取token
 * @param {Object} event - SCF事件对象
 */
function extractToken(event) {
  // 1. 从Authorization header获取
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // 2. 从query参数获取
  if (event.queryString?.token) {
    return event.queryString.token;
  }

  // 3. 从body获取
  if (event.body?.token) {
    return event.body.token;
  }

  return null;
}

/**
 * SCF API网关中间件：验证token
 * @param {Object} event - SCF事件对象
 * @returns {Object|null} 用户信息，验证失败返回null
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
 * 生成用户ID（纯数字格式，与 CloudBase 一致）
 * 格式：时间戳(13位) + 随机数(6位) = 19位数字
 */
function generateUserId() {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  return `${timestamp}${random}`;
}

/**
 * 生成随机字符串
 */
function generateRandomString(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

module.exports = {
  getJwtSecret,
  MIN_SECRET_LENGTH,
  sign,
  verify,
  extractToken,
  authenticate,
  generateUserId,
  generateRandomString
};
