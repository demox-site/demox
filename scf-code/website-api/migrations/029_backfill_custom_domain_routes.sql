-- 旧 custom_domains.website_id 行补进 custom_domain_routes。
-- 新库的 custom_domains 没有 website_id 列时，本文件什么也不写。
-- INSERT IGNORE 可重复执行。不改表结构。
-- 先执行 017_add_custom_domains.sql，再执行本文件。
-- 回滚：不需要。多出来的路由行是从旧列复制的，删行会让旧域名失去路由。

DROP PROCEDURE IF EXISTS demox_backfill_custom_domain_routes;
DELIMITER //
CREATE PROCEDURE demox_backfill_custom_domain_routes()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'custom_domains'
      AND COLUMN_NAME = 'website_id'
  ) THEN
    INSERT IGNORE INTO custom_domain_routes (custom_domain_id, label, website_id)
    SELECT id, '', website_id FROM custom_domains WHERE website_id IS NOT NULL;
  END IF;
END //
DELIMITER ;
CALL demox_backfill_custom_domain_routes();
DROP PROCEDURE IF EXISTS demox_backfill_custom_domain_routes;
