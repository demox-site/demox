-- 飞书 OAuth 身份字段。可重复执行。

DROP PROCEDURE IF EXISTS demox_add_feishu_identity;
DELIMITER //
CREATE PROCEDURE demox_add_feishu_identity()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'feishu_open_id'
  ) THEN
    ALTER TABLE users
      ADD COLUMN feishu_open_id VARCHAR(128) DEFAULT NULL COMMENT '飞书应用内用户唯一标识';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'feishu_union_id'
  ) THEN
    ALTER TABLE users
      ADD COLUMN feishu_union_id VARCHAR(128) DEFAULT NULL COMMENT '飞书开发者维度用户唯一标识';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'feishu_name'
  ) THEN
    ALTER TABLE users
      ADD COLUMN feishu_name VARCHAR(255) DEFAULT NULL COMMENT '飞书用户名称';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'uniq_feishu_open_id'
  ) THEN
    ALTER TABLE users ADD UNIQUE KEY uniq_feishu_open_id (feishu_open_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'uniq_feishu_union_id'
  ) THEN
    ALTER TABLE users ADD UNIQUE KEY uniq_feishu_union_id (feishu_union_id);
  END IF;
END //
DELIMITER ;
CALL demox_add_feishu_identity();
DROP PROCEDURE IF EXISTS demox_add_feishu_identity;
