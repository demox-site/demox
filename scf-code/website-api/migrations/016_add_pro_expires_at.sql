-- 专业会员到期时间。NULL = 永久（存量开通保持不变）。
-- 可重复执行。运行时不再补列。
-- 与 78c3446 兼容：列为 NULL 时旧代码把会员视为永久。
-- 回滚：列保留即可，不要 DROP。

DROP PROCEDURE IF EXISTS demox_add_pro_expires_at;
DELIMITER //
CREATE PROCEDURE demox_add_pro_expires_at()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_roles' AND COLUMN_NAME = 'pro_expires_at'
  ) THEN
    ALTER TABLE user_roles
      ADD COLUMN pro_expires_at DATETIME DEFAULT NULL COMMENT '专业会员到期时间，NULL=永久' AFTER roles;
  END IF;
END //
DELIMITER ;
CALL demox_add_pro_expires_at();
DROP PROCEDURE IF EXISTS demox_add_pro_expires_at;
