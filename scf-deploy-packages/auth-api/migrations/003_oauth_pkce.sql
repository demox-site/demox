-- PKCE code_challenge on oauth_auth_codes. Nullable, so old rows and old inserts stay valid.
-- Idempotent. Runtime no longer adds this column.
-- Rollback: leave the column. Do not drop it; current login code reads it.

DROP PROCEDURE IF EXISTS demox_add_oauth_code_challenge;
DELIMITER //
CREATE PROCEDURE demox_add_oauth_code_challenge()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oauth_auth_codes' AND COLUMN_NAME = 'code_challenge'
  ) THEN
    ALTER TABLE oauth_auth_codes
      ADD COLUMN code_challenge VARCHAR(128) NULL;
  END IF;
END //
DELIMITER ;
CALL demox_add_oauth_code_challenge();
DROP PROCEDURE IF EXISTS demox_add_oauth_code_challenge;
