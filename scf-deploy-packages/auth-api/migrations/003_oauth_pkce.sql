ALTER TABLE oauth_auth_codes
  ADD COLUMN code_challenge VARCHAR(128) NULL;
