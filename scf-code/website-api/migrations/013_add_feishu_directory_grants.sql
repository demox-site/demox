-- 飞书项目授权只使用稳定主体标识：用户 open_id、部门 open_department_id。
-- 邮箱只用于搜索用户；tenant_key 用于阻止跨租户匹配。

DELIMITER //
CREATE PROCEDURE migrate_feishu_directory_grants()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_feishu_grants' AND COLUMN_NAME = 'tenant_key'
  ) THEN
    ALTER TABLE project_feishu_grants
      ADD COLUMN tenant_key VARCHAR(128) DEFAULT NULL COMMENT '授权主体所属飞书租户' AFTER principal_key;
  END IF;

  ALTER TABLE project_feishu_grants
    MODIFY COLUMN key_type VARCHAR(32) NOT NULL COMMENT 'open_id/open_department_id';

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'feishu_department_ids'
  ) THEN
    ALTER TABLE users
      ADD COLUMN feishu_department_ids TEXT DEFAULT NULL COMMENT '飞书直属部门及祖先部门 open_department_id JSON' AFTER feishu_email;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'feishu_directory_synced_at'
  ) THEN
    ALTER TABLE users
      ADD COLUMN feishu_directory_synced_at TIMESTAMP NULL DEFAULT NULL COMMENT '飞书部门身份同步时间' AFTER feishu_department_ids;
  END IF;
END //
DELIMITER ;

CALL migrate_feishu_directory_grants();
DROP PROCEDURE migrate_feishu_directory_grants;

-- 旧授权缺少可信租户归属或使用了可变邮箱/整租户语义，默认停用并要求重新授权。
UPDATE project_feishu_grants
SET active = 0, updated_at = NOW()
WHERE active = 1 AND (
  tenant_key IS NULL
  OR principal_type NOT IN ('user', 'department')
  OR key_type NOT IN ('open_id', 'open_department_id')
);
