const mysql = require('mysql2/promise');

// 数据库连接参数全部来自环境变量，代码里不保留任何真实值。
// 缺失必填变量时直接抛错，避免静默连错库。
const REQUIRED_ENV = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  throw new Error(`缺少数据库环境变量: ${missing.join(', ')}`);
}

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
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

module.exports = { query, transaction };
