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
    dnsRetryPropagationMs: 0,
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
  assert.deepEqual(result, {
    renewed: true,
    oldCertId: undefined,
    newCertId: 'cert-new',
    previousRemainingDays: null,
    attempt: 'dns-01'
  });
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

function acmeClientFor(auto) {
  return {
    crypto: {
      createPrivateKey: async () => 'account-key',
      createCsr: async () => [Buffer.from('private-key'), 'csr']
    },
    Client: class Client {
      async auto(options) {
        return auto(options);
      }
    }
  };
}

test('wildcard attempt order is dns-01 then a longer dns-01 retry', () => {
  assert.deepEqual(__private.WILDCARD_REJECTED_CHALLENGES, ['http-01', 'tls-alpn-01']);
  const override = process.env.DNS_RETRY_PROPAGATION_MS;
  const expectedDefault = override == null || override === '' ? 60_000 : Number.parseInt(override, 10);
  assert.equal(__private.CONFIG.dnsRetryPropagationMs, expectedDefault);
  assert.equal(__private.parseInteger(undefined, 60_000), 60_000);
  assert.equal(__private.parseInteger('45000', 60_000), 45_000);
  assert.deepEqual(__private.buildAttemptOrder({ dnsPropagationMs: 25_000, dnsRetryPropagationMs: 60_000 }), [
    { id: 'dns-01', propagationMs: 25_000 },
    { id: 'dns-01-retry', propagationMs: 60_000 }
  ]);
});

test('dns-01 validation failure retries once with the longer wait', async () => {
  const calls = [];
  const waits = [];
  let autos = 0;
  const service = __private.createRenewService({
    config: config({ dnsPropagationMs: 25, dnsRetryPropagationMs: 90 }),
    apis: {
      teo: async (action) => {
        calls.push(['teo', action]);
        if (action === 'DescribeAccelerationDomains') return { AccelerationDomains: [] };
        return {};
      },
      dnspod: async (action) => {
        calls.push(['dnspod', action]);
        return action === 'CreateRecord' ? { RecordId: 7 } : {};
      },
      ssl: async (action) => {
        calls.push(['ssl', action]);
        return { CertificateId: 'cert-new' };
      },
      scf: async (action) => {
        calls.push(['scf', action]);
        if (action === 'GetCustomDomain') return scfDomain({ certId: 'cert-old' });
        return {};
      }
    },
    acmeClient: acmeClientFor(async (options) => {
      autos += 1;
      const challenge = { type: 'dns-01' };
      await options.challengeCreateFn({ identifier: { value: 'demox.site' } }, challenge, 'txt-value');
      await options.challengeRemoveFn({}, challenge);
      if (autos === 1) throw new Error('challenge invalid: dns');
      return 'certificate';
    }),
    wait: async (ms) => { waits.push(ms); },
    logger: { log() {}, warn() {} }
  });

  const result = await service.renew({ force: true });
  assert.equal(result.attempt, 'dns-01-retry');
  assert.equal(result.newCertId, 'cert-new');
  assert.deepEqual(waits, [25, 90]);
  assert.equal(calls.filter((item) => item[0] === 'dnspod' && item[1] === 'CreateRecord').length, 2);
});

test('DNSPod write failure is not retried and names the single attempt', async () => {
  const calls = [];
  const service = __private.createRenewService({
    config: config(),
    apis: {
      teo: async () => ({ AccelerationDomains: [] }),
      dnspod: async (action) => {
        calls.push(action);
        throw new Error('AuthFailure.SecretIdNotFound: rejected');
      },
      ssl: async () => { throw new Error('should not upload'); },
      scf: async () => { throw new Error('should not bind'); }
    },
    acmeClient: acmeClientFor(async (options) => {
      await options.challengeCreateFn({ identifier: { value: 'demox.site' } }, { type: 'dns-01' }, 'txt');
      return 'certificate';
    }),
    wait: async () => {},
    logger: { log() {}, warn() {} }
  });

  await assert.rejects(
    () => service.renew({ force: true }),
    (error) => {
      assert.equal(error.step, 'issue');
      assert.deepEqual(error.attempts.map((item) => item.id), ['dns-01']);
      assert.match(error.message, /DNSPod 写入 TXT 失败/);
      assert.match(error.message, /AuthFailure\.SecretIdNotFound/);
      assert.doesNotMatch(error.message, /dns-01-retry/);
      return true;
    }
  );
  assert.deepEqual(calls, ['CreateRecord']);
});

