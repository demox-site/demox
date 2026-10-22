-- 项目数据库的连接密码。主机、端口和用户名不落在这张表里：
-- 主机是 db.demox.site，端口是 3306，用户名是项目对外 ID。
-- 密码只存密文。可重复执行。

CREATE TABLE IF NOT EXISTS project_db_credentials (
  project_id BIGINT UNSIGNED NOT NULL,
  password_enc TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
