const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeishuDirectoryClient, FeishuDirectoryError } = require('./feishu-directory.js');

function clientWith(handler) {
  return createFeishuDirectoryClient({
    appId: 'cli_test',
    appSecret: 'secret_test',
    request: async (input) => {
      if (input.path.includes('/auth/v3/tenant_access_token/internal')) {
        return { code: 0, tenant_access_token: 'tenant-token-secret', expire: 3600 };
      }
      return handler(input);
    }
  });
}

test('email lookup resolves to open_id and loads user details', async () => {
  const seen = [];
  const client = clientWith(async (input) => {
    seen.push(input);
    if (input.path.includes('batch_get_id')) return { code: 0, data: { user_list: [{ user_id: 'ou_target', email: 'login@example.com' }] } };
    return { code: 0, data: { user: { open_id: 'ou_target', name: 'Target User', department_ids: ['od-child'] } } };
  });
  const user = await client.resolveUserByEmail(' Login@Example.com ');
  assert.equal(user.openId, 'ou_target');
  assert.equal(user.name, 'Target User');
  assert.deepEqual(seen[0].body, { emails: ['login@example.com'] });
});

test('an unmatched email fails with USER_NOT_FOUND', async () => {
  const client = clientWith(async () => ({ code: 0, data: { user_list: [] } }));
  await assert.rejects(() => client.resolveUserByEmail('missing@example.com'), (error) => error.code === 'USER_NOT_FOUND');
});

test('department listing follows pagination', async () => {
  let page = 0;
  const client = clientWith(async () => {
    page += 1;
    return page === 1
      ? { code: 0, data: { items: [{ open_department_id: 'od-one', name: 'One' }], has_more: true, page_token: 'next' } }
      : { code: 0, data: { items: [{ open_department_id: 'od-two', name: 'Two' }], has_more: false } };
  });
  assert.deepEqual((await client.listDepartments()).map((item) => item.open_department_id), ['od-one', 'od-two']);
});

test('department closure includes direct departments and ancestors', async () => {
  const client = clientWith(async (input) => {
    if (input.path.includes('/users/')) return { code: 0, data: { user: { open_id: 'ou_target', department_ids: ['od-child'] } } };
    return { code: 0, data: { items: [{ open_department_id: 'od-parent' }], has_more: false } };
  });
  assert.deepEqual((await client.getUserDepartmentClosure('ou_target')).departmentIds, ['od-child', 'od-parent']);
});

test('API errors preserve the code without exposing the bearer token', async () => {
  const client = clientWith(async () => ({ code: 40004, msg: 'no dept authority error' }));
  await assert.rejects(
    () => client.listDepartments(),
    (error) => error instanceof FeishuDirectoryError && error.code === 40004 && !error.message.includes('tenant-token-secret')
  );
});
