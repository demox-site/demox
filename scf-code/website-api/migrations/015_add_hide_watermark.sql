-- Pro / admin users can disable the injected "Powered by Demox" watermark per site.
DROP PROCEDURE IF EXISTS demox_add_hide_watermark;
DELIMITER //
CREATE PROCEDURE demox_add_hide_watermark()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'hide_watermark'
  ) THEN
    ALTER TABLE websites
      ADD COLUMN hide_watermark TINYINT(1) NOT NULL DEFAULT 0
      COMMENT 'Whether the hosted-page Demox watermark is hidden';
  END IF;
END //
DELIMITER ;
CALL demox_add_hide_watermark();
DROP PROCEDURE IF EXISTS demox_add_hide_watermark;
