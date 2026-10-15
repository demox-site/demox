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
    reuseWithinDays: 7,
    reuseMinRemainingDays: 60,
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
      ssl: async (action) => {
        calls.push(['ssl', action]);
        if (action === 'DescribeCertificate') {
          return {
            CertificateId: 'cert-old',
            Domain: '*.demox.site',
            SubjectAltName: ['*.demox.site', 'demox.site'],
            CertEndTime: future,
            Status: 1
          };
        }
        return { Certificates: [] };
      },
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
    ['scf', 'GetCustomDomain'],
    ['ssl', 'DescribeCertificate']
  ]);
});

test('forced renewal writes DNS challenge, uploads SSL, and binds EdgeOne in order', async () => {
  const calls = [];
  const logs = [];
  let challengeOptions;
  const soon = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const apis = {
    teo: async (action, payload) => {
      calls.push(['teo', action, payload]);
      if (action === 'DescribeAccelerationDomains') {
        return {
          AccelerationDomains: ['demox.site', 'www.demox.site', '*.demox.site'].map((DomainName) => ({
            DomainName,
            Certificate: { List: [{ Type: 'upload', CertId: 'cert-old', ExpireTime: soon }] }
          }))
        };
      }
      return {};
    },
    dnspod: async (action, payload) => {
      calls.push(['dnspod', action, payload]);
      return action === 'CreateRecord' ? { RecordId: 42 } : {};
    },
    ssl: async (action, payload) => {
      calls.push(['ssl', action, payload]);
      if (action === 'DescribeCertificate') {
        return {
          CertificateId: 'cert-old',
          Domain: '*.demox.site',
          SubjectAltName: ['*.demox.site', 'demox.site'],
          CertEndTime: soon,
          Status: 1
        };
      }
      if (action === 'DescribeCertificates') return { Certificates: [] };
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
    logger: { log: (line) => logs.push(String(line)), warn() {} }
  });

  const result = await service.renew({ force: true });
  assert.equal(result.renewed, true);
  assert.equal(result.path, 'issue');
  assert.equal(result.oldCertId, 'cert-old');
  assert.equal(result.newCertId, 'cert-new');
  assert.equal(result.attempt, 'dns-01');
  assert.equal(logs.some((line) => line.includes('dry-run path=issue')), true);
  assert.equal(logs.join('\n').includes('private-key'), false);
  assert.equal(challengeOptions.skipChallengeVerification, true);
  assert.deepEqual(calls.map((item) => item.slice(0, 2)), [
    ['teo', 'DescribeAccelerationDomains'],
    ['scf', 'GetCustomDomain'],
    ['ssl', 'DescribeCertificate'],
    ['ssl', 'DescribeCertificates'],
    ['dnspod', 'CreateRecord'],
    ['dnspod', 'DeleteRecord'],
    ['ssl', 'UploadCertificate'],
    ['teo', 'ModifyHostsCertificate'],
    ['scf', 'GetCustomDomain'],
    ['scf', 'UpdateCustomDomain']
  ]);
  const create = calls.find((item) => item[1] === 'CreateRecord');
  const modify = calls.find((item) => item[1] === 'ModifyHostsCertificate');
  const update = calls.find((item) => item[1] === 'UpdateCustomDomain');
  assert.equal(create[2].SubDomain, '_acme-challenge');
  assert.equal(modify[2].ZoneId, 'zone-test');
  assert.deepEqual(modify[2].Hosts, ['demox.site', 'www.demox.site', '*.demox.site']);
  assert.deepEqual(modify[2].ServerCertInfo, [{ CertId: 'cert-new' }]);
  assert.equal(update[2].Domain, 'api.demox.site');
  assert.equal(update[2].CertConfig.CertificateId, 'cert-new');
  assert.equal(update[2].WafConfig.WafOpen, 'OPEN');
  assert.equal(update[2].EndpointsConfig.length, 1);
  assert.equal(calls.some((item) => item[1] === 'UploadCertificate' && JSON.stringify(item[2]).includes('BEGIN PRIVATE KEY') && logs.join('\n').includes('BEGIN PRIVATE KEY')), false);
});

