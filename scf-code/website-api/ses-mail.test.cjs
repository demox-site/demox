'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const https = require('https');

Object.assign(process.env, {
  MYSQL_HOST: process.env.MYSQL_HOST || '127.0.0.1',
  MYSQL_USER: process.env.MYSQL_USER || 'test',
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || 'test',
  MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'test'
});

const { runWithSesCredentials } = require('../../scf-deploy-packages/auth-api/ses-credentials.cjs');
const { _sesMailForTest } = require('./index.js');

function captureSes(fn) {
  const original = https.request;
  const seen = [];
  https.request = (options, callback) => {
    seen.push(options);
    const response = new EventEmitter();
    response.statusCode = 200;
    response.setEncoding = () => {};
    process.nextTick(() => {
      callback(response);
      response.emit('data', JSON.stringify({ Response: { MessageId: 'mid-1' } }));
      response.emit('end');
    });
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {};
    request.destroy = () => {};
    return request;
  };
  const finish = () => {
    https.request = original;
  };
  try {
    const result = fn(seen);
    if (result && typeof result.then === 'function') return result.finally(finish);
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}

test('ban notice fails closed without platform SES credentials and does not use TENCENTCLOUD_*', async () => {
  const previous = {
    id: process.env.TENCENTCLOUD_SECRETID,
    key: process.env.TENCENTCLOUD_SECRETKEY,
    token: process.env.TENCENTCLOUD_SESSIONTOKEN
  };
  process.env.TENCENTCLOUD_SECRETID = 'biz-id';
  process.env.TENCENTCLOUD_SECRETKEY = 'biz-key';
  process.env.TENCENTCLOUD_SESSIONTOKEN = 'biz-token';
  try {
    await captureSes(async (seen) => {
      await assert.rejects(
        _sesMailForTest.sendSesEmail({
          to: 'owner@example.com',
          subject: '停用',
          text: 'text',
          html: '<p>html</p>'
        }),
        (error) => error.code === 'PLATFORM_SES_ROLE_MISSING' && /未配置/.test(error.message)
      );
      assert.equal(seen.length, 0);
    });
    assert.equal(process.env.TENCENTCLOUD_SECRETID, 'biz-id');
    assert.equal(process.env.TENCENTCLOUD_SECRETKEY, 'biz-key');
    assert.equal(process.env.TENCENTCLOUD_SESSIONTOKEN, 'biz-token');
  } finally {
    for (const [key, value] of Object.entries({
      TENCENTCLOUD_SECRETID: previous.id,
      TENCENTCLOUD_SECRETKEY: previous.key,
      TENCENTCLOUD_SESSIONTOKEN: previous.token
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('ban notice signs SendEmail with the platform SES context and leaves TENCENTCLOUD_* in place', async () => {
  const previous = {
    id: process.env.TENCENTCLOUD_SECRETID,
    key: process.env.TENCENTCLOUD_SECRETKEY,
    token: process.env.TENCENTCLOUD_SESSIONTOKEN
  };
  process.env.TENCENTCLOUD_SECRETID = 'biz-id';
  process.env.TENCENTCLOUD_SECRETKEY = 'biz-key';
  process.env.TENCENTCLOUD_SESSIONTOKEN = 'biz-token';
  try {
    await runWithSesCredentials({
      secretId: 'lin-ses-id',
      secretKey: 'lin-ses-key',
      token: 'lin-ses-token'
    }, () => captureSes(async (seen) => {
      const result = await _sesMailForTest.sendSesEmail({
        to: 'owner@example.com',
        subject: '停用',
        text: 'text',
        html: '<p>html</p>'
      });
      assert.equal(result.MessageId, 'mid-1');
      assert.equal(seen.length, 1);
      assert.equal(seen[0].host, 'ses.tencentcloudapi.com');
      assert.equal(seen[0].headers['X-TC-Action'], 'SendEmail');
      assert.match(seen[0].headers.Authorization, /Credential=lin-ses-id\//);
      assert.equal(seen[0].headers.Authorization.includes('biz-id'), false);
      assert.equal(seen[0].headers['X-TC-Token'], 'lin-ses-token');
      assert.equal(process.env.TENCENTCLOUD_SECRETID, 'biz-id');
      assert.equal(process.env.TENCENTCLOUD_SECRETKEY, 'biz-key');
      assert.equal(process.env.TENCENTCLOUD_SESSIONTOKEN, 'biz-token');
    }));
  } finally {
    for (const [key, value] of Object.entries({
      TENCENTCLOUD_SECRETID: previous.id,
      TENCENTCLOUD_SECRETKEY: previous.key,
      TENCENTCLOUD_SESSIONTOKEN: previous.token
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
