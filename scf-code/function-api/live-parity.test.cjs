'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const parity = JSON.parse(readFileSync(path.join(__dirname, 'live-parity.json'), 'utf8'));

test('redacted live config names the VPC and merged environment keys', () => {
  const config = JSON.parse(readFileSync(path.join(__dirname, 'live-config.json'), 'utf8'));
  assert.equal(config.unifiedRecommendation.vpc.vpcId, 'vpc-bwtrj6fb');
  assert.equal(config.unifiedRecommendation.vpc.subnetId, 'subnet-nzrl3bbq');
  assert.equal(config.unifiedRecommendation.memorySize, 512);
  assert.equal(config.unifiedRecommendation.timeout, 300);
  assert.ok(config.unifiedRecommendation.environmentKeys.includes('MYSQL_HOST'));
  assert.ok(config.unifiedRecommendation.environmentKeys.includes('ACME_EMAIL'));
  assert.equal(JSON.stringify(config).includes('Secret'), false);
});

test('recorded live entrypoints still match the expected local files', () => {
  for (const entry of parity.entries) {
    const localSha256 = createHash('sha256').update(readFileSync(path.join(repoRoot, entry.localPath))).digest('hex');
    if (entry.exactMatch === false) {
      assert.notEqual(localSha256, entry.liveSha256, `${entry.name} was expected to differ from live`);
      continue;
    }
    assert.equal(localSha256, entry.liveSha256, `${entry.name} drifted from the recorded live entrypoint`);
  }
});
