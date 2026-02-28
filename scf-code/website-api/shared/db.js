const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || 'DATABASE_HOST',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER || 'DATABASE_USER',
      password: process.env.MYSQL_PASSWORD || 'DATABASE_PASSWORD',
      database: process.env.MYSQL_DATABASE || 'DATABASE_NAME',
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0
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
