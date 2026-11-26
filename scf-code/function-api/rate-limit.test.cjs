'use strict';

const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createMysqlFunctionRepository, InMemoryFunctionRepository } = require('./repository.js');

test('local repository keeps a bounded number of buckets and reclaims expired ones', async () => {
  const repository = new InMemoryFunctionRepository();
  const start = 1_000_000;
  for (let i = 0; i < 10_000; i += 1) {
    assert.equal(await repository.reserveInvocation('test-function', String(i), 1, () => start), true);
  }
  assert.equal(await repository.reserveInvocation('test-function', 'new', 1, () => start + 59_999), false);
  assert.equal(await repository.reserveInvocation('test-function', '0', 1, () => start + 59_999), false);
  assert.equal(await repository.reserveInvocation('test-function', 'new', 1, () => start + 60_000), true);
  assert.equal(repository.rateBuckets.size, 1);
});

const mysqlUrl = process.env.FUNCTION_RATE_LIMIT_TEST_MYSQL;
test('MySQL reservations share a sliding window across independent pools', { skip: !mysqlUrl }, async (t) => {
  const mysql = require('mysql2/promise');
  const pools = [mysql.createPool(mysqlUrl), mysql.createPool(mysqlUrl)];
  t.after(() => Promise.all(pools.map((pool) => pool.end())));
  const migration = readFileSync(path.join(__dirname, 'migrations/007_create_function_rate_buckets.sql'), 'utf8');
  await pools[0].query(migration);
  const repositories = pools.map((pool) => createMysqlFunctionRepository({
    query: async (...args) => (await pool.query(...args))[0],
    transaction: async (run) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await run(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  }));

  const functionId = randomUUID();
  const start = Date.now();
  const primaryClient = '203.0.113.10';
  const reserve = (index, time, client = primaryClient) =>
    repositories[index].reserveInvocation(functionId, client, 2, () => time);

  assert.equal(await reserve(0, start), true);
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => reserve(i % 2, start + 30_000)));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await reserve(1, start + 59_999), false);
  assert.equal(await reserve(1, start + 59_999, '203.0.113.11'), true);
  assert.equal(await reserve(0, start + 60_000), true);
  assert.equal(await reserve(0, start + 60_000), false);

  t.mock.method(Math, 'random', () => 0);
  assert.equal(await reserve(1, start + 120_000, '203.0.113.12'), true);
  const oldKey = createHash('sha256').update(`${functionId}:${primaryClient}`).digest();
  const [expired] = await pools[0].query('SELECT bucket_key FROM demox_function_rate_buckets WHERE bucket_key = ?', [oldKey]);
  assert.deepEqual(expired, []);
});
