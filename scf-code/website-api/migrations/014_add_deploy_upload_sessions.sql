-- 分块部署上传会话。ZIP 分块暂存在目标站点对应的对象存储桶中，完成时校验并部署。
-- 会话记录用于权限绑定、并发 complete 互斥、响应丢失后的幂等返回和过期清理。

CREATE TABLE IF NOT EXISTS deploy_upload_sessions (
  upload_id     CHAR(36) NOT NULL,
  user_id       VARCHAR(64) NOT NULL,
  website_id    VARCHAR(32) NOT NULL,
  file_name     VARCHAR(255) NOT NULL,
  project_id    VARCHAR(64) DEFAULT NULL,
  bucket_id     INT DEFAULT NULL,
  total_size    BIGINT UNSIGNED NOT NULL,
  chunk_size    INT UNSIGNED NOT NULL,
  total_chunks  INT UNSIGNED NOT NULL,
  sha256        CHAR(64) NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'UPLOADING',
  result_json   LONGTEXT DEFAULT NULL,
  error_message VARCHAR(500) DEFAULT NULL,
  expires_at    TIMESTAMP NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (upload_id),
  INDEX idx_deploy_upload_user_status (user_id, status, updated_at),
  INDEX idx_deploy_upload_expires (expires_at, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='部署分块上传会话';
