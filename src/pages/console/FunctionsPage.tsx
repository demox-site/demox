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
import { ArrowLeft, Copy, Loader2, Play, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { functionsApi, mapWebsiteRow, websiteApi, type SiteFunction } from "@/api";
import { getDisplayName, getSiteDomains } from "@/lib/website-utils";

const USER_LIST_TIMEOUT_MS = 12_000;

function siteApiPath(slug: string) {
  return `/api/${String(slug || "").trim()}`;
}

function siteApiUrl(site: any, slug: string) {
  const host = getSiteDomains(site || {})[0]?.host;
  if (!host || !slug) return "";
  return `https://${host}${siteApiPath(slug)}`;
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

const DEFAULT_SOURCE = `export default async function handler(request, env) {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true,
      site: env.SITE_ID,
      input: request.body
    })
  };
}`;

const texts = {
  zh: {
    title: "云函数",
    subtitle: "给当前站点加一段后端。发布后，前端用 fetch('/api/函数标识') 调用。",
    back: "返回站点设置",
    createTitle: "新建函数",
    createDesc: "发布后，这个站点上的页面可以用 fetch('/api/函数标识') 调用它。",
    name: "函数名称",
    slug: "函数标识",
    source: "函数代码",
    payload: "测试事件",
    create: "新建函数",
    creating: "发布中...",
    invoke: "测试调用",
    invoking: "调用中...",
    empty: "还没有函数。新建一个，前端就能 fetch('/api/标识')。",
    loadFailed: "函数列表加载失败",
    userListSlow: "函数列表仍在加载。",
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
    siteEnvTitle: "站点环境变量",
    siteEnvHint: "这个站点下的云函数都能读到。写在 handler(request, env) 的 env 里，例如 env.API_KEY。不会注入 Demox 平台密钥。",
    siteEnvKey: "变量名",
    siteEnvValue: "值",
    siteEnvAdd: "添加变量",
    siteEnvSave: "保存环境变量",
    siteEnvSaved: "环境变量已保存",
    siteEnvSaveFailed: "环境变量保存失败",
    siteEnvLoadFailed: "环境变量加载失败",
    invokeUrl: "站点调用地址",
    invokeHint: "在已部署的前端里这样调用：",
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
    subtitle: "Add a backend to this site. After publish, call it with fetch('/api/slug').",
    back: "Back to site settings",
    createTitle: "Create function",
    createDesc: "After publish, pages on this site can call it with fetch('/api/slug').",
    name: "Function name",
    slug: "Function ID",
    source: "Code",
    payload: "Test event",
    create: "Create function",
    creating: "Publishing...",
    invoke: "Test invoke",
    invoking: "Invoking...",
    empty: "No functions yet. Create one, then fetch('/api/slug') from the site.",
    loadFailed: "Failed to load functions",
    userListSlow: "Still loading functions.",
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
    siteEnvTitle: "Site environment variables",
    siteEnvHint: "Shared by every function on this site as handler(request, env), for example env.API_KEY. Demox platform secrets are not injected.",
    siteEnvKey: "Name",
    siteEnvValue: "Value",
    siteEnvAdd: "Add variable",
    siteEnvSave: "Save variables",
    siteEnvSaved: "Environment variables saved",
    siteEnvSaveFailed: "Failed to save environment variables",
    siteEnvLoadFailed: "Failed to load environment variables",
    invokeUrl: "Site URL",
    invokeHint: "Call it from the deployed frontend like this:",
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
  const [items, setItems] = useState<SiteFunction[]>([]);
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
  const [envRows, setEnvRows] = useState<Array<{ key: string; value: string }>>([{ key: "", value: "" }]);
  const [envSaving, setEnvSaving] = useState(false);
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

  const load = useCallback(async () => {
    if (!websiteId) return;
    setLoading(true);
    setUserListPending(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), USER_LIST_TIMEOUT_MS);
    try {
      const response = await functionsApi.list(websiteId, { signal: controller.signal });
      setItems(response.functions || []);
    } catch (error) {
      if ((error as { name?: string })?.name !== "AbortError") {
        toast({ title: t.loadFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
      } else {
        toast({ title: t.userListSlow });
      }
    } finally {
      window.clearTimeout(timer);
      setLoading(false);
      setUserListPending(false);
    }
  }, [t.loadFailed, t.userListSlow, toast, websiteId]);

  useEffect(() => {
    void loadWebsite();
  }, [loadWebsite]);

  useEffect(() => {
    if (websiteId) void load();
  }, [load, websiteId]);

  const loadEnv = useCallback(async () => {
    if (!websiteId) return;
    try {
      const response = await functionsApi.getEnv(websiteId);
      const entries = Object.entries(response.env || {});
      setEnvRows(entries.length ? entries.map(([key, value]) => ({ key, value })) : [{ key: "", value: "" }]);
    } catch (error) {
      setEnvRows([{ key: "", value: "" }]);
      toast({
        title: t.siteEnvLoadFailed,
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    }
  }, [t.siteEnvLoadFailed, toast, websiteId]);

  useEffect(() => {
    if (websiteId) void loadEnv();
  }, [loadEnv, websiteId]);

  const onSaveEnv = async () => {
    const env: Record<string, string> = {};
    for (const row of envRows) {
      const key = row.key.trim().toUpperCase();
      if (!key) continue;
      env[key] = row.value;
    }
    setEnvSaving(true);
    try {
      const saved = await functionsApi.putEnv(websiteId, env);
      const entries = Object.entries(saved.env || {});
      setEnvRows(entries.length ? entries.map(([key, value]) => ({ key, value })) : [{ key: "", value: "" }]);
      toast({ title: t.siteEnvSaved });
    } catch (error) {
      toast({
        title: t.siteEnvSaveFailed,
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    } finally {
      setEnvSaving(false);
    }
  };

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
      toast({ title: t.saved });
      await load();
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
      const siteUrl = siteApiUrl(website, selectedFunction.slug);
      let response = null;
      if (siteUrl) {
        try {
          const res = await fetch(siteUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body ?? {})
          });
          const parsed = await res.json().catch(async () => res.text());
          const looksLikeSiteFunction = res.ok || (parsed && typeof parsed === "object" && !String(parsed).includes("<"));
          if (looksLikeSiteFunction) response = { status: res.status, body: parsed, url: siteUrl };
        } catch {
          // Fall back to the management invoke path if the public site URL is not live yet.
        }
      }
      if (!response) {
        const invoked = await functionsApi.invoke(selectedFunction.functionId, body);
        response = { ...invoked, url: siteUrl || siteApiPath(selectedFunction.slug) };
      }
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

  const envLabel = selected?.env || "production";

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
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading || userListPending ? "animate-spin" : ""}`} />
              {t.refresh}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!websiteId}>
              <Plus className="mr-2 h-4 w-4" />
              {t.create}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-medium">{t.siteEnvTitle}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t.siteEnvHint}</p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEnvRows((current) => [...current, { key: "", value: "" }])}
              >
                <Plus className="mr-2 h-4 w-4" />
                {t.siteEnvAdd}
              </Button>
              <Button type="button" size="sm" onClick={() => void onSaveEnv()} disabled={envSaving || !websiteId}>
                {envSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t.siteEnvSave}
              </Button>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {envRows.map((row, index) => (
              <div key={index} className="grid grid-cols-[1fr_minmax(0,1.4fr)_auto] gap-2">
                <Input
                  value={row.key}
                  placeholder={t.siteEnvKey}
                  className="font-mono text-sm"
                  onChange={(event) => {
                    const value = event.target.value;
                    setEnvRows((current) => current.map((item, itemIndex) => (
                      itemIndex === index ? { ...item, key: value } : item
                    )));
                  }}
                />
                <Input
                  value={row.value}
                  placeholder={t.siteEnvValue}
                  className="font-mono text-sm"
                  onChange={(event) => {
                    const value = event.target.value;
                    setEnvRows((current) => current.map((item, itemIndex) => (
                      itemIndex === index ? { ...item, value } : item
                    )));
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEnvRows((current) => {
                    const next = current.filter((_, itemIndex) => itemIndex !== index);
                    return next.length ? next : [{ key: "", value: "" }];
                  })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
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
                        disabled={!siteApiUrl(website, item.slug)}
                        onClick={(event) => {
                          event.stopPropagation();
                          void copyUrl(siteApiUrl(website, item.slug));
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
                  <div className="mt-1 break-all font-mono text-xs">
                    {siteApiUrl(website, selected.slug) || siteApiPath(selected.slug)}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t.invokeHint}{" "}
                    <span className="font-mono">fetch('{siteApiPath(selected.slug)}')</span>
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>{t.code}</Label>
                  <Textarea
                    className="min-h-64 font-mono text-sm"
                    value={sourceLoading ? "" : editorSource}
                    disabled={sourceLoading}
                    onChange={(event) => setEditorSource(event.target.value)}
                  />
                  <Button onClick={onSave} disabled={saving || sourceLoading || !editorSource.trim()}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {saving ? t.saving : t.save}
                  </Button>
                </div>
                <div className="space-y-1.5">
                  <Label>{t.payload}</Label>
                  <Textarea className="min-h-24 font-mono text-sm" value={payload} onChange={(event) => setPayload(event.target.value)} />
                </div>
                <div className="flex gap-2">
                  <Button onClick={onInvoke} disabled={invoking}>
                    {invoking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                    {invoking ? t.invoking : t.invoke}
                  </Button>
                  <Button variant="outline" onClick={() => void copyUrl(siteApiUrl(website, selected.slug) || siteApiPath(selected.slug))}>
                    <Copy className="mr-2 h-4 w-4" />
                    {t.copyUrl}
                  </Button>
                </div>
                {result ? <pre className="overflow-auto rounded-md border bg-muted p-3 text-xs">{result}</pre> : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
