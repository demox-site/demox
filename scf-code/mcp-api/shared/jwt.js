const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production-min-32-chars';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

function sign(payload, expiresIn = JWT_EXPIRES_IN) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function verify(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    if (error.name === 'TokenExpiredError') throw new Error('Token已过期');
    if (error.name === 'JsonWebTokenError') throw new Error('Token无效');
    throw error;
  }
}

function extractToken(event) {
  const headers = event.headers || {};
  const authHeader = headers.Authorization || headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  const queryString = event.queryString || event.queryStringParameters || event.query || {};
  if (queryString.token) return queryString.token;

  const body = event.body || {};
  if (body.token) return body.token;
  return null;
}

module.exports = { sign, verify, extractToken };
