#!/usr/bin/env node
'use strict';

/**
 * 只读统计：已有站点对象里有多少 .exe / .msi / .dmg / .apk / .bat / .ps1。
 *
 * 默认不访问网络。不会调用删除或写入。
 *
 *   node scripts/inventory-executable-sites.cjs
 *   node scripts/inventory-executable-sites.cjs --fixture scripts/fixtures/executable-site-keys.json
 *   COS_SECRET_ID=... COS_SECRET_KEY=... node scripts/inventory-executable-sites.cjs --live
 *
 * --live 只对 COS 做 ListObjects（getBucket）。密钥放环境变量，不要写进命令行历史后贴到聊天或日志。
 * 默认桶 resource-game-1307257815、地域 ap-chengdu、前缀 sites/。
 * 其它注册桶需要换 COS_BUCKET / COS_REGION 再跑一遍。本脚本不连数据库，也不解密桶密钥。
 */

const fs = require('fs');
const path = require('path');
const { summarizeExecutableKeys, EXECUTABLE_SUFFIXES } = require('../scf-code/website-api/shared/executable-files.js');

const DEFAULT_BUCKET = 'resource-game-1307257815';
const DEFAULT_REGION = 'ap-chengdu';
const DEFAULT_PREFIX = 'sites/';
const READONLY_BLOCKED = ['putObject', 'deleteObject', 'deleteMultipleObject', 'putObjectCopy', 'sliceUploadFile', 'postObject'];

function readCredentials(env) {
  const source = env || {};
  return {
    secretId: source.COS_SECRET_ID || source.TENCENTCLOUD_SECRETID || source.TENCENT_SECRET_ID || '',
    secretKey: source.COS_SECRET_KEY || source.TENCENTCLOUD_SECRETKEY || source.TENCENT_SECRET_KEY || '',
    token: source.COS_SESSION_TOKEN || source.TENCENTCLOUD_SESSIONTOKEN || '',
    bucket: source.COS_BUCKET || DEFAULT_BUCKET,
    region: source.COS_REGION || DEFAULT_REGION,
    prefix: source.COS_PREFIX || DEFAULT_PREFIX
  };
}

function redact(text, secrets) {
  let out = String(text == null ? '' : text);
  const values = [...new Set((secrets || []).filter((item) => typeof item === 'string' && item.length >= 6))];
  values.sort((a, b) => b.length - a.length);
  for (const value of values) out = out.split(value).join('[redacted]');
  return out;
}

function parseArgs(argv) {
  const out = { live: false, fixture: '', help: false, rejected: '', unknown: '' };
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || '');
    if (arg === '--live') out.live = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--fixture') out.fixture = String(args[++i] || '');
    else if (arg === '--bucket') out.bucket = String(args[++i] || '');
    else if (arg === '--region') out.region = String(args[++i] || '');
    else if (arg === '--prefix') out.prefix = String(args[++i] || '');
    else if (arg.startsWith('--')) {
      if (/delete|apply|put|write|mutate/i.test(arg)) out.rejected = arg;
      else out.unknown = arg;
    } else {
      out.unknown = arg;
    }
  }
  return out;
}

function assertSitePrefix(prefix) {
  const value = String(prefix || '');
  if (value !== 'sites' && value !== 'sites/' && !value.startsWith('sites/')) {
    throw Object.assign(new Error('前缀必须是 sites/，避免列出站点以外的对象'), { code: 'BAD_PREFIX' });
  }
  return value.endsWith('/') ? value : `${value}/`;
}

function requireCosSdk() {
  try {
    return require('cos-nodejs-sdk-v5');
  } catch (e) {
    return require(path.join(__dirname, '../scf-code/website-api/node_modules/cos-nodejs-sdk-v5'));
  }
}

function lockReadOnly(client) {
  for (const name of READONLY_BLOCKED) {
    if (client[name]) {
      client[name] = () => {
        throw new Error('inventory is read-only');
      };
    }
  }
  return client;
}

function listAllObjects(opts) {
  const Cos = opts.Cos || requireCosSdk();
  const cos = lockReadOnly(new Cos({
    SecretId: opts.secretId,
    SecretKey: opts.secretKey,
    SecurityToken: opts.token || undefined
  }));
  if (typeof cos.getBucket !== 'function') {
    throw new Error('COS 客户端缺少 getBucket');
  }
  const keys = [];
  let marker = '';
  let pages = 0;
  return (async () => {
    const prefix = assertSitePrefix(opts.prefix);
    const nextPage = () => new Promise((resolve, reject) => {
      cos.getBucket({
        Bucket: opts.bucket,
        Region: opts.region,
        Prefix: prefix,
        Marker: marker,
        MaxKeys: 1000
      }, (err, data) => (err ? reject(err) : resolve(data || {})));
    });
    let truncated = true;
    while (truncated) {
      pages += 1;
      if (pages > 20000) {
        const error = new Error('列出的对象页数超过上限，统计不完整');
        error.code = 'LIST_TRUNCATED';
        error.keys = keys;
        throw error;
      }
      const page = await nextPage();
      const contents = page.Contents || [];
      for (const item of contents) {
        if (item && item.Key) keys.push(item.Key);
      }
      truncated = page.IsTruncated === 'true' || page.IsTruncated === true;
      const next = page.NextMarker || (contents.length ? contents[contents.length - 1].Key : '');
      if (!truncated) break;
      if (!next || next === marker) break;
      marker = next;
    }
    return keys;
  })();
}

