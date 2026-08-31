'use strict';

const jwt = require('jsonwebtoken');
const { unauthorized } = require('./errors.js');

function getAuthorizationHeader(event) {
  const headers = event?.headers || {};
  return headers.authorization || headers.Authorization || '';
}

function createJwtAuthenticator({ secret = process.env.JWT_SECRET, algorithms = ['HS256'] } = {}) {
  if (!secret) throw new Error('函数管理接口缺少 JWT_SECRET');
  return (event) => {
    const header = getAuthorizationHeader(event);
    if (!header.startsWith('Bearer ')) throw unauthorized();
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw unauthorized();
    try {
      const payload = jwt.verify(token, secret, { algorithms });
      const userId = payload.userId ?? payload.user_id ?? payload.sub;
      if (userId === undefined || userId === null || userId === '') throw unauthorized();
      return { ...payload, userId: String(userId) };
    } catch (error) {
      if (error?.code === 'UNAUTHORIZED') throw error;
      throw unauthorized('登录凭证无效或已过期');
    }
  };
}

module.exports = { createJwtAuthenticator, getAuthorizationHeader };
