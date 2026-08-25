const test = require('node:test');
const assert = require('node:assert/strict');
const { createGithubDirectoryClient, GithubDirectoryError } = require('./github-directory.js');

function clientWith(handler) {
  return createGithubDirectoryClient({
    token: 'ghs_test',
    request: handler
  });
}

test('exact GitHub login is returned first and search results are deduplicated', async () => {
  const seen = [];
  const client = clientWith(async (input) => {
    seen.push(input.path);
    if (input.path.startsWith('/users/octocat')) {
      return { __statusCode: 200, id: 1, login: 'octocat', name: 'The Octocat', avatar_url: 'https://example/a.png' };
    }
    return {
      __statusCode: 200,
      items: [
        { id: 1, login: 'octocat', avatar_url: 'https://example/a.png' },
        { id: 2, login: 'octocat-helper', avatar_url: 'https://example/b.png' }
      ]
    };
  });

  const users = await client.searchUsers('octocat');
  assert.deepEqual(users.map((user) => user.id), ['1', '2']);
  assert.equal(users[0].name, 'The Octocat');
  assert.equal(seen[0], '/users/octocat');
});

test('missing GitHub users resolve to null instead of throwing', async () => {
  const client = clientWith(async () => ({ __statusCode: 404, message: 'Not Found' }));
  assert.equal(await client.getUserById('999'), null);
  assert.equal(await client.getUserByLogin('missing-user'), null);
});

test('rate-limit responses become GithubDirectoryError', async () => {
  const client = clientWith(async () => ({ __statusCode: 403, message: 'API rate limit exceeded' }));
  await assert.rejects(
    () => client.searchUsers('alice'),
    (error) => error instanceof GithubDirectoryError && error.code === 'RATE_LIMITED'
  );
});
