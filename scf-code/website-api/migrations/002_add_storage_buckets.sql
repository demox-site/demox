-- 存储桶注册制：多云存储的第一步
-- ---------------------------------------------------------------------------
-- 1) 新建 storage_buckets 表：一行 = 一个可部署目标（COS / S3 兼容）。
-- 2) websites 表新增 bucket_id：站点关联到具体桶。
-- 3) 数据回填（把现有 COS 桶注册为默认桶 + 关联存量站点）由 website-api 的
--    migrate_buckets handler 用环境变量授权执行，不在本脚本里写死桶名/密钥。
--
-- 在 MySQL 执行一次即可；建表/加列均为幂等写法。

CREATE TABLE IF NOT EXISTS storage_buckets (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(64)  NOT NULL COMMENT '展示名，如 "腾讯云成都(默认)"',
  provider      VARCHAR(16)  NOT NULL DEFAULT 'cos' COMMENT 'cos | s3',
  bucket        VARCHAR(128) NOT NULL COMMENT '桶名，如 resource-game-1307257815',
  region        VARCHAR(64)  DEFAULT NULL COMMENT '区域，如 ap-chengdu；S3 兼容可为 auto',
  endpoint      VARCHAR(255) DEFAULT NULL COMMENT 'S3 兼容服务的 endpoint；COS 留空',
  origin_host   VARCHAR(255) DEFAULT NULL COMMENT '边缘回源域，如 sites.demox.site',
  force_path_style TINYINT(1) DEFAULT NULL COMMENT 'S3 path-style；NULL=适配器默认',
  secret_id_enc  TEXT DEFAULT NULL COMMENT 'AES-GCM 加密的 SecretId；NULL=用 SCF env 凭证',
  secret_key_enc TEXT DEFAULT NULL COMMENT 'AES-GCM 加密的 SecretKey；NULL=用 SCF env 凭证',
  is_default    TINYINT(1) NOT NULL DEFAULT 0 COMMENT '默认桶：新部署落这里',
  enabled       TINYINT(1) NOT NULL DEFAULT 1,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='多云存储桶注册表';

-- websites 关联到桶。NULL = 旧数据，迁移时回填为默认桶 id。
-- 用存储过程包一层以兼容不支持 ADD COLUMN IF NOT EXISTS 的 MySQL 版本。
DROP PROCEDURE IF EXISTS demox_add_bucket_id;
DELIMITER //
CREATE PROCEDURE demox_add_bucket_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'bucket_id'
  ) THEN
    ALTER TABLE websites ADD COLUMN bucket_id INT DEFAULT NULL COMMENT '所属存储桶(storage_buckets.id)；NULL=默认桶';
    ALTER TABLE websites ADD INDEX idx_bucket_id (bucket_id);
  END IF;
END //
DELIMITER ;
CALL demox_add_bucket_id();
DROP PROCEDURE IF EXISTS demox_add_bucket_id;
