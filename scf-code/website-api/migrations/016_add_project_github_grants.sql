-- 项目 GitHub 用户授权
-- 授权绑定 GitHub 数字 ID。对方无需预先注册 Demox，使用 GitHub 登录后即可访问。

CREATE TABLE IF NOT EXISTS project_github_grants (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  project_id     BIGINT NOT NULL COMMENT 'projects.id',
  principal_type VARCHAR(16) NOT NULL DEFAULT 'user' COMMENT 'user',
  key_type       VARCHAR(32) NOT NULL DEFAULT 'github_id' COMMENT 'github_id',
  principal_key  VARCHAR(255) NOT NULL COMMENT 'GitHub 用户数字 ID',
  github_login   VARCHAR(255) DEFAULT NULL COMMENT '授权时的 GitHub 用户名',
  display_name   VARCHAR(120) DEFAULT NULL,
  avatar_url     VARCHAR(512) DEFAULT NULL,
  role           VARCHAR(16) NOT NULL DEFAULT 'member' COMMENT 'admin/member',
  created_by     VARCHAR(64) NOT NULL,
  active         TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_project_github_principal (project_id, principal_type, key_type, principal_key),
  INDEX idx_project_github_principal (principal_type, key_type, principal_key, active),
  INDEX idx_project_github_project (project_id, active, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目 GitHub 用户授权表';
