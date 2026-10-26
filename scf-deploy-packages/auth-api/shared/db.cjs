const mysql = require('mysql2/promise');
const { businessMysqlConfig, assertMysqlConfig } = require('./env-pairs.cjs');

// 业务库优先 BUSINESS_MYSQL_*，未配置时回落 MYSQL_*。
const cfg = assertMysqlConfig(businessMysqlConfig(), '业务库');

const dbConfig = {
  host: cfg.host,
  port: cfg.port,
  user: cfg.user,
  password: cfg.password,
  database: cfg.database,
  timezone: 'Z',
  ssl: {
    rejectUnauthorized: false
  }
};

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...dbConfig,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
    pool.on('connection', (conn) => {
      conn.query("SET time_zone = '+00:00'");
    });
  }
  return pool;
}

async function getConnection() {
  const pool = getPool();
  return await pool.getConnection();
}

async function query(sql, params = []) {
  const pool = getPool();
  const [results] = await pool.execute(sql, params);
  return results;
}

async function transaction(callback) {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  dbConfig,
  getConnection,
  query,
  transaction,
  getPool
};
