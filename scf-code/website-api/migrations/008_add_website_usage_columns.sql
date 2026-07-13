-- 站点用量统计：websites 表新增 file_count / storage_size 列。
-- 部署时写入本次上传包的文件数与体积，供「用量与套餐」页聚合展示真实用量。
-- 历史站点为 NULL，聚合时以 0 计；新部署/重部署会回填。
-- 可重复执行；线上也可通过 website-api 的 migrate_website_usage action 执行同等逻辑。

DROP PROCEDURE IF EXISTS demox_add_website_file_count;
DELIMITER //
CREATE PROCEDURE demox_add_website_file_count()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'file_count'
  ) THEN
    ALTER TABLE websites ADD COLUMN file_count INT DEFAULT NULL COMMENT '本次部署的文件数量（单次上传包）';
  END IF;
END //
DELIMITER ;
CALL demox_add_website_file_count();
DROP PROCEDURE IF EXISTS demox_add_website_file_count;

DROP PROCEDURE IF EXISTS demox_add_website_storage_size;
DELIMITER //
CREATE PROCEDURE demox_add_website_storage_size()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'storage_size'
  ) THEN
    ALTER TABLE websites ADD COLUMN storage_size BIGINT DEFAULT NULL COMMENT '本次部署的上传包体积(字节)';
  END IF;
END //
DELIMITER ;
CALL demox_add_website_storage_size();
DROP PROCEDURE IF EXISTS demox_add_website_storage_size;
