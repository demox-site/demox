import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
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
import { ArrowLeft, ChevronDown, Copy, Eye, EyeOff, Loader2, Play, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { functionsApi, mapWebsiteRow, websiteApi, type SiteFunction } from "@/api";
import { getDisplayName } from "@/lib/website-utils";

const USER_LIST_TIMEOUT_MS = 12_000;

function siteApiPath(slug: string) {
  return `/api/${String(slug || "").trim()}`;
}

function slugFromName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "fn";
}

function functionPublicPath(item: Pick<SiteFunction, "slug" | "routes">) {
  const route = (item.routes || [])[0];
  if (route) return route.startsWith("/") ? route : `/${route}`;
  return siteApiPath(item.slug);
}

function functionInvokeUrl(siteId: string, item: Pick<SiteFunction, "slug" | "routes">, alias = "production") {
  const websiteId = String(siteId || "").trim();
  const aliasName = String(alias || "production").trim() || "production";
  if (!websiteId) return "";
  return `${functionsApi.baseUrl}/${encodeURIComponent(websiteId)}/${encodeURIComponent(aliasName)}${functionPublicPath(item)}`;
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

function callSnippet(path: string) {
  return `fetch('${path}', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Demox' })
})`;
}

const DEFAULT_ALIASES = new Set(["production", "develop"]);

function sortAliases(items: Array<{ alias: string; version: number }>) {
  const rank = (name: string) => (name === "production" ? 0 : name === "develop" ? 1 : 2);
  return [...items].sort((a, b) => rank(a.alias) - rank(b.alias) || a.alias.localeCompare(b.alias));
}

const DEFAULT_SOURCE = `module.exports = async function handler(request, env) {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true,
      site: env.SITE_ID || process.env.SITE_ID,
      input: request.body
    })
  };
};
`;

const texts = {
  zh: {
    title: "云函数",
    subtitle: "给这个站点加一段后端。页面里用 fetch 就能调用。",
    back: "返回站点设置",
    createTitle: "新建函数",
    createDesc: "创建后得到 v1，production 和 develop 都指向 v1。页面可以用 fetch('/api/函数标识') 调用它。",
    name: "函数名称",
    slug: "调用标识",
    source: "函数代码",
    payload: "测试请求",
    create: "新建函数",
    creating: "创建中...",
    invoke: "测试调用",
    invoking: "调用中...",
    empty: "还没有函数。新建一个，页面里就能 fetch('/api/标识')。",
    emptyAction: "新建第一个函数",
    loadFailed: "函数列表加载失败",
    userListSlow: "函数列表仍在加载。",
    createFailed: "创建失败",
    invokeFailed: "调用失败",
    copied: "已复制",
    search: "搜索名称或标识",
    runtime: "运行环境",
    status: "状态",
    all: "全部",
    nodejs: "Node.js",
    active: "已发布",
    unpublished: "未发布",
    refresh: "刷新",
    nameColumn: "函数",
    pathColumn: "调用路径",
    triggerColumn: "触发",
    versionColumn: "版本",
    updatedColumn: "更新时间",
    actions: "操作",
    copyUrl: "复制地址",
    copySnippet: "复制调用代码",
    total: (count: number) => `共 ${count} 个函数`,
    env: "环境",
    siteEnvTitle: "这个函数的环境变量",
    siteEnvHint: "只注入当前函数，例如 env.API_KEY。不会带上 Demox 平台自己的密钥。",
    aliasTitle: "别名",
    aliasHint: "每个函数都会有 production 和 develop。改代码不会自动改指向，要在这里或 CLI 里改。",
    aliasName: "别名",
    aliasVersion: "版本",
    aliasAdd: "添加别名",
    aliasSaved: "别名已更新",
    aliasSaveFailed: "别名更新失败",
    aliasLoadFailed: "别名加载失败",
    aliasCreateFailed: "创建别名失败",
    aliasDeleted: "已删除别名",
    aliasDeleteFailed: "删除别名失败",
    aliasReserved: "默认别名不能删除",
    siteEnvShow: "显示密钥",
    siteEnvHide: "隐藏密钥",
    customRoutes: "自定义路径",
    customRoutesHint: "可选。默认是 /api/函数标识。需要 webhook 这类固定路径时再填，例如 /webhooks/stripe。",
    timerName: "定时触发",
    timerHint: "可选。填写后按这个名称接收定时事件。",
    advanced: "高级选项",
    nodejsHint: "代码在 Node.js 里运行，可用 require('mysql2')、require('jsonwebtoken')。",
    siteEnvKey: "变量名",
    siteEnvValue: "值",
    siteEnvAdd: "添加",
    siteEnvSave: "保存",
    siteEnvSaved: "已保存",
    siteEnvSaveFailed: "保存失败",
    siteEnvLoadFailed: "环境变量加载失败",
    invokeUrl: "调用地址",
    invokeHint: "在已部署的页面里这样调用：",
    howToCall: "页面里这样调用",
    afterPublish: "调用地址",
    routes: "路径",
    timerOnly: "定时",
    code: "代码",
    save: "保存为新版本",
    saving: "保存中...",
    saved: "已保存新版本，别名未改动",
    saveFailed: "保存失败",
    sourceFailed: "代码加载失败",
    builtinCodeHint: "这是站点内置函数，不能在这里改代码。要写自己的逻辑，请新建函数。",
    testResult: "调用结果"
  },
  en: {
    title: "Functions",
    subtitle: "Add a backend to this site. Call it with fetch from the page.",
    back: "Back to site settings",
    createTitle: "Create function",
    createDesc: "Creating it gives v1. production and develop both point at v1. Pages can call it with fetch('/api/slug').",
    name: "Name",
    slug: "ID",
    source: "Code",
    payload: "Test request",
    create: "Create function",
    creating: "Creating...",
    invoke: "Test",
    invoking: "Calling...",
    empty: "No functions yet. Create one, then fetch('/api/slug') from the site.",
    emptyAction: "Create the first function",
    loadFailed: "Failed to load functions",
    userListSlow: "Still loading functions.",
    createFailed: "Create failed",
    invokeFailed: "Call failed",
    copied: "Copied",
    search: "Search by name or ID",
    runtime: "Runtime",
    status: "Status",
    all: "All",
    nodejs: "Node.js",
    active: "Published",
    unpublished: "Draft",
    refresh: "Refresh",
    nameColumn: "Function",
    pathColumn: "Path",
    triggerColumn: "Trigger",
    versionColumn: "Version",
    updatedColumn: "Updated",
    actions: "Actions",
    copyUrl: "Copy URL",
    copySnippet: "Copy snippet",
    total: (count: number) => `${count} functions`,
    env: "Environment",
    siteEnvTitle: "This function's environment variables",
    siteEnvHint: "Injected only into this function, for example env.API_KEY. Demox platform secrets are not included.",
    aliasTitle: "Aliases",
    aliasHint: "Every function has production and develop. Uploading code does not move them; change the target here or with the CLI.",
    aliasName: "Alias",
    aliasVersion: "Version",
    aliasAdd: "Add alias",
    aliasSaved: "Alias updated",
    aliasSaveFailed: "Failed to update alias",
    aliasLoadFailed: "Failed to load aliases",
    aliasCreateFailed: "Failed to create alias",
    aliasDeleted: "Alias deleted",
    aliasDeleteFailed: "Failed to delete alias",
    aliasReserved: "Default aliases cannot be deleted",
    siteEnvShow: "Show values",
    siteEnvHide: "Hide values",
    customRoutes: "Custom path",
    customRoutesHint: "Optional. The default is /api/slug. Use this for a fixed path such as /webhooks/stripe.",
    timerName: "Timer",
    timerHint: "Optional. Receive timer events under this name.",
    advanced: "Advanced",
    nodejsHint: "Runs on Node.js. You can require('mysql2') and require('jsonwebtoken').",
    siteEnvKey: "Name",
    siteEnvValue: "Value",
    siteEnvAdd: "Add",
    siteEnvSave: "Save",
    siteEnvSaved: "Saved",
    siteEnvSaveFailed: "Failed to save",
    siteEnvLoadFailed: "Failed to load environment variables",
    invokeUrl: "URL",
    invokeHint: "Call it from the deployed page like this:",
    howToCall: "Call it from the page",
    afterPublish: "URL",
    routes: "Routes",
    timerOnly: "Timer",
    code: "Code",
    save: "Save as new version",
    saving: "Saving...",
    saved: "Saved a new version; aliases were not changed",
    saveFailed: "Save failed",
    sourceFailed: "Failed to load code",
    builtinCodeHint: "This is a site builtin and cannot be edited here. Create a new function to write your own code.",
    testResult: "Result"
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
  const [createRoutes, setCreateRoutes] = useState("");
  const [createTimer, setCreateTimer] = useState("");
  const [createAdvanced, setCreateAdvanced] = useState(false);
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
  const [statusFilter, setStatusFilter] = useState("all");
  const [editorSource, setEditorSource] = useState(DEFAULT_SOURCE);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [envRows, setEnvRows] = useState<Array<{ key: string; value: string }>>([{ key: "", value: "" }]);
  const [envSaving, setEnvSaving] = useState(false);
  const [envVisible, setEnvVisible] = useState(false);
  const [aliases, setAliases] = useState<Array<{ alias: string; version: number }>>([]);
  const [versions, setVersions] = useState<Array<{ version: number; status: string }>>([]);
  const [newAliasName, setNewAliasName] = useState("");
  const [newAliasVersion, setNewAliasVersion] = useState("");
  const [aliasSaving, setAliasSaving] = useState(false);
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

  const resetCreateForm = () => {
    setName("hello");
    setSlug("hello");
    setSlugTouched(false);
    setCreateRoutes("");
    setCreateTimer("");
    setCreateAdvanced(false);
    setSource(DEFAULT_SOURCE);
  };

  const onCreate = async () => {
    setCreating(true);
    try {
      const routes = createRoutes.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
      const timerName = createTimer.trim();
      const created = await functionsApi.create(websiteId, name, slug, {
        runtime: "nodejs",
        routes,
        triggers: timerName ? ["http", "timer"] : ["http"],
        timerName: timerName || undefined
      });
      await functionsApi.createVersion(created.function.functionId, source);
      setSelectedId(created.function.functionId);
      sourceCache.current.set(created.function.functionId, source);
      setEditorSource(source);
      setCreateOpen(false);
      resetCreateForm();
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
      const invokeUrl = functionInvokeUrl(selectedFunction.websiteId || websiteId, selectedFunction);
      let response = null;
      if (invokeUrl) {
        try {
          const res = await fetch(invokeUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body ?? {})
          });
          const parsed = await res.json().catch(async () => res.text());
          const looksLikeSiteFunction = res.ok || (parsed && typeof parsed === "object" && !String(parsed).includes("<"));
          if (looksLikeSiteFunction) response = { status: res.status, body: parsed, url: invokeUrl };
        } catch {
          // Fall back to the management invoke path if the public function URL is not live yet.
        }
      }
      if (!response) {
        const invoked = await functionsApi.invoke(selectedFunction.functionId, body);
        response = { ...invoked, url: invokeUrl || siteApiPath(selectedFunction.slug) };
      }
      setResult(JSON.stringify(response, null, 2));
    } catch (error) {
      toast({ title: t.invokeFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setInvoking(false);
    }
  };

  const copyText = async (value: string, title = t.copied) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast({ title });
  };

  const selected = items.find((item) => item.functionId === selectedId) || null;
  const selectedEditable = Boolean(selected && selected.editable !== false);
  const availableVersions = versions.filter((item) => item.status !== "failed" && item.status !== "draft");

  const onSaveEnv = async () => {
    if (!selected) return;
    const env: Record<string, string> = {};
    for (const row of envRows) {
      const key = row.key.trim().toUpperCase();
      if (!key) continue;
      env[key] = row.value;
    }
    setEnvSaving(true);
    try {
      const saved = await functionsApi.putFunctionEnv(selected.functionId, env);
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

  const refreshAliases = async (functionId: string) => {
    const [aliasResult, versionResult] = await Promise.allSettled([
      functionsApi.listAliases(functionId),
      functionsApi.listVersions(functionId)
    ]);
    if (versionResult.status === "fulfilled") {
      setVersions(versionResult.value.versions || []);
      const latest = (versionResult.value.versions || []).find((item) => item.status !== "failed" && item.status !== "draft");
      if (latest) setNewAliasVersion(String(latest.version));
    }
    if (aliasResult.status === "fulfilled") {
      setAliases(sortAliases(aliasResult.value.aliases || []));
      return;
    }
    setAliases([]);
    throw aliasResult.reason;
  };

  const onSetAlias = async (alias: string, version: number) => {
    if (!selected) return;
    setAliasSaving(true);
    try {
      const saved = await functionsApi.setAlias(selected.functionId, alias, version);
      setAliases((current) => sortAliases(current.map((item) => (
        item.alias === saved.alias.alias ? { alias: saved.alias.alias, version: saved.alias.version } : item
      ))));
      toast({ title: t.aliasSaved, description: `${saved.alias.alias} → v${saved.alias.version}` });
    } catch (error) {
      toast({
        title: t.aliasSaveFailed,
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    } finally {
      setAliasSaving(false);
    }
  };

  const onCreateAlias = async () => {
    if (!selected) return;
    const alias = newAliasName.trim().toLowerCase();
    const version = Number(newAliasVersion);
    if (!alias || !version) return;
    setAliasSaving(true);
    try {
      const saved = await functionsApi.setAlias(selected.functionId, alias, version);
      setAliases((current) => sortAliases([
        ...current.filter((item) => item.alias !== saved.alias.alias),
        { alias: saved.alias.alias, version: saved.alias.version }
      ]));
      setNewAliasName("");
      toast({ title: t.aliasSaved, description: `${saved.alias.alias} → v${saved.alias.version}` });
    } catch (error) {
      toast({
        title: t.aliasCreateFailed,
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    } finally {
      setAliasSaving(false);
    }
  };

  const onDeleteAlias = async (alias: string) => {
    if (!selected) return;
    if (DEFAULT_ALIASES.has(alias)) {
      toast({ title: t.aliasReserved, variant: "destructive" });
      return;
    }
    setAliasSaving(true);
    try {
      await functionsApi.deleteAlias(selected.functionId, alias);
      setAliases((current) => current.filter((item) => item.alias !== alias));
      toast({ title: t.aliasDeleted });
    } catch (error) {
      toast({
        title: t.aliasDeleteFailed,
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    } finally {
      setAliasSaving(false);
    }
  };

  useEffect(() => {
    if (!selected) {
      setEnvRows([{ key: "", value: "" }]);
      setAliases([]);
      setVersions([]);
      setNewAliasName("");
      setNewAliasVersion("");
      return;
    }
    let cancelled = false;
    functionsApi.getFunctionEnv(selected.functionId)
      .then((response) => {
        if (cancelled) return;
        const entries = Object.entries(response.env || {});
        setEnvRows(entries.length ? entries.map(([key, value]) => ({ key, value })) : [{ key: "", value: "" }]);
      })
      .catch((error) => {
        if (cancelled) return;
        setEnvRows([{ key: "", value: "" }]);
        toast({
          title: t.siteEnvLoadFailed,
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive"
        });
      });
    refreshAliases(selected.functionId).catch((error) => {
      if (cancelled) return;
      setAliases([]);
      toast({
        title: t.aliasLoadFailed,
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    });
    return () => {
      cancelled = true;
    };
  }, [selected?.functionId, t.aliasLoadFailed, t.siteEnvLoadFailed, toast]);

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
      sourceCache.current.set(selected.functionId, editorSource);
      setItems((current) => current.map((item) => (
        item.functionId === selected.functionId
          ? { ...item, publishedVersion: version.version.version }
          : item
      )));
      await refreshAliases(selected.functionId);
      toast({ title: t.saved, description: `v${version.version.version}` });
    } catch (error) {
      toast({ title: t.saveFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "all" && functionStatus(item) !== statusFilter) return false;
      if (!needle) return true;
      return [item.name, item.slug, item.functionId, ...(item.routes || [])].join(" ").toLowerCase().includes(needle);
    });
  }, [items, query, statusFilter]);

  const exampleItem = filtered[0] || items[0] || { slug: slug || "hello", routes: [] } as SiteFunction;
  const examplePath = functionPublicPath(exampleItem);
  const exampleSnippet = callSnippet(examplePath);
  const previewPath = createRoutes.trim().split(/[\s,]+/).filter(Boolean)[0] || siteApiPath(slug);
  const previewUrl = functionInvokeUrl(websiteId, { slug, routes: previewPath === siteApiPath(slug) ? [] : [previewPath] });

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
              {t.subtitle}
              {website ? (
                <>
                  <span className="mx-2 text-border">·</span>
                  {getDisplayName(website)}
                </>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading || userListPending ? "animate-spin" : ""}`} />
              {t.refresh}
            </Button>
            <Button size="sm" onClick={() => { resetCreateForm(); setCreateOpen(true); }} disabled={!websiteId}>
              <Plus className="mr-2 h-4 w-4" />
              {t.create}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-medium">{t.howToCall}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t.invokeHint}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyText(exampleSnippet, t.copied)}>
              <Copy className="mr-2 h-4 w-4" />
              {t.copySnippet}
            </Button>
          </div>
          <pre className="mt-3 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs leading-5">{exampleSnippet}</pre>
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
                <TableHead>{t.pathColumn}</TableHead>
                <TableHead>{t.triggerColumn}</TableHead>
                <TableHead className="w-20">{t.versionColumn}</TableHead>
                <TableHead className="w-36">{t.updatedColumn}</TableHead>
                <TableHead className="w-24 text-right">{t.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => {
                const status = functionStatus(item);
                const path = functionPublicPath(item);
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
                    <TableCell className="font-mono text-xs text-muted-foreground">{path}</TableCell>
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
                        onClick={(event) => {
                          event.stopPropagation();
                          void copyText(functionInvokeUrl(item.websiteId || websiteId, item) || path);
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
                  <TableCell colSpan={7} className="py-12 text-center">
                    <p className="text-sm text-muted-foreground">{t.empty}</p>
                    <Button className="mt-4" size="sm" onClick={() => { resetCreateForm(); setCreateOpen(true); }} disabled={!websiteId}>
                      <Plus className="mr-2 h-4 w-4" />
                      {t.emptyAction}
                    </Button>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <div className="border-t px-4 py-2 text-xs text-muted-foreground">{t.total(filtered.length)}</div>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (open) resetCreateForm(); }}>
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
            <p className="text-xs text-muted-foreground">
              {t.afterPublish}
              {" "}
              <span className="font-mono">{previewUrl}</span>
            </p>
            <div className="space-y-1.5">
              <Label>{t.source}</Label>
              <Textarea className="min-h-48 font-mono text-sm" value={source} onChange={(event) => setSource(event.target.value)} />
              <p className="text-xs text-muted-foreground">{t.nodejsHint}</p>
            </div>
            <Collapsible open={createAdvanced} onOpenChange={setCreateAdvanced}>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ChevronDown className={`h-4 w-4 transition-transform ${createAdvanced ? "rotate-0" : "-rotate-90"}`} />
                {t.advanced}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 grid gap-3">
                <div className="space-y-1.5">
                  <Label>{t.customRoutes}</Label>
                  <Input value={createRoutes} onChange={(event) => setCreateRoutes(event.target.value)} placeholder="/webhooks/stripe" />
                  <p className="text-xs text-muted-foreground">{t.customRoutesHint}</p>
                </div>
                <div className="space-y-1.5">
                  <Label>{t.timerName}</Label>
                  <Input value={createTimer} onChange={(event) => setCreateTimer(event.target.value)} />
                  <p className="text-xs text-muted-foreground">{t.timerHint}</p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          <DialogFooter>
            <Button onClick={onCreate} disabled={creating || !websiteId || !slug.trim()}>
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
                <SheetDescription className="font-mono">{functionPublicPath(selected)}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">{t.status}</div>
                    <div className="mt-1">{functionStatus(selected) === "active" ? t.active : t.unpublished}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t.versionColumn}</div>
                    <div className="mt-1 font-mono text-xs">{selected.publishedVersion ? `v${selected.publishedVersion}` : "—"}</div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div>
                    <div className="text-sm font-medium">{t.aliasTitle}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{t.aliasHint}</p>
                  </div>
                  <div className="space-y-2">
                    {aliases.map((item) => (
                      <div key={item.alias} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-2">
                        <div className="font-mono text-xs">{item.alias}</div>
                        <Select
                          value={String(item.version)}
                          disabled={aliasSaving || !availableVersions.length}
                          onValueChange={(value) => { void onSetAlias(item.alias, Number(value)); }}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder={t.aliasVersion} />
                          </SelectTrigger>
                          <SelectContent>
                            {availableVersions.map((version) => (
                              <SelectItem key={version.version} value={String(version.version)}>
                                v{version.version}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {DEFAULT_ALIASES.has(item.alias) ? (
                          <span className="sr-only">{t.aliasReserved}</span>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={aliasSaving}
                            onClick={() => void onDeleteAlias(item.alias)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-2">
                    <Input
                      value={newAliasName}
                      placeholder={t.aliasName}
                      autoComplete="off"
                      className="h-8 font-mono text-sm"
                      onChange={(event) => setNewAliasName(event.target.value)}
                    />
                    <Select
                      value={newAliasVersion}
                      disabled={!availableVersions.length}
                      onValueChange={setNewAliasVersion}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder={t.aliasVersion} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableVersions.map((version) => (
                          <SelectItem key={version.version} value={String(version.version)}>
                            v{version.version}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={aliasSaving || !newAliasName.trim() || !newAliasVersion}
                      onClick={() => void onCreateAlias()}
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      {t.aliasAdd}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-sm font-medium">{t.siteEnvTitle}</div>
                      <p className="mt-1 text-xs text-muted-foreground">{t.siteEnvHint}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEnvVisible((current) => !current)}
                      >
                        {envVisible ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                        {envVisible ? t.siteEnvHide : t.siteEnvShow}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEnvRows((current) => [...current, { key: "", value: "" }])}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        {t.siteEnvAdd}
                      </Button>
                      <Button type="button" size="sm" onClick={() => void onSaveEnv()} disabled={envSaving}>
                        {envSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {t.siteEnvSave}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {envRows.map((row, index) => (
                      <div key={index} className="grid grid-cols-[1fr_minmax(0,1.4fr)_auto] gap-2">
                        <Input
                          value={row.key}
                          placeholder={t.siteEnvKey}
                          autoComplete="off"
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
                          type={envVisible ? "text" : "password"}
                          placeholder={t.siteEnvValue}
                          autoComplete="new-password"
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
                <div>
                  <div className="text-xs text-muted-foreground">{t.invokeUrl}</div>
                  <div className="mt-1 space-y-1">
                    {(aliases.length ? aliases : [{ alias: "production", version: selected.publishedVersion || 0 }]).map((item) => (
                      <div key={item.alias} className="break-all font-mono text-xs">
                        {functionInvokeUrl(selected.websiteId || websiteId, selected, item.alias)}
                      </div>
                    ))}
                  </div>
                  <pre className="mt-3 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs leading-5">
                    {callSnippet(functionPublicPath(selected))}
                  </pre>
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void copyText(callSnippet(functionPublicPath(selected)))}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      {t.copySnippet}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void copyText(functionInvokeUrl(selected.websiteId || websiteId, selected) || functionPublicPath(selected))}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      {t.copyUrl}
                    </Button>
                  </div>
                </div>
                {(selected.routes || []).length ? (
                  <div>
                    <div className="text-xs text-muted-foreground">{t.routes}</div>
                    <div className="mt-1 font-mono text-xs">{selected.routes?.join(", ")}</div>
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
                    disabled={sourceLoading || !selectedEditable}
                    onChange={(event) => setEditorSource(event.target.value)}
                  />
                  {selectedEditable ? (
                    <Button onClick={onSave} disabled={saving || sourceLoading || !editorSource.trim()}>
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {saving ? t.saving : t.save}
                    </Button>
                  ) : null}
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
                </div>
                {result ? (
                  <div>
                    <div className="text-xs text-muted-foreground">{t.testResult}</div>
                    <pre className="mt-1 overflow-auto rounded-md border bg-muted p-3 text-xs">{result}</pre>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
