/**
 * 控制台「示例数据」预览（VITE_CONSOLE_DEMO=1 才会打进包里）。
 * 拦截 window.fetch，所有接口都由本文件返回编造的数据，不连任何线上服务、不带真实令牌。
 * 只用于给设计审阅颜色和版式；正式构建里 main.tsx 的条件恒为 false，这个文件会被摇掉。
 */
import { buildFixture } from "@/pages/admin/bi/fixtures";
import type { BiRange } from "@/pages/admin/bi/types";

const DAY = 86400000;
const now = Date.now();
const iso = (offsetDays: number) => new Date(now - offsetDays * DAY).toISOString();
const dateKey = (offsetDays: number) => iso(offsetDays).slice(0, 10);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const DEMO_USER = {
  id: "demo-admin",
  userId: "demo-admin",
  email: "admin@example.com",
  nickname: "Demo Admin",
  roles: ["admin", "pro"],
  hasPassword: true,
  membership: { hasPro: true, lifetime: true }
};

const projects = [
  { id: "p-demo", numericId: "1", name: "Sample project", slug: "demo", role: "owner", ownerUserId: "demo-admin", websitesCount: 3, archived: false },
  { id: "p-docs", numericId: "2", name: "Docs", slug: "docs", role: "owner", ownerUserId: "demo-admin", websitesCount: 1, archived: false }
];

const websites = [
  { id: 1, website_id: "DEMO0001", name: "Launch page", file_name: "launch.zip", url: "https://demo0001.example.com/", project_id: "p-demo", projectKey: "p-demo", project_name: "Sample project", user_id: "demo-admin", visibility: "public", deployed_size: 2_400_000, created_at: iso(40), updated_at: iso(1) },
  { id: 2, website_id: "DEMO0002", name: "Event signup", file_name: "event.zip", url: "https://demo0002.example.com/", project_id: "p-demo", projectKey: "p-demo", project_name: "Sample project", user_id: "demo-admin", visibility: "public", deployed_size: 880_000, created_at: iso(20), updated_at: iso(3) },
  { id: 3, website_id: "DEMO0003", name: "Weekly report", file_name: "weekly.zip", url: "https://demo0003.example.com/", project_id: "p-demo", projectKey: "p-demo", project_name: "Sample project", user_id: "demo-admin", visibility: "private", deployed_size: 310_000, created_at: iso(9), updated_at: iso(2) }
];

function siteStats(days: number) {
  const r = rng(days * 31);
  const daily = Array.from({ length: days }, (_, i) => {
    const views = Math.round(180 + 120 * Math.sin(i / 3) + 90 * r() + i * 4);
    return { date: dateKey(days - 1 - i), views, badgeClicks: Math.round(views * 0.03) };
  });
  const total = daily.reduce((s, d) => s + d.views, 0);
  const share = (p: number) => Math.round(total * p);
  return {
    success: true,
    rangeDays: days,
    totals: { views: total, badgeClicks: daily.reduce((s, d) => s + d.badgeClicks, 0) },
    daily,
    referrers: [
      { host: "(direct)", views: share(0.41) },
      { host: "weixin.qq.com", views: share(0.22) },
      { host: "google.com", views: share(0.14) },
      { host: "github.com", views: share(0.09) },
      { host: "x.com", views: share(0.05) }
    ],
    paths: [
      { path: "/", views: share(0.62) },
      { path: "/pricing", views: share(0.17) },
      { path: "/signup", views: share(0.11) },
      { path: "/faq", views: share(0.06) }
    ],
    countries: [
      { country: "CN", views: share(0.58) }, { country: "SG", views: share(0.12) }, { country: "US", views: share(0.1) },
      { country: "JP", views: share(0.06) }, { country: "DE", views: share(0.04) }, { country: "GB", views: share(0.03) },
      { country: "AU", views: share(0.02) }, { country: "BR", views: share(0.01) }
    ],
    provinces: [
      { country: "CN", province: "Guangdong", views: share(0.2) }, { country: "CN", province: "Shanghai", views: share(0.14) },
      { country: "CN", province: "Beijing", views: share(0.11) }
    ]
  };
}

