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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  useToast
} from "@/components/ui";
import { Check, Copy, Globe, Loader2, Plus, Settings2, Trash2 } from "lucide-react";
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
    domainDesc: "添加完整域名，再按指引写一条 CNAME。证书由 Demox 签发。",
    create: "添加域名",
    dialogTitle: "添加域名",
    dialogDesc: "填写要访问的完整域名，并选择打开后看到的站点。",
    hostnameLabel: "完整域名",
    hostnamePlaceholder: "docs.example.com",
    hostnameHint: "不要带 https://",
    siteLabel: "打开后显示",
    chooseSite: "选择站点",
    next: "下一步",
    adding: "创建中…",
    dnsTitle: "添加这条 CNAME",
    dnsDesc: "到域名服务商添加下面这一条记录。不要指到 www.demox.site 或其他 Demox 地址。",
    recordHost: "主机记录",
    recordValue: "记录值",
    copy: "复制",
    copied: "已复制",
    verify: "检测",
    verifying: "检测中…",
    complete: "完成",
    verifyHint: "检测通过后可以点完成。",
    verified: "DNS 已指到 Demox",
    verifyFailed: "DNS 还没指到 Demox",
    verifyError: "检测失败",
    continueSetup: "继续配置",
    emptySites: "这个项目还没有站点，先部署一个再添加域名。",
    emptyDomains: "还没有添加域名。",
    loadFailed: "域名列表加载失败",
    addFailed: "添加失败",
    added: "域名已添加",
    removed: "域名已移除",
    removeFailed: "移除失败",
    statusPending: "等待 DNS",
    statusActive: "已生效",
    defaultSite: "打开后显示",
    saveRoute: "保存",
    unassigned: "还没选站点。",
    remove: "移除",
    removeTitle: "移除这个域名？",
    removeDesc: "域名服务商里的 CNAME 需要你自己删。",
    memberHint: "只有项目所有者和管理员可以改域名。",
    noHost: "请填写完整域名",
    noSite: "请选择站点",
    routeSaved: "已保存"
  },
  en: {
    eyebrow: "Project",
    title: "Project settings",
    subtitle: "Point your own domain at a site in this project.",
    domainTitle: "Custom domains",
    domainDesc: "Add a full hostname, then create one CNAME. We issue the certificate.",
    create: "Add domain",
    dialogTitle: "Add domain",
    dialogDesc: "Enter the full hostname, then pick which site it opens.",
    hostnameLabel: "Full hostname",
    hostnamePlaceholder: "docs.example.com",
    hostnameHint: "Without https://",
    siteLabel: "Opens this site",
    chooseSite: "Select a site",
    next: "Next",
    adding: "Creating…",
    dnsTitle: "Add this CNAME",
    dnsDesc: "Create the record below at your DNS provider. Do not point it at www.demox.site or another Demox address.",
    recordHost: "Host",
    recordValue: "Value",
    copy: "Copy",
    copied: "Copied",
    verify: "Check",
    verifying: "Checking…",
    complete: "Done",
    verifyHint: "Done is enabled after the check passes.",
    verified: "DNS is pointing at Demox",
    verifyFailed: "DNS is not pointing at Demox yet",
    verifyError: "Check failed",
    continueSetup: "Continue setup",
    emptySites: "This project has no sites yet. Deploy one first.",
    emptyDomains: "No custom domain yet.",
    loadFailed: "Could not load domains",
    addFailed: "Could not add domain",
    added: "Domain added",
    removed: "Domain removed",
    removeFailed: "Could not remove domain",
    statusPending: "Waiting for DNS",
    statusActive: "Active",
    defaultSite: "Opens",
    saveRoute: "Save",
    unassigned: "No site selected.",
    remove: "Remove",
    removeTitle: "Remove this domain?",
    removeDesc: "Delete the CNAME at your DNS provider yourself.",
    memberHint: "Only project owners and admins can change domains.",
    noHost: "Enter a full hostname",
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
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createStep, setCreateStep] = React.useState<"form" | "dns">("form");
  const [hostname, setHostname] = React.useState("");
  const [addWebsiteId, setAddWebsiteId] = React.useState("");
  const [draftDomain, setDraftDomain] = React.useState<ProjectCustomDomain | null>(null);
  const [dnsReady, setDnsReady] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [busyKey, setBusyKey] = React.useState("");
  const [copied, setCopied] = React.useState("");
  const [removeTarget, setRemoveTarget] = React.useState<ProjectCustomDomain | null>(null);
  const [defaultSiteByDomain, setDefaultSiteByDomain] = React.useState<Record<string, string>>({});

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

  const resetCreate = () => {
    setCreateOpen(false);
    setCreateStep("form");
    setHostname("");
    setDraftDomain(null);
    setDnsReady(false);
    setSaving(false);
  };

  const openCreate = () => {
    setCreateStep("form");
    setHostname("");
    setDraftDomain(null);
    setDnsReady(false);
    setAddWebsiteId((current) => current || sites[0]?.websiteId || "");
    setCreateOpen(true);
  };

  const openDnsStep = (domain: ProjectCustomDomain) => {
    setDraftDomain(domain);
    setHostname(domain.hostname);
    setDnsReady(false);
    setCreateStep("dns");
    setCreateOpen(true);
  };

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

  const handleCreateNext = async (event: React.FormEvent) => {
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
      setDraftDomain(res.domain);
      setDnsReady(false);
      setCreateStep("dns");
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

  const handleSaveRoute = async (domain: ProjectCustomDomain, websiteId: string) => {
    if (!projectId) return;
    if (!websiteId) {
      toast({ title: t.noSite, variant: "destructive" });
      return;
    }
    setBusyKey(`${domain.id}:root`);
    try {
      const res = await websiteApi.setProjectCustomDomainRoute({
        projectId,
        domainId: domain.id,
        label: "",
        websiteId
      });
      if (!res?.success || !res.domain) throw new Error(res?.message || t.addFailed);
      applyDomains(domains.map((item) => (item.id === res.domain?.id ? res.domain : item)));
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

  const handleVerifyDraft = async () => {
    if (!projectId || !draftDomain) return;
    setBusyKey("verify-draft");
    try {
      const res = await websiteApi.verifyProjectCustomDomain({ projectId, domainId: draftDomain.id });
      if (!res?.success || !res.domain) throw new Error(res?.message || t.verifyError);
      applyDomains(domains.map((item) => (item.id === res.domain?.id ? res.domain : item)));
      setDraftDomain(res.domain);
      const passed = res.domain.status === "active";
      setDnsReady(passed);
      toast({
        title: passed ? t.verified : t.verifyFailed,
        description: res.message || ""
      });
    } catch (error) {
      setDnsReady(false);
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

  const guideHostname = draftDomain?.hostname || hostname;
  const guideHost = cnameHostFromHostname(guideHostname);

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
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-[var(--stitch-ink)]">
              <Globe className="h-4 w-4 text-[var(--stitch-blue)]" />
              {t.domainTitle}
            </CardTitle>
            <CardDescription className="text-[var(--stitch-muted)]">{t.domainDesc}</CardDescription>
          </div>
          {canManage && (
            <Button
              type="button"
              disabled={sites.length === 0}
              className="stitch-primary rounded-full"
              onClick={openCreate}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {t.create}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!canManage && <p className="text-sm text-[var(--stitch-muted)]">{t.memberHint}</p>}
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
            return (
              <div key={domain.id} className="space-y-4 rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
                  {canManage && (
                    <div className="flex shrink-0 items-center gap-2">
                      {domain.status !== "active" && (
                        <Button type="button" variant="outline" size="sm" onClick={() => openDnsStep(domain)}>
                          {t.continueSetup}
                        </Button>
                      )}
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
                      onClick={() => handleSaveRoute(domain, defaultSite)}
                    >
                      {t.saveRoute}
                    </Button>
                  )}
                </div>
                {!domain.defaultWebsiteId && (
                  <p className="text-sm text-[var(--stitch-muted)]">{t.unassigned}</p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : resetCreate())}>
        <DialogContent className="border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)]">
          {createStep === "form" ? (
            <form onSubmit={handleCreateNext} className="space-y-5">
              <DialogHeader>
                <DialogTitle>{t.dialogTitle}</DialogTitle>
                <DialogDescription className="text-[var(--stitch-muted)]">{t.dialogDesc}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label className="text-[var(--stitch-ink)]">{t.hostnameLabel}</Label>
                <Input
                  value={hostname}
                  onChange={(event) => setHostname(event.target.value)}
                  placeholder={t.hostnamePlaceholder}
                  autoFocus
                  className="border-[var(--stitch-line)] bg-[var(--stitch-surface)] text-[var(--stitch-ink)]"
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
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={resetCreate}>
                  {shared.cancel || "Cancel"}
                </Button>
                <Button type="submit" disabled={saving || sites.length === 0} className="stitch-primary">
                  {saving ? t.adding : t.next}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-5">
              <DialogHeader>
                <DialogTitle>{t.dnsTitle}</DialogTitle>
                <DialogDescription className="text-[var(--stitch-muted)]">{t.dnsDesc}</DialogDescription>
              </DialogHeader>
              <div className="rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-[5rem_1fr_1fr_auto] sm:items-center">
                  <div className="font-mono text-sm text-[var(--stitch-ink)]">CNAME</div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--stitch-muted)]">{t.recordHost}</div>
                    <div className="font-mono text-sm text-[var(--stitch-ink)]">{guideHost}</div>
                    <div className="text-xs text-[var(--stitch-muted)]">{guideHostname}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--stitch-muted)]">{t.recordValue}</div>
                    <code className="truncate font-mono text-sm text-[var(--stitch-ink)]">{cnameTarget}</code>
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleCopy(cnameTarget, "create")}>
                    {copied === "create" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <p className="text-sm text-[var(--stitch-muted)]">{t.verifyHint}</p>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busyKey === "verify-draft"}
                  onClick={handleVerifyDraft}
                >
                  {busyKey === "verify-draft" ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      {t.verifying}
                    </>
                  ) : (
                    t.verify
                  )}
                </Button>
                <Button
                  type="button"
                  disabled={!dnsReady}
                  className="stitch-primary"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    resetCreate();
                  }}
                >
                  {t.complete}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
