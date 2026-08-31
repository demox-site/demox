export const DEFAULT_OFFICIAL_DOMAIN = "demox.site";
export const CUSTOM_DOMAIN_CNAME_TARGET = "customers.demox.site";

export const OFFICIAL_DOMAINS = [
  DEFAULT_OFFICIAL_DOMAIN
];

export const isOfficialDomain = (domain) => {
  const value = String(domain || "").trim().toLowerCase();
  return OFFICIAL_DOMAINS.includes(value);
};

export const normalizeOfficialDomain = (domain) => {
  const value = String(domain || DEFAULT_OFFICIAL_DOMAIN).trim().toLowerCase();
  return isOfficialDomain(value) ? value : DEFAULT_OFFICIAL_DOMAIN;
};

export const supportedOfficialBinding = (subdomain, domain) => {
  const label = String(subdomain || "").trim().toLowerCase();
  const raw = String(domain || DEFAULT_OFFICIAL_DOMAIN).trim().toLowerCase() || DEFAULT_OFFICIAL_DOMAIN;
  if (!label || !isOfficialDomain(raw)) {
    return { subdomain: null, subdomainDomain: DEFAULT_OFFICIAL_DOMAIN };
  }
  return { subdomain: label, subdomainDomain: raw };
};

const PLATFORM_HOSTS = new Set(["www.demox.site", "demox.site"]);

export const hostnameFromSiteValue = (value: string): string => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/\.$/, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").split("/")[0].replace(/\.$/, "");
  }
};

export const isDemoxPlatformHost = (host: string): boolean => PLATFORM_HOSTS.has(hostnameFromSiteValue(host));

export const isDemoxPlatformSite = (website: {
  url?: string;
  subdomain?: string;
  subdomainDomain?: string;
  subdomain_domain?: string;
} | null | undefined): boolean => {
  if (!website) return false;
  const subdomain = String(website.subdomain || "").trim().toLowerCase();
  const domain = normalizeOfficialDomain(website.subdomainDomain || website.subdomain_domain);
  if (subdomain && isDemoxPlatformHost(`${subdomain}.${domain}`)) return true;
  return isDemoxPlatformHost(website.url || "");
};
