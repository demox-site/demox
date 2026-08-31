import React from "react";
import { Navigate, useParams } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  useToast
} from "@/components/ui";
import { Check, Copy, Globe, Loader2, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { mapWebsiteRow, websiteApi, type ProjectCustomDomain } from "@/api";
import { CUSTOM_DOMAIN_CNAME_TARGET } from "@/lib/official-domains";
import { translations } from "../home-translations";
import { useProjects } from "../use-projects";

const texts = {
  zh: {
    eyebrow: "项目",
    title: "项目设置",
    subtitle: "每条记录是一个完整主机名，指向本项目里的一个站点。",
    domainTitle: "自定义域名",
    domainDesc: "先绑 aaa.ccc.com 指向站点 A；再在这条下面加前缀 bbb，得到 bbb.aaa.ccc.com 指向站点 B。",
    hostnameLabel: "完整主机名",
    hostnamePlaceholder: "aaa.ccc.com",
    siteLabel: "指向站点",
    addDomain: "添加域名",
    adding: "绑定中…",
    emptySites: "这个项目还没有站点，先部署一个再配指向。",
    emptyDomains: "还没有绑定项目域名。",
    loadFailed: "域名列表加载失败",
    addFailed: "绑定失败",
    added: "域名已绑定到项目",
    removed: "已从项目解绑",
    removeFailed: "解绑失败",
    verified: "DNS 已生效",
    verifyFailed: "还没解析到平台入口",
    verifyError: "校验失败",
    recordType: "类型",
    recordHost: "主机记录",
    recordValue: "值",
    copy: "复制",
    copied: "已复制",
    dnsTitle: "DNS 记录",
    dnsRoot: "主机名本身",
    dnsWildcard: "给子域名用的通配",
    apexNote: "DNS 由你来写：aaa 和 *.aaa（或单独的 bbb.aaa）都 CNAME 到 customers.demox.site。",
    httpsNote: "不要指到 www.demox.site，也不要指到站点的官方地址。证书由平台签发。",
    statusPending: "等待 DNS",
    statusActive: "已生效",
    defaultSite: "这条记录指向",
    chooseSite: "选择站点",
    unassigned: "尚未指向站点",
    saveRoute: "保存指向",
    subTitle: "在这条下面加前缀",
    subDesc: "加前缀 bbb 后，完整主机名是 bbb.aaa.ccc.com，再选一个本项目站点。",
    subLabel: "前缀",
    subPlaceholder: "bbb",
    addSub: "添加前缀",
    removeRoute: "取消指向",
    verify: "检测解析",
    remove: "从项目解绑",
    removeTitle: "解绑这个项目域名？",
    removeDesc: "根域名和它下面的子域名指向都会删除。DNS 记录需要你自己改。",
    memberHint: "只有项目 owner / admin 可以改域名。",
    noHost: "请填写项目域名",
    noLabel: "请填写子域名前缀",
    noSite: "请选择站点",
    routeSaved: "指向已更新"
  },
  en: {
    eyebrow: "Project",
    title: "Project settings",
    subtitle: "Each record is a full hostname pointing at a site in this project.",
    domainTitle: "Custom domains",
    domainDesc: "Bind aaa.ccc.com to site A, then add prefix bbb under that record to send bbb.aaa.ccc.com to site B.",
    hostnameLabel: "Full hostname",
    hostnamePlaceholder: "aaa.ccc.com",
    siteLabel: "Target site",
    addDomain: "Add domain",
    adding: "Binding…",
    emptySites: "This project has no sites yet. Deploy one before routing the domain.",
    emptyDomains: "No project domain yet.",
    loadFailed: "Could not load domains",
    addFailed: "Could not bind domain",
    added: "Domain bound to this project",
    removed: "Domain removed from project",
    removeFailed: "Could not remove domain",
    verified: "DNS is pointing at the platform",
    verifyFailed: "DNS is not pointing at the platform yet",
    verifyError: "Could not verify DNS",
    recordType: "Type",
    recordHost: "Host",
    recordValue: "Value",
    copy: "Copy",
    copied: "Copied",
    dnsTitle: "DNS records",
    dnsRoot: "This hostname",
    dnsWildcard: "Wildcard for prefixes",
    apexNote: "You write DNS: CNAME aaa and *.aaa (or bbb.aaa) to customers.demox.site.",
    httpsNote: "Do not CNAME to www.demox.site or the official site URL. We issue the certificate.",
    statusPending: "Waiting for DNS",
    statusActive: "Active",
    defaultSite: "This record points to",
    chooseSite: "Select a site",
    unassigned: "Not pointing at a site yet",
    saveRoute: "Save route",
    subTitle: "Add a prefix under this record",
    subDesc: "Prefix bbb becomes bbb.aaa.ccc.com and must point at another site in this project.",
    subLabel: "Prefix",
    subPlaceholder: "bbb",
    addSub: "Add prefix",
    removeRoute: "Remove route",
    verify: "Check DNS",
    remove: "Unbind from project",
    removeTitle: "Unbind this project domain?",
    removeDesc: "The root host and every subdomain route will be removed. Change DNS yourself if you no longer need it.",
    memberHint: "Only project owners and admins can change domains.",
    noHost: "Enter a project domain",
    noLabel: "Enter a subdomain label",
    noSite: "Select a site",
    routeSaved: "Route updated"
  }
} as const;

type ProjectSite = {
  websiteId: string;
  name: string;
};

function cnameHostFromHostname(hostname: string) {
  const value = String(hostname || "").trim().toLowerCase();
  if (!value.includes(".")) return value || "demox";
  return value.slice(0, value.indexOf("."));
}

export default function ProjectSettingsPage() {
  const { projectId } = useParams();
  const { language: lang } = useLanguage();
  const t = texts[lang];
  const shared = translations[lang];
  const { toast } = useToast();
  const projects = useProjects({
    t: shared,
    handleAuthError: (error) => console.warn("Project settings auth error:", error)
  });

  const [sites, setSites] = React.useState<ProjectSite[]>([]);
  const [domains, setDomains] = React.useState<ProjectCustomDomain[]>([]);
  const [cnameTarget, setCnameTarget] = React.useState(CUSTOM_DOMAIN_CNAME_TARGET);
  const [canManage, setCanManage] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [hostname, setHostname] = React.useState("");
  const [addWebsiteId, setAddWebsiteId] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [busyKey, setBusyKey] = React.useState("");
  const [copied, setCopied] = React.useState("");
  const [removeTarget, setRemoveTarget] = React.useState<ProjectCustomDomain | null>(null);
  const [defaultSiteByDomain, setDefaultSiteByDomain] = React.useState<Record<string, string>>({});
  const [subLabelByDomain, setSubLabelByDomain] = React.useState<Record<string, string>>({});
  const [subSiteByDomain, setSubSiteByDomain] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    projects.loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentProject = projects.getProjectById(projectId) || null;
  const missingProject =
    projectId &&
    !projects.loadingProjects &&
    projects.activeProjects.length > 0 &&
    !currentProject;

  const applyDomains = (next: ProjectCustomDomain[]) => {
    setDomains(next);
    setDefaultSiteByDomain((current) => {
      const merged = { ...current };
      next.forEach((domain) => {
        merged[domain.id] = domain.defaultWebsiteId || merged[domain.id] || "";
      });
      return merged;
    });
    setSubSiteByDomain((current) => {
      const merged = { ...current };
      next.forEach((domain) => {
        merged[domain.id] = merged[domain.id] || sites[0]?.websiteId || "";
      });
      return merged;
    });
  };

  const loadPage = React.useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [siteRes, domainRes] = await Promise.all([
        websiteApi.list({ projectId }),
        websiteApi.listProjectCustomDomains(projectId)
      ]);
      const nextSites = siteRes?.success
        ? (siteRes.websites || []).map(mapWebsiteRow).filter((site) => site.websiteId)
        : [];
      setSites(nextSites);
      setAddWebsiteId((current) => current || nextSites[0]?.websiteId || "");
      if (domainRes?.success) {
        applyDomains(domainRes.domains || []);
        setCnameTarget(domainRes.cnameTarget || CUSTOM_DOMAIN_CNAME_TARGET);
        setCanManage(!!domainRes.canManage);
      } else if (domainRes && domainRes.success === false) {
        toast({ title: t.loadFailed, description: domainRes.message || "", variant: "destructive" });
      }
    } catch (error) {
      toast({
        title: t.loadFailed,
        description: error instanceof Error ? error.message : "",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }, [projectId, t.loadFailed, toast]);

  React.useEffect(() => {
    loadPage();
  }, [loadPage]);

  if (missingProject) {
    return <Navigate to="/console/projects" replace />;
  }

  const previewHost = cnameHostFromHostname(hostname);
  const handleCopy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      toast({ title: t.copied });
      window.setTimeout(() => setCopied(""), 1500);
    } catch (error) {
      toast({
        title: t.copy,
        description: error instanceof Error ? error.message : value,
        variant: "destructive"
      });
    }
  };

  const handleAddDomain = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId) return;
    const nextHost = hostname.trim();
    if (!nextHost) {
      toast({ title: t.noHost, variant: "destructive" });
      return;
    }
    if (!addWebsiteId) {
      toast({ title: t.noSite, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await websiteApi.addProjectCustomDomain({
        projectId,
        hostname: nextHost,
        websiteId: addWebsiteId
      });
      if (!res?.success || !res.domain) throw new Error(res?.message || t.addFailed);
      applyDomains([res.domain, ...domains.filter((item) => item.id !== res.domain?.id)]);
      setHostname("");
      toast({ title: t.added, description: res.message || "" });
    } catch (error) {
      toast({
        title: t.addFailed,
        description: error instanceof Error ? error.message : "",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRoute = async (domain: ProjectCustomDomain, label: string, websiteId: string) => {
    if (!projectId) return;
    if (!websiteId) {
      toast({ title: t.noSite, variant: "destructive" });
      return;
    }
    const key = `${domain.id}:${label || "root"}`;
    setBusyKey(key);
    try {
      const res = await websiteApi.setProjectCustomDomainRoute({
        projectId,
        domainId: domain.id,
        label,
        websiteId
      });
      if (!res?.success || !res.domain) throw new Error(res?.message || t.addFailed);
      applyDomains(domains.map((item) => (item.id === res.domain?.id ? res.domain : item)));
      if (label) setSubLabelByDomain((current) => ({ ...current, [domain.id]: "" }));
      toast({ title: t.routeSaved, description: res.message || "" });
    } catch (error) {
      toast({
        title: t.addFailed,
        description: error instanceof Error ? error.message : "",
        variant: "destructive"
      });
    } finally {
      setBusyKey("");
    }
  };

  const handleRemoveRoute = async (domain: ProjectCustomDomain, routeId: string) => {
    if (!projectId) return;
    setBusyKey(`route:${routeId}`);
    try {
      const res = await websiteApi.removeProjectCustomDomainRoute({
        projectId,
        domainId: domain.id,
        routeId
      });
      if (!res?.success || !res.domain) throw new Error(res?.message || t.removeFailed);
      applyDomains(domains.map((item) => (item.id === res.domain?.id ? res.domain : item)));
    } catch (error) {
      toast({
        title: t.removeFailed,
        description: error instanceof Error ? error.message : "",
        variant: "destructive"
      });
    } finally {
      setBusyKey("");
    }
  };

  const handleVerify = async (domain: ProjectCustomDomain) => {
    if (!projectId) return;
    setBusyKey(`verify:${domain.id}`);
    try {
      const res = await websiteApi.verifyProjectCustomDomain({ projectId, domainId: domain.id });
      if (!res?.success || !res.domain) throw new Error(res?.message || t.verifyError);
      applyDomains(domains.map((item) => (item.id === res.domain?.id ? res.domain : item)));
      toast({
        title: res.domain.status === "active" ? t.verified : t.verifyFailed,
        description: res.message || ""
      });
    } catch (error) {
      toast({
        title: t.verifyError,
        description: error instanceof Error ? error.message : "",
        variant: "destructive"
      });
    } finally {
      setBusyKey("");
    }
  };

  const handleRemoveDomain = async () => {
    if (!projectId || !removeTarget) return;
    setBusyKey(`remove:${removeTarget.id}`);
    try {
      const res = await websiteApi.removeProjectCustomDomain({
        projectId,
        domainId: removeTarget.id
      });
      if (!res?.success) throw new Error(res?.message || t.removeFailed);
      applyDomains(domains.filter((item) => item.id !== removeTarget.id));
      setRemoveTarget(null);
      toast({ title: t.removed });
    } catch (error) {
      toast({
        title: t.removeFailed,
        description: error instanceof Error ? error.message : "",
        variant: "destructive"
      });
    } finally {
      setBusyKey("");
    }
  };

  const renderDnsRow = (host: string, hint: string, key: string) => (
    <div className="grid gap-2 sm:grid-cols-[5rem_1fr_1fr_auto] sm:items-center">
      <div className="font-mono text-sm text-[var(--stitch-ink)]">CNAME</div>
      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--stitch-muted)]">{t.recordHost}</div>
        <div className="font-mono text-sm text-[var(--stitch-ink)]">{host}</div>
        <div className="text-xs text-[var(--stitch-muted)]">{hint}</div>
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--stitch-muted)]">{t.recordValue}</div>
        <code className="truncate font-mono text-sm text-[var(--stitch-ink)]">{cnameTarget}</code>
      </div>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleCopy(cnameTarget, key)}>
        {copied === key ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );

  return (
    <div className="stitch-page max-w-4xl">
      <div className="stitch-page-hero mb-8">
        <div className="stitch-eyebrow">
          <Settings2 className="h-3.5 w-3.5" />
          {t.eyebrow}
        </div>
        <h1 className="stitch-title">{t.title}</h1>
        <p className="stitch-subtitle">{t.subtitle}</p>
      </div>

      <Card className="stitch-panel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[var(--stitch-ink)]">
            <Globe className="h-4 w-4 text-[var(--stitch-blue)]" />
            {t.domainTitle}
          </CardTitle>
          <CardDescription className="text-[var(--stitch-muted)]">{t.domainDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--stitch-muted)]">{t.dnsTitle}</div>
            {renderDnsRow(previewHost || "demox", t.dnsRoot, "root")}
            {renderDnsRow(`*.${previewHost || "demox"}`, t.dnsWildcard, "wild")}
            <p className="text-sm text-[var(--stitch-muted)]">{t.apexNote}</p>
            <p className="text-sm text-[var(--stitch-muted)]">{t.httpsNote}</p>
          </div>

          {canManage ? (
            <form onSubmit={handleAddDomain} className="grid gap-4 sm:grid-cols-[1fr_minmax(12rem,16rem)_auto] sm:items-end">
              <div className="space-y-2">
                <Label className="text-[var(--stitch-ink)]">{t.hostnameLabel}</Label>
                <Input
                  value={hostname}
                  onChange={(event) => setHostname(event.target.value)}
                  placeholder={t.hostnamePlaceholder}
                  className="border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[var(--stitch-ink)]">{t.siteLabel}</Label>
                <select
                  value={addWebsiteId}
                  onChange={(event) => setAddWebsiteId(event.target.value)}
                  disabled={sites.length === 0}
                  className="stitch-select h-10 w-full"
                >
                  {sites.length === 0 && <option value="">{t.chooseSite}</option>}
                  {sites.map((site) => (
                    <option key={site.websiteId} value={site.websiteId}>
                      {site.name || site.websiteId}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={saving || sites.length === 0} className="stitch-primary rounded-full">
                {saving ? t.adding : t.addDomain}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-[var(--stitch-muted)]">{t.memberHint}</p>
          )}

          {sites.length === 0 && !loading && (
            <p className="text-sm text-[var(--stitch-muted)]">{t.emptySites}</p>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-[var(--stitch-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {!loading && domains.length === 0 && (
            <p className="text-sm text-[var(--stitch-muted)]">{t.emptyDomains}</p>
          )}

          {domains.map((domain) => {
            const defaultSite = defaultSiteByDomain[domain.id] || domain.defaultWebsiteId || "";
            const subLabel = subLabelByDomain[domain.id] || "";
            const subSite = subSiteByDomain[domain.id] || sites[0]?.websiteId || "";
            const subRoutes = (domain.routes || []).filter((route) => !route.isDefault);
            return (
              <div key={domain.id} className="space-y-4 rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={domain.url || `https://${domain.hostname}/`}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate font-medium text-[var(--stitch-ink)] hover:underline"
                      >
                        {domain.hostname}
                      </a>
                      <Badge variant={domain.status === "active" ? "default" : "secondary"}>
                        {domain.status === "active" ? t.statusActive : t.statusPending}
                      </Badge>
                    </div>
                    <div className="font-mono text-xs text-[var(--stitch-muted)]">
                      {domain.cnameHost} / {domain.wildcardHost} → {domain.cnameTarget || cnameTarget}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={busyKey === `verify:${domain.id}`} onClick={() => handleVerify(domain)}>
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        {t.verify}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setRemoveTarget(domain)}>
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        {t.remove}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_minmax(12rem,16rem)_auto] sm:items-end">
                  <div className="space-y-1">
                    <Label className="text-[var(--stitch-ink)]">{t.defaultSite}</Label>
                    <div className="text-xs text-[var(--stitch-muted)]">{domain.hostname}</div>
                  </div>
                  <select
                    value={defaultSite}
                    onChange={(event) => setDefaultSiteByDomain((current) => ({ ...current, [domain.id]: event.target.value }))}
                    disabled={!canManage || sites.length === 0}
                    className="stitch-select h-10 w-full"
                  >
                    <option value="">{t.chooseSite}</option>
                    {sites.map((site) => (
                      <option key={site.websiteId} value={site.websiteId}>
                        {site.name || site.websiteId}
                      </option>
                    ))}
                  </select>
                  {canManage && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!defaultSite || busyKey === `${domain.id}:root`}
                      onClick={() => handleSaveRoute(domain, "", defaultSite)}
                    >
                      {t.saveRoute}
                    </Button>
                  )}
                </div>
                {!domain.defaultWebsiteId && (
                  <p className="text-sm text-[var(--stitch-muted)]">{t.unassigned}</p>
                )}

                <div className="space-y-3 border-t border-[var(--stitch-line)] pt-4">
                  <div>
                    <div className="text-sm font-medium text-[var(--stitch-ink)]">{t.subTitle}</div>
                    <p className="text-sm text-[var(--stitch-muted)]">{t.subDesc}</p>
                  </div>
                  {subRoutes.map((route) => (
                    <div key={route.id} className="flex flex-col gap-2 rounded-xl border border-[var(--stitch-line)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm text-[var(--stitch-ink)]">{route.hostname}</div>
                        <div className="text-xs text-[var(--stitch-muted)]">{route.websiteName || route.websiteId}</div>
                      </div>
                      {canManage && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busyKey === `route:${route.id}`}
                          onClick={() => handleRemoveRoute(domain, route.id)}
                        >
                          {t.removeRoute}
                        </Button>
                      )}
                    </div>
                  ))}
                  {canManage && (
                    <div className="grid gap-3 sm:grid-cols-[8rem_minmax(12rem,1fr)_auto] sm:items-end">
                      <div className="space-y-2">
                        <Label className="text-[var(--stitch-ink)]">{t.subLabel}</Label>
                        <Input
                          value={subLabel}
                          onChange={(event) => setSubLabelByDomain((current) => ({ ...current, [domain.id]: event.target.value }))}
                          placeholder={t.subPlaceholder}
                          className="border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)]"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[var(--stitch-ink)]">{t.chooseSite}</Label>
                        <select
                          value={subSite}
                          onChange={(event) => setSubSiteByDomain((current) => ({ ...current, [domain.id]: event.target.value }))}
                          className="stitch-select h-10 w-full"
                        >
                          {sites.map((site) => (
                            <option key={site.websiteId} value={site.websiteId}>
                              {site.name || site.websiteId}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!subLabel.trim() || !subSite || busyKey === `${domain.id}:${subLabel.trim()}`}
                        onClick={() => {
                          const label = subLabel.trim();
                          if (!label) {
                            toast({ title: t.noLabel, variant: "destructive" });
                            return;
                          }
                          handleSaveRoute(domain, label, subSite);
                        }}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        {t.addSub}
                      </Button>
                    </div>
                  )}
                  {subLabel.trim() && (
                    <div className="font-mono text-xs text-[var(--stitch-muted)]">
                      {subLabel.trim().toLowerCase()}.{domain.hostname}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent className="border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.removeTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--stitch-muted)]">{t.removeDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{shared.cancel || "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveDomain}>{t.remove}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
