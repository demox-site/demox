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
    subtitle: "把你的域名指到这个项目里的站点。",
    domainTitle: "自定义域名",
    domainDesc: "填要访问的域名，选打开后看到哪个站点。证书由 Demox 签发，你只要在域名服务商加 CNAME。",
    hostnameLabel: "域名",
    hostnamePlaceholder: "docs.example.com",
    hostnameHint: "填完整域名，不要带 https://",
    siteLabel: "打开后显示",
    addDomain: "添加",
    adding: "添加中…",
    emptySites: "这个项目还没有站点，先部署一个再绑定域名。",
    emptyDomains: "还没有绑定域名。",
    loadFailed: "域名列表加载失败",
    addFailed: "添加失败",
    added: "域名已添加",
    removed: "域名已移除",
    removeFailed: "移除失败",
    verified: "DNS 已指到 Demox",
    verifyFailed: "DNS 还没指到 Demox",
    verifyError: "检查失败",
    recordHost: "主机记录",
    recordValue: "记录值",
    copy: "复制",
    copied: "已复制",
    dnsTitle: "在域名服务商添加这两条 CNAME",
    dnsRoot: (fqdn: string) => `对应 ${fqdn}`,
    dnsWildcard: (fqdn: string) => `对应 *.${fqdn}，给子域名用`,
    dnsEmpty: "填好域名后，这里会列出要添加的 CNAME。",
    dnsWrongTarget: "两条记录的值都用上面这一行。指到 www.demox.site 或其他 Demox 地址会打不开。",
    statusPending: "等待 DNS",
    statusActive: "已生效",
    defaultSite: "打开后显示",
    chooseSite: "选择站点",
    unassigned: "还没选站点，打开这个域名不会显示内容。",
    saveRoute: "保存",
    subTitle: "子域名",
    subDesc: (host: string) => `如果还想用子域名打开另一个站点，填前缀即可。例如填 blog，访问地址是 blog.${host}`,
    subPreview: (label: string, host: string) => `访问地址：${label}.${host}`,
    subLabel: "前缀",
    subPlaceholder: "blog",
    addSub: "添加子域名",
    removeRoute: "移除",
    verify: "检查 DNS",
    remove: "移除域名",
    removeTitle: "移除这个域名？",
    removeDesc: "会同时去掉它下面的子域名。域名服务商里的 CNAME 需要你自己删。",
    memberHint: "只有项目所有者和管理员可以改域名。",
    noHost: "请填写域名",
    noLabel: "请填写前缀",
    noSite: "请选择站点",
    routeSaved: "已保存"
  },
  en: {
    eyebrow: "Project",
    title: "Project settings",
    subtitle: "Point your own domain at a site in this project.",
    domainTitle: "Custom domains",
    domainDesc: "Enter the domain people will visit, and pick which site it opens. We issue the certificate. You only add a CNAME at your DNS provider.",
    hostnameLabel: "Domain",
    hostnamePlaceholder: "docs.example.com",
    hostnameHint: "Full hostname, without https://",
    siteLabel: "Opens this site",
    addDomain: "Add",
    adding: "Adding…",
    emptySites: "This project has no sites yet. Deploy one first.",
    emptyDomains: "No custom domain yet.",
    loadFailed: "Could not load domains",
    addFailed: "Could not add domain",
    added: "Domain added",
    removed: "Domain removed",
    removeFailed: "Could not remove domain",
    verified: "DNS is pointing at Demox",
    verifyFailed: "DNS is not pointing at Demox yet",
    verifyError: "Could not check DNS",
    recordHost: "Host",
    recordValue: "Value",
    copy: "Copy",
    copied: "Copied",
    dnsTitle: "Add these two CNAMEs at your DNS provider",
    dnsRoot: (fqdn: string) => `For ${fqdn}`,
    dnsWildcard: (fqdn: string) => `For *.${fqdn} (subdomains)`,
    dnsEmpty: "After you enter a domain, the CNAME records will show up here.",
    dnsWrongTarget: "Use only this value. Do not CNAME to www.demox.site or any xxx.demox.site site URL.",
    statusPending: "Waiting for DNS",
    statusActive: "Active",
    defaultSite: "Opens",
    chooseSite: "Select a site",
    unassigned: "No site selected. This domain will not show a site yet.",
    saveRoute: "Save",
    subTitle: "Subdomains",
    subDesc: (host: string) => `Use a prefix to open another site. Example: blog becomes blog.${host}`,
    subPreview: (label: string, host: string) => `Visitors open ${label}.${host}`,
    subLabel: "Prefix",
    subPlaceholder: "blog",
    addSub: "Add subdomain",
    removeRoute: "Remove",
    verify: "Check DNS",
    remove: "Remove domain",
    removeTitle: "Remove this domain?",
    removeDesc: "Subdomains under it will be removed too. Delete the CNAME at your DNS provider yourself.",
    memberHint: "Only project owners and admins can change domains.",
    noHost: "Enter a domain",
    noLabel: "Enter a prefix",
    noSite: "Select a site",
    routeSaved: "Saved"
  }
} as const;

