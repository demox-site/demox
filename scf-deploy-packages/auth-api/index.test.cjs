const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');

Object.assign(process.env, {
  MYSQL_HOST: '127.0.0.1',
  MYSQL_USER: 'test',
  MYSQL_PASSWORD: 'test',
  MYSQL_DATABASE: 'test',
  JWT_SECRET: 'test-secret-that-is-long-enough-for-unit-tests'
});
delete process.env.FEISHU_APP_ID;
delete process.env.FEISHU_APP_SECRET;

let queryImpl = async (sql) => {
  throw new Error(`Unexpected query: ${sql}`);
};
const dbModulePath = require.resolve('./shared/db.cjs');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: {
    query: (...args) => queryImpl(...args),
    transaction: async (callback) => callback({ execute: (...args) => queryImpl(...args) })
  }
};

const { main } = require('./index.cjs');
const { sign } = require('./shared/jwt.cjs');

function request(path, body = {}) {
  return main({ path, httpMethod: 'POST', body });
}

test('feishu login requires an authorization code and PKCE verifier', async () => {
  const response = await request('/auth/feishu');
  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).error, /code 和 codeVerifier/);
});

test('feishu login rejects malformed PKCE before contacting the provider', async () => {
  const response = await request('/auth/feishu', {
    code: 'one-time-code',
    codeVerifier: 'too-short'
  });
  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).error, /PKCE/);
});

test('feishu login fails closed when server credentials are missing', async () => {
  const response = await request('/auth/feishu', {
    code: 'one-time-code',
    codeVerifier: 'a'.repeat(43)
  });
  assert.equal(response.statusCode, 500);
  assert.match(JSON.parse(response.body).error, /未配置飞书 OAuth/);
});

test('feishu login fails closed when the server redirect URI is missing', async () => {
  process.env.FEISHU_APP_ID = 'cli_test';
  process.env.FEISHU_APP_SECRET = 'test-secret';
  delete process.env.FEISHU_REDIRECT_URI;
  try {
    const response = await request('/auth/feishu', {
      code: 'one-time-code',
      codeVerifier: 'a'.repeat(43)
    });
    assert.equal(response.statusCode, 500);
    assert.match(JSON.parse(response.body).error, /回调地址/);
  } finally {
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
  }
});

test('feishu finalize rejects an invalid short-lived ticket', async () => {
  const response = await request('/auth/feishu/finalize', {
    ticket: 'invalid-ticket',
    choice: 'create'
  });
  assert.equal(response.statusCode, 401);
  assert.match(JSON.parse(response.body).error, /票据无效或已过期/);
});

test('request logs redact OAuth secrets', async () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await request('/auth/feishu', {
      code: 'sensitive-code',
      codeVerifier: 'sensitive-verifier'
    });
  } finally {
    console.log = originalLog;
  }

  const output = lines.join('\n');
  assert.match(output, /\[REDACTED\]/);
  assert.doesNotMatch(output, /sensitive-code|sensitive-verifier/);
});

