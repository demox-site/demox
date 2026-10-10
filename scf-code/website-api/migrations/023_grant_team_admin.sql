-- 023：给团队管理员账号授 admin（2026-10-10）。
--
-- 和 website-api 里的 ensureTeamAdminGrant() 等价：website 函数每次 5 分钟统计定时器会顺带检查，
-- 只读代码常量 TEAM_ADMIN_USER_ID（不读环境变量）。数据库在 VPC 里，平时不用手动执行本文件；
-- 只有在能直连库、又不想等定时器时才用。
--
-- 用法：把下一行的空字符串改成团队账号的用户 ID 再执行。保持空字符串 = 什么也不做。
-- 幂等：已经是 admin 不写；只追加 admin，不删已有角色；用户不存在不写。
-- 审计：真正改了角色才在 admin_audit_log 记一行（operator_uid=system:023，via=migration）。
-- 只授一次：已经有这个 ID 的 grant_team_admin 成功记录就跳过（避免把后台手动撤掉的 admin 加回来）。
-- 回滚：在后台把这个账号的 admin 角色去掉（并把常量改回空字符串）。
SET @team_admin_user_id = '';

SET @team_admin_target = CONCAT('uid=', @team_admin_user_id, ';role=admin');
SET @team_admin_ok = (
  @team_admin_user_id <> ''
  AND EXISTS (SELECT 1 FROM users WHERE id = @team_admin_user_id)
  AND NOT EXISTS (SELECT 1 FROM admin_audit_log WHERE action = 'grant_team_admin' AND target = @team_admin_target AND success = 1)
  AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = @team_admin_user_id AND JSON_CONTAINS(roles, '"admin"'))
);

START TRANSACTION;

INSERT INTO user_roles (user_id, roles, updated_at)
SELECT @team_admin_user_id, JSON_ARRAY('user', 'admin'), NOW()
FROM DUAL
WHERE @team_admin_ok
  AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = @team_admin_user_id);

UPDATE user_roles
SET roles = JSON_ARRAY_APPEND(roles, '$', 'admin'), updated_at = NOW()
WHERE @team_admin_ok
  AND user_id = @team_admin_user_id
  AND NOT JSON_CONTAINS(roles, '"admin"');

INSERT INTO admin_audit_log (operator_uid, auth_method, action, kind, target, via, status_code, success)
SELECT 'system:023', 'system', 'grant_team_admin', 'write', @team_admin_target, 'migration', 200, 1
FROM DUAL
WHERE @team_admin_ok;

COMMIT;
