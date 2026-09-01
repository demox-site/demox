'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { __private } = require('./index.js');

function config(overrides = {}) {
  return {
    domain: '*.demox.site',
    san: ['demox.site'],
    thresholdDays: 30,
    acmeDirectory: 'https://acme.test/directory',
    acmeEmail: 'test@demox.site',
    dnspodDomain: 'demox.site',
    zoneId: 'zone-test',
    region: 'ap-guangzhou',
    dnsPropagationMs: 0,
    ...overrides
  };
}

test('invalid timer Message cannot force a renewal', () => {
  assert.equal(__private.parseForce({ force: true }), true);
  assert.equal(__private.parseForce({ Message: '{"force":true}' }), true);
  assert.equal(__private.parseForce({ Message: 'not-json' }), false);
  assert.equal(__private.parseForce({ Message: '{"force":false}' }), false);
});

test('renewal exits without writes while the certificate is outside the threshold', async () => {
  const calls = [];
  const future = new Date(Date.now() + 60 * 86_400_000).toISOString();
  const service = __private.createRenewService({
    config: config(),
    apis: {
      teo: async (action) => {
        calls.push(['teo', action]);
        return {
          AccelerationDomains: [{
            DomainName: '*.demox.site',
            Certificate: { List: [{ Type: 'upload', CertId: 'cert-old', ExpireTime: future }] }
          }]
        };
      },
      dnspod: async (action) => { calls.push(['dnspod', action]); },
      ssl: async (action) => { calls.push(['ssl', action]); }
    },
    logger: { log() {}, warn() {} }
  });

  const result = await service.renew();
  assert.equal(result.renewed, false);
  assert.equal(result.reason, 'not_due');
  assert.deepEqual(calls, [['teo', 'DescribeAccelerationDomains']]);
});

test('forced renewal writes DNS challenge, uploads SSL, and binds EdgeOne in order', async () => {
  const calls = [];
  let challengeOptions;
  const apis = {
    teo: async (action, payload) => {
      calls.push(['teo', action, payload]);
      if (action === 'DescribeAccelerationDomains') return { AccelerationDomains: [] };
      return {};
    },
    dnspod: async (action, payload) => {
      calls.push(['dnspod', action, payload]);
      return action === 'CreateRecord' ? { RecordId: 42 } : {};
    },
    ssl: async (action, payload) => {
      calls.push(['ssl', action, payload]);
      return { CertificateId: 'cert-new' };
    }
  };
  const fakeAcme = {
    crypto: {
      createPrivateKey: async () => 'account-key',
      createCsr: async () => [Buffer.from('private-key'), 'csr']
    },
    Client: class Client {
      async auto(options) {
        challengeOptions = options;
        const challenge = { type: 'dns-01' };
        await options.challengeCreateFn({ identifier: { value: 'demox.site' } }, challenge, 'txt-value');
        await options.challengeRemoveFn({}, challenge);
        return 'certificate';
      }
    }
  };
  const service = __private.createRenewService({
    config: config(),
    apis,
    acmeClient: fakeAcme,
    wait: async () => {},
    logger: { log() {}, warn() {} }
  });

  const result = await service.renew({ force: true });
  assert.deepEqual(result, { renewed: true, oldCertId: undefined, newCertId: 'cert-new', previousRemainingDays: null });
  assert.equal(challengeOptions.skipChallengeVerification, true);
  assert.deepEqual(calls.map((item) => item.slice(0, 2)), [
    ['teo', 'DescribeAccelerationDomains'],
    ['dnspod', 'CreateRecord'],
    ['dnspod', 'DeleteRecord'],
    ['ssl', 'UploadCertificate'],
    ['teo', 'ModifyHostsCertificate']
  ]);
  assert.equal(calls[1][2].SubDomain, '_acme-challenge');
  assert.equal(calls[4][2].ZoneId, 'zone-test');
  assert.deepEqual(calls[4][2].Hosts, ['*.demox.site', 'demox.site']);
  assert.deepEqual(calls[4][2].ServerCertInfo, [{ CertId: 'cert-new' }]);
});

test('challenge cleanup failure does not hide a successful issuance flow', async () => {
  const warnings = [];
  const service = __private.createRenewService({
    config: config(),
    apis: {
      teo: async () => ({}),
      ssl: async () => ({}),
      dnspod: async (action) => {
        if (action === 'DeleteRecord') throw new Error('temporary DNS failure');
        return { RecordId: 1 };
      }
    },
    logger: { log() {}, warn: (...args) => warnings.push(args) }
  });
  await service.removeTxtRecord(1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][1], /temporary DNS failure/);
});
