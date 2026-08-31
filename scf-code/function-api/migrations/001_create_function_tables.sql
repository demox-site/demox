-- User functions are metadata only; executable bundles remain immutable objects in COS.
CREATE TABLE IF NOT EXISTS demox_functions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  function_id VARCHAR(40) NOT NULL,
  owner_user_id VARCHAR(128) NOT NULL,
  website_id VARCHAR(128) NOT NULL,
  name VARCHAR(80) NOT NULL,
  slug VARCHAR(63) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  published_version INT UNSIGNED NULL,
  timeout_ms INT UNSIGNED NOT NULL DEFAULT 1000,
  memory_limit_bytes INT UNSIGNED NOT NULL DEFAULT 16777216,
  max_body_bytes INT UNSIGNED NOT NULL DEFAULT 65536,
  max_response_bytes INT UNSIGNED NOT NULL DEFAULT 262144,
  max_code_bytes INT UNSIGNED NOT NULL DEFAULT 262144,
  max_invocations_per_minute INT UNSIGNED NOT NULL DEFAULT 60,
  env_json JSON NOT NULL,
  allowed_outbound_hosts_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_demox_functions_function_id (function_id),
  UNIQUE KEY uq_demox_functions_website_slug (website_id, slug),
  KEY idx_demox_functions_owner (owner_user_id),
  KEY idx_demox_functions_website (website_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS demox_function_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  function_id VARCHAR(40) NOT NULL,
  version INT UNSIGNED NOT NULL,
  bundle_key VARCHAR(512) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  entrypoint VARCHAR(128) NOT NULL DEFAULT 'index.mjs',
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_demox_function_versions (function_id, version),
  KEY idx_demox_function_versions_status (function_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS demox_function_invocations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  function_id VARCHAR(40) NOT NULL,
  version INT UNSIGNED NOT NULL,
  owner_user_id VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
  request_bytes INT UNSIGNED NOT NULL DEFAULT 0,
  response_bytes INT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_demox_function_invocations_function_time (function_id, created_at),
  KEY idx_demox_function_invocations_owner_time (owner_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
