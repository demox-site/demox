-- roles.project_limit / roles.max_db_bytes（d3875c7 额度）。
-- NULL = 不限。普通用户角色在列为 NULL 时写成默认值：3 个项目、100MiB（104857600 字节）。
-- 已有非 NULL 值不覆盖。可重复执行。只加可空列。
-- 与 78c3446 兼容：旧代码的 roles INSERT 不带这两列，NULL 默认值让旧 INSERT 仍然成功。
-- 回滚：列保留即可，不要 DROP。新代码未部署时旧代码不读这两列。

DROP PROCEDURE IF EXISTS demox_add_role_quota_columns;
DELIMITER //
CREATE PROCEDURE demox_add_role_quota_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roles' AND COLUMN_NAME = 'project_limit'
  ) THEN
    ALTER TABLE roles
      ADD COLUMN project_limit INT NULL COMMENT '最大未归档自有项目数，NULL=不限';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roles' AND COLUMN_NAME = 'max_db_bytes'
  ) THEN
    ALTER TABLE roles
      ADD COLUMN max_db_bytes BIGINT NULL COMMENT '单项目数据库字节上限，NULL=不限';
  END IF;

  UPDATE roles
     SET project_limit = COALESCE(project_limit, 3),
         max_db_bytes = COALESCE(max_db_bytes, 104857600)
   WHERE id = 'user' OR name IN ('user', '普通用户');
END //
DELIMITER ;
CALL demox_add_role_quota_columns();
DROP PROCEDURE IF EXISTS demox_add_role_quota_columns;
