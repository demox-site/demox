-- 项目协作：成员角色与邮箱邀请
-- ---------------------------------------------------------------------------
-- 1) project_members：记录项目成员，role = owner / admin / member。
-- 2) project_invitations：记录按邮箱发出的待处理邀请。
-- 3) project_feishu_grants：记录无需 Demox 账号的飞书用户/组织授权。
-- 4) 将现有 projects.user_id 回填为 owner 成员。
--
-- 可重复执行；线上也可通过 website-api 的 migrate_project_collaboration action 执行同等逻辑。

CREATE TABLE IF NOT EXISTS project_members (
  project_id BIGINT NOT NULL COMMENT 'projects.id',
  user_id    VARCHAR(64) NOT NULL COMMENT '成员用户ID',
  role       VARCHAR(16) NOT NULL DEFAULT 'member' COMMENT 'owner/admin/member',
  invited_by VARCHAR(64) DEFAULT NULL,
  joined_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id),
  INDEX idx_project_members_user (user_id, role),
  INDEX idx_project_members_project_role (project_id, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目成员表';

CREATE TABLE IF NOT EXISTS project_invitations (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  project_id  BIGINT NOT NULL COMMENT 'projects.id',
  email       VARCHAR(255) NOT NULL COMMENT '受邀邮箱，小写',
  role        VARCHAR(16) NOT NULL DEFAULT 'member' COMMENT 'admin/member',
  token       VARCHAR(64) DEFAULT NULL,
  invited_by  VARCHAR(64) NOT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/accepted/canceled/expired',
  accepted_by VARCHAR(64) DEFAULT NULL,
  accepted_at TIMESTAMP NULL DEFAULT NULL,
  expires_at  TIMESTAMP NULL DEFAULT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_project_invite_status (project_id, email, status),
  INDEX idx_project_invitations_email_status (email, status),
  INDEX idx_project_invitations_project_status (project_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目邀请表';

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

INSERT INTO project_members (project_id, user_id, role, invited_by, joined_at, updated_at)
SELECT id, user_id, 'owner', user_id, created_at, NOW()
FROM projects
WHERE user_id IS NOT NULL AND user_id <> ''
ON DUPLICATE KEY UPDATE role = 'owner', updated_at = NOW();

UPDATE project_members
SET role = 'member'
WHERE role NOT IN ('owner', 'admin', 'member');
