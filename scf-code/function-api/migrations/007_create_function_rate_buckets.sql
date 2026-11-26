-- Run before deploying the function API. Previous versions ignore this table.
CREATE TABLE IF NOT EXISTS demox_function_rate_buckets (
  bucket_key BINARY(32) NOT NULL,
  timestamps_json JSON NOT NULL,
  expires_at_ms BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (bucket_key),
  KEY idx_demox_function_rate_bucket_expiry (expires_at_ms)
) ENGINE=InnoDB;
