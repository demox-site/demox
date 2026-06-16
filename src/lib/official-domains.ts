export const DEFAULT_OFFICIAL_DOMAIN = "demox.site";

export const OFFICIAL_DOMAINS = [
  DEFAULT_OFFICIAL_DOMAIN,
  "vibeme.cn"
];

export const normalizeOfficialDomain = (domain) => {
  const value = String(domain || DEFAULT_OFFICIAL_DOMAIN).trim().toLowerCase();
  return OFFICIAL_DOMAINS.includes(value) ? value : DEFAULT_OFFICIAL_DOMAIN;
};
