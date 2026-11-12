const mysql = require('mysql2/promise');
const { businessMysqlConfig, assertMysqlConfig } = require('./env-pairs.js');

// 业务库优先读 BUSINESS_MYSQL_*，未配置时回落 MYSQL_*（网关切分完成前兼容）。
// 缺失必填变量时直接抛错，避免静默连错库。
const cfg = assertMysqlConfig(businessMysqlConfig(), '业务库');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      // 让驱动把 DATETIME/TIMESTAMP 字符串按 UTC 解析，
      // 配合下面的 SET time_zone='+00:00'，保证读出的 Date instant 正确，
      // 不再依赖 MySQL 会话时区或 SCF 容器的 TZ。前端再用 toLocaleString 转本地时间。
      timezone: 'Z',
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0
    });
    // 每个新连接强制会话时区为 UTC，避免 TencentDB 默认 +08:00 导致的二次时区偏移
    pool.on('connection', (conn) => {
      conn.query("SET time_zone = '+00:00'");
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const pool = getPool();
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function transaction(callback) {
  const pool = getPool();
  const conn = await pool.getConnection();
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

// GET_LOCK 绑在连接上。query() 每次可能拿到池里不同的连接，锁和释放必须走同一条。
async function withConnection(fn) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

module.exports = { query, transaction, withConnection };
