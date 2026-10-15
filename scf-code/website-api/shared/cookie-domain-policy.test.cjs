const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cookieDomainScope, customDomainAuthCookieHeader } = require('./cookie-domain-policy.cjs');

const HOST_ONLY = [
  'example.com',
  'www.example.com',
  'example.co.uk',
  'www.example.co.uk',
  'example.com.cn',
  'a.b.example.com.cn',
  'example.cn',
  'foo.github.io',
  'myblog.blogspot.com',
  'bucket.s3.amazonaws.com',
  'www.ck'
];

const PUBLIC_SUFFIX = [
  'github.io',
  'co.uk',
  'com.cn',
  'blogspot.com',
  's3.amazonaws.com',
  'foo.ck'
];

test('cookie scope is host-only for registrable custom hosts, including multi-label suffixes', () => {
  for (const host of HOST_ONLY) {
    const scope = cookieDomainScope(host);
    assert.equal(scope.mode, 'host-only', host);
    assert.equal(scope.host, host);
    assert.ok(scope.registrable, host);
    const header = customDomainAuthCookieHeader(host, 'ACCOUNT_TOKEN', 3600);
    assert.match(header, /^demox_access=ACCOUNT_TOKEN; Max-Age=3600; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    assert.doesNotMatch(header, /domain\s*=/i);
    assert.doesNotMatch(header, new RegExp('Domain=\\.?' + scope.registrable.replace(/\./g, '\\.'), 'i'));
  }
});

test('public suffixes and official hosts are refused, and never produce a Set-Cookie', () => {
  for (const host of PUBLIC_SUFFIX) {
    const scope = cookieDomainScope(host);
    assert.equal(scope.mode, 'refuse', host);
    assert.equal(scope.reason, 'public-suffix', host);
    assert.equal(customDomainAuthCookieHeader(host, 'ACCOUNT_TOKEN', 3600), '');
  }
  for (const host of ['demox.site', 'www.demox.site', 'evil.demox.site', 'customers.demox.site']) {
    assert.equal(cookieDomainScope(host).reason, 'official', host);
    assert.equal(customDomainAuthCookieHeader(host, 'ACCOUNT_TOKEN', 3600), '');
  }
  assert.equal(cookieDomainScope('').reason, 'invalid');
  assert.equal(cookieDomainScope('localhost').reason, 'invalid');
  assert.equal(cookieDomainScope('127.0.0.1').reason, 'ip');
});

test('www.example.co.uk cookie does not widen to the registrable parent', () => {
  const scope = cookieDomainScope('www.example.co.uk');
  assert.equal(scope.registrable, 'example.co.uk');
  const header = customDomainAuthCookieHeader('www.example.co.uk', 'ACCOUNT_TOKEN', 60);
  assert.equal(header.includes('example.co.uk'), false);
  assert.equal(header.includes('Domain'), false);
});

test('website-api inlines the same policy (functions push only ships index.js)', () => {
  const mod = fs.readFileSync(path.join(__dirname, 'cookie-domain-policy.cjs'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const start = mod.indexOf('function cookieDomainScope(');
  const end = mod.indexOf('module.exports');
  const body = mod.slice(start, end).trim();
  assert.ok(start > 0 && end > start);
  assert.ok(index.includes(body), 'index.js must inline cookie-domain-policy.cjs verbatim');
});
