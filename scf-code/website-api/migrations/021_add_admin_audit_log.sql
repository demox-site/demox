-- 管理员操作审计（v13）。
--
-- 每次管理员操作写一行：谁（operator_uid）、什么时候（created_at，UTC）、做了什么（action）、
-- 对谁（target）、用什么凭证（auth_method：jwt 网页登录 / pat 个人令牌 / oauth CLI·MCP）、
-- 走的是哪条管理员通道（via：admin_only 仅管理员接口 / override 用管理员身份操作别人的资源）、
-- 结果（status_code、success）。target 只记 ID、角色这类字段，不记邮箱、token、密钥。
--
-- website-api v13 在第一次写审计时也会 CREATE TABLE IF NOT EXISTS（ensureAdminAuditTable），
-- 本文件与之一致，可重复执行。发布时先执行本迁移，再切 website 别名。
-- 只追加，不更新、不删除；读接口 list_admin_audit 只读。
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  operator_uid VARCHAR(64) NOT NULL,
  auth_method VARCHAR(8) NOT NULL,
  action VARCHAR(64) NOT NULL,
  kind VARCHAR(8) NOT NULL DEFAULT 'write',
  target VARCHAR(255) NOT NULL DEFAULT '',
  via VARCHAR(64) NOT NULL DEFAULT 'admin_only',
  status_code SMALLINT NOT NULL DEFAULT 0,
  success TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_admin_audit_time (created_at),
  INDEX idx_admin_audit_operator_time (operator_uid, created_at),
  INDEX idx_admin_audit_action_time (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理员操作审计';
