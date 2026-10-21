-- 平台函数密钥。只新增表，不改 demox_functions.env_json。
-- 表里只存密文（AES-256-GCM，密文自带 key id）。明文环境变量仍走 env_json。
-- 可重复执行。回滚：表保留即可，不要 DROP。旧代码不读这张表。

CREATE TABLE IF NOT EXISTS demox_function_platform_secrets (
  function_id VARCHAR(40) NOT NULL,
  secrets_json JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (function_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
