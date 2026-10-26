-- 项目数据库的 HTTP Basic 密码（不是公网 MySQL 协议账号）。
-- 用户名是项目对外 ID；公网不开放 db.demox.site:3306。
-- 密码只存密文。可重复执行。

CREATE TABLE IF NOT EXISTS project_db_credentials (
  project_id BIGINT UNSIGNED NOT NULL,
  password_enc TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
