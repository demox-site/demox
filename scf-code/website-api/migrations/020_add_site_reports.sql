-- Hosted-page abuse reports from the Demox watermark.
--
-- Already exists in production: website-api creates this table itself
-- (CREATE TABLE IF NOT EXISTS in ensureSiteReportsTable, index.js) the first time
-- reports are used, live since website function v9 (2026-09-20). This file only
-- records the schema in git. It is idempotent and safe to run again.
--
-- Numbering: written locally as 018_add_site_reports.sql; renumbered to 020 because
-- 018 is add_website_deploy_locks (PR #4) and 019 is add_gallery_cards (admin gallery).
CREATE TABLE IF NOT EXISTS site_reports (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  website_id VARCHAR(32) NOT NULL,
  reason VARCHAR(16) NOT NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  page_url VARCHAR(1024) NOT NULL DEFAULT '',
  host VARCHAR(255) NOT NULL DEFAULT '',
  ip_hash CHAR(64) NOT NULL DEFAULT '',
  user_agent VARCHAR(512) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_reports_site_time (website_id, created_at),
  INDEX idx_reports_ip_time (ip_hash, created_at),
  INDEX idx_reports_status_time (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='托管页水印举报';
