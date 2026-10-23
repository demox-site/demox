'use strict';

/**
 * 网关自用与业务用 MySQL / JWT 两套环境变量。
 * 未配置带前缀的名字时回落到旧的 MYSQL_* / JWT_SECRET，方便分阶段切。
 */

function firstNonEmpty(env, keys) {
  for (const key of keys) {
    const value = env?.[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

function gatewayMysqlConfig(env = process.env) {
  return {
    host: firstNonEmpty(env, ['GATEWAY_MYSQL_HOST', 'MYSQL_HOST']),
    port: Number(firstNonEmpty(env, ['GATEWAY_MYSQL_PORT', 'MYSQL_PORT']) || 3306),
    user: firstNonEmpty(env, ['GATEWAY_MYSQL_USER', 'MYSQL_USER']),
    password: firstNonEmpty(env, ['GATEWAY_MYSQL_PASSWORD', 'MYSQL_PASSWORD']),
    database: firstNonEmpty(env, ['GATEWAY_MYSQL_DATABASE', 'MYSQL_DATABASE'])
  };
}

function businessMysqlConfig(env = process.env) {
  return {
    host: firstNonEmpty(env, ['BUSINESS_MYSQL_HOST', 'MYSQL_HOST']),
    port: Number(firstNonEmpty(env, ['BUSINESS_MYSQL_PORT', 'MYSQL_PORT']) || 3306),
    user: firstNonEmpty(env, ['BUSINESS_MYSQL_USER', 'MYSQL_USER']),
    password: firstNonEmpty(env, ['BUSINESS_MYSQL_PASSWORD', 'MYSQL_PASSWORD']),
    database: firstNonEmpty(env, ['BUSINESS_MYSQL_DATABASE', 'MYSQL_DATABASE'])
  };
}

function gatewayJwtSecret(env = process.env) {
  return firstNonEmpty(env, ['GATEWAY_JWT_SECRET', 'JWT_SECRET']);
}

function businessJwtSecret(env = process.env) {
  return firstNonEmpty(env, ['BUSINESS_JWT_SECRET', 'JWT_SECRET']);
}

function assertMysqlConfig(config, label) {
  const missing = [];
  if (!config.host) missing.push('HOST');
  if (!config.user) missing.push('USER');
  if (!config.password) missing.push('PASSWORD');
  if (!config.database) missing.push('DATABASE');
  if (missing.length) {
    throw new Error(`${label} 缺少数据库环境变量: ${missing.join(', ')}`);
  }
  return config;
}

module.exports = {
  firstNonEmpty,
  gatewayMysqlConfig,
  businessMysqlConfig,
  gatewayJwtSecret,
  businessJwtSecret,
  assertMysqlConfig
};
