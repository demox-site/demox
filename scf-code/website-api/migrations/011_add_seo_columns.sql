-- 站点 SEO 元信息：用于边缘函数在回源时向 <head> 注入 meta 标签
-- seo_title  为空时回退到 websites.name
-- og_image   存外链 URL，不存 COS key
DROP PROCEDURE IF EXISTS ensure_seo_columns;
DELIMITER $$
CREATE PROCEDURE ensure_seo_columns() BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'seo_title'
  ) THEN
    ALTER TABLE websites ADD COLUMN seo_title VARCHAR(255) NULL COMMENT 'SEO 标题，为空回退 name';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'seo_description'
  ) THEN
    ALTER TABLE websites ADD COLUMN seo_description VARCHAR(500) NULL COMMENT 'SEO 描述（meta description）';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'og_image'
  ) THEN
    ALTER TABLE websites ADD COLUMN og_image VARCHAR(500) NULL COMMENT 'OG 图片外链 URL';
  END IF;
END$$
DELIMITER ;
CALL ensure_seo_columns();
DROP PROCEDURE IF EXISTS ensure_seo_columns;