type ProjectSite = {
  websiteId: string;
  name: string;
};

function cnameHostFromHostname(hostname: string) {
  const value = String(hostname || "").trim().toLowerCase().replace(/\.+$/, "");
  if (!value) return "";
  if (!value.includes(".")) return value;
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

  const renderDnsBox = (hostnameValue: string, keyPrefix: string) => {
    const host = cnameHostFromHostname(hostnameValue);
    if (!host) {
      return <p className="text-sm text-[var(--stitch-muted)]">{t.dnsEmpty}</p>;
    }
    return (
      <div className="rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-4 space-y-3">
        <div className="text-sm font-medium text-[var(--stitch-ink)]">{t.dnsTitle}</div>
        {renderDnsRow(host, t.dnsRoot(hostnameValue.trim().toLowerCase()), `${keyPrefix}-root`)}
        {renderDnsRow(`*.${host}`, t.dnsWildcard(hostnameValue.trim().toLowerCase()), `${keyPrefix}-wild`)}
        <p className="text-sm text-[var(--stitch-muted)]">{t.dnsWrongTarget}</p>
      </div>
    );
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
          {canManage ? (
            <form onSubmit={handleAddDomain} className="space-y-3">
              <div className="grid gap-4 sm:grid-cols-[1fr_minmax(12rem,16rem)_auto] sm:items-end">
                <div className="space-y-2">
                  <Label className="text-[var(--stitch-ink)]">{t.hostnameLabel}</Label>
                  <Input
                    value={hostname}
                    onChange={(event) => setHostname(event.target.value)}
                    placeholder={t.hostnamePlaceholder}
                    className="border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)]"
                  />
                  <p className="text-xs text-[var(--stitch-muted)]">{t.hostnameHint}</p>
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
              </div>
              {cnameHostFromHostname(hostname) ? renderDnsBox(hostname, "add") : null}
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

                <div className="grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-end">
                  <div className="space-y-2">
                    <Label className="text-[var(--stitch-ink)]">{t.defaultSite}</Label>
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
                  </div>
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

                {renderDnsBox(domain.hostname, `domain-${domain.id}`)}

                <div className="space-y-3 border-t border-[var(--stitch-line)] pt-4">
                  <div>
                    <div className="text-sm font-medium text-[var(--stitch-ink)]">{t.subTitle}</div>
                    <p className="text-sm text-[var(--stitch-muted)]">{t.subDesc(domain.hostname)}</p>
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
                        <Label className="text-[var(--stitch-ink)]">{t.siteLabel}</Label>
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
                    <div className="text-sm text-[var(--stitch-muted)]">
                      {t.subPreview(subLabel.trim().toLowerCase(), domain.hostname)}
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
