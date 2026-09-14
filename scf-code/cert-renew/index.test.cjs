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
    scfCustomDomain: 'api.demox.site',
    dnsPropagationMs: 0,
    ...overrides
  };
}

function scfDomain({ certId = 'cert-old', endpoints = true, waf = false } = {}) {
  return {
    Domain: 'api.demox.site',
    Protocol: 'HTTPS',
    CertConfig: certId ? { CertificateId: certId } : {},
    EndpointsConfig: endpoints
      ? [{
          Namespace: 'demox',
          FunctionName: 'demox-function-api',
          Qualifier: '$LATEST',
          PathMatch: '/*'
        }]
      : [],
    ...(waf ? { WafConfig: { WafOpen: 'OPEN' } } : {})
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
      ssl: async (action) => { calls.push(['ssl', action]); },
      scf: async (action) => {
        calls.push(['scf', action]);
        return scfDomain({ certId: 'cert-old' });
      }
    },
    logger: { log() {}, warn() {} }
  });

  const result = await service.renew();
  assert.equal(result.renewed, false);
  assert.equal(result.reason, 'not_due');
  assert.deepEqual(calls, [
    ['teo', 'DescribeAccelerationDomains'],
    ['scf', 'GetCustomDomain']
  ]);
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
    },
    scf: async (action, payload) => {
      calls.push(['scf', action, payload]);
      if (action === 'GetCustomDomain') return scfDomain({ certId: 'cert-old', waf: true });
      return {};
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
    ['teo', 'ModifyHostsCertificate'],
    ['scf', 'GetCustomDomain'],
    ['scf', 'UpdateCustomDomain']
  ]);
  assert.equal(calls[1][2].SubDomain, '_acme-challenge');
  assert.equal(calls[4][2].ZoneId, 'zone-test');
  assert.deepEqual(calls[4][2].Hosts, ['*.demox.site', 'demox.site']);
  assert.deepEqual(calls[4][2].ServerCertInfo, [{ CertId: 'cert-new' }]);
  assert.equal(calls[6][2].Domain, 'api.demox.site');
  assert.equal(calls[6][2].CertConfig.CertificateId, 'cert-new');
  assert.equal(calls[6][2].WafConfig.WafOpen, 'OPEN');
  assert.equal(calls[6][2].EndpointsConfig.length, 1);
});

test('when EdgeOne is not due, SCF custom domain is synced to the current cert', async () => {
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
            Certificate: { List: [{ Type: 'upload', CertId: 'cert-current', ExpireTime: future }] }
          }]
        };
      },
      scf: async (action, payload) => {
        calls.push(['scf', action, payload]);
        if (action === 'GetCustomDomain') return scfDomain({ certId: 'cert-stale', waf: true });
        return {};
      },
      ssl: async (action) => { calls.push(['ssl', action]); },
      dnspod: async (action) => { calls.push(['dnspod', action]); }
    },
    logger: { log() {}, warn() {} }
  });

  const result = await service.renew();
  assert.equal(result.renewed, false);
  assert.equal(result.reason, 'scf_cert_synced');
  assert.equal(result.oldScfCertId, 'cert-stale');
  assert.equal(result.newCertId, 'cert-current');
  assert.ok(result.remainingDays >= 59);
  assert.deepEqual(calls.map((item) => item.slice(0, 2)), [
    ['teo', 'DescribeAccelerationDomains'],
    ['scf', 'GetCustomDomain'],
    ['scf', 'UpdateCustomDomain']
  ]);
  assert.equal(calls[2][2].CertConfig.CertificateId, 'cert-current');
  assert.equal(calls[2][2].WafConfig.WafOpen, 'OPEN');
  assert.deepEqual(calls[2][2].EndpointsConfig, [{
    Namespace: 'demox',
    FunctionName: 'demox-function-api',
    Qualifier: '$LATEST',
    PathMatch: '/*'
  }]);
});

test('SCF certificate bind refuses to update a domain with no routes', async () => {
  const service = __private.createRenewService({
    config: config(),
    apis: {
      scf: async () => scfDomain({ endpoints: false })
    },
    logger: { log() {}, warn() {} }
  });
  await assert.rejects(
    () => service.bindToScf('cert-new'),
    /没有路由/
  );
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
