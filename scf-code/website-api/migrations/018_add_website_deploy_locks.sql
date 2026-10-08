-- 站点级部署互斥锁（带 TTL）。代码中 ensureWebsiteDeployLocksTable() 也会幂等创建。
CREATE TABLE IF NOT EXISTS website_deploy_locks (
  website_id  VARCHAR(32) NOT NULL,
  lock_token  CHAR(36) NOT NULL,
  owner_id    VARCHAR(64) DEFAULT NULL,
  expires_at  DATETIME NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (website_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站点部署互斥锁（带 TTL）';
