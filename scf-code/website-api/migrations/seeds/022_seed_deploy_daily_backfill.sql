-- 一次性写入 deploy_daily_backfill（先执行 022_add_deploy_daily_backfill.sql）。
-- 数据：/workspace/v14/log-backfill.json（只有按天聚合，不含任何日志原文、令牌或用户信息）。
-- 覆盖 2026-10-02T13:10:03+08:00 至 2026-10-09T13:25:21+08:00（UTC+8）；10-02 只从日志开始时算，10-09 只算埋点开始之前。
-- fail / channel 日志里认不出，写 NULL（未知），不是 0。
-- 可重复执行：INSERT IGNORE，已有的行不覆盖。只写这一张表。
-- 回滚：DELETE FROM deploy_daily_backfill WHERE source = 'log_backfill';
INSERT IGNORE INTO deploy_daily_backfill
  (stat_date, source, total, fail, channel, partial, covered_from, covered_until, note)
VALUES
  ('2026-10-02', 'log_backfill', 0, NULL, NULL, 1, '2026-10-02 05:10:03', '2026-10-02 16:00:00', 'CLS demox-user-nodejs, uploadedCount responses, dedup by RequestId'),
  ('2026-10-03', 'log_backfill', 0, NULL, NULL, 0, '2026-10-02 16:00:00', '2026-10-03 16:00:00', 'CLS demox-user-nodejs, uploadedCount responses, dedup by RequestId'),
  ('2026-10-04', 'log_backfill', 24, NULL, NULL, 0, '2026-10-03 16:00:00', '2026-10-04 16:00:00', 'CLS demox-user-nodejs, uploadedCount responses, dedup by RequestId'),
  ('2026-10-05', 'log_backfill', 18, NULL, NULL, 0, '2026-10-04 16:00:00', '2026-10-05 16:00:00', 'CLS demox-user-nodejs, uploadedCount responses, dedup by RequestId'),
  ('2026-10-06', 'log_backfill', 22, NULL, NULL, 0, '2026-10-05 16:00:00', '2026-10-06 16:00:00', 'CLS demox-user-nodejs, uploadedCount responses, dedup by RequestId'),
  ('2026-10-07', 'log_backfill', 136, NULL, NULL, 0, '2026-10-06 16:00:00', '2026-10-07 16:00:00', 'CLS demox-user-nodejs, uploadedCount responses, dedup by RequestId'),
  ('2026-10-08', 'log_backfill', 124, NULL, NULL, 0, '2026-10-07 16:00:00', '2026-10-08 16:00:00', 'CLS demox-user-nodejs, uploadedCount responses, dedup by RequestId'),
  ('2026-10-09', 'log_backfill', 26, NULL, NULL, 1, '2026-10-08 16:00:00', '2026-10-09 05:25:21', 'CLS demox-user-nodejs, uploadedCount responses, dedup by RequestId');
