-- 产品漏斗埋点表（匿名，不需要用户 ID）。
-- 用于追踪从落地页访问到部署成功的转化漏斗：
--   landing_view → deploy_click → deploy_success / deploy_fail
--   landing_view → example_click
--   deploy_success → feedback_copy
-- visitor_id 由前端 localStorage 生成，用于跨页面串联同一访客的漏斗路径。
-- 可重复执行；线上也可通过 website-api 的 migrate_product_events action 执行同等逻辑。

CREATE TABLE IF NOT EXISTS product_events (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_name  VARCHAR(64) NOT NULL COMMENT '事件名（landing_view/deploy_click/deploy_success/deploy_fail/example_click/feedback_copy）',
  visitor_id  VARCHAR(64) NOT NULL DEFAULT '' COMMENT '匿名访客ID（前端 localStorage 生成）',
  page        VARCHAR(128) NOT NULL DEFAULT '' COMMENT '触发页面路径',
  props       JSON NULL COMMENT '附加属性（JSON）',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_product_events_name_time (event_name, created_at),
  INDEX idx_product_events_visitor (visitor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品漏斗埋点';
