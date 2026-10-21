-- 密码登录失败限速（按账号）。运行时不再建表。发布前用本文件在库里建表。
-- email_hash = sha256(规范化邮箱)，不存明文；时间字段是毫秒时间戳（BIGINT），不受会话时区影响。
-- 可重复执行。表不存在时登录限速会 fail-open，并尝试往 login_throttle_fail_open 记一行。
CREATE TABLE IF NOT EXISTS login_throttle (
  email_hash CHAR(64) NOT NULL PRIMARY KEY,
  failures INT NOT NULL DEFAULT 0,
  last_failed_at BIGINT NOT NULL DEFAULT 0,
  locked_until BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- fail-open 旁表计数：限速放行时写一行（op / code / 毫秒时间），不依赖日志。
-- 定时巡检：SELECT COUNT(*) FROM login_throttle_fail_open WHERE created_at_ms > ?；大于 0 就报警。
CREATE TABLE IF NOT EXISTS login_throttle_fail_open (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  op VARCHAR(16) NOT NULL,
  code VARCHAR(64) NOT NULL,
  created_at_ms BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_created_at_ms (created_at_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
