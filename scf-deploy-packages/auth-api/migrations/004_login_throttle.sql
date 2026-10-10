-- 密码登录失败限速（按账号）。auth-api 首次用到时也会 CREATE TABLE IF NOT EXISTS，这里留一份给手工建表/审计。
-- email_hash = sha256(规范化邮箱)，不存明文；时间字段是毫秒时间戳（BIGINT），不受会话时区影响。
CREATE TABLE IF NOT EXISTS login_throttle (
  email_hash CHAR(64) NOT NULL PRIMARY KEY,
  failures INT NOT NULL DEFAULT 0,
  last_failed_at BIGINT NOT NULL DEFAULT 0,
  locked_until BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
