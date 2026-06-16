const mysql = require('mysql2/promise');

// MySQL连接配置 —— 全部从环境变量读取，不在代码里保留任何真实连接参数。
// 缺失必填变量时直接抛错，避免静默连到错误的库或把默认值写死。
const REQUIRED_ENV = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  throw new Error(`缺少数据库环境变量: ${missing.join(', ')}`);
}

const dbConfig = {
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  // 让驱动把 DATETIME/TIMESTAMP 按 UTC 解析，配合下面 SET time_zone='+00:00'，
  // 保证读出的 created_at instant 正确，前端再用 toLocaleString 转本地时间，避免二次 +8。
  timezone: 'Z',
  ssl: {
    rejectUnauthorized: false // 允许自签名证书
  }
};

// 连接池（推荐用于生产环境）
let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...dbConfig,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
    // 每个新连接强制会话时区为 UTC，避免 TencentDB 默认 +08:00 导致的二次时区偏移
    pool.on('connection', (conn) => {
      conn.query("SET time_zone = '+00:00'");
    });
  }
  return pool;
}

// 获取数据库连接
async function getConnection() {
  const pool = getPool();
  return await pool.getConnection();
}

// 执行查询
async function query(sql, params = []) {
  const pool = getPool();
  const [results] = await pool.execute(sql, params);
  return results;
}

// 事务处理
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
