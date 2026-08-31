-- A custom domain belongs to a project, not a single site.
-- The root host (demox.aigc.sx.cn) and extra labels (subsite.demox.aigc.sx.cn)
-- are routed to sites in that project via custom_domain_routes.

CREATE TABLE IF NOT EXISTS custom_domains (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT NOT NULL,
  hostname VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT 'pending | active',
  created_by VARCHAR(64) NOT NULL,
  verified_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_custom_domain_hostname (hostname),
  INDEX idx_custom_domains_project (project_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Customer root hostnames owned by a project';

CREATE TABLE IF NOT EXISTS custom_domain_routes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  custom_domain_id BIGINT NOT NULL,
  label VARCHAR(63) NOT NULL DEFAULT '' COMMENT 'empty = project root host',
  website_id BIGINT NOT NULL COMMENT 'websites.id',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_custom_domain_route (custom_domain_id, label),
  INDEX idx_custom_domain_routes_website (website_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Root and subdomain routes under a project domain';
