-- User functions choose a runtime (quickjs inline, or a dedicated runtime SCF).
-- Custom HTTP prefixes and a single timer name let a site function take over
-- platform paths such as /auth without sharing the router process.
-- Idempotent. Additive only: nullable / defaulted columns and one unique key.
-- Safe to re-run on a database where the runtime used to add these columns.
-- Multiple NULLs are allowed in uq_demox_functions_timer_name.
-- Rollback: leave the columns and key in place. Do not drop them; 78c3446 reads them.

DROP PROCEDURE IF EXISTS demox_add_function_runtime_columns;
DELIMITER //
CREATE PROCEDURE demox_add_function_runtime_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demox_functions' AND COLUMN_NAME = 'runtime'
  ) THEN
    ALTER TABLE demox_functions
      ADD COLUMN runtime VARCHAR(16) NOT NULL DEFAULT 'nodejs' AFTER slug;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demox_functions' AND COLUMN_NAME = 'routes_json'
  ) THEN
    ALTER TABLE demox_functions
      ADD COLUMN routes_json JSON NULL AFTER env_json;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demox_functions' AND COLUMN_NAME = 'triggers_json'
  ) THEN
    ALTER TABLE demox_functions
      ADD COLUMN triggers_json JSON NULL AFTER routes_json;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demox_functions' AND COLUMN_NAME = 'timer_name'
  ) THEN
    ALTER TABLE demox_functions
      ADD COLUMN timer_name VARCHAR(64) NULL AFTER triggers_json;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demox_functions' AND INDEX_NAME = 'uq_demox_functions_timer_name'
  ) THEN
    ALTER TABLE demox_functions
      ADD UNIQUE KEY uq_demox_functions_timer_name (timer_name);
  END IF;
END //
DELIMITER ;
CALL demox_add_function_runtime_columns();
DROP PROCEDURE IF EXISTS demox_add_function_runtime_columns;
