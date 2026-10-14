-- 首页作品墙。后台可配置；公开接口只返回 enabled=1。
-- 生产环境可能不会执行包里的 SQL 文件，website-api 首次访问时也会
-- CREATE TABLE IF NOT EXISTS（ensureGalleryCardsTable）。本文件与那段 DDL 保持一致。
--
-- title_en / caption_en 从第一天就有：英文首页在远程卡片替换内置卡片时
-- 仍能用英文文案，没有英文则回退到 title / caption。
-- 编号 019 在 master 上仍空着（020 的注释把这一号留给作品墙）。
CREATE TABLE IF NOT EXISTS gallery_cards (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  title_en VARCHAR(200) NOT NULL DEFAULT '',
  url VARCHAR(512) NOT NULL,
  href VARCHAR(512) NOT NULL DEFAULT '',
  preview VARCHAR(16) NOT NULL DEFAULT 'image',
  image VARCHAR(512) NOT NULL DEFAULT '',
  caption VARCHAR(500) NOT NULL DEFAULT '',
  caption_en VARCHAR(500) NOT NULL DEFAULT '',
  row_num TINYINT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_gallery_row_order (row_num, sort_order),
  INDEX idx_gallery_enabled (enabled, row_num, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='首页作品墙卡片';
