-- User functions choose a runtime (quickjs inline, or a dedicated runtime SCF).
-- Custom HTTP prefixes and a single timer name let a site function take over
-- platform paths such as /auth without sharing the router process.
ALTER TABLE demox_functions
  ADD COLUMN runtime VARCHAR(16) NOT NULL DEFAULT 'nodejs' AFTER slug,
  ADD COLUMN routes_json JSON NULL AFTER env_json,
  ADD COLUMN triggers_json JSON NULL AFTER routes_json,
  ADD COLUMN timer_name VARCHAR(64) NULL AFTER triggers_json;

ALTER TABLE demox_functions
  ADD UNIQUE KEY uq_demox_functions_timer_name (timer_name);
