-- 自定义子域名前缀功能：websites 表新增 subdomain 列
-- 用户可给站点设置一个好记的前缀 label，通过 https://{label}.demox.site 访问。
-- 在 MySQL 执行一次即可。

ALTER TABLE websites
  ADD COLUMN subdomain VARCHAR(63) DEFAULT NULL COMMENT '自定义子域名前缀(label)，访问 {label}.demox.site';

-- 唯一约束：一个前缀只能绑定一个站点。
-- NULL 不占用唯一性（MySQL 允许多行 NULL），未设置前缀的站点不受影响。
ALTER TABLE websites
  ADD UNIQUE KEY uniq_subdomain (subdomain);