test('http-01 and tls-alpn-01 are rejected for the wildcard and do not write DNS', async () => {
  for (const type of ['http-01', 'tls-alpn-01']) {
    const calls = [];
    const service = __private.createRenewService({
      config: config(),
      apis: {
        teo: async () => ({ AccelerationDomains: [] }),
        dnspod: async (action) => { calls.push(action); return { RecordId: 1 }; },
        ssl: async () => ({}),
        scf: async () => scfDomain()
      },
      acmeClient: acmeClientFor(async (options) => {
        await options.challengeCreateFn({ identifier: { value: 'demox.site' } }, { type }, 'token');
        return 'certificate';
      }),
      logger: { log() {}, warn() {} }
    });
    await assert.rejects(
      () => service.renew({ force: true }),
      (error) => error.step === 'issue' && error.message.includes(type) && error.message.includes('通配符')
    );
    assert.deepEqual(calls, []);
  }
});

test('renewal failure throws CERT_RENEW_FAILED instead of returning success:false', async () => {
  const errors = [];
  await assert.rejects(
    () => __private.runRenewal({}, {
      config: config(),
      apis: {
        teo: async () => { throw new Error('teo down'); },
        dnspod: async () => {},
        ssl: async () => {},
        scf: async () => ({})
      },
      logger: { log() {}, warn() {}, error: (line) => errors.push(line) }
    }),
    (error) => {
      assert.equal(error.code, 'CERT_RENEW_FAILED');
      assert.match(error.message, /^ALERT cert-renew failed step=read-expiry /);
      assert.match(error.message, /teo down/);
      return true;
    }
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^ALERT cert-renew failed step=read-expiry /);
});

test('a due renewal without SCF_CUSTOM_DOMAIN fails instead of skipping the api bind', async () => {
  const service = __private.createRenewService({
    config: config({ scfCustomDomain: '' }),
    apis: {
      teo: async (action) => (action === 'DescribeAccelerationDomains' ? { AccelerationDomains: [] } : {}),
      dnspod: async (action) => (action === 'CreateRecord' ? { RecordId: 1 } : {}),
      ssl: async () => ({ CertificateId: 'cert-new' }),
      scf: async () => { throw new Error('should not call scf'); }
    },
    acmeClient: acmeClientFor(async (options) => {
      const challenge = { type: 'dns-01' };
      await options.challengeCreateFn({ identifier: { value: 'demox.site' } }, challenge, 'txt');
      await options.challengeRemoveFn({}, challenge);
      return 'certificate';
    }),
    wait: async () => {},
    logger: { log() {}, warn() {} }
  });
  await assert.rejects(
    () => service.renew({ force: true }),
    (error) => error.step === 'bind-scf' && /SCF_CUSTOM_DOMAIN/.test(error.message)
  );
});

test('not-due check still skips renewal when SCF custom domain is unset', async () => {
  const future = new Date(Date.now() + 60 * 86_400_000).toISOString();
  const service = __private.createRenewService({
    config: config({ scfCustomDomain: '' }),
    apis: {
      teo: async () => ({
        AccelerationDomains: [{
          DomainName: '*.demox.site',
          Certificate: { List: [{ Type: 'upload', CertId: 'cert-old', ExpireTime: future }] }
        }]
      }),
      scf: async () => { throw new Error('should not call scf'); },
      ssl: async () => { throw new Error('should not upload'); },
      dnspod: async () => { throw new Error('should not write dns'); }
    },
    logger: { log() {}, warn() {} }
  });
  const result = await service.renew();
  assert.equal(result.renewed, false);
  assert.equal(result.reason, 'not_due');
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
