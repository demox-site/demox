-- 项目维度默认回填：
-- 1) 新建 projects 表：一行 = 一个用户项目。
-- 2) websites 表新增 project_id。
-- 3) 为 users 表与 websites 表中出现过的每个 user_id 创建 slug=default 的默认项目。
-- 4) 将现有未归属项目的站点回填到各自用户的 default 项目。
--
-- 可重复执行；线上也可通过 website-api 的 migrate_default_projects action 执行同等逻辑。

CREATE TABLE IF NOT EXISTS projects (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(20) DEFAULT NULL COMMENT '对外展示的随机项目ID',
  user_id     VARCHAR(64) NOT NULL COMMENT '项目归属用户ID',
  name        VARCHAR(255) NOT NULL DEFAULT 'default' COMMENT '项目显示名称',
  slug        VARCHAR(64) NOT NULL DEFAULT 'default' COMMENT '用户内唯一项目标识',
  description TEXT DEFAULT NULL,
  color       VARCHAR(32) DEFAULT NULL,
  icon        VARCHAR(64) DEFAULT NULL,
  archived    TINYINT(1) NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_project_key (project_key),
  UNIQUE KEY uniq_user_project_slug (user_id, slug),
  INDEX idx_projects_user_id (user_id),
  INDEX idx_projects_archived (archived)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户项目表';

DROP PROCEDURE IF EXISTS demox_add_project_key;
DELIMITER //
CREATE PROCEDURE demox_add_project_key()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'project_key'
  ) THEN
    ALTER TABLE projects ADD COLUMN project_key VARCHAR(20) DEFAULT NULL COMMENT '对外展示的随机项目ID' AFTER id;
  END IF;
END //
DELIMITER ;
CALL demox_add_project_key();
DROP PROCEDURE IF EXISTS demox_add_project_key;

DROP PROCEDURE IF EXISTS demox_add_project_id;
DELIMITER //
CREATE PROCEDURE demox_add_project_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'project_id'
  ) THEN
    ALTER TABLE websites ADD COLUMN project_id BIGINT DEFAULT NULL COMMENT '所属项目(projects.id)';
  END IF;
END //
DELIMITER ;
CALL demox_add_project_id();
DROP PROCEDURE IF EXISTS demox_add_project_id;

DROP PROCEDURE IF EXISTS demox_add_project_indexes;
DELIMITER //
CREATE PROCEDURE demox_add_project_indexes()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND INDEX_NAME = 'uniq_project_key'
  ) THEN
    ALTER TABLE projects ADD UNIQUE KEY uniq_project_key (project_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND INDEX_NAME = 'idx_project_id'
  ) THEN
    ALTER TABLE websites ADD INDEX idx_project_id (project_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND INDEX_NAME = 'idx_user_project_updated'
  ) THEN
    ALTER TABLE websites ADD INDEX idx_user_project_updated (user_id, project_id, updated_at);
  END IF;
END //
DELIMITER ;
CALL demox_add_project_indexes();
DROP PROCEDURE IF EXISTS demox_add_project_indexes;

-- 给 users 表里的每个用户创建 default 项目。
INSERT INTO projects (project_key, user_id, name, slug)
SELECT DISTINCT CONCAT('P', UPPER(SUBSTRING(REPLACE(UUID(), '-', ''), 1, 9))), id, 'default', 'default'
FROM users
WHERE id IS NOT NULL AND id <> ''
ON DUPLICATE KEY UPDATE slug = slug;

-- 给仅出现在 websites 表里的历史 user_id 也创建 default 项目。
INSERT INTO projects (project_key, user_id, name, slug)
SELECT DISTINCT CONCAT('P', UPPER(SUBSTRING(REPLACE(UUID(), '-', ''), 1, 9))), user_id, 'default', 'default'
FROM websites
WHERE user_id IS NOT NULL AND user_id <> ''
ON DUPLICATE KEY UPDATE slug = slug;

-- 给已有项目补随机对外 ID。
UPDATE projects
SET project_key = CONCAT('P', UPPER(SUBSTRING(REPLACE(UUID(), '-', ''), 1, 9)))
WHERE project_key IS NULL OR project_key = '';

-- 将所有尚未归属项目的站点放入各自用户的 default 项目。
UPDATE websites w
JOIN projects p ON p.user_id = w.user_id AND p.slug = 'default'
SET w.project_id = p.id
WHERE w.project_id IS NULL;
