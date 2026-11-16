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
    const request = new EventEmitter();
    request.body = '';
    request.write = (chunk) => { request.body += chunk; };
    request.end = () => {};
    request.destroy = () => {};
    seen.push({ ...options, request });
    const response = new EventEmitter();
    response.statusCode = 200;
    response.setEncoding = () => {};
    process.nextTick(() => {
      callback(response);
      response.emit('data', JSON.stringify({ Response: { MessageId: 'mid-1' } }));
      response.emit('end');
    });
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
        subject: '【Demox】站点 STX0K1MD 已停用，可申诉',
        templateId: 226012,
        templateData: { siteId: 'STX0K1MD', siteName: '示例', reason: '违规内容需要下线处理', replyDays: '3' }
      });
      const payload = JSON.parse(seen[0].request.body);
      assert.equal(result.MessageId, 'mid-1');
      assert.equal(seen.length, 1);
      assert.equal(seen[0].host, 'ses.tencentcloudapi.com');
      assert.equal(seen[0].headers['X-TC-Action'], 'SendEmail');
      assert.match(seen[0].headers.Authorization, /Credential=lin-ses-id\//);
      assert.equal(seen[0].headers.Authorization.includes('biz-id'), false);
      assert.equal(seen[0].headers['X-TC-Token'], 'lin-ses-token');
      assert.equal(payload.FromEmailAddress, 'Demox <noreply@mail.demox.site>');
      assert.equal(payload.Template.TemplateID, 226012);
      assert.equal(payload.Simple, undefined);
      assert.equal(JSON.parse(payload.Template.TemplateData).siteId, 'STX0K1MD');
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

test('ban notice refuses a foreign from domain and a template outside 137482 or 226012 before calling SES', async () => {
  const previous = process.env.SES_FROM_EMAIL;
  process.env.SES_FROM_EMAIL = 'Demox <noreply@evil.example>';
  try {
    await runWithSesCredentials({
      secretId: 'lin-ses-id',
      secretKey: 'lin-ses-key',
      token: 'lin-ses-token'
    }, () => captureSes(async (seen) => {
      await assert.rejects(
        _sesMailForTest.sendSesEmail({
          to: 'owner@example.com',
          subject: '停用',
          templateId: 226012,
          templateData: { siteId: 'STX0K1MD' }
        }),
        (error) => error.code === 'SES_SEND_REFUSED'
      );
      process.env.SES_FROM_EMAIL = 'noreply@mail.aigc.sx.cn';
      await assert.rejects(
        _sesMailForTest.sendSesEmail({
          to: 'owner@example.com',
          subject: '停用',
          templateId: 999999,
          templateData: { siteId: 'STX0K1MD' }
        }),
        (error) => error.code === 'SES_SEND_REFUSED'
      );
      const result = await _sesMailForTest.sendSesEmail({
        to: 'owner@example.com',
        subject: '停用',
        templateId: 226012,
        templateData: { siteId: 'STX0K1MD', siteName: '示例', reason: '理由足够长', replyDays: '3' }
      });
      assert.equal(result.MessageId, 'mid-1');
      assert.equal(seen.length, 1);
      const payload = JSON.parse(seen[0].request.body);
      assert.equal(payload.FromEmailAddress, 'noreply@mail.aigc.sx.cn');
      assert.equal(payload.Template.TemplateID, 226012);
    }));
  } finally {
    if (previous === undefined) delete process.env.SES_FROM_EMAIL;
    else process.env.SES_FROM_EMAIL = previous;
  }
});

const PLATFORM_SES = {
  secretId: 'lin-ses-id',
  secretKey: 'lin-ses-key',
  token: 'lin-ses-token'
};

function validBanData(overrides = {}) {
  return {
    siteId: 'STX0K1MD',
    siteName: '示例',
    reason: '违规内容需要下线处理',
    replyDays: '3',
    ...overrides
  };
}

function withPlatformSes(fn) {
  return runWithSesCredentials(PLATFORM_SES, () => captureSes(fn));
}

function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  const restore = () => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function sendBan(templateData, extra = {}) {
  return _sesMailForTest.sendSesEmail({
    to: 'owner@example.com',
    subject: '【Demox】站点 STX0K1MD 已停用，可申诉',
    templateId: 226012,
    templateData,
    replyTo: 'phosa@qq.com',
    ...extra
  });
}

test('complete ban notice variables send template 226012 once with the default Reply-To', async () => {
  await withEnv('BAN_NOTICE_REPLY_TO', undefined, () => withPlatformSes(async (seen) => {
    const notice = _sesMailForTest.buildSiteDisabledNotice({
      siteName: '示例',
      websiteId: 'STX0K1MD',
      reason: '违规内容需要下线处理'
    });
    const result = await _sesMailForTest.sendSesEmail({
      to: 'owner@example.com',
      subject: notice.subject,
      templateId: notice.templateId,
      templateData: notice.templateData,
      replyTo: notice.replyTo
    });
    assert.equal(result.MessageId, 'mid-1');
    assert.equal(seen.length, 1);
    const payload = JSON.parse(seen[0].request.body);
    assert.equal(payload.Template.TemplateID, 226012);
    assert.equal(payload.ReplyToAddresses, 'phosa@qq.com');
    assert.equal(notice.replyTo, 'phosa@qq.com');
  }));
});

test('empty ban notice variables are rejected before SES', async () => {
  await withPlatformSes(async (seen) => {
    for (const [key, value] of [
      ['siteId', ''],
      ['siteName', ''],
      ['reason', ''],
      ['replyDays', ''],
      ['siteName', '   '],
      ['replyDays', '4']
    ]) {
      await assert.rejects(
        sendBan(validBanData({ [key]: value })),
        (error) => error.code === 'BAN_NOTICE_INVALID'
      );
    }
    const missing = validBanData();
    delete missing.siteId;
    await assert.rejects(
      sendBan(missing),
      (error) => error.code === 'BAN_NOTICE_INVALID'
    );
    assert.equal(seen.length, 0);
  });
});

test('an unfilled placeholder is rejected before SES', async () => {
  await withPlatformSes(async (seen) => {
    await assert.rejects(
      sendBan(validBanData({ reason: '原因仍是{{reason}}' })),
      (error) => error.code === 'BAN_NOTICE_INVALID'
    );
    await assert.rejects(
      sendBan(validBanData({ siteName: '名称}}' })),
      (error) => error.code === 'BAN_NOTICE_INVALID'
    );
    assert.equal(seen.length, 0);
  });
});

test('a siteId naming more than one site is rejected before SES', async () => {
  await withPlatformSes(async (seen) => {
    for (const siteId of ['A,B', 'A B']) {
      await assert.rejects(
        sendBan(validBanData({ siteId })),
        (error) => error.code === 'BAN_NOTICE_INVALID'
      );
    }
    assert.equal(seen.length, 0);
  });
});

test('BAN_NOTICE_REPLY_TO overrides the ban notice Reply-To and is restored', async () => {
  const previousReplyTo = process.env.BAN_NOTICE_REPLY_TO;
  await withEnv('BAN_NOTICE_REPLY_TO', 'appeal@example.com', () => withPlatformSes(async (seen) => {
    const notice = _sesMailForTest.buildSiteDisabledNotice({
      siteName: '示例',
      websiteId: 'STX0K1MD',
      reason: '违规内容需要下线处理'
    });
    await _sesMailForTest.sendSesEmail({
      to: 'owner@example.com',
      subject: notice.subject,
      templateId: notice.templateId,
      templateData: notice.templateData,
      replyTo: notice.replyTo
    });
    assert.equal(seen.length, 1);
    const payload = JSON.parse(seen[0].request.body);
    assert.equal(payload.ReplyToAddresses, 'appeal@example.com');
  }));
  assert.equal(process.env.BAN_NOTICE_REPLY_TO, previousReplyTo);
});

test('template 137482 does not attach Reply-To', async () => {
  await withPlatformSes(async (seen) => {
    await _sesMailForTest.sendSesEmail({
      to: 'owner@example.com',
      subject: '验证码',
      templateId: 137482,
      templateData: { code: '123456' }
    });
    assert.equal(seen.length, 1);
    const payload = JSON.parse(seen[0].request.body);
    assert.equal(payload.Template.TemplateID, 137482);
    assert.equal(payload.ReplyToAddresses, undefined);
  });
});

test('BAN_NOTICE_DRY_RUN skips SES after checks and still refuses disallowed sends', async () => {
  const previousDryRun = process.env.BAN_NOTICE_DRY_RUN;
  const previousFrom = process.env.SES_FROM_EMAIL;
  await withEnv('BAN_NOTICE_DRY_RUN', '1', () => withPlatformSes(async (seen) => {
    const logs = [];
    const originalInfo = console.info;
    console.info = (...args) => {
      logs.push(args.map((arg) => String(arg)).join(' '));
      return originalInfo.apply(console, args);
    };
    try {
      const notice = _sesMailForTest.buildSiteDisabledNotice({
        siteName: '示例',
        websiteId: 'STX0K1MD',
        reason: '违规内容需要下线处理'
      });
      const result = await _sesMailForTest.sendSesEmail({
        to: 'owner@example.com',
        subject: notice.subject,
        templateId: notice.templateId,
        templateData: notice.templateData,
        replyTo: notice.replyTo
      });
      assert.deepEqual(result, { dryRun: true, MessageId: null });
      assert.deepEqual(logs, ['ban-notice dry-run siteId=STX0K1MD template=226012']);

      await assert.rejects(
        sendBan(validBanData({ reason: '' })),
        (error) => error.code === 'BAN_NOTICE_INVALID'
      );
      await assert.rejects(
        _sesMailForTest.sendSesEmail({
          to: 'owner@example.com',
          subject: '停用',
          templateId: 999999,
          templateData: validBanData()
        }),
        (error) => error.code === 'SES_SEND_REFUSED'
      );
      process.env.SES_FROM_EMAIL = 'Demox <noreply@evil.example>';
      await assert.rejects(
        sendBan(validBanData()),
        (error) => error.code === 'SES_SEND_REFUSED'
      );
      assert.equal(seen.length, 0);
      assert.deepEqual(logs, ['ban-notice dry-run siteId=STX0K1MD template=226012']);
    } finally {
      console.info = originalInfo;
      if (previousFrom === undefined) delete process.env.SES_FROM_EMAIL;
      else process.env.SES_FROM_EMAIL = previousFrom;
    }
  }));
  assert.equal(process.env.BAN_NOTICE_DRY_RUN, previousDryRun);
});

test('buildSiteDisabledNotice falls back to 你的站点 when siteName is empty', async () => {
  await withEnv('BAN_NOTICE_REPLY_TO', undefined, () => {
    const notice = _sesMailForTest.buildSiteDisabledNotice({
      siteName: '',
      websiteId: 'X1',
      reason: '…'
    });
    assert.equal(notice.templateData.siteName, '你的站点');
    assert.equal(notice.templateData.siteId, 'X1');
    assert.equal(notice.templateData.reason, '…');
    assert.equal(notice.templateData.replyDays, '3');
    assert.equal(notice.templateId, 226012);
    assert.equal(notice.replyTo, 'phosa@qq.com');
    assert.doesNotThrow(() => _sesMailForTest.assertBanNoticeData(notice.templateData));
  });
});
