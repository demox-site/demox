-- 项目飞书授权匹配所需的租户和认证邮箱字段。可重复执行。

DROP PROCEDURE IF EXISTS demox_add_feishu_grant_identity;
DELIMITER //
CREATE PROCEDURE demox_add_feishu_grant_identity()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'feishu_tenant_key'
  ) THEN
    ALTER TABLE users
      ADD COLUMN feishu_tenant_key VARCHAR(128) DEFAULT NULL COMMENT '飞书租户唯一标识';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'feishu_email'
  ) THEN
    ALTER TABLE users
      ADD COLUMN feishu_email VARCHAR(255) DEFAULT NULL COMMENT '飞书认证邮箱';
  END IF;
END //
DELIMITER ;
CALL demox_add_feishu_grant_identity();
DROP PROCEDURE IF EXISTS demox_add_feishu_grant_identity;
