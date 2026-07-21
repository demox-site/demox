-- 项目飞书主体授权
-- 用户授权可使用飞书邮箱/open_id/union_id；组织授权使用 tenant_key。
-- 授权在飞书登录身份与主体匹配时直接生效，不要求预先存在 Demox 账号。

CREATE TABLE IF NOT EXISTS project_feishu_grants (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  project_id     BIGINT NOT NULL COMMENT 'projects.id',
  principal_type VARCHAR(16) NOT NULL COMMENT 'user/organization',
  key_type       VARCHAR(16) NOT NULL COMMENT 'email/open_id/union_id/tenant_key',
  principal_key  VARCHAR(255) NOT NULL COMMENT '标准化后的飞书主体标识',
  display_name   VARCHAR(120) DEFAULT NULL,
  role           VARCHAR(16) NOT NULL DEFAULT 'member' COMMENT 'admin/member',
  created_by     VARCHAR(64) NOT NULL,
  active         TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_project_feishu_principal (project_id, principal_type, key_type, principal_key),
  INDEX idx_project_feishu_principal (principal_type, key_type, principal_key, active),
  INDEX idx_project_feishu_project (project_id, active, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目飞书主体授权表';
