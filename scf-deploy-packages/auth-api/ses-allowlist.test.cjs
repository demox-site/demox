'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  ALLOWED_FROM_DOMAINS,
  ALLOWED_TEMPLATE_IDS,
  assertPlatformSesSend
} = require('./ses-allowlist.cjs');

test('auth and website SES allowlists are the same file', () => {
  const auth = fs.readFileSync(path.join(__dirname, 'ses-allowlist.cjs'), 'utf8');
  const website = fs.readFileSync(path.join(__dirname, '../../scf-code/website-api/ses-allowlist.js'), 'utf8');
  assert.equal(auth, website);
  assert.deepEqual([...ALLOWED_FROM_DOMAINS], ['mail.demox.site', 'mail.aigc.sx.cn']);
  assert.deepEqual([...ALLOWED_TEMPLATE_IDS], [137482, 226012]);
});

test('only the two from domains and the two template ids are accepted', () => {
  assert.deepEqual(
    assertPlatformSesSend({ from: 'Demox <noreply@mail.demox.site>', templateId: 137482 }),
    { domain: 'mail.demox.site', templateId: 137482 }
  );
  assert.deepEqual(
    assertPlatformSesSend({ from: 'noreply@mail.aigc.sx.cn', templateId: '226012' }),
    { domain: 'mail.aigc.sx.cn', templateId: 226012 }
  );
  const refused = [
    { from: 'Demox <noreply@mail.demox.site>', templateId: 1 },
    { from: 'Demox <noreply@mail.demox.site>', templateId: 226011 },
    { from: 'noreply@evil.example', templateId: 137482 },
    { from: 'noreply@mail.demox.site.evil.com', templateId: 137482 },
    { from: 'Demox <noreply@notmail.demox.site>', templateId: 226012 },
    { from: 'a@b.com <noreply@mail.demox.site>', templateId: 137482 },
    { from: '', templateId: 137482 },
    { from: 'Demox <noreply@mail.demox.site>', templateId: null }
  ];
  for (const input of refused) {
    assert.throws(
      () => assertPlatformSesSend(input),
      (error) => error.code === 'SES_SEND_REFUSED',
      JSON.stringify(input)
    );
  }
});
