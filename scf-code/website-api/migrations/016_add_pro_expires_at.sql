-- 专业会员到期时间。NULL = 永久（存量开通保持不变）。
-- 线上 handleSetUserRole / handleListUserRoles / handleGetUsage 会幂等补列。

ALTER TABLE user_roles
  ADD COLUMN pro_expires_at DATETIME DEFAULT NULL COMMENT '专业会员到期时间，NULL=永久' AFTER roles;
