'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createJwtAuthenticator } = require('./auth.js');

const SECRET = 'unit-test-secret-0123456789abcdef-0123456789';

test('a site access ticket cannot manage functions', () => {
  const authenticate = createJwtAuthenticator({ secret: SECRET });
  const account = jwt.sign({ userId: 'user-1' }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });
  assert.equal(authenticate({ headers: { authorization: 'Bearer ' + account } }).userId, 'user-1');

  const ticket = jwt.sign({
    purpose: 'site_access',
    userId: 'user-1',
    websiteId: 'BOTCAMP1',
    host: 'botcamp.demox.site'
  }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  assert.throws(
    () => authenticate({ headers: { authorization: 'Bearer ' + ticket } }),
    (error) => error && error.code === 'UNAUTHORIZED'
  );
});
