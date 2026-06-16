-- 站点公开/私有访问控制
-- ---------------------------------------------------------------------------
-- 1) websites 表新增 visibility：public = 匿名可访问，private = 仅 owner/admin。
-- 2) 边缘函数读取 resolve_subdomain 返回的 visibility，在边缘层做访问拦截。
-- 3) 线上也可通过 website-api 的 migrate_site_visibility action 执行同等逻辑。

DROP PROCEDURE IF EXISTS demox_add_site_visibility;
DELIMITER //
CREATE PROCEDURE demox_add_site_visibility()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'visibility'
  ) THEN
    ALTER TABLE websites
      ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT 'public'
      COMMENT '站点访问级别: public/private';
  END IF;

  UPDATE websites
    SET visibility = 'public'
    WHERE visibility IS NULL OR visibility NOT IN ('public', 'private');

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND INDEX_NAME = 'idx_visibility'
  ) THEN
    ALTER TABLE websites ADD INDEX idx_visibility (visibility);
  END IF;
END //
DELIMITER ;
CALL demox_add_site_visibility();
DROP PROCEDURE IF EXISTS demox_add_site_visibility;
