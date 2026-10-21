-- 项目内数据库：表目录和行都在现有 MySQL 里，按 project_id 分开。
-- 不新建物理库。可重复执行。只建新表，不改已有表。
-- 与 78c3446 兼容：旧代码若仍执行 CREATE TABLE IF NOT EXISTS，遇到已存在的表会直接跳过。
-- 回滚：表保留即可。未使用这两张表的旧代码不受影响。

CREATE TABLE IF NOT EXISTS project_tables (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(64) NOT NULL,
  columns_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_project_table_name (project_id, name),
  KEY idx_project_tables_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS project_rows (
  project_id BIGINT UNSIGNED NOT NULL,
  table_id BIGINT UNSIGNED NOT NULL,
  pk VARCHAR(255) NOT NULL,
  doc JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, table_id, pk),
  KEY idx_project_rows_table (table_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
