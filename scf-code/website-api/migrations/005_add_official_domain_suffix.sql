-- 官方域名池：允许同一个前缀在不同官方域名后缀下分别绑定。
-- 例如 my-site.demox.site 与 my-site.vibeme.cn 可以绑定到不同站点。
-- 执行前请确认已完成 001_add_subdomain.sql。

ALTER TABLE websites
  ADD COLUMN subdomain_domain VARCHAR(255) NOT NULL DEFAULT 'demox.site'
  COMMENT '官方域名后缀，如 demox.site / vibeme.cn';

UPDATE websites
  SET subdomain_domain = 'demox.site'
  WHERE subdomain_domain IS NULL OR subdomain_domain = '';

-- 旧索引只按 subdomain 全局唯一；新模型改成同一官方域名下唯一。
ALTER TABLE websites
  DROP INDEX uniq_subdomain;

ALTER TABLE websites
  ADD UNIQUE KEY uniq_official_subdomain (subdomain_domain, subdomain);
