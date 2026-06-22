-- Site analytics aggregation tables. Raw events are stored separately in object storage when enabled.
CREATE TABLE IF NOT EXISTS site_daily_stats (
  website_id VARCHAR(32) NOT NULL,
  stat_date DATE NOT NULL,
  views BIGINT NOT NULL DEFAULT 0,
  visitors BIGINT NOT NULL DEFAULT 0,
  badge_clicks BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (website_id, stat_date),
  INDEX idx_site_daily_date (stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站点按日访问聚合';

CREATE TABLE IF NOT EXISTS site_referrer_daily_stats (
  website_id VARCHAR(32) NOT NULL,
  stat_date DATE NOT NULL,
  referrer_host VARCHAR(255) NOT NULL DEFAULT 'direct',
  views BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (website_id, stat_date, referrer_host),
  INDEX idx_referrer_daily_date (stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站点按日来源聚合';

CREATE TABLE IF NOT EXISTS site_path_daily_stats (
  website_id VARCHAR(32) NOT NULL,
  stat_date DATE NOT NULL,
  path VARCHAR(512) NOT NULL,
  views BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (website_id, stat_date, path),
  INDEX idx_path_daily_date (stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站点按日路径聚合';


CREATE TABLE IF NOT EXISTS site_country_daily_stats (
  website_id VARCHAR(32) NOT NULL,
  stat_date DATE NOT NULL,
  country VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
  views BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (website_id, stat_date, country),
  INDEX idx_country_daily_date (stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站点按日地区聚合';


CREATE TABLE IF NOT EXISTS site_province_daily_stats (
  website_id VARCHAR(32) NOT NULL,
  stat_date DATE NOT NULL,
  country VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
  province VARCHAR(64) NOT NULL DEFAULT 'UNKNOWN',
  views BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (website_id, stat_date, country, province),
  INDEX idx_province_daily_date (stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站点按日省级地区聚合';


CREATE TABLE IF NOT EXISTS site_analytics_ingested_events (
  object_key VARCHAR(512) NOT NULL,
  website_id VARCHAR(32) NOT NULL,
  event_ts DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (object_key),
  INDEX idx_ingested_site_ts (website_id, event_ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='已聚合的原始访问日志对象，用于延迟统计去重';
