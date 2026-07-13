-- 个人访问令牌（Personal Access Token）表。
-- 用于 CLI / MCP Server 非交互部署鉴权。
-- PAT 本身是带 jti 声明的长效 JWT（与 JWT_SECRET 同密钥签名），
-- 故 website-api 现有 getUserId/authenticate 无需改动即可解析；
-- 吊销通过 jti 在 exports.main 中查表拦截。
-- 可重复执行；线上也可通过 website-api 的 migrate_access_tokens action 执行同等逻辑。

CREATE TABLE IF NOT EXISTS access_tokens (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id      VARCHAR(64) NOT NULL COMMENT '所属用户ID',
  name         VARCHAR(255) NOT NULL COMMENT '令牌名称（用户自取）',
  jti          VARCHAR(64) NOT NULL COMMENT 'JWT ID，用于吊销查表',
  prefix       VARCHAR(32) NOT NULL COMMENT '令牌前缀（展示用，不可还原）',
  expires_at   TIMESTAMP NULL DEFAULT NULL COMMENT '过期时间',
  last_used_at TIMESTAMP NULL DEFAULT NULL COMMENT '最近使用时间',
  revoked_at   TIMESTAMP NULL DEFAULT NULL COMMENT '吊销时间',
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_access_tokens_jti (jti),
  INDEX idx_access_tokens_user (user_id),
  INDEX idx_access_tokens_prefix (prefix)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='个人访问令牌';
