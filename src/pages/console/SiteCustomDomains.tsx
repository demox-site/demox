import React from "react";
import {
  Badge,
  Button,
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
import { AlertCircle, Check, ChevronRight, Copy, Globe, Loader2, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { ConfirmDestructive } from "@/components/ui/confirm-destructive";
import { websiteApi, type ProjectCustomDomain } from "@/api";
import { CUSTOM_DOMAIN_CNAME_TARGET } from "@/lib/official-domains";
import { translations } from "../home-translations";

const texts = {
  zh: {
    title: "自定义域名",
    desc: "添加完整域名，再按指引写一条 CNAME。证书由 Demox 签发。",
    create: "添加域名",
    dialogTitle: "添加域名",
    dialogDesc: "填写要访问的完整域名。打开后会显示这个站点。",
    hostnameLabel: "完整域名",
    hostnamePlaceholder: "docs.example.com",
    hostnameHint: "不要带 https://",
    next: "下一步",
    adding: "创建中…",
    dnsTitle: "添加这条 CNAME",
    aFallbackToggle: "根域名写不了 CNAME？",
    aFallback: "如果 DNS 服务商不支持根域名写 CNAME，或根域名配了企业邮箱（MX 记录），改用 A 记录",
    close: "关闭",
    closeHint: "关掉也会在后台继续检测。",
    dnsDesc: "到域名服务商添加下面这条记录。",
    recordHost: "主机记录",
    recordValue: "记录值",
    copy: "复制",
    copied: "已复制",
    verify: "检测",
    verifying: "检测中…",
    complete: "完成",
    verifyHint: "加好记录后点检测。先查解析，再签发证书，都通了才能点完成。",
    steps: ["解析", "证书", "可访问"],
    stepWait: ["约 1–10 分钟", "约 2–5 分钟", ""],
    stuckDns: "卡在第 1 步：解析",
    stuckCert: "卡在第 2 步：证书",
    stuckGateway: "卡在第 2 步：平台入口",
    actionDns: "需要你改 DNS。改完不用重新添加。",
    actionCert: "超过 10 分钟还没好，请联系我们。",
    actionGateway: "这是平台问题，不用改 DNS，我们会处理。",
    autoCheck: "每 30 秒自动检测",
    lastChecked: "上次检测",
    doneTitle: "已可访问",
    icpTitle: "这个域名还没备案，大陆服务器接不进来",
    icpWhat: "先在腾讯云完成 ICP 备案，备案通过后回来点「检测」。DNS 记录可以先加好。",
    icpLink: "去备案",
    statusIcp: "需要先备案",
    verified: "自定义域名已可访问",
    verifyFailed: "还不能访问",
    verifyError: "检测失败",
    continueSetup: "继续配置",
    empty: "还没有绑定到这个站点的域名。",
    loadFailed: "域名列表加载失败",
    addFailed: "添加失败",
    removed: "域名已移除",
    removeFailed: "移除失败",
    statusPending: "未生效",
    statusDns: "卡在解析",
    statusCert: "签发证书中",
    statusActive: "已生效",
    remove: "移除",
    removeConfirm: "移除域名",
    removeTitle: "移除这个域名？",
    removeDesc: "域名服务商里的 CNAME 需要你自己删。",
    memberHint: "只有项目所有者和管理员可以改域名。",
    noHost: "请填写完整域名"
  },
  en: {
    title: "Custom domain",
    desc: "Add a full hostname, then create one CNAME. We issue the certificate.",
    create: "Add domain",
    dialogTitle: "Add domain",
    dialogDesc: "Enter the full hostname. It will open this site.",
    hostnameLabel: "Full hostname",
    hostnamePlaceholder: "docs.example.com",
    hostnameHint: "Without https://",
    next: "Next",
    adding: "Creating…",
    dnsTitle: "Add this CNAME",
    aFallbackToggle: "Can't add a CNAME on the root domain?",
    aFallback: "If your DNS provider doesn't allow a CNAME on the root domain, or the root domain has email (MX records), use an A record instead:",
    close: "Close",
    closeHint: "Checks keep running after you close this.",
    dnsDesc: "Create the record below at your DNS provider.",
    recordHost: "Host",
    recordValue: "Value",
    copy: "Copy",
    copied: "Copied",
    verify: "Check",
    verifying: "Checking…",
    complete: "Done",
    verifyHint: "Add the record, then Check. We check DNS first, then issue the certificate.",
    steps: ["DNS", "Certificate", "Live"],
    stepWait: ["~1–10 min", "~2–5 min", ""],
    stuckDns: "Stuck at step 1: DNS",
    stuckCert: "Stuck at step 2: certificate",
    stuckGateway: "Stuck at step 2: platform entrance",
    actionDns: "Change your DNS record. No need to add the domain again.",
    actionCert: "Contact us if it takes over 10 minutes.",
    actionGateway: "This is on our side. No DNS change needed.",
    autoCheck: "Auto-checking every 30s",
    lastChecked: "Last check",
    doneTitle: "Live",
    icpTitle: "This domain has no ICP filing, so our mainland servers can't serve it",
    icpWhat: "File it with Tencent Cloud ICP first, then come back and click Check. You can add the DNS record now.",
    icpLink: "Start ICP filing",
    statusIcp: "Needs ICP filing",
    verified: "Custom domain is reachable",
    verifyFailed: "Not reachable yet",
    verifyError: "Check failed",
    continueSetup: "Continue setup",
    empty: "No custom domain is bound to this site yet.",
    loadFailed: "Could not load domains",
    addFailed: "Could not add domain",
    removed: "Domain removed",
    removeFailed: "Could not remove domain",
    statusPending: "Not live",
    statusDns: "Stuck at DNS",
    statusCert: "Issuing certificate",
    statusActive: "Active",
    remove: "Remove",
    removeConfirm: "Remove domain",
    removeTitle: "Remove this domain?",
    removeDesc: "Delete the CNAME at your DNS provider yourself.",
    memberHint: "Only project owners and admins can change domains.",
    noHost: "Enter a full hostname"
  }
} as const;

// 只在还没拿到后端结果时兜底；正式的主机记录由后端按公共后缀表算（a.b.example.com → a.b）
function cnameHostFromHostname(hostname: string) {
  const value = String(hostname || "").trim().toLowerCase().replace(/\.+$/, "");
  if (!value) return "";
  const labels = value.split(".");
  return labels.length > 2 ? labels.slice(0, -2).join(".") : "@";
}

function belongsToSite(domain: ProjectCustomDomain, websiteId: string) {
  if (domain.defaultWebsiteId && String(domain.defaultWebsiteId) === String(websiteId)) return true;
  return (domain.routes || []).some((route) => String(route.websiteId || "") === String(websiteId));
}

type CheckStep = NonNullable<ProjectCustomDomain["checkStep"]>;
const STEP_ORDER: CheckStep[] = ["dns", "cert", "active"];
const ICP_FILING_URL = "https://console.cloud.tencent.com/beian";
// zinc/black/white 在亮色主题下会自动镜像（见 index.css），所以只写暗色一侧。
const ZINC_SECONDARY = "bg-zinc-800 text-zinc-100 hover:bg-zinc-700";
const ZINC_OUTLINE = "border-zinc-700 bg-transparent text-[var(--stitch-ink)] hover:bg-zinc-800";
const OPAQUE_CARD = "bg-zinc-950";
const AUTO_CHECK_MS = 30_000;
const AUTO_CHECK_LIMIT = 20;

function stepIndex(step?: CheckStep | null) {
  if (!step) return -1;
  return STEP_ORDER.indexOf(step === "gateway" ? "cert" : step);
}

function formatClock(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function CheckProgress({
  domain,
  checking,
  t
}: {
  domain: ProjectCustomDomain | null;
  checking: boolean;
  t: (typeof texts)["zh"] | (typeof texts)["en"];
}) {
  const step = domain?.checkStep && domain.checkedAt ? domain.checkStep : null;
  const current = stepIndex(step);
  const live = step === "active";
  const stuckTitle = step === "dns" ? t.stuckDns : step === "gateway" ? t.stuckGateway : t.stuckCert;
  const action = step === "dns" ? t.actionDns : step === "gateway" ? t.actionGateway : t.actionCert;
  if (step === "icp") {
    return (
      <div className={`space-y-1.5 rounded-xl border border-[var(--stitch-ink)] px-3 py-3 text-sm ${OPAQUE_CARD}`} role="status" data-testid="custom-domain-icp">
        <div className="flex items-start gap-1.5 font-medium text-[var(--stitch-ink)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t.icpTitle}</span>
        </div>
        <p className="text-[var(--stitch-muted)]">{t.icpWhat}</p>
        <a
          href={ICP_FILING_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center text-[var(--stitch-ink)] underline underline-offset-4"
        >
          {t.icpLink} · console.cloud.tencent.com/beian
        </a>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="custom-domain-progress">
      <ol className="grid grid-cols-3 gap-2">
        {t.steps.map((label, index) => {
          const done = current > index || (live && index === 2);
          const isCurrent = !live && current === index;
          const success = live && index === 2;
          return (
            <li
              key={label}
              className={`rounded-xl border px-3 py-2 ${OPAQUE_CARD} ${
                isCurrent ? "border-[var(--stitch-ink)]" : "border-[var(--stitch-line)]"
              }`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--stitch-ink)]">
                {success ? (
                  <Check className="h-4 w-4 text-[hsl(var(--success))]" />
                ) : done ? (
                  <Check className="h-4 w-4" />
                ) : isCurrent && checking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isCurrent ? (
                  <AlertCircle className="h-4 w-4" />
                ) : (
                  <span className="inline-flex h-4 w-4 items-center justify-center font-mono text-xs text-[var(--stitch-muted)]">{index + 1}</span>
                )}
                <span className={done || isCurrent ? "" : "text-[var(--stitch-muted)]"}>{label}</span>
              </div>
              {t.stepWait[index] ? (
                <div className="mt-0.5 text-xs text-[var(--stitch-muted)]">{t.stepWait[index]}</div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {!step ? (
        <p className="text-sm text-[var(--stitch-muted)]">{t.verifyHint}</p>
      ) : live ? (
        <p className="flex items-center gap-1.5 text-sm text-[var(--stitch-ink)]">
          <Check className="h-4 w-4 text-[hsl(var(--success))]" />
          {t.doneTitle}
        </p>
      ) : (
        <div className={`space-y-1 rounded-xl border border-[var(--stitch-line)] px-3 py-2.5 text-sm ${OPAQUE_CARD}`} role="status" aria-live="polite">
          <div className="font-medium text-[var(--stitch-ink)]">{stuckTitle}</div>
          {domain?.pendingMessage ? <div className="text-[var(--stitch-ink)]">{domain.pendingMessage}</div> : null}
          <div className="text-[var(--stitch-muted)]">{action}</div>
          <div className="text-xs text-[var(--stitch-muted)]">
            {t.lastChecked} {formatClock(domain?.checkedAt)} · {t.autoCheck}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SiteCustomDomains({
  projectId,
  websiteId,
  onChanged
}: {
  projectId: string;
  websiteId: string;
  onChanged?: () => void;
}) {
  const { language: lang } = useLanguage();
  const t = texts[lang === "en" ? "en" : "zh"];
  const shared = translations[lang === "en" ? "en" : "zh"];
  const { toast } = useToast();
  const [domains, setDomains] = React.useState<ProjectCustomDomain[]>([]);
  const [cnameTarget, setCnameTarget] = React.useState(CUSTOM_DOMAIN_CNAME_TARGET);
  const [canManage, setCanManage] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createStep, setCreateStep] = React.useState<"form" | "dns">("form");
  const [hostname, setHostname] = React.useState("");
  const [draftDomain, setDraftDomain] = React.useState<ProjectCustomDomain | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [busyKey, setBusyKey] = React.useState("");
  const [copied, setCopied] = React.useState("");
  // 备用 A 记录默认收起，点开才显示网关 IP
  const [fallbackOpen, setFallbackOpen] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<ProjectCustomDomain | null>(null);

  const siteDomains = domains.filter((item) => belongsToSite(item, websiteId));

  const loadPage = React.useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const domainRes = await websiteApi.listProjectCustomDomains(projectId);
      if (domainRes?.success) {
        setDomains(domainRes.domains || []);
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
    void loadPage();
  }, [loadPage]);

  // 弹窗关掉后也在后台继续检测：页面开着时，每分钟把本站未生效的域名静默测一次（最多 10 次）。
  const backgroundRounds = React.useRef(0);
  const [backgroundTick, setBackgroundTick] = React.useState(0);
  const pendingIds = domains
    .filter((item) => belongsToSite(item, websiteId) && item.status !== "active" && item.checkStep !== "icp")
    .map((item) => item.id)
    .join(",");
  React.useEffect(() => {
    if (!projectId || !canManage || !pendingIds || createOpen) return;
    if (backgroundRounds.current >= 10) return;
    const delay = backgroundRounds.current === 0 ? 1500 : 60_000;
    const timer = window.setTimeout(async () => {
      backgroundRounds.current += 1;
      for (const id of pendingIds.split(",")) {
        try {
          const res = await websiteApi.verifyProjectCustomDomain({ projectId, domainId: id });
          if (res?.success && res.domain) {
            const next = res.domain as ProjectCustomDomain;
            setDomains((current) => current.map((item) => (item.id === next.id ? next : item)));
          }
        } catch {
          // 后台检测失败不打扰用户
        }
      }
      setBackgroundTick((value) => value + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [projectId, canManage, pendingIds, createOpen, backgroundTick]);

  const resetCreate = () => {
    setCreateOpen(false);
    setCreateStep("form");
    setHostname("");
    setDraftDomain(null);
    setSaving(false);
    setFallbackOpen(false);
  };

  const openCreate = () => {
    setCreateStep("form");
    setHostname("");
    setDraftDomain(null);
    setCreateOpen(true);
  };

  const openDnsStep = (domain: ProjectCustomDomain) => {
    setDraftDomain(domain);
    setHostname(domain.hostname);
    setCreateStep("dns");
    setCreateOpen(true);
    // 回来继续配置时先测一次，直接告诉用户卡在哪一步
    void handleVerifyDraft({ silent: true, domain });
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
    if (!projectId || !websiteId) return;
    const nextHost = hostname.trim();
    if (!nextHost) {
      toast({ title: t.noHost, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await websiteApi.addProjectCustomDomain({
        projectId,
        hostname: nextHost,
        websiteId
      });
      if (!res?.success || !res.domain) throw new Error(res?.message || t.addFailed);
      let domain = res.domain as ProjectCustomDomain;
      if (!belongsToSite(domain, websiteId)) {
        const routed = await websiteApi.setProjectCustomDomainRoute({
          projectId,
          domainId: domain.id,
          label: "",
          websiteId
        });
        if (!routed?.success || !routed.domain) throw new Error(routed?.message || t.addFailed);
        domain = routed.domain;
      }
      setDomains((current) => [domain, ...current.filter((item) => item.id !== domain.id)]);
      setDraftDomain(domain);
      setCreateStep("dns");
      onChanged?.();
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

  const autoChecks = React.useRef(0);

  const handleVerifyDraft = async ({ silent = false, domain: target }: { silent?: boolean; domain?: ProjectCustomDomain } = {}) => {
    const draft = target || draftDomain;
    if (!projectId || !draft) return;
    if (!silent) autoChecks.current = 0;
    setBusyKey("verify-draft");
    try {
      const res = await websiteApi.verifyProjectCustomDomain({ projectId, domainId: draft.id });
      if (!res?.success || !res.domain) throw new Error(res?.message || t.verifyError);
      setDomains((current) => current.map((item) => (item.id === res.domain?.id ? res.domain as ProjectCustomDomain : item)));
      setDraftDomain(res.domain);
      const passed = res.domain.status === "active";
      onChanged?.();
      if (!silent || passed) {
        toast({
          title: passed ? t.verified : t.verifyFailed,
          description: res.message || ""
        });
      }
    } catch (error) {
      if (silent) return;
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
      setDomains((current) => current.filter((item) => item.id !== removeTarget.id));
      setRemoveTarget(null);
      onChanged?.();
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

  // 检测过一次、还没生效时，弹窗开着就每 30 秒自动再测，最多 10 分钟。
  const draftStep = draftDomain?.checkedAt ? draftDomain.checkStep : undefined;
  const draftCheckedAt = draftDomain?.checkedAt;
  React.useEffect(() => {
    if (!createOpen || createStep !== "dns" || !draftStep || draftStep === "active" || draftStep === "icp") return;
    if (busyKey === "verify-draft" || autoChecks.current >= AUTO_CHECK_LIMIT) return;
    const timer = window.setTimeout(() => {
      autoChecks.current += 1;
      void handleVerifyDraft({ silent: true });
    }, AUTO_CHECK_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createOpen, createStep, draftStep, draftCheckedAt, busyKey]);

  const guideHostname = draftDomain?.hostname || hostname;
  const guideHost = draftDomain?.recordName || draftDomain?.cnameHost || cnameHostFromHostname(guideHostname);
  // 一律写 CNAME（根域名也是 @ → 入口）。老数据里 recordType 可能是 A，也按 CNAME 显示。
  const guideType = "CNAME";
  const guideValue = draftDomain?.recordType === "A" ? cnameTarget : draftDomain?.recordValue || cnameTarget;
  const guideFallbackA = draftDomain?.apex && draftDomain?.fallbackRecordType === "A" ? draftDomain.fallbackRecordValue || "" : "";
  const guidePassed = draftDomain?.status === "active";

  return (
    <section className="site-settings-group mb-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-[var(--stitch-blue)]" />
            {t.title}
          </h3>
          <p className="site-settings-hint">{t.desc}</p>
        </div>
        {canManage ? (
          <Button type="button" size="sm" className="stitch-primary shrink-0 rounded-full" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t.create}
          </Button>
        ) : null}
      </div>

      {!canManage ? <p className="text-sm text-[var(--stitch-muted)]">{t.memberHint}</p> : null}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--stitch-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : null}
      {!loading && siteDomains.length === 0 ? (
        <p className="text-sm text-[var(--stitch-muted)]">{t.empty}</p>
      ) : null}

      {siteDomains.map((domain) => (
        <div key={domain.id} className="space-y-3 rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <a
                href={domain.url || `https://${domain.hostname}/`}
                target="_blank"
                rel="noreferrer"
                className="truncate font-medium text-[var(--stitch-ink)] hover:underline"
              >
                {domain.hostname}
              </a>
              <Badge
                variant={domain.status === "active" ? "default" : "secondary"}
                className={domain.status === "active" ? undefined : "border-transparent bg-zinc-800 text-zinc-300 hover:bg-zinc-800"}
              >
                {domain.status === "active"
                  ? t.statusActive
                  : domain.checkStep === "icp"
                    ? t.statusIcp
                    : domain.checkStep === "dns"
                    ? t.statusDns
                    : domain.checkStep === "cert" || domain.checkStep === "gateway"
                      ? t.statusCert
                      : t.statusPending}
              </Badge>
            </div>
            {canManage ? (
              <div className="flex shrink-0 items-center gap-2">
                {domain.status !== "active" ? (
                  <Button type="button" variant="outline" size="sm" className={ZINC_OUTLINE} onClick={() => openDnsStep(domain)}>
                    {t.continueSetup}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" size="sm" className={ZINC_OUTLINE} onClick={() => setRemoveTarget(domain)}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {t.remove}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ))}

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
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={resetCreate}>
                  {shared.cancel || "Cancel"}
                </Button>
                <Button type="submit" disabled={saving} className="stitch-primary">
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
              <div className="space-y-3 rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-4">
                <div className="grid gap-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto_auto] sm:items-center">
                  <div className="font-mono text-sm text-[var(--stitch-ink)]">{guideType}</div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--stitch-muted)]">{t.recordHost}</div>
                    <div className="font-mono text-sm text-[var(--stitch-ink)]">{guideHost}</div>
                    <div className="text-xs text-[var(--stitch-muted)]">{guideHostname}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--stitch-muted)]">{t.recordValue}</div>
                    <code className="block whitespace-nowrap font-mono text-sm text-[var(--stitch-ink)]">{guideValue}</code>
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => void handleCopy(guideValue, "create")}>
                    {copied === "create" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                {guideFallbackA ? (
                  <div className="text-xs text-[var(--stitch-muted)]" data-testid="custom-domain-a-fallback">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-[var(--stitch-ink)]"
                      aria-expanded={fallbackOpen}
                      onClick={() => setFallbackOpen((open) => !open)}
                    >
                      <ChevronRight className={`h-3 w-3 transition-transform ${fallbackOpen ? "rotate-90" : ""}`} />
                      {t.aFallbackToggle}
                    </button>
                    {fallbackOpen ? (
                      <p className="mt-1 pl-4">
                        {t.aFallback} <span className="whitespace-nowrap font-mono">@ → {guideFallbackA}</span>
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <CheckProgress domain={draftDomain} checking={busyKey === "verify-draft"} t={t} />
              {!guidePassed && draftDomain?.checkStep !== "icp" ? <p className="text-xs text-[var(--stitch-muted)]">{t.closeHint}</p> : null}
              {/* 手机和电脑按钮顺序一致：检测（次要）在左，关闭 / 完成在右 */}
              <DialogFooter className="flex-row justify-end gap-2 space-x-0 sm:space-x-0">
                <Button
                  type="button"
                  variant="secondary"
                  className={ZINC_SECONDARY}
                  disabled={busyKey === "verify-draft"}
                  onClick={() => void handleVerifyDraft()}
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
                {guidePassed ? (
                  <Button type="button" className="stitch-primary" onClick={() => resetCreate()}>
                    {t.complete}
                  </Button>
                ) : (
                  <Button type="button" variant="outline" className={ZINC_OUTLINE} onClick={() => resetCreate()}>
                    {t.close}
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDestructive
        open={Boolean(removeTarget)}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
        title={t.removeTitle}
        description={t.removeDesc}
        confirmLabel={t.removeConfirm}
        cancelLabel={shared.cancel || "Cancel"}
        busy={Boolean(removeTarget && busyKey === `remove:${removeTarget.id}`)}
        onConfirm={() => handleRemoveDomain()}
      />
    </section>
  );
}
