-- 项目飞书主体授权
-- 用户授权使用 open_id；部门授权使用 open_department_id。
-- 邮箱仅用于查找飞书用户，授权不要求预先存在 Demox 账号。

CREATE TABLE IF NOT EXISTS project_feishu_grants (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  project_id     BIGINT NOT NULL COMMENT 'projects.id',
  principal_type VARCHAR(16) NOT NULL COMMENT 'user/department',
  key_type       VARCHAR(32) NOT NULL COMMENT 'open_id/open_department_id',
  principal_key  VARCHAR(255) NOT NULL COMMENT '标准化后的飞书主体标识',
  tenant_key     VARCHAR(128) DEFAULT NULL COMMENT '授权主体所属飞书租户',
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