test('different cert ids outside the window do not bind or issue', async () => {
  const calls = [];
  const future = new Date(Date.now() + 60 * 86_400_000).toISOString();
  const service = __private.createRenewService({
    config: config(),
    apis: {
      teo: async (action) => {
        calls.push(['teo', action]);
        return {
          AccelerationDomains: ['demox.site', 'www.demox.site', '*.demox.site'].map((DomainName) => ({
            DomainName,
            Certificate: { List: [{ Type: 'upload', CertId: 'cert-edge', ExpireTime: future }] }
          }))
        };
      },
      scf: async (action) => {
        calls.push(['scf', action]);
        if (action === 'GetCustomDomain') return scfDomain({ certId: 'cert-api' });
        throw new Error('should not update');
      },
      ssl: async (action) => {
        calls.push(['ssl', action]);
        if (action === 'DescribeCertificate') {
          return {
            CertificateId: 'cert-api',
            Domain: '*.demox.site',
            SubjectAltName: ['*.demox.site', 'demox.site'],
            CertEndTime: future,
            Status: 1
          };
        }
        throw new Error('should not list or upload');
      },
      dnspod: async () => { throw new Error('should not write dns'); }
    },
    logger: { log() {}, warn() {} }
  });

  const result = await service.renew();
  assert.equal(result.renewed, false);
  assert.equal(result.path, 'not-due');
  assert.equal(result.reason, 'not_due');
  assert.ok(result.targets.every((target) => target.due === false));
  assert.deepEqual(calls.map((item) => item.slice(0, 2)), [
    ['teo', 'DescribeAccelerationDomains'],
    ['scf', 'GetCustomDomain'],
    ['ssl', 'DescribeCertificate']
  ]);
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
      ssl: async (action) => {
        if (action === 'DescribeCertificate') {
          return { CertificateId: 'cert-old', CertEndTime: new Date(Date.now() + 5 * 86_400_000).toISOString(), Status: 1 };
        }
        if (action === 'DescribeCertificates') return { Certificates: [] };
        throw new Error('should not upload');
      },
      scf: async (action) => {
        if (action === 'GetCustomDomain') return scfDomain({ certId: 'cert-old' });
        throw new Error('should not bind');
      }
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
    (error) => error.step === 'bind-scf' && error.status === 'api not updated' && /api not updated/.test(error.message) && /SCF_CUSTOM_DOMAIN/.test(error.message)
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

const NOV1 = Date.parse('2026-11-01T03:17:00+08:00');
const EDGE_EXPIRES = '2027-01-13T00:00:00+08:00';
const API_EXPIRES = '2026-11-23 00:00:00';

function accelerationDomains(certId, expireTime, hosts = ['demox.site', 'www.demox.site', '*.demox.site']) {
  return {
    AccelerationDomains: hosts.map((DomainName) => ({
      DomainName,
      Certificate: { List: [{ Type: 'upload', CertId: certId, ExpireTime: expireTime }] }
    }))
  };
}

function sslCert({ id, begin, end, names = ['*.demox.site', 'demox.site'], status = 1, privateKey = '' }) {
  return {
    CertificateId: id,
    Domain: names[0],
    SubjectAltName: names,
    CertBeginTime: begin,
    CertEndTime: end,
    Status: status,
    ...(privateKey ? { CertificatePrivateKey: privateKey } : {})
  };
}

test('2026-11-01 reuses the fresh EdgeOne cert for the due api domain and does not issue', async () => {
  const calls = [];
  const logs = [];
  const edgeCert = sslCert({
    id: 'cert-edge',
    begin: '2026-10-15 00:00:00',
    end: '2027-01-13 00:00:00'
  });
  const service = __private.createRenewService({
    config: config(),
    clock: () => NOV1,
    apis: {
      teo: async (action, payload) => {
        calls.push(['teo', action, payload]);
        if (action === 'DescribeAccelerationDomains') return accelerationDomains('cert-edge', EDGE_EXPIRES);
        throw new Error('should not modify edgeone');
      },
      scf: async (action, payload) => {
        calls.push(['scf', action, payload]);
        if (action === 'GetCustomDomain') return scfDomain({ certId: 'cert-old', waf: true });
        return {};
      },
      ssl: async (action, payload) => {
        calls.push(['ssl', action, payload?.CertificateId || payload?.SearchKey || '']);
        if (action === 'DescribeCertificate' && payload.CertificateId === 'cert-old') {
          return sslCert({ id: 'cert-old', begin: '2026-08-25 00:00:00', end: API_EXPIRES, privateKey: '-----BEGIN PRIVATE KEY-----\nOLD\n-----END PRIVATE KEY-----' });
        }
        if (action === 'DescribeCertificate' && payload.CertificateId === 'cert-edge') return edgeCert;
        throw new Error(`unexpected ssl ${action}`);
      },
      dnspod: async () => { throw new Error('should not write dns'); }
    },
    acmeClient: acmeClientFor(async () => { throw new Error('should not issue'); }),
    logger: { log: (line) => logs.push(String(line)), warn() {} }
  });

  const result = await service.renew();
  assert.equal(result.renewed, false);
  assert.equal(result.reused, true);
  assert.equal(result.path, 'reuse-bound');
  assert.equal(result.newCertId, 'cert-edge');
  assert.equal(result.targets.find((target) => target.role === 'sites').days, 72);
  assert.equal(result.targets.find((target) => target.role === 'www').days, 72);
  assert.equal(result.targets.find((target) => target.role === 'apex').days, 72);
  assert.equal(result.targets.find((target) => target.role === 'api').days, 21);
  assert.equal(result.targets.find((target) => target.role === 'api').due, true);
  assert.equal(result.targets.filter((target) => target.kind === 'edgeone').every((target) => target.due === false), true);
  assert.equal(result.edgeone.updated, false);
  assert.equal(result.scf.updated, true);
  assert.equal(result.scf.previousCertId, 'cert-old');
  assert.deepEqual(calls.map((item) => item.slice(0, 2)), [
    ['teo', 'DescribeAccelerationDomains'],
    ['scf', 'GetCustomDomain'],
    ['ssl', 'DescribeCertificate'],
    ['ssl', 'DescribeCertificate'],
    ['scf', 'GetCustomDomain'],
    ['scf', 'UpdateCustomDomain']
  ]);
  const update = calls.find((item) => item[1] === 'UpdateCustomDomain');
  assert.equal(update[2].CertConfig.CertificateId, 'cert-edge');
  assert.equal(update[2].WafConfig.WafOpen, 'OPEN');
  assert.equal(calls.some((item) => item[1] === 'ModifyHostsCertificate' || item[1] === 'UploadCertificate' || item[1] === 'DescribeCertificates'), false);
  assert.match(logs.join('\n'), /dry-run path=reuse-bound certificateId=cert-edge due=api:api\.demox\.site/);
  assert.equal(logs.join('\n').includes('BEGIN PRIVATE KEY'), false);
});

test('api bind failure is an explicit api not updated failure and does not issue', async () => {
  const calls = [];
  const logged = [];
  const service = __private.createRenewService({
    config: config(),
    clock: () => NOV1,
    apis: {
      teo: async (action) => {
        calls.push(['teo', action]);
        if (action === 'DescribeAccelerationDomains') return accelerationDomains('cert-edge', EDGE_EXPIRES);
        return {};
      },
      scf: async (action) => {
        calls.push(['scf', action]);
        if (action === 'GetCustomDomain') return scfDomain({ certId: 'cert-old' });
        throw new Error('UnauthorizedOperation: scf:GetFunction is required by UpdateCustomDomain');
      },
      ssl: async (action, payload) => {
        calls.push(['ssl', action]);
        if (action === 'DescribeCertificate' && payload.CertificateId === 'cert-old') {
          return sslCert({ id: 'cert-old', begin: '2026-08-25 00:00:00', end: API_EXPIRES });
        }
        if (action === 'DescribeCertificate') return sslCert({ id: 'cert-edge', begin: '2026-10-15 00:00:00', end: '2027-01-13 00:00:00' });
        throw new Error('should not upload');
      },
      dnspod: async () => { throw new Error('should not write dns'); }
    },
    acmeClient: acmeClientFor(async () => { throw new Error('should not issue'); }),
    logger: { log() {}, warn() {}, error: (line) => logged.push(String(line)) }
  });

  await assert.rejects(
    () => service.renew(),
    (error) => {
      assert.equal(error.step, 'bind-scf');
      assert.equal(error.status, 'api not updated');
      assert.match(error.message, /api not updated/);
      assert.match(error.message, /scf:GetFunction/);
      return true;
    }
  );
  assert.equal(calls.some((item) => item[1] === 'UploadCertificate' || item[1] === 'CreateRecord' || item[1] === 'ModifyHostsCertificate'), false);

  logged.length = 0;
  await assert.rejects(
    () => __private.runRenewal({}, {
      config: config(),
      clock: () => NOV1,
      apis: {
        teo: async (action) => (action === 'DescribeAccelerationDomains' ? accelerationDomains('cert-edge', EDGE_EXPIRES) : {}),
        scf: async (action) => {
          if (action === 'GetCustomDomain') return scfDomain({ certId: 'cert-old' });
          throw new Error('UnauthorizedOperation: scf:GetFunction is required by UpdateCustomDomain');
        },
        ssl: async (action, payload) => {
          if (action === 'DescribeCertificate' && payload.CertificateId === 'cert-old') {
            return sslCert({ id: 'cert-old', begin: '2026-08-25 00:00:00', end: API_EXPIRES });
          }
          if (action === 'DescribeCertificate') return sslCert({ id: 'cert-edge', begin: '2026-10-15 00:00:00', end: '2027-01-13 00:00:00' });
          throw new Error('should not upload');
        },
        dnspod: async () => { throw new Error('should not write dns'); }
      },
      acmeClient: acmeClientFor(async () => { throw new Error('should not issue'); }),
      logger: { log() {}, warn() {}, error: (line) => logged.push(String(line)) }
    }),
    (error) => {
      assert.equal(error.code, 'CERT_RENEW_FAILED');
      assert.equal(error.status, 'api not updated');
      assert.match(error.message, /status=api not updated/);
      assert.match(error.message, /step=bind-scf/);
      assert.doesNotMatch(error.message, /BEGIN PRIVATE KEY/);
      return true;
    }
  );
  assert.match(logged.join('\n'), /status=api not updated/);
});

test('fresh issue runs when no bound or recent certificate can cover the due targets', async () => {
  const calls = [];
  const logs = [];
  const now = Date.parse('2026-11-01T03:17:00+08:00');
  const soon = '2026-11-20T00:00:00+08:00';
  const service = __private.createRenewService({
    config: config(),
    clock: () => now,
    apis: {
      teo: async (action, payload) => {
        calls.push(['teo', action]);
        if (action === 'DescribeAccelerationDomains') return accelerationDomains('cert-old', soon);
        return {};
      },
      dnspod: async (action) => {
        calls.push(['dnspod', action]);
        return action === 'CreateRecord' ? { RecordId: 9 } : {};
      },
      ssl: async (action) => {
        calls.push(['ssl', action]);
        if (action === 'DescribeCertificate') {
          return sslCert({ id: 'cert-old', begin: '2026-08-22 00:00:00', end: '2026-11-20 00:00:00' });
        }
        if (action === 'DescribeCertificates') {
          return {
            Certificates: [
              sslCert({ id: 'cert-old-upload', begin: '2026-08-01 00:00:00', end: '2026-11-20 00:00:00' }),
              sslCert({ id: 'cert-short', begin: '2026-10-30 00:00:00', end: '2026-12-20 00:00:00' }),
              sslCert({ id: 'cert-other', begin: '2026-10-30 00:00:00', end: '2027-01-30 00:00:00', names: ['example.com'] })
            ]
          };
        }
        if (action === 'UploadCertificate') return { CertificateId: 'cert-issued' };
        throw new Error(`unexpected ${action}`);
      },
      scf: async (action) => {
        calls.push(['scf', action]);
        if (action === 'GetCustomDomain') return scfDomain({ certId: 'cert-old' });
        return {};
      }
    },
    acmeClient: acmeClientFor(async (options) => {
      const challenge = { type: 'dns-01' };
      await options.challengeCreateFn({ identifier: { value: 'demox.site' } }, challenge, 'txt-value');
      await options.challengeRemoveFn({}, challenge);
      return 'certificate';
    }),
    wait: async () => {},
    logger: { log: (line) => logs.push(String(line)), warn() {} }
  });

  const result = await service.renew();
  assert.equal(result.path, 'issue');
  assert.equal(result.renewed, true);
  assert.equal(result.newCertId, 'cert-issued');
  assert.equal(result.attempt, 'dns-01');
  assert.match(logs.join('\n'), /dry-run path=issue/);
  assert.equal(logs.join('\n').includes('private-key'), false);
  assert.equal(calls.filter((item) => item[0] === 'dnspod' && item[1] === 'CreateRecord').length, 1);
  assert.equal(calls.filter((item) => item[1] === 'UploadCertificate').length, 1);
  assert.equal(calls.some((item) => item[1] === 'ModifyHostsCertificate'), true);
  assert.equal(calls.some((item) => item[1] === 'UpdateCustomDomain'), true);
});

test('a recent SSL certificate for the same names is reused and already-bound targets are skipped', async () => {
  const calls = [];
  const logs = [];
  const now = Date.parse('2026-11-01T03:17:00+08:00');
  const begin = '2026-10-30 00:00:00';
  const end = '2027-01-28 00:00:00';
  const service = __private.createRenewService({
    config: config(),
    clock: () => now,
    apis: {
      teo: async (action) => {
        calls.push(['teo', action]);
        if (action === 'DescribeAccelerationDomains') return accelerationDomains('cert-recent', '2026-11-18T00:00:00+08:00');
        throw new Error('should not modify edgeone');
      },
      scf: async (action) => {
        calls.push(['scf', action]);
        if (action === 'GetCustomDomain') return scfDomain({ certId: 'cert-recent' });
        throw new Error('should not update api');
      },
      ssl: async (action) => {
        calls.push(['ssl', action]);
        if (action === 'DescribeCertificate') {
          return sslCert({ id: 'cert-recent', begin, end: '2026-11-18 00:00:00' });
        }
        if (action === 'DescribeCertificates') {
          return { Certificates: [sslCert({ id: 'cert-recent', begin, end })] };
        }
        throw new Error('should not upload');
      },
      dnspod: async () => { throw new Error('should not write dns'); }
    },
    acmeClient: acmeClientFor(async () => { throw new Error('should not issue'); }),
    logger: { log: (line) => logs.push(String(line)), warn() {} }
  });

  const result = await service.renew();
  assert.equal(result.path, 'reuse-ssl');
  assert.equal(result.renewed, false);
  assert.equal(result.newCertId, 'cert-recent');
  assert.equal(result.edgeone.reason, 'already_bound');
  assert.equal(result.scf.reason, 'already_bound');
  assert.match(logs.join('\n'), /dry-run path=reuse-ssl certificateId=cert-recent/);
  assert.match(logs.join('\n'), /dry-run path=bind-edgeone .*skip=already_bound/);
  assert.match(logs.join('\n'), /dry-run path=bind-scf certificateId=cert-recent reason=skip=already_bound/);
  assert.equal(calls.some((item) => ['UploadCertificate', 'ModifyHostsCertificate', 'UpdateCustomDomain', 'CreateRecord'].includes(item[1])), false);
});

test('certificate helpers cover the wildcard, reject a different name set, and drop private keys', () => {
  assert.deepEqual(__private.edgeTargetsFor(__private.CONFIG).map((item) => item.host), [
    'demox.site',
    'www.demox.site',
    '*.demox.site'
  ]);
  assert.equal(__private.certCoversHost(['*.demox.site', 'demox.site'], 'api.demox.site'), true);
  assert.equal(__private.certCoversHost(['*.demox.site', 'demox.site'], 'www.demox.site'), true);
  assert.equal(__private.certCoversHost(['demox.site'], 'api.demox.site'), false);
  assert.equal(__private.sameDomainSet(['demox.site', '*.demox.site'], config()), true);
  assert.equal(__private.sameDomainSet(['*.demox.site'], config()), false);
  const now = Date.parse('2026-11-01T00:00:00+08:00');
  const selected = __private.selectReusableCertificate([
    { certificateId: 'too-old', domain: '*.demox.site', altNames: ['*.demox.site', 'demox.site'], beginTime: '2026-10-01 00:00:00', endTime: '2027-01-01 00:00:00', status: 1 },
    { certificateId: 'short', domain: '*.demox.site', altNames: ['*.demox.site', 'demox.site'], beginTime: '2026-10-30 00:00:00', endTime: '2026-12-15 00:00:00', status: 1 },
    { certificateId: 'reuse-me', domain: '*.demox.site', altNames: ['demox.site', '*.demox.site'], beginTime: '2026-10-28 00:00:00', endTime: '2027-01-26 00:00:00', status: 1 }
  ], config(), now);
  assert.equal(selected.certificateId, 'reuse-me');
  const view = __private.publicCertView({
    CertificateId: 'cert-x',
    Domain: '*.demox.site',
    SubjectAltName: ['*.demox.site', 'demox.site'],
    CertificatePrivateKey: '-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----',
    CertEndTime: API_EXPIRES
  });
  assert.equal(Object.hasOwn(view, 'CertificatePrivateKey'), false);
  assert.equal(JSON.stringify(view).includes('SECRET'), false);
  const alert = __private.formatRenewalAlert(Object.assign(new Error('boom -----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY----- Authorization: Bearer token-value'), { step: 'upload-ssl', status: 'api not updated' }));
  assert.match(alert, /status=api not updated/);
  assert.match(alert, /\[redacted-private-key\]/);
  assert.match(alert, /Authorization=\[redacted\]/);
  assert.equal(alert.includes('SECRET'), false);
  assert.equal(alert.includes('token-value'), false);
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