function readFixtureKeys(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.keys)) return raw.keys;
  throw new Error('夹具必须是字符串数组，或 { keys: [] }');
}

function opsHelp() {
  return {
    install: 'npm ci --prefix scf-code/website-api --no-audit --no-fund',
    live: 'COS_SECRET_ID=... COS_SECRET_KEY=... node scripts/inventory-executable-sites.cjs --live',
    fixture: 'node scripts/inventory-executable-sites.cjs --fixture scripts/fixtures/executable-site-keys.json',
    env: [
      'COS_SECRET_ID 或 TENCENTCLOUD_SECRETID 或 TENCENT_SECRET_ID',
      'COS_SECRET_KEY 或 TENCENTCLOUD_SECRETKEY 或 TENCENT_SECRET_KEY',
      '可选 COS_SESSION_TOKEN 或 TENCENTCLOUD_SESSIONTOKEN',
      '可选 COS_BUCKET、COS_REGION、COS_PREFIX（前缀必须是 sites/）'
    ],
    defaults: {
      bucket: DEFAULT_BUCKET,
      region: DEFAULT_REGION,
      prefix: DEFAULT_PREFIX
    }
  };
}

async function main(argv, env = process.env, io = {}) {
  const stdout = io.stdout || ((text) => process.stdout.write(text));
  const stderr = io.stderr || ((text) => process.stderr.write(text));
  const args = parseArgs(argv);
  const creds = readCredentials(env);
  const secrets = [creds.secretId, creds.secretKey, creds.token];
  const fail = (code, message) => {
    stderr(`${redact(message, secrets)}\n`);
    return code;
  };
  if (args.rejected) return fail(2, `拒绝 ${args.rejected}：这个脚本只读，不会删除或改写对象`);
  if (args.unknown) return fail(2, `未知参数 ${args.unknown}`);
  if (args.help) {
    stdout(`${JSON.stringify({
      mode: 'help',
      mutate: false,
      suffixes: EXECUTABLE_SUFFIXES,
      ops: opsHelp()
    }, null, 2)}\n`);
    return 0;
  }
  if (args.bucket) creds.bucket = args.bucket;
  if (args.region) creds.region = args.region;
  if (args.prefix) creds.prefix = args.prefix;

  if (args.fixture) {
    const keys = readFixtureKeys(args.fixture);
    stdout(`${JSON.stringify({
      mode: 'fixture',
      source: path.basename(args.fixture),
      live: false,
      note: '离线夹具计数，不是线上存量。未访问 COS，未删除或改写对象。',
      ...summarizeExecutableKeys(keys)
    }, null, 2)}\n`);
    return 0;
  }

  if (!args.live) {
    stdout(`${JSON.stringify({
      mode: 'dry-run',
      live: false,
      mutate: false,
      suffixes: EXECUTABLE_SUFFIXES.slice(),
      siteCount: null,
      objectCount: null,
      note: '未访问 COS 或数据库，不能给出线上存量。下面的命令只读列出对象，不会删除或改写。',
      archiveFollowUp: '部署拒收检查的是上传 ZIP 的条目名。ZIP 里面再套 ZIP/7z 的可执行文件本次不拆开，留作后续。',
      ops: opsHelp()
    }, null, 2)}\n`);
    return 0;
  }

  try {
    assertSitePrefix(creds.prefix);
  } catch (error) {
    return fail(2, error.message);
  }
  if (!creds.secretId || !creds.secretKey) {
    return fail(2, '缺少 COS 只读凭证，未访问云端。把密钥放在环境变量里再加 --live。');
  }
  try {
    const listObjects = io.listObjects || ((options) => listAllObjects(options));
    const keys = await listObjects({
      secretId: creds.secretId,
      secretKey: creds.secretKey,
      token: creds.token,
      bucket: creds.bucket,
      region: creds.region,
      prefix: creds.prefix,
      Cos: io.Cos
    });
    stdout(`${JSON.stringify({
      mode: 'live',
      live: true,
      bucket: creds.bucket,
      region: creds.region,
      prefix: assertSitePrefix(creds.prefix),
      note: '只读 ListObjects，未删除、未改写已有对象。',
      ...summarizeExecutableKeys(keys)
    }, null, 2)}\n`);
    return 0;
  } catch (error) {
    const incomplete = error && Array.isArray(error.keys);
    if (incomplete) {
      stdout(`${JSON.stringify({
        mode: 'live',
        live: true,
        incomplete: true,
        bucket: creds.bucket,
        region: creds.region,
        prefix: creds.prefix,
        note: '列出的对象页数超过上限，下面的计数不完整。未删除、未改写已有对象。',
        ...summarizeExecutableKeys(error.keys)
      }, null, 2)}\n`);
    }
    return fail(1, error && (error.code || error.message) ? `${error.code || ''} ${error.message || ''}`.trim() : '列出对象失败');
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write('列出对象失败\n');
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  listAllObjects,
  parseArgs,
  readCredentials,
  redact,
  lockReadOnly
};
