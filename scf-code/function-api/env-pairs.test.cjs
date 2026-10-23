'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  gatewayMysqlConfig,
  businessMysqlConfig,
  gatewayJwtSecret,
  businessJwtSecret
} = require('../website-api/shared/env-pairs.js');
const {
  PLATFORM_ENV_KEYS,
  PLATFORM_BUSINESS_SECRET_KEYS,
  platformSiteEnvFromProcess
} = require('./platform-site.js');

test('gateway mysql prefers GATEWAY_MYSQL_* then MYSQL_*', () => {
  const env = {
    GATEWAY_MYSQL_HOST: 'gw.example',
    GATEWAY_MYSQL_USER: 'gw',
    GATEWAY_MYSQL_PASSWORD: 'gw-pass',
    GATEWAY_MYSQL_DATABASE: 'gwdb',
    MYSQL_HOST: 'old.example',
    MYSQL_USER: 'old',
    MYSQL_PASSWORD: 'old-pass',
    MYSQL_DATABASE: 'olddb'
  };
  assert.equal(gatewayMysqlConfig(env).host, 'gw.example');
  assert.equal(gatewayMysqlConfig(env).user, 'gw');
  assert.equal(businessMysqlConfig(env).host, 'old.example');
});

test('business mysql prefers BUSINESS_MYSQL_*', () => {
  const env = {
    BUSINESS_MYSQL_HOST: 'biz.example',
    BUSINESS_MYSQL_USER: 'biz',
    BUSINESS_MYSQL_PASSWORD: 'biz-pass',
    BUSINESS_MYSQL_DATABASE: 'bizdb',
    MYSQL_HOST: 'old.example',
    MYSQL_USER: 'old',
    MYSQL_PASSWORD: 'old-pass',
    MYSQL_DATABASE: 'olddb'
  };
  assert.equal(businessMysqlConfig(env).host, 'biz.example');
  assert.equal(gatewayMysqlConfig(env).host, 'old.example');
});

test('jwt pairs prefer prefixed secrets', () => {
  const env = {
    GATEWAY_JWT_SECRET: 'g'.repeat(32),
    BUSINESS_JWT_SECRET: 'b'.repeat(32),
    JWT_SECRET: 'j'.repeat(32)
  };
  assert.equal(gatewayJwtSecret(env), 'g'.repeat(32));
  assert.equal(businessJwtSecret(env), 'b'.repeat(32));
});

test('platform seed does not copy business secrets from process env', () => {
  const env = {
    FEISHU_APP_SECRET: 'secret',
    ENCRYPTION_KEY: 'enc-key-at-least-16',
    ANALYTICS_HASH_SALT: 'salt',
    JWT_SECRET: 'j'.repeat(32),
    MYSQL_PASSWORD: 'pw',
    ACME_EMAIL: 'ops@example.com',
    AUTH_API_URL: 'https://api.demox.site/auth',
    WEBSITE_API_URL: 'https://api.demox.site/website',
    EDGEONE_ZONE_ID: 'zone-x'
  };
  const seeded = platformSiteEnvFromProcess(env);
  assert.equal(seeded.AUTH_API_URL, env.AUTH_API_URL);
  assert.equal(seeded.EDGEONE_ZONE_ID, env.EDGEONE_ZONE_ID);
  for (const key of PLATFORM_BUSINESS_SECRET_KEYS) {
    assert.equal(seeded[key], undefined, key);
  }
  assert.ok(!PLATFORM_ENV_KEYS.includes('FEISHU_APP_SECRET'));
  assert.ok(!PLATFORM_ENV_KEYS.includes('ENCRYPTION_KEY'));
  assert.ok(!PLATFORM_ENV_KEYS.includes('JWT_SECRET'));
});
