-- websites.deployed_size：当前部署解压后的体积（字节）。
-- 运行时不再补列。可重复执行。只加可空列，已有行保持 NULL。
-- 与 78c3446 兼容：旧代码不依赖这一列的 NOT NULL，缺省为 NULL。
-- 回滚：列保留即可，不要 DROP。

DROP PROCEDURE IF EXISTS demox_add_website_deployed_size;
DELIMITER //
CREATE PROCEDURE demox_add_website_deployed_size()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'deployed_size'
  ) THEN
    ALTER TABLE websites
      ADD COLUMN deployed_size BIGINT DEFAULT NULL COMMENT '当前部署解压后文件体积(字节)';
  END IF;
END //
DELIMITER ;
CALL demox_add_website_deployed_size();
DROP PROCEDURE IF EXISTS demox_add_website_deployed_size;
