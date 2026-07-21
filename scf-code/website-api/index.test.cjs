const test = require('node:test');
const assert = require('node:assert/strict');

Object.assign(process.env, {
  MYSQL_HOST: '127.0.0.1',
  MYSQL_USER: 'test',
  MYSQL_PASSWORD: 'test',
  MYSQL_DATABASE: 'test',
  JWT_SECRET: 'website-api-test-secret'
});

let queryImpl = async (sql) => {
  throw new Error(`Unexpected query: ${sql}`);
};
const dbModulePath = require.resolve('./shared/db.js');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: {
    query: (...args) => queryImpl(...args),
    transaction: async (callback) => callback({ query: (...args) => queryImpl(...args) })
  }
};

const { main } = require('./index.js');
const { sign } = require('./shared/jwt.js');

function request(action, body = {}, userId = 'user-feishu') {
  const token = sign({ userId, email: `${userId}@example.com` });
  return main({
    path: `/website/${action.replaceAll('_', '-')}`,
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: { action, ...body }
  });
}

test('a tenant grant authorizes a private site without a project_members row', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('FROM websites w')) {
      return [{
        path: 'sites/private/index.html',
        user_id: 'project-owner',
        project_id: 42,
        website_id: 'PRIVATE1',
        visibility: 'private'
      }];
    }
    if (sql.includes('FROM user_roles')) return [];
    if (sql.includes('FROM project_feishu_grants g')) return [{ project_id: 42, role: 'member' }];
    if (sql.includes('FROM projects p') && sql.includes('LEFT JOIN project_members')) {
      return [{ id: 42, user_id: 'project-owner', project_role: null }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const response = await request('check_site_access', { label: 'private1', domain: 'demox.site' });
  const body = JSON.parse(response.body);
  assert.equal(body.success, true);
  assert.equal(body.allowed, true);
  assert.equal(body.role, 'member');
});

test('removing the matching grant immediately denies private-site access', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('FROM websites w')) {
      return [{
        path: 'sites/private/index.html',
        user_id: 'project-owner',
        project_id: 42,
        website_id: 'PRIVATE1',
        visibility: 'private'
      }];
    }
    if (sql.includes('FROM user_roles')) return [];
    if (sql.includes('FROM project_feishu_grants g')) return [];
    if (sql.includes('FROM projects p') && sql.includes('LEFT JOIN project_members')) return [];
    if (sql.includes("SELECT *, 'owner' AS project_role")) return [];
    throw new Error(`Unexpected query: ${sql}`);
  };

  const response = await request('check_site_access', { label: 'private1', domain: 'demox.site' });
  const body = JSON.parse(response.body);
  assert.equal(body.success, true);
  assert.equal(body.allowed, false);
  assert.equal(body.reason, 'forbidden');
});

test('project owner can pre-authorize a normalized Feishu email', async () => {
  let insertedParams = null;
  queryImpl = async (sql, params) => {
    if (sql.includes('FROM user_roles')) return [];
    if (sql.includes('FROM project_feishu_grants g')) return [];
    if (sql.includes('FROM projects p') && sql.includes('LEFT JOIN project_members')) {
      return [{ id: 42, user_id: 'project-owner', project_role: 'owner' }];
    }
    if (sql.includes('INSERT INTO project_feishu_grants')) {
      insertedParams = params;
      return { affectedRows: 1 };
    }
    if (sql.includes('SELECT * FROM project_feishu_grants')) {
      return [{
        id: 7,
        project_id: 42,
        principal_type: 'user',
        key_type: 'email',
        principal_key: 'person@company.example',
        role: 'member',
        created_by: 'project-owner'
      }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const response = await request('grant_project_to_feishu', {
    projectId: 42,
    principalType: 'user',
    principalKey: ' Person@Company.Example ',
    role: 'member'
  }, 'project-owner');
  const body = JSON.parse(response.body);
  assert.equal(body.success, true);
  assert.equal(body.grant.principalKey, 'person@company.example');
  assert.equal(insertedParams[3], 'person@company.example');
});

test('project admin cannot grant the admin role', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('FROM user_roles')) return [];
    if (sql.includes('FROM project_feishu_grants g')) return [];
    if (sql.includes('FROM projects p') && sql.includes('LEFT JOIN project_members')) {
      return [{ id: 42, user_id: 'project-owner', project_role: 'admin' }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const response = await request('grant_project_to_feishu', {
    projectId: 42,
    principalType: 'organization',
    principalKey: 'tenant_abc',
    role: 'admin'
  }, 'project-admin');
  const body = JSON.parse(response.body);
  assert.equal(body.success, false);
  assert.match(body.message, /admin 只能授予 member/);
});
