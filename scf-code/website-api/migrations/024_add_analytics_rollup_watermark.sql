-- 024：analytics-rollup-5m 的水位和永久缺口。
--
-- 这份文件还没有在任何库执行过。运行时不执行本文件，也不执行任何 CREATE。
-- 云帆用临时授权先在 develop 库跑，再在 production 库跑；每个环境发布前，对应的库必须已经跑完。
-- 顺序：授权 → 执行本文件 → 撤权，权限 diff 为 0。然后才 deploy-develop 或 promote 到那个环境。
-- promote 到 production 之前确认 ANALYTICS_RAW_ENABLED=1，并且 ANALYTICS_RAW_BUCKET_ID 已配置。
-- 运行时账号只要 site_analytics_rollup_watermark 和 site_analytics_rollup_gaps 的 SELECT、INSERT、UPDATE。
-- 合并 master 不会自动发布（FUNCTION_API_AUTO_DEPLOY 未设置）。上线是手动 stage → deploy-develop → promote。
-- 告警试打只在 develop 上做，不打 production，也不打 api.demox.site。
--
-- 定时器每次从 site_analytics_rollup_watermark.watermark_ms 往后补，最多回看 48 小时。
-- 水位是「已结清」的 5 分钟边界（UTC epoch ms）：早于它的窗口要么已经计入计数器，
-- 要么已经记成下面的缺口。水位比 now 再留出约 2 分钟，因为原始事件先盖 ts、后上传 COS。
-- 没有水位时从 48 小时前开始。initial_ms 记下这一次的扫描起点。weekStart 早于 initial_ms 时，分类为暂定周（before_watermark），不把那段时间写成 over_48h 缺口。
-- 水位早于 now-48h：把 [水位, now-48h) 写入 site_analytics_rollup_gaps（reason=over_48h，status='active'），然后从 48 小时前接着补。
-- 单个原始对象超过 256KB：不读内容，记 reason=object_too_large，object_key 为对象键，status='active'。
-- 单次未处理对象仍超过 2000：只处理按时间排好的前 2000 个，水位停在第一个没结清的 5 分钟窗口，不写缺口。
-- 列表比水位再往前一个小时，避免盖在 HH:59:58、数分钟后才出现的对象被丢掉。
-- ts 早于水位、但还没入库的对象仍然计入（INFO analytics-rollup-5m … code=LATE_OBJECT）。object_key 主键保证重复跑不会计两次。
--
-- 暂定周分类只数有效缺口：status = 'active' AND reason <> 'test_fire'。
-- 统计周从周一 00:00 UTC+8 开始，到下一周同一时刻结束（结束不含）。
-- 这和 stat_date 的切日一致：周一 00:00 UTC+8 = 周日 16:00Z。
-- 例如 2026-10-05（周一）那一周：
--   weekStart = 2026-10-04 16:00:00.000（UTC）
--   weekEnd   = 2026-10-11 16:00:00.000（UTC）
-- gap_start / gap_end 是 UTC（会话 time_zone = '+00:00'）。查询参数必须是 UTC 字符串，不要传 UTC+8 墙上时间。
-- 1. 水位和起点。
--      SELECT watermark_ms, initial_ms FROM site_analytics_rollup_watermark WHERE id = 1。
--    没有行、initial_ms 为空，或 weekStart < initial_ms → 这周在开始追踪之前 → 暂定周（before_watermark）。
--    没有行，或 watermark_ms < weekEnd（UTC epoch ms，结束不含）→ 本周还没汇总完 → 暂定周。
-- 2. 永久缺口。下面的查询有任意一行 → 暂定周（数据确有缺失，补跑也不会回来）：
--      SELECT gap_start, gap_end, reason, object_key
--      FROM site_analytics_rollup_gaps
--      WHERE gap_end > '2026-10-04 16:00:00.000'
--        AND gap_start < '2026-10-11 16:00:00.000'
--        AND status = 'active'
--        AND reason <> 'test_fire';
-- 3. initial_ms <= weekStart，水位已经 >= weekEnd，且没有重叠的有效缺口 → WAU 可以当最终值。
-- 临时积压不写这张表。积压消化完、水位盖过本周后，暂定周分类会自己去掉。
-- 代码里的同一判断：analyticsRollupCoverage（index.js，测试出口 _analyticsRollupForTest.coverage）。
--
-- 告警试打写的缺口行：reason='test_fire'，object_key='test-fire:<YYYYMMDD>-<n>'，status='active'。
-- 例如 object_key 为 test-fire:<YYYYMMDD>-<n>。试打结束后只作废，不删行：
--      UPDATE site_analytics_rollup_gaps SET status = 'void'
--      WHERE reason = 'test_fire' AND object_key = 'test-fire:<YYYYMMDD>-<n>';
-- status 取值 active 或 void，默认 active。void 的行不进入暂定周分类。
--
-- 只建表，不改已有表。可重复执行。
-- 回滚：DROP TABLE site_analytics_rollup_gaps; DROP TABLE site_analytics_rollup_watermark;
CREATE TABLE IF NOT EXISTS site_analytics_rollup_watermark (
  id TINYINT NOT NULL PRIMARY KEY,
  watermark_ms BIGINT NOT NULL COMMENT 'UTC epoch ms，对齐到 5 分钟；早于它的窗口已结清',
  initial_ms BIGINT NOT NULL COMMENT '第一次开始汇总的 UTC epoch ms；更早的周分类为暂定周',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='访问汇总水位（analytics-rollup-5m）';

CREATE TABLE IF NOT EXISTS site_analytics_rollup_gaps (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  gap_start DATETIME(3) NOT NULL COMMENT '缺口起点（UTC，含）',
  gap_end DATETIME(3) NOT NULL COMMENT '缺口终点（UTC，不含）',
  reason VARCHAR(32) NOT NULL COMMENT 'over_48h | object_too_large | test_fire',
  object_key VARCHAR(512) NOT NULL DEFAULT '' COMMENT 'object_too_large 时为对象键；试打为 test-fire:<YYYYMMDD>-<n>；窗口级缺口为空串',
  status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT 'active | void',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_analytics_rollup_gap (reason, gap_start, object_key),
  INDEX idx_analytics_rollup_gap_range (gap_start, gap_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='访问汇总永久缺口；status=active 且 reason 不是 test_fire 的行计入暂定周分类';
