-- Bind functions to a website. Additive and idempotent.
-- website_id stays NULL so 78c3446 inserts that omit the column still succeed.
-- The new unique key allows multiple NULLs. It does not drop
-- uq_demox_functions_owner_slug: dropping that key is not backward compatible
-- with code that still relies on owner+slug uniqueness. Leave the old key.
-- Rollback: leave the column and keys in place. Do not drop them.

DROP PROCEDURE IF EXISTS demox_add_function_website_binding;
DELIMITER //
CREATE PROCEDURE demox_add_function_website_binding()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demox_functions' AND COLUMN_NAME = 'website_id'
  ) THEN
    ALTER TABLE demox_functions
      ADD COLUMN website_id VARCHAR(128) NULL AFTER owner_user_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demox_functions' AND INDEX_NAME = 'idx_demox_functions_website'
  ) THEN
    ALTER TABLE demox_functions
      ADD KEY idx_demox_functions_website (website_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demox_functions' AND INDEX_NAME = 'uq_demox_functions_website_slug'
  ) THEN
    ALTER TABLE demox_functions
      ADD UNIQUE KEY uq_demox_functions_website_slug (website_id, slug);
  END IF;
END //
DELIMITER ;
CALL demox_add_function_website_binding();
DROP PROCEDURE IF EXISTS demox_add_function_website_binding;