function accessLogs(page: number, pageSize: number) {
  const r = rng(page * 97);
  const paths = ["/", "/pricing", "/signup", "/faq"];
  const refs = ["", "weixin.qq.com", "google.com", "github.com"];
  const geo = [["CN", "Guangdong"], ["CN", "Shanghai"], ["SG", ""], ["US", "California"], ["JP", ""]];
  const logs = Array.from({ length: pageSize }, (_, i) => {
    const g = geo[Math.floor(r() * geo.length)];
    const ref = refs[Math.floor(r() * refs.length)];
    return {
      ts: now - (page - 1) * pageSize * 600000 - i * 600000,
      type: "view",
      host: "demo0001.example.com",
      path: paths[Math.floor(r() * paths.length)],
      referrer: ref ? `https://${ref}/` : "",
      referrerHost: ref,
      country: g[0],
      province: g[1],
      ip: `203.0.113.${Math.floor(r() * 250)}`.replace(/\.\d+$/, ".*"),
      userAgent: i % 3 ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" : "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)"
    };
  });
  return { success: true, page, pageSize, total: 128, totalPages: Math.ceil(128 / pageSize), logs };
}

const userRoles = [
  { _id: "demo-admin", email: "admin@example.com", nickname: "Demo Admin", authProviders: ["github"], role: ["admin"], siteCount: 4, storageBytes: 3_600_000, updatedAt: iso(1) },
  { _id: "u-1024", email: "lin@example.com", nickname: "Lin", authProviders: ["feishu"], role: ["pro"], proExpiresAt: iso(-48), remainingDays: 48, siteCount: 12, storageBytes: 48_000_000, updatedAt: iso(2) },
  { _id: "u-2048", email: "chen@example.com", nickname: "", authProviders: [], role: ["pro"], proExpired: true, proExpiresAt: iso(6), siteCount: 5, storageBytes: 9_100_000, updatedAt: iso(6) },
  { _id: "u-4096", email: "wang@example.com", nickname: "Wang", authProviders: ["github", "feishu"], role: ["pro"], proLifetime: true, siteCount: 21, storageBytes: 120_000_000, updatedAt: iso(9) },
  { _id: "u-8192", email: "zhao@example.com", nickname: "", authProviders: [], role: ["user"], siteCount: 1, storageBytes: 120_000, updatedAt: iso(14) },
  { _id: "u-9000", email: "", nickname: "", authProviders: [], role: ["user"], siteCount: 0, storageBytes: 0, updatedAt: iso(30) }
];

const roleLimits = [
  { _id: "admin", name: "admin", priority: 100, max_file_size: null, deployment_limit: null, max_file_count: null, allowed_extensions: [], enabled: true },
  { _id: "pro", name: "pro", priority: 50, max_file_size: 200 * 1024 * 1024, deployment_limit: 200, max_file_count: 5000, allowed_extensions: [], enabled: true },
  { _id: "user", name: "user", priority: 10, max_file_size: 20 * 1024 * 1024, deployment_limit: 20, max_file_count: 500, allowed_extensions: ["html", "css", "js", "png", "jpg", "svg"], enabled: true },
  { _id: "trial", name: "trial", priority: 5, max_file_size: 5 * 1024 * 1024, deployment_limit: 3, max_file_count: 100, allowed_extensions: ["html"], enabled: false }
];

const buckets = [
  { id: 1, name: "Primary (Guangzhou)", provider: "cos", bucket: "demo-sites-1250000000", region: "ap-guangzhou", originHost: "sites.example.com", hasOwnCreds: false, enabled: true, isDefault: true },
  { id: 2, name: "Backup", provider: "oss", bucket: "demo-backup", region: "oss-cn-hangzhou", originHost: "", hasOwnCreds: true, enabled: true, isDefault: false },
  { id: 3, name: "Legacy", provider: "s3", bucket: "legacy-demo", endpoint: "https://s3.example.com", originHost: "", hasOwnCreds: true, enabled: false, isDefault: false }
];

const reports = [
  { id: 11, website_id: "DEMO0002", reason: "phishing", note: "Asks for card number (sample)", page_url: "https://demo0002.example.com/pay", host: "demo0002.example.com", status: "open", created_at: iso(0.2), site_name: "Event signup", visibility: "public" },
  { id: 12, website_id: "DEMO0003", reason: "spam", note: "", page_url: "", host: "demo0003.example.com", status: "open", created_at: iso(1.5), site_name: "Weekly report", visibility: "disabled" },
  { id: 13, website_id: "DEMO0001", reason: "other", note: "Image copyright (sample)", page_url: "https://demo0001.example.com/", host: "demo0001.example.com", status: "reviewed", created_at: iso(4), site_name: "Launch page", visibility: "public" }
];

