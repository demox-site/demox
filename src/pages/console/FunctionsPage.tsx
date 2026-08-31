import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  useToast
} from "@/components/ui";
import { ArrowLeft, Copy, Loader2, Play, Plus, RefreshCw, Search } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { functionsApi, mapWebsiteRow, tokenManager, websiteApi, type SiteFunction } from "@/api";
import { getDisplayName, getSiteDomains } from "@/lib/website-utils";
import {
  DEMOX_PLATFORM_WEBSITE_ID,
  hostnameFromSiteValue,
  isDemoxPlatformHost,
  isDemoxPlatformSite
} from "@/lib/official-domains";

const USER_LIST_TIMEOUT_MS = 12_000;

function platformHostFor(site: any): string {
  const hosts = [
    site?.url,
    site?.subdomain && `${site.subdomain}.${site.subdomainDomain || site.subdomain_domain || "demox.site"}`,
    ...getSiteDomains(site || {}).map((item: { host: string }) => item.host)
  ];
  return hosts.map((item) => hostnameFromSiteValue(String(item || ""))).find((item) => isDemoxPlatformHost(item)) || "www.demox.site";
}

function slugFromName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "fn";
}

function functionRuntime(item: SiteFunction) {
  const runtime = String(item.runtime || "").toLowerCase();
  if (runtime.includes("quick")) return "quickjs";
  if (item.editable === false || item.kind === "site" || item.kind === "system") return "nodejs";
  return runtime || "quickjs";
}

function functionStatus(item: SiteFunction) {
  if (item.publishedVersion) return "active";
  if (String(item.status || "").toLowerCase() === "active") return "active";
  return "unpublished";
}

function triggerLabels(item: SiteFunction) {
  const triggers = new Set((item.triggers || []).map((value) => String(value).toLowerCase()));
  if (item.invokeUrl || (item.routes || []).length) triggers.add("http");
  if (!triggers.size) triggers.add("http");
  return [...triggers];
}

