-- 站点停用理由与停用时间。运行时不再补列。可重复执行。
-- 两列均可空，已有行保持 NULL。与 78c3446 兼容：旧代码写 visibility 时不读这两列。
-- 回滚：列保留即可，不要 DROP。

DROP PROCEDURE IF EXISTS demox_add_website_disable_columns;
DELIMITER //
CREATE PROCEDURE demox_add_website_disable_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'disable_reason'
  ) THEN
    ALTER TABLE websites ADD COLUMN disable_reason VARCHAR(500) NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'disabled_at'
  ) THEN
    ALTER TABLE websites ADD COLUMN disabled_at TIMESTAMP NULL;
  END IF;
END //
DELIMITER ;
CALL demox_add_website_disable_columns();
DROP PROCEDURE IF EXISTS demox_add_website_disable_columns;