function userOverview(uid: string) {
  const u = userRoles.find((x) => x._id === uid) || userRoles[1];
  const daily = Array.from({ length: 30 }, (_, i) => ({ date: dateKey(29 - i), views: Math.round(60 + 40 * Math.sin(i / 4) + i * 2) }));
  return {
    success: true,
    user: { ...u, id: u._id },
    counts: { projects: 2, sites: u.siteCount },
    usage: { role: { name: (u.role || ["user"])[0] }, files: 340, storage: u.storageBytes },
    traffic: { views7d: 820, views30d: 3400, viewsAll: 18_200, daily },
    projects: [{ id: "p-x", name: "Sample project", slug: "demo", websitesCount: 2, archived: false, sites: websites.slice(0, 2).map((w) => ({ websiteId: w.website_id, name: w.name, url: w.url, views30d: 1200, storage: w.deployed_size })) }],
    sites: websites.map((w) => ({ websiteId: w.website_id, name: w.name, url: w.url, views30d: 900, storage: w.deployed_size })),
    ungroupedSites: []
  };
}

function bucketStats() {
  const r = rng(5);
  const series = Array.from({ length: 30 }, (_, i) => ({ time: iso(29 - i), value: Math.round(4e8 + 2e8 * r()) }));
  return { success: true, code: 0, data: { storage: series, traffic: series, requests: series } };
}

function websiteAction(action: string, body: Record<string, unknown>): unknown {
  switch (action) {
    case "list": return { success: true, websites: websites, count: websites.length };
    case "list_all": return { success: true, websites: websites, count: websites.length };
    case "get": return { success: true, website: websites[0] };
    case "list_projects": return { success: true, projects, count: projects.length };
    case "get_site_stats": return siteStats(Number(body.days) || 30);
    case "get_site_access_logs": return accessLogs(Number(body.page) || 1, Number(body.pageSize || body.page_size) || 10);
    case "get_role_limits": return { code: 0, data: roleLimits };
    case "get_usage": return { code: 0, data: { role: { name: "pro", priority: 50 }, usage: { deployments: 38, files: 1240, storage: 61_000_000 }, maxSite: { fileCount: 410, storageSize: 24_000_000 }, limits: { deployment_limit: 200, max_file_count: 5000, max_file_size: 200 * 1024 * 1024 } } };
    case "list_tokens": return { code: 0, data: [
      { id: "t1", name: "CI deploy", prefix: "dmx_demo1", createdAt: now - 30 * DAY, lastUsedAt: now - DAY, expiresAt: now + 60 * DAY, revoked: false },
      { id: "t2", name: "Old laptop", prefix: "dmx_demo2", createdAt: now - 200 * DAY, lastUsedAt: now - 90 * DAY, expiresAt: null, revoked: true },
      { id: "t3", name: "Temp script", prefix: "dmx_demo3", createdAt: now - 100 * DAY, lastUsedAt: null, expiresAt: now - 10 * DAY, revoked: false }
    ] };
    case "get_admin_bi": return { success: true, data: buildFixture((Number(body.range) || 30) as BiRange) };
    case "list_user_roles": return { success: true, data: userRoles };
    case "get_user_overview": return userOverview(String(body.uid || ""));
    case "list_role_limits": return { success: true, data: roleLimits };
    case "list_buckets": return { success: true, data: buckets };
    case "bucket_stats": return bucketStats();
    case "list_site_reports": return { success: true, data: body.status === "all" ? reports : reports.filter((r) => r.status === (body.status || "open")) };
    case "list_project_members": return { success: true, members: [{ userId: "demo-admin", email: "admin@example.com", role: "owner" }] };
    case "list_project_custom_domains": return { success: true, cnameTarget: "customers.demox.site", canManage: true, domains: demoDomains };
    case "verify_project_custom_domain": return verifyDemoDomain(String(body.domainId || ""));
    case "get_product_funnel": return { code: 0, data: { days: 14, totals: {}, daily: [] } };
    case "track_product_event": return { code: 0, data: { tracked: false } };
    case "list_admin_audit": return { success: true, items: [], nextBeforeId: null };
    default:
      // 演示里不执行任何写操作
      return { success: false, code: 403, message: "Sample-data preview: writes are disabled" };
  }
}