function formatUpdatedAt(item: SiteFunction, locale: string) {
  const raw = item.updatedAt || item.createdAt;
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function builtinSource(item: SiteFunction) {
  const routes = (item.routes || []).join(" ");
  return `// ${item.name} (${item.slug})
// Runtime: Node.js  ·  Triggers: ${triggerLabels(item).join(", ")}
${routes ? `// Routes: ${routes}\n` : ""}// This builtin runs in the site Node.js runtime and cannot be edited here.
export default async function handler(request) {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ function: ${JSON.stringify(item.slug)}, builtin: true })
  };
}
`;
}

function localBuiltins(websiteId: string): SiteFunction[] {
  const base = functionsApi.baseUrl.replace(/\/+$/, "");
  return [
    { functionId: "system-auth", kind: "site", name: "Auth", slug: "system-auth", runtime: "nodejs", status: "active", publishedVersion: 1, routes: ["/auth", "/oauth"], triggers: ["http"], invokeUrl: `${base}/auth`, editable: false },
    { functionId: "system-website", kind: "site", name: "Website", slug: "system-website", runtime: "nodejs", status: "active", publishedVersion: 1, routes: ["/website"], triggers: ["http", "timer"], invokeUrl: `${base}/website`, editable: false },
    { functionId: "system-mcp", kind: "site", name: "Deploy / MCP", slug: "system-mcp", runtime: "nodejs", status: "active", publishedVersion: 1, routes: ["/deploy", "/websites", "/mcp"], triggers: ["http"], invokeUrl: `${base}/deploy`, editable: false },
    { functionId: "system-cert-renew", kind: "site", name: "Certificate renew", slug: "system-cert-renew", runtime: "nodejs", status: "active", publishedVersion: 1, routes: [], triggers: ["timer"], invokeUrl: null, editable: false }
  ].map((item) => ({ ...item, websiteId }));
}

const DEFAULT_SOURCE = `export default async function handler(request, env) {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true,
      input: request.body
    })
  };
}`;

const texts = {
  zh: {
    title: "云函数",
    subtitle: "函数属于当前站点，可在此查看运行状态、触发方式和调用地址。",
    back: "返回站点设置",
    createTitle: "新建函数",
    createDesc: "创建后会立即上传代码并发布为可调用版本。",
    name: "函数名称",
    slug: "函数标识",
    source: "函数代码",
    payload: "测试事件",
    create: "新建函数",
    creating: "发布中...",
    invoke: "测试调用",
    invoking: "调用中...",
    empty: "还没有函数。点击右上角新建一个。",
    loadFailed: "函数列表加载失败",
    userListSlow: "用户函数仍在同步，站点函数已可查看。",
    createFailed: "创建失败",
    invokeFailed: "调用失败",
    copied: "已复制调用地址",
    search: "搜索函数名称或标识",
    runtime: "运行环境",
    status: "状态",
    all: "全部",
    nodejs: "Node.js",
    quickjs: "QuickJS",
    active: "运行中",
    unpublished: "未发布",
    refresh: "刷新",
    nameColumn: "函数名称",
    triggerColumn: "触发方式",
    versionColumn: "版本",
    updatedColumn: "更新时间",
    actions: "操作",
    copyUrl: "复制地址",
    open: "详情",
    total: (count: number) => `共 ${count} 个函数`,
    env: "环境",
    invokeUrl: "调用地址",
    routes: "路径",
    timerOnly: "定时触发",
    code: "函数代码",
    save: "保存并发布",
    saving: "发布中...",
    saved: "已发布新版本",
    saveFailed: "保存失败",
    sourceFailed: "代码加载失败",
    builtinCodeHint: "这是站点内置函数，跑在 Node.js 可信运行时，不能在控制台改代码。要写自己的逻辑，请新建函数。"
  },
  en: {
    title: "Functions",
    subtitle: "Functions belong to this site. Check status, triggers, and invoke URLs here.",
    back: "Back to site settings",
    createTitle: "Create function",
    createDesc: "The function is published as an invokable version right after you create it.",
    name: "Function name",
    slug: "Function ID",
    source: "Code",
    payload: "Test event",
    create: "Create function",
    creating: "Publishing...",
    invoke: "Test invoke",
    invoking: "Invoking...",
    empty: "No functions yet. Create one to get started.",
    loadFailed: "Failed to load functions",
    userListSlow: "User functions are still syncing. Site functions are ready.",
    createFailed: "Create failed",
    invokeFailed: "Invoke failed",
    copied: "Invoke URL copied",
    search: "Search by name or ID",
    runtime: "Runtime",
    status: "Status",
    all: "All",
    nodejs: "Node.js",
    quickjs: "QuickJS",
    active: "Active",
    unpublished: "Unpublished",
    refresh: "Refresh",
    nameColumn: "Function name",
    triggerColumn: "Trigger",
    versionColumn: "Version",
    updatedColumn: "Last modified",
    actions: "Actions",
    copyUrl: "Copy URL",
    open: "Details",
    total: (count: number) => `${count} functions`,
    env: "Environment",
    invokeUrl: "Invoke URL",
    routes: "Routes",
    timerOnly: "Timer",
    code: "Code",
    save: "Save and publish",
    saving: "Publishing...",
    saved: "Published a new version",
    saveFailed: "Save failed",
    sourceFailed: "Failed to load code",
    builtinCodeHint: "This is a site builtin on the trusted Node.js runtime. Create a new function to write your own code."
  }
} as const;

export default function FunctionsPage() {
  const { projectId = "", websiteId = "" } = useParams();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = texts[language === "en" ? "en" : "zh"];
  const locale = language === "en" ? "en" : "zh-CN";
  const { toast } = useToast();
  const [website, setWebsite] = useState<any>(websiteId ? { websiteId } : null);
  const [items, setItems] = useState<SiteFunction[]>(() => (
    websiteId === DEMOX_PLATFORM_WEBSITE_ID ? localBuiltins(websiteId) : []
  ));
  const [name, setName] = useState("hello");
  const [slug, setSlug] = useState("hello");
  const [slugTouched, setSlugTouched] = useState(false);
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [payload, setPayload] = useState('{ "name": "Demox" }');
  const [selectedId, setSelectedId] = useState("");
  const [result, setResult] = useState("");
  const [creating, setCreating] = useState(false);
  const [invoking, setInvoking] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userListPending, setUserListPending] = useState(false);
  const [query, setQuery] = useState("");
  const [runtimeFilter, setRuntimeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editorSource, setEditorSource] = useState(DEFAULT_SOURCE);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const sourceCache = React.useRef(new Map<string, string>());

  const loadWebsite = useCallback(async () => {
    if (!websiteId) return;
    try {
      const response = await websiteApi.list({ projectId });
      const row = (response.websites || [])
        .map(mapWebsiteRow)
        .find((item: any) => item.websiteId === websiteId || item._id === websiteId);
      setWebsite(row || { websiteId });
    } catch {
      setWebsite({ websiteId });
    }
  }, [projectId, websiteId]);

  const mergeItems = useCallback((next: SiteFunction[]) => {
    setItems((current) => {
      const byId = new Map<string, SiteFunction>();
      for (const item of [...current, ...next]) byId.set(item.functionId, item);
      return [...byId.values()];
    });
  }, []);

  const load = useCallback(async (site: any) => {
    if (!websiteId) return;
    const platformSite = isDemoxPlatformSite(site) || websiteId === DEMOX_PLATFORM_WEBSITE_ID;
    setLoading(true);
    setUserListPending(true);
    if (platformSite) mergeItems(localBuiltins(websiteId));

    if (platformSite) {
      try {
        const builtins = await functionsApi.listSystem(platformHostFor(site));
        if (builtins.functions?.length) {
          setItems((current) => {
            const users = current.filter((item) => item.editable !== false);
            return [...builtins.functions, ...users];
          });
        }
      } catch (error) {
        toast({ title: t.loadFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
      }
    }

    setLoading(false);

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), USER_LIST_TIMEOUT_MS);
    try {
      const response = await functionsApi.list(websiteId, { signal: controller.signal });
      setItems((current) => {
        const builtins = current.filter((item) => item.editable === false);
        return [...builtins, ...(response.functions || [])];
      });
    } catch (error) {
      if ((error as { name?: string })?.name !== "AbortError") {
        toast({ title: t.userListSlow, description: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      window.clearTimeout(timer);
      setUserListPending(false);
    }
  }, [mergeItems, t.loadFailed, t.userListSlow, toast, websiteId]);

  useEffect(() => {
    void loadWebsite();
  }, [loadWebsite]);

  useEffect(() => {
    if (website) void load(website);
  }, [load, website]);

  const onCreate = async () => {
    setCreating(true);
    try {
      const created = await functionsApi.create(websiteId, name, slug);
      const version = await functionsApi.createVersion(created.function.functionId, source);
      await functionsApi.publish(created.function.functionId, version.version.version);
      setSelectedId(created.function.functionId);
      sourceCache.current.set(created.function.functionId, source);
      setEditorSource(source);
      setCreateOpen(false);
      await load(website);
    } catch (error) {
      toast({ title: t.createFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const onInvoke = async () => {
    const selectedFunction = items.find((item) => item.functionId === selectedId);
    if (!selectedFunction) return;
    setInvoking(true);
    try {
      let body: unknown = payload;
      try { body = JSON.parse(payload); } catch { /* keep raw string */ }
      const response = selectedFunction.editable === false && selectedFunction.invokeUrl
        ? await fetch(selectedFunction.invokeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(tokenManager.get() ? { Authorization: `Bearer ${tokenManager.get()}` } : {})
          },
          body: JSON.stringify(body ?? {})
        }).then(async (res) => ({ status: res.status, body: await res.json().catch(async () => res.text()) }))
        : await functionsApi.invoke(selectedFunction.functionId, body);
      setResult(JSON.stringify(response, null, 2));
    } catch (error) {
      toast({ title: t.invokeFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setInvoking(false);
    }
  };

  const copyUrl = async (url: string | null) => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast({ title: t.copied });
  };

  const selected = items.find((item) => item.functionId === selectedId) || null;
  const selectedEditable = Boolean(selected && selected.editable !== false);

  useEffect(() => {
    if (!selected) return;
    if (selected.editable === false) {
      setEditorSource(builtinSource(selected));
      setSourceLoading(false);
      return;
    }
    const cached = sourceCache.current.get(selected.functionId);
    if (cached) {
      setEditorSource(cached);
      setSourceLoading(false);
      return;
    }
    let cancelled = false;
    setSourceLoading(true);
    functionsApi.getSource(selected.functionId)
      .then((response) => {
        if (cancelled) return;
        sourceCache.current.set(selected.functionId, response.source);
        setEditorSource(response.source);
      })
      .catch((error) => {
        if (cancelled) return;
        setEditorSource(DEFAULT_SOURCE);
        toast({ title: t.sourceFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, t.sourceFailed, toast]);

  const onSave = async () => {
    if (!selected || !selectedEditable) return;
    setSaving(true);
    try {
      const version = await functionsApi.createVersion(selected.functionId, editorSource);
      const published = await functionsApi.publish(selected.functionId, version.version.version);
      sourceCache.current.set(selected.functionId, editorSource);
      setItems((current) => current.map((item) => (
        item.functionId === selected.functionId
          ? { ...item, publishedVersion: published.function.publishedVersion, invokeUrl: published.function.invokeUrl || item.invokeUrl }
          : item
      )));
      toast({ title: t.saved });
    } catch (error) {
      toast({ title: t.saveFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (runtimeFilter !== "all" && functionRuntime(item) !== runtimeFilter) return false;
      if (statusFilter !== "all" && functionStatus(item) !== statusFilter) return false;
      if (!needle) return true;
      return [item.name, item.slug, item.functionId, ...(item.routes || [])].join(" ").toLowerCase().includes(needle);
    });
  }, [items, query, runtimeFilter, statusFilter]);

  const envLabel = selected?.env || website?.subdomain || "production";

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <button
              type="button"
            onClick={() => navigate(`/console/projects/${projectId}/sites/${websiteId}`)}
            className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-[var(--stitch-muted)] transition-colors hover:text-[var(--stitch-ink)]"
          >
            <ArrowLeft className="h-4 w-4" />
            {t.back}
            </button>
            <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {website ? getDisplayName(website) : t.subtitle}
              <span className="mx-2 text-border">·</span>
              <span className="font-mono text-xs">{websiteId}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => website && void load(website)} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading || userListPending ? "animate-spin" : ""}`} />
              {t.refresh}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!websiteId}>
              <Plus className="mr-2 h-4 w-4" />
              {t.create}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.search}
              className="pl-9"
            />
          </div>
          <Select value={runtimeFilter} onValueChange={setRuntimeFilter}>
            <SelectTrigger className="sm:w-40">
              <SelectValue placeholder={t.runtime} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.runtime}: {t.all}</SelectItem>
              <SelectItem value="nodejs">{t.nodejs}</SelectItem>
              <SelectItem value="quickjs">{t.quickjs}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-36">
              <SelectValue placeholder={t.status} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.status}: {t.all}</SelectItem>
              <SelectItem value="active">{t.active}</SelectItem>
              <SelectItem value="unpublished">{t.unpublished}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {userListPending ? (
          <p className="text-xs text-muted-foreground">{t.userListSlow}</p>
        ) : null}

        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t.nameColumn}</TableHead>
                <TableHead className="w-28">{t.status}</TableHead>
                <TableHead className="w-28">{t.runtime}</TableHead>
                <TableHead>{t.triggerColumn}</TableHead>
                <TableHead className="w-20">{t.versionColumn}</TableHead>
                <TableHead className="w-36">{t.updatedColumn}</TableHead>
                <TableHead className="w-24 text-right">{t.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => {
                const status = functionStatus(item);
                const runtime = functionRuntime(item);
                return (
                  <TableRow
                    key={item.functionId}
                    className="cursor-pointer"
                    tabIndex={0}
                    data-state={selectedId === item.functionId ? "selected" : undefined}
                    onClick={() => {
                      setSelectedId(item.functionId);
                      setResult("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(item.functionId);
                        setResult("");
                      }
                    }}
                  >
                    <TableCell>
                      <div className="font-medium">{item.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{item.slug}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={status === "active" ? "success" : "warning"}>
                        {status === "active" ? t.active : t.unpublished}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{runtime === "nodejs" ? t.nodejs : t.quickjs}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {triggerLabels(item).map((trigger) => (
                          <Badge key={trigger} variant="outline" className="font-normal capitalize">
                            {trigger === "timer" ? t.timerOnly : trigger.toUpperCase()}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {item.publishedVersion ? `v${item.publishedVersion}` : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatUpdatedAt(item, locale)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!item.invokeUrl}
                        onClick={(event) => {
                          event.stopPropagation();
                          void copyUrl(item.invokeUrl);
                        }}
                      >
                        <Copy className="h-4 w-4" />
                        <span className="sr-only">{t.copyUrl}</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!filtered.length && !loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                    {t.empty}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <div className="border-t px-4 py-2 text-xs text-muted-foreground">{t.total(filtered.length)}</div>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.createTitle}</DialogTitle>
            <DialogDescription>{t.createDesc}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t.name}</Label>
                <Input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (!slugTouched) setSlug(slugFromName(event.target.value));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t.slug}</Label>
                <Input
                  value={slug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    setSlug(event.target.value);
                  }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t.source}</Label>
              <Textarea className="min-h-48 font-mono text-sm" value={source} onChange={(event) => setSource(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={onCreate} disabled={creating || !websiteId}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              {creating ? t.creating : t.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelectedId(""); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle>{selected.name}</SheetTitle>
                <SheetDescription className="font-mono">{selected.slug}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">{t.status}</div>
                    <div className="mt-1">{functionStatus(selected) === "active" ? t.active : t.unpublished}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t.runtime}</div>
                    <div className="mt-1">{functionRuntime(selected) === "nodejs" ? t.nodejs : t.quickjs}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t.env}</div>
                    <div className="mt-1 font-mono text-xs">{envLabel}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t.versionColumn}</div>
                    <div className="mt-1 font-mono text-xs">{selected.publishedVersion ? `v${selected.publishedVersion}` : "—"}</div>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t.invokeUrl}</div>
                  <div className="mt-1 break-all font-mono text-xs">{selected.invokeUrl || t.timerOnly}</div>
                </div>
                {(selected.routes || []).length ? (
                  <div>
                    <div className="text-xs text-muted-foreground">{t.routes}</div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">{selected.routes?.join(" · ")}</div>
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label>{t.code}</Label>
                  {!selectedEditable ? (
                    <p className="text-xs text-muted-foreground">{t.builtinCodeHint}</p>
                  ) : null}
                  <Textarea
                    className="min-h-64 font-mono text-sm"
                    value={sourceLoading ? "" : editorSource}
                    readOnly={!selectedEditable}
                    disabled={sourceLoading}
                    onChange={(event) => setEditorSource(event.target.value)}
                  />
                  {selectedEditable ? (
                    <Button onClick={onSave} disabled={saving || sourceLoading || !editorSource.trim()}>
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {saving ? t.saving : t.save}
                    </Button>
                  ) : null}
                </div>
                {selected.invokeUrl ? (
                  <>
                    <div className="space-y-1.5">
                      <Label>{t.payload}</Label>
                      <Textarea className="min-h-24 font-mono text-sm" value={payload} onChange={(event) => setPayload(event.target.value)} />
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={onInvoke} disabled={invoking}>
                        {invoking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                        {invoking ? t.invoking : t.invoke}
                      </Button>
                      <Button variant="outline" onClick={() => void copyUrl(selected.invokeUrl)}>
                        <Copy className="mr-2 h-4 w-4" />
                        {t.copyUrl}
                      </Button>
                    </div>
                    {result ? <pre className="overflow-auto rounded-md border bg-muted p-3 text-xs">{result}</pre> : null}
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
