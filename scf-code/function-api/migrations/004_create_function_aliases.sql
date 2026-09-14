CREATE TABLE IF NOT EXISTS demox_function_aliases (
  function_id VARCHAR(40) NOT NULL,
  alias VARCHAR(32) NOT NULL,
  version INT UNSIGNED NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (function_id, alias),
  KEY idx_demox_function_aliases_version (function_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