test('returning feishu user exchanges code and signs into the bound account', async () => {
  const originalRequest = https.request;
  const requests = [];
  https.request = (options, callback) => {
    const req = new EventEmitter();
    let requestBody = '';
    req.write = (chunk) => {
      requestBody += chunk;
    };
    req.setTimeout = () => req;
    req.end = () => {
      requests.push({ options, body: requestBody });
      const res = new EventEmitter();
      callback(res);
      const responseBody = options.hostname === 'accounts.feishu.cn'
        ? { code: 0, access_token: 'user-access-token' }
        : {
            code: 0,
            data: {
              open_id: 'ou_test',
              union_id: 'on_test',
              name: 'Feishu User',
              avatar_url: 'https://example.com/avatar.png'
            }
          };
      process.nextTick(() => {
        res.emit('data', JSON.stringify(responseBody));
        res.emit('end');
      });
    };
    return req;
  };

  queryImpl = async (sql) => {
    if (sql.includes('FROM users') && sql.includes('feishu_open_id')) {
      return [{ id: 'user-1', email: 'user@example.com', nickname: 'Existing User' }];
    }
    if (sql.trim().startsWith('UPDATE users')) return { affectedRows: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  };
  Object.assign(process.env, {
    FEISHU_APP_ID: 'cli_test',
    FEISHU_APP_SECRET: 'test-secret',
    FEISHU_REDIRECT_URI: 'https://www.demox.site/feishu-callback'
  });

  try {
    const response = await request('/auth/feishu', {
      code: 'one-time-code',
      codeVerifier: 'a'.repeat(43)
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.userId, 'user-1');
    assert.equal(body.isNewUser, false);
    assert.ok(body.token);
    assert.deepEqual(requests.map((item) => item.options.hostname), [
      'accounts.feishu.cn',
      'open.feishu.cn'
    ]);
    const tokenRequest = JSON.parse(requests[0].body);
    assert.equal(tokenRequest.code_verifier, 'a'.repeat(43));
    assert.equal(tokenRequest.redirect_uri, process.env.FEISHU_REDIRECT_URI);
  } finally {
    https.request = originalRequest;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_REDIRECT_URI;
  }
});

test('first-time feishu identity is created atomically from a short-lived ticket', async () => {
  const writes = [];
  queryImpl = async (sql, params) => {
    if (sql.includes('FROM users') && sql.includes('feishu_open_id')) return [];
    if (sql.trim().startsWith('INSERT INTO')) {
      writes.push({ sql, params });
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  const ticket = sign({
    kind: 'feishu_link',
    openId: 'ou_new_user',
    unionId: 'on_new_user',
    feishuName: 'New User',
    avatarUrl: null
  }, '5m');

  const response = await request('/auth/feishu/finalize', {
    ticket,
    choice: 'create'
  });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.isNewUser, true);
  assert.match(body.email, /^feishu_[a-f0-9]{32}@users\.noreply\.demox\.site$/);
  assert.equal(writes.length, 2);
  assert.match(writes[0].sql, /INSERT INTO users/);
  assert.match(writes[1].sql, /INSERT INTO user_roles/);
});

test('feishu schema migration cannot be triggered through the public request body', async () => {
  queryImpl = async (sql) => {
    throw new Error(`Unexpected query: ${sql}`);
  };

  const response = await request('/auth/not-found', {
    internalMigration: 'feishu_identity',
    dryRun: false
  });

  assert.equal(response.statusCode, 404);
});

test('direct SCF invoke applies and verifies the feishu schema migration', async () => {
  let migrated = false;
  let alterSql = '';
  queryImpl = async (sql) => {
    if (sql.includes('information_schema.COLUMNS')) {
      return migrated
        ? [
            { COLUMN_NAME: 'feishu_open_id' },
            { COLUMN_NAME: 'feishu_union_id' },
            { COLUMN_NAME: 'feishu_name' }
          ]
        : [];
    }
    if (sql.includes('information_schema.STATISTICS')) {
      return migrated
        ? [
            { INDEX_NAME: 'uniq_feishu_open_id' },
            { INDEX_NAME: 'uniq_feishu_union_id' }
          ]
        : [];
    }
    if (sql.includes('information_schema.TABLES')) return [{ TABLE_ROWS: 12 }];
    if (sql.startsWith('ALTER TABLE users')) {
      alterSql = sql;
      migrated = true;
      return { affectedRows: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const response = await main({
    internalMigration: 'feishu_identity',
    dryRun: false,
    body: {}
  });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.verified, true);
  assert.equal(body.estimatedRows, 12);
  assert.deepEqual(body.addedColumns, [
    'feishu_open_id',
    'feishu_union_id',
    'feishu_name'
  ]);
  assert.deepEqual(body.addedIndexes, [
    'uniq_feishu_open_id',
    'uniq_feishu_union_id'
  ]);
  assert.match(alterSql, /ADD COLUMN feishu_open_id/);
  assert.match(alterSql, /ADD UNIQUE KEY uniq_feishu_union_id/);
});
