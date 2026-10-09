-- 部署按天的一次性回填（v14，Chief 2026-10-09 批准）。
--
-- 服务端部署埋点（product_events 里 page=server:* 的 deploy_success / deploy_fail）从
-- website v12 上线（2026-10-09 13:25:21 UTC+8）才开始写。在这之前的日子，get_admin_bi 按站点记录读时补算，
-- 本表再补一份从 CLS 日志算出的「成功部署次数」（CLS 只保留 7 天，不存下来就没了）。
--
-- 只建表，不改、不删任何已有表或数据。可重复执行。
-- 读：get_admin_bi 对埋点之前的每一天取 max(站点记录补算, 本表 total)，从不相加。
-- 回滚：DROP TABLE deploy_daily_backfill;（看板自动退回只用站点记录补算，表不存在时不报错）
CREATE TABLE IF NOT EXISTS deploy_daily_backfill (
  stat_date     DATE NOT NULL COMMENT 'UTC+8 日期',
  source        VARCHAR(16) NOT NULL DEFAULT 'log_backfill' COMMENT '数据来源；目前只有 log_backfill',
  total         INT UNSIGNED NOT NULL COMMENT '当天成功部署次数（按请求去重）',
  fail          INT UNSIGNED DEFAULT NULL COMMENT '失败次数；日志里认不出，NULL = 未知',
  channel       VARCHAR(16) DEFAULT NULL COMMENT '渠道；日志里没有，NULL = 未知',
  partial       TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = 这天只覆盖了一部分（日志开始那天 / 埋点开始那天）',
  covered_from  DATETIME DEFAULT NULL COMMENT '这一行覆盖的起点（UTC）',
  covered_until DATETIME DEFAULT NULL COMMENT '这一行覆盖的终点（UTC，不含）',
  note          VARCHAR(255) DEFAULT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (stat_date, source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='部署按天回填（埋点之前，只有总数）';