// 自定义域名示例：卡在解析（Cloudflare 代理）/ 卡在证书（第 3 次检测后变成已生效）/ 根域名 A 记录 / 已生效
const GATEWAY_IP = "119.91.123.2";
const demoDomainBase = (id: string, hostname: string, status: "pending" | "active", record: { recordType: "CNAME" | "A"; recordName: string; recordValue: string; apex: boolean }) => ({
  id, hostname, status, cnameTarget: "customers.demox.site", cnameHost: record.recordName, ...record,
  url: `https://${hostname}/`, defaultWebsiteId: "DEMO0001", defaultWebsiteName: "Launch page",
  routes: [{ label: "", host: hostname, websiteId: "DEMO0001", websiteName: "Launch page", isDefault: true }],
  verifiedAt: status === "active" ? iso(3) : null, createdAt: iso(status === "active" ? 5 : 0)
});
const cnameRecord = (name: string) => ({ recordType: "CNAME" as const, recordName: name, recordValue: "customers.demox.site", apex: false });
const demoDomains = [
  demoDomainBase("d-cf", "www.example.cn", "pending", cnameRecord("www")),
  demoDomainBase("d-cert", "shop.example.org", "pending", cnameRecord("shop")),
  demoDomainBase("d-apex", "example.com.cn", "pending", { recordType: "A", recordName: "@", recordValue: GATEWAY_IP, apex: true }),
  demoDomainBase("d-live", "docs.example.com", "active", cnameRecord("docs"))
];
const demoChecks: Record<string, number> = {};
function verifyDemoDomain(id: string) {
  const base = demoDomains.find((d) => d.id === id) || demoDomains[0];
  demoChecks[base.id] = (demoChecks[base.id] || 0) + 1;
  const checkedAt = new Date().toISOString();
  if (base.id === "d-cf") {
    const message = "开着 Cloudflare 代理，查不到 CNAME。到 Cloudflare 把这条记录的橙色云点成灰色（仅 DNS）：类型 CNAME，名称 www，内容 customers.demox.site";
    return { success: true, message, domain: { ...base, checkStep: "dns", dnsReason: "cloudflare_proxy", pendingMessage: message, checkedAt } };
  }
  if (base.id === "d-apex") {
    const message = `还查不到记录。请确认 A 记录 @ 指向 ${GATEWAY_IP}，新记录一般 1–10 分钟生效`;
    return { success: true, message, domain: { ...base, checkStep: "dns", dnsReason: "no_record", pendingMessage: message, checkedAt } };
  }
  if (base.id === "d-cert" && demoChecks[base.id] < 4) {
    const message = "解析已通，正在签发证书。会自动检测，不用点，也不用改 DNS";
    return { success: true, message, domain: { ...base, checkStep: "cert", dnsVia: "cname", pendingMessage: message, checkedAt } };
  }
  return { success: true, message: "自定义域名已可访问", domain: { ...base, status: "active", checkStep: "active", dnsVia: "cname", pendingMessage: "", checkedAt, verifiedAt: checkedAt } };
}

export function installConsoleDemo(apiOrigin: string) {
  localStorage.setItem("demox_token", "demo-preview-token");
  localStorage.setItem("demox_user", JSON.stringify(DEMO_USER));
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(apiOrigin)) return realFetch(input, init);
    const path = url.slice(apiOrigin.length);
    let body: Record<string, unknown> = {};
    try { body = init?.body ? JSON.parse(String(init.body)) : {}; } catch { body = {}; }
    let payload: unknown;
    if (/\/auth\/me$/.test(path)) payload = { success: true, user: DEMO_USER };
    else if (/\/auth\/verify$/.test(path)) payload = { valid: true, userId: DEMO_USER.id };
    else if (/\/functions/.test(path)) payload = { success: true, functions: [], websiteId: "DEMO0001" };
    else payload = websiteAction(String(body.action || ""), body);
    await new Promise((r) => setTimeout(r, 120));
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}
