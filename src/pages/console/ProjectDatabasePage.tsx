import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useToast } from "@/components/ui";
import { ConfirmDestructive } from "@/components/ui/confirm-destructive";
import { ArrowLeft, Copy, Eye, EyeOff, Plus, RefreshCw, Search } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { websiteApi, type ProjectColumn, type ProjectRow, type ProjectTable } from "@/api";
import config from "@/configs/env";
import { translations } from "../home-translations";
import { useProjects } from "../use-projects";

const TABLE_TABS = ["data", "schema", "settings"] as const;
type TableTab = (typeof TABLE_TABS)[number];

const texts = {
  zh: {
    title: "数据库",
    subtitle: "在这个项目里查看和编辑表。",
    navTables: "表",
    navNew: "新建",
    searchTables: "搜索表或列",
    searchRows: "在已加载的行里搜索",
    refresh: "刷新",
    createTable: "新建表",
    tableName: "表名",
    columns: "列",
    rows: "行",
    created: "创建时间",
    emptyTables: "还没有表。",
    emptyAction: "新建第一张表",
    loadFailed: "加载失败",
    saveFailed: "保存失败",
    saved: "已保存",
    deleted: "已删除",
    total: (count: number) => `共 ${count} 张表`,
    rowTotal: (count: number) => `已加载 ${count} 行`,
    columnName: "列名",
    columnType: "类型",
    addColumn: "添加列",
    text: "文本",
    number: "数字",
    boolean: "是/否",
    yes: "是",
    no: "否",
    primary: "主键",
    primaryHint: "选一列文本作为主键。保存相同主键会覆盖这一行。改主键会另存一行。",
    nameRule: "名称以字母开头，只能用小写字母、数字和下划线。",
    backList: "返回表",
    tabs: { data: "数据", schema: "结构", settings: "设置" },
    emptyRows: "还没有数据。",
    noMatch: "没有匹配的行。",
    noTableMatch: "没有匹配的表。",
    insert: "插入行",
    saveRow: "保存这一行",
    cancelEdit: "取消",
    deleteRow: "删除这一行",
    deleteRowTitle: "删除这一行",
    deleteRowDesc: "这一行会从这张表里去掉。",
    loadMore: "加载更多",
    schemaHint: "建表之后不能改列。要换结构，请新建一张表。",
    type: "类型",
    settingsHint: "删除表会同时删掉里面的行。",
    deleteTable: "删除表",
    deleteTableTitle: "删除这张表",
    deleteTableDesc: "表和里面的行都会去掉。",
    cancel: "取消",
    connect: "连接",
    connectTitle: "连接",
    connectHint: "用主机、端口、用户名和密码连接，或者用 API。",
    tabDirect: "主机",
    tabApi: "API",
    host: "主机",
    port: "端口",
    username: "用户名",
    password: "密码",
    showPassword: "显示密码",
    hidePassword: "隐藏密码",
    directHint: "用这四项连数据库。用户名是项目 ID，密码只属于这个项目。",
    apiHint: "也可以用访问令牌调 API。令牌在访问令牌页创建，放在 Authorization: Bearer 里。",
    copyValue: "复制",
    copied: "已复制",
    passwordLoading: "正在读取密码",
    passwordReadOnly: "需要这个项目的写权限才能看密码。",
    passwordFailed: "密码没有读到"
  },
  en: {
    title: "Database",
    subtitle: "View and edit tables in this project.",
    navTables: "Tables",
    navNew: "New",
    searchTables: "Search tables or columns",
    searchRows: "Search loaded rows",
    refresh: "Refresh",
    createTable: "New table",
    tableName: "Table",
    columns: "Columns",
    rows: "Rows",
    created: "Created",
    emptyTables: "No tables yet.",
    emptyAction: "Create the first table",
    loadFailed: "Could not load",
    saveFailed: "Could not save",
    saved: "Saved",
    deleted: "Deleted",
    total: (count: number) => `${count} tables`,
    rowTotal: (count: number) => `${count} rows loaded`,
    columnName: "Column",
    columnType: "Type",
    addColumn: "Add column",
    text: "Text",
    number: "Number",
    boolean: "Yes / no",
    yes: "Yes",
    no: "No",
    primary: "Primary",
    primaryHint: "Pick one text column as the primary key. Saving the same key replaces that row. Changing the key stores another row.",
    nameRule: "Names start with a letter and use lowercase letters, digits, and underscores.",
    backList: "Back to tables",
    tabs: { data: "Data", schema: "Schema", settings: "Settings" },
    emptyRows: "No rows yet.",
    noMatch: "No matching rows.",
    noTableMatch: "No matching tables.",
    insert: "Insert row",
    saveRow: "Save row",
    cancelEdit: "Cancel",
    deleteRow: "Delete this row",
    deleteRowTitle: "Delete this row",
    deleteRowDesc: "This row will be removed from the table.",
    loadMore: "Load more",
    schemaHint: "Columns cannot be changed after the table is created. Create another table for a different shape.",
    type: "Type",
    settingsHint: "Deleting the table also deletes its rows.",
    deleteTable: "Delete table",
    deleteTableTitle: "Delete this table",
    deleteTableDesc: "The table and its rows will be removed.",
    cancel: "Cancel",
    connect: "Connect",
    connectTitle: "Connect",
    connectHint: "Connect with host, port, username, and password, or use the API.",
    tabDirect: "Host",
    tabApi: "API",
    host: "Host",
    port: "Port",
    username: "Username",
    password: "Password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    directHint: "Connect to the database with these four values. The username is the project ID, and the password belongs to this project.",
    apiHint: "You can also call the API with an access token. Create it on the Access Tokens page and send Authorization: Bearer.",
    copyValue: "Copy",
    copied: "Copied",
    passwordLoading: "Loading password",
    passwordReadOnly: "Write access to this project is required to view the password.",
    passwordFailed: "Could not load the password"
  }
} as const;

const DB_HOST = "db.demox.site";
const DB_PORT = "3306";

function apiBase() {
  return config.websiteApiUrl.replace(/\/+$/, "");
}

function directSnippet(username: string, password: string) {
  const secret = password || "PASSWORD";
  return `mysql -h ${DB_HOST} -P ${DB_PORT} -u '${username}' -p'${secret}'`;
}

function apiSnippet(username: string) {
  const base = apiBase();
  return `curl -X POST '${base}/website/list-project-rows' \\
  -H 'Authorization: Bearer $DEMOX_TOKEN' \\
  -H 'Content-Type: application/json' \\
  --data '{"action":"list_project_rows","projectId":"${username}","table":"notes","limit":50}'

curl -X POST '${base}/website/put-project-row' \\
  -H 'Authorization: Bearer $DEMOX_TOKEN' \\
  -H 'Content-Type: application/json' \\
  --data '{"action":"put_project_row","projectId":"${username}","table":"notes","values":{"id":"1","body":"hello"}}'`;
}

type ColumnDraft = { name: string; type: ProjectColumn["type"]; primary: boolean };
type Copy = (typeof texts)["zh"];

function useDatabaseCopy() {
  const { language } = useLanguage();
  const lang = language === "en" ? "en" : "zh";
  return { copy: texts[lang] as Copy, locale: lang === "en" ? "en" : "zh-CN" };
}

function formatWhen(value: string | null | undefined, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function displayValue(value: string | number | boolean | null | undefined, yes: string, no: string) {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? yes : no;
  return String(value);
}

function DatabaseConnectGuide({ projectId }: { projectId: string }) {
  const { copy } = useDatabaseCopy();
  const { toast } = useToast();
  const target = { host: DB_HOST, port: DB_PORT };
  const [mode, setMode] = useState<"direct" | "api">("direct");
  const [username, setUsername] = useState(projectId);
  const [password, setPassword] = useState("");
  const [passwordNote, setPasswordNote] = useState(copy.passwordLoading);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let alive = true;
    setUsername(projectId);
    setPassword("");
    setPasswordNote(copy.passwordLoading);
    websiteApi.getProjectDbConnection(projectId).then((response) => {
      if (!alive) return;
      if (!response?.success) {
        setPasswordNote(response?.message || copy.passwordFailed);
        return;
      }
      if (response.username) setUsername(response.username);
      if (response.password) {
        setPassword(response.password);
        setPasswordNote("");
        return;
      }
      setPasswordNote(response.code === "read_only" ? copy.passwordReadOnly : copy.passwordFailed);
    }).catch((error) => {
      if (!alive) return;
      setPasswordNote(error instanceof Error ? error.message : copy.passwordFailed);
    });
    return () => {
      alive = false;
    };
  }, [copy.passwordFailed, copy.passwordLoading, copy.passwordReadOnly, projectId]);

  const copyText = async (value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast({ title: copy.copied });
  };
  const fields = [
    { label: copy.host, value: target.host },
    { label: copy.port, value: target.port },
    { label: copy.username, value: username },
    { label: copy.password, value: password, secret: true }
  ];
  const snippet = mode === "direct" ? directSnippet(username, password) : apiSnippet(username);

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex gap-1">
        {(["direct", "api"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setMode(item)}
            className={`rounded-md px-3 py-1.5 text-sm ${mode === item ? "bg-muted font-medium" : "text-muted-foreground"}`}
          >
            {item === "direct" ? copy.tabDirect : copy.tabApi}
          </button>
        ))}
      </div>
      {mode === "direct" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{copy.directHint}</p>
          <div className="divide-y rounded-lg border">
            {fields.map((field) => (
              <div key={field.label} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{field.label}</p>
                  <p className="truncate font-mono text-sm">
                    {field.secret ? (password ? (showPassword ? password : "••••••••") : passwordNote) : field.value}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {field.secret && password ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? copy.hidePassword : copy.showPassword}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" size="sm" disabled={field.secret && !password} onClick={() => void copyText(field.value)}>
                    <Copy className="mr-2 h-4 w-4" />
                    {copy.copyValue}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{copy.apiHint}</p>
      )}
      <pre className="max-w-full overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs leading-5">{snippet}</pre>
      <Button type="button" variant="outline" size="sm" onClick={() => void copyText(snippet)}>
        <Copy className="mr-2 h-4 w-4" />
        {copy.copyValue}
      </Button>
    </div>
  );
}

function DatabaseNav() {
  const { projectId = "" } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { copy } = useDatabaseCopy();
  const base = `/console/projects/${projectId}/database`;
  const onNew = pathname === `${base}/new`;
  return (
    <nav className="flex w-full shrink-0 gap-1 sm:w-40 sm:flex-col">
      <button
        type="button"
        onClick={() => navigate(base)}
        className={`rounded-md px-3 py-2 text-left text-sm ${onNew ? "text-muted-foreground hover:bg-muted" : "bg-muted font-medium"}`}
      >
        {copy.navTables}
      </button>
      <button
        type="button"
        onClick={() => navigate(`${base}/new`)}
        className={`rounded-md px-3 py-2 text-left text-sm ${onNew ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}
      >
        {copy.navNew}
      </button>
    </nav>
  );
}

export default function ProjectDatabaseLayout() {
  const { projectId = "" } = useParams();
  const { language } = useLanguage();
  const { copy } = useDatabaseCopy();
  const projects = useProjects({
    t: translations[language === "en" ? "en" : "zh"],
    handleAuthError: (error) => console.warn("Project database page auth error:", error)
  });
  const [ready, setReady] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setReady(false);
    projects.loadProjects().finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const currentProject = projects.getProjectById(projectId) || null;
  const missingProject =
    projectId &&
    !projects.loadingProjects &&
    projects.activeProjects.length > 0 &&
    !currentProject;

  if (missingProject) return <Navigate to="/console/projects" replace />;
  if (!ready) {
    return (
      <div className="stitch-page">
        <div className="site-list-row h-40 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="stitch-page">
      <div className="site-page-head">
        <div>
          <h1 className="site-page-title">{copy.title}</h1>
          <p className="site-page-desc">{copy.subtitle}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setConnectOpen(true)}>
          {copy.connect}
        </Button>
      </div>
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>{copy.connectTitle}</DialogTitle>
            <DialogDescription>{copy.connectHint}</DialogDescription>
          </DialogHeader>
          <DatabaseConnectGuide projectId={projectId} />
        </DialogContent>
      </Dialog>
      <Outlet />
    </div>
  );
}

export function ProjectDatabaseList() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { copy, locale } = useDatabaseCopy();
  const { toast } = useToast();
  const [tables, setTables] = useState<ProjectTable[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const response = await websiteApi.listProjectTables(projectId);
    if (!response?.success) throw new Error(response?.message || copy.loadFailed);
    setTables(response.tables || []);
    setError("");
  }, [copy.loadFailed, projectId]);

  useEffect(() => {
    let alive = true;
    setReady(false);
    load()
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : copy.loadFailed);
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [copy.loadFailed, load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tables;
    return tables.filter((table) => [table.name, ...table.columns.map((column) => column.name)].join(" ").toLowerCase().includes(needle));
  }, [query, tables]);

  const reload = async () => {
    try {
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : copy.loadFailed;
      setError(message);
      toast({ title: copy.loadFailed, description: message, variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <DatabaseNav />
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">{copy.connectTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.connectHint}</p>
          <div className="mt-4">
            <DatabaseConnectGuide projectId={projectId} />
          </div>
        </section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchTables} className="pl-9" />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void reload()} disabled={!ready}>
              <RefreshCw className={`mr-2 h-4 w-4 ${ready ? "" : "animate-spin"}`} />
              {copy.refresh}
            </Button>
            <Button size="sm" onClick={() => navigate(`/console/projects/${projectId}/database/new`)}>
              <Plus className="mr-2 h-4 w-4" />
              {copy.createTable}
            </Button>
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.tableName}</TableHead>
                <TableHead>{copy.columns}</TableHead>
                <TableHead>{copy.rows}</TableHead>
                <TableHead>{copy.created}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!ready ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">{copy.refresh}</TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <p className="font-medium">{copy.loadFailed}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{error}</p>
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    {tables.length === 0 ? (
                      <>
                        <p>{copy.emptyTables}</p>
                        <Button className="mt-4" size="sm" onClick={() => navigate(`/console/projects/${projectId}/database/new`)}>
                          <Plus className="mr-2 h-4 w-4" />
                          {copy.emptyAction}
                        </Button>
                      </>
                    ) : (
                      <p>{copy.noTableMatch}</p>
                    )}
                  </TableCell>
                </TableRow>
              ) : filtered.map((table) => (
                <TableRow
                  key={table.name}
                  className="cursor-pointer"
                  onClick={() => navigate(`/console/projects/${projectId}/database/tables/${encodeURIComponent(table.name)}`)}
                >
                  <TableCell className="font-medium">{table.name}</TableCell>
                  <TableCell className="max-w-[16rem] truncate font-mono text-xs text-muted-foreground">
                    {table.columns.map((column) => column.name).join(", ")}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{table.rowCount || 0}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatWhen(table.createdAt, locale)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t px-4 py-2 text-xs text-muted-foreground">{copy.total(filtered.length)}</div>
        </div>
      </div>
    </div>
  );
}

export function ProjectDatabaseCreate() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { copy } = useDatabaseCopy();
  const { toast } = useToast();
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>([{ name: "", type: "text", primary: true }]);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const name = tableName.trim();
    const nextColumns = columns
      .map((column) => ({ ...column, name: column.name.trim() }))
      .filter((column) => column.name);
    if (!name || nextColumns.length === 0 || !nextColumns.some((column) => column.primary)) return;
    setSaving(true);
    try {
      const response = await websiteApi.createProjectTable({ projectId, name, columns: nextColumns });
      if (!response?.success) throw new Error(response?.message || copy.saveFailed);
      navigate(`/console/projects/${projectId}/database/tables/${encodeURIComponent(name)}`);
    } catch (err) {
      toast({ title: copy.saveFailed, description: err instanceof Error ? err.message : copy.saveFailed, variant: "destructive" });
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <DatabaseNav />
      <form className="flex min-w-0 max-w-xl flex-1 flex-col gap-4" onSubmit={onSubmit}>
        <div>
          <h2 className="text-base font-medium">{copy.createTable}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.primaryHint} {copy.nameRule}</p>
        </div>
        <Field label={copy.tableName}>
          <Input value={tableName} onChange={(event) => setTableName(event.target.value)} />
        </Field>
        {columns.map((column, index) => (
          <div key={index} className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
            <Field label={copy.columnName}>
              <Input
                value={column.name}
                onChange={(event) => {
                  const value = event.target.value;
                  setColumns((current) => current.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, name: value } : item
                  )));
                }}
              />
            </Field>
            <Field label={copy.columnType}>
              <select
                value={column.type}
                onChange={(event) => {
                  const value = event.target.value as ColumnDraft["type"];
                  setColumns((current) => current.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, type: value, primary: value === "text" ? item.primary : false } : item
                  )));
                }}
                className="stitch-select h-10"
              >
                <option value="text">{copy.text}</option>
                <option value="number">{copy.number}</option>
                <option value="boolean">{copy.boolean}</option>
              </select>
            </Field>
            <label className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
              <input
                type="radio"
                name="project-table-primary"
                checked={column.primary}
                disabled={column.type !== "text"}
                onChange={() => {
                  setColumns((current) => current.map((item, itemIndex) => ({
                    ...item,
                    primary: itemIndex === index
                  })));
                }}
              />
              {copy.primary}
            </label>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setColumns((current) => [...current, { name: "", type: "text", primary: false }])}
          >
            <Plus className="mr-2 h-4 w-4" />
            {copy.addColumn}
          </Button>
          <Button type="submit" disabled={saving}>{copy.createTable}</Button>
        </div>
      </form>
    </div>
  );
}

export function ProjectDatabaseTable() {
  const { projectId = "", tableName = "" } = useParams();
  const navigate = useNavigate();
  const { copy, locale } = useDatabaseCopy();
  const { toast } = useToast();
  const decodedName = decodeURIComponent(tableName);
  const [table, setTable] = useState<ProjectTable | null>(null);
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tab, setTab] = useState<TableTab>("data");
  const [query, setQuery] = useState("");
  const [inserting, setInserting] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<string | null>(null);
  const [deleteTableOpen, setDeleteTableOpen] = useState(false);
  const typeLabel = { text: copy.text, number: copy.number, boolean: copy.boolean };

  const load = useCallback(async () => {
    const [tableResponse, rowResponse] = await Promise.all([
      websiteApi.getProjectTable({ projectId, table: decodedName }),
      websiteApi.listProjectRows({ projectId, table: decodedName, limit: 100 })
    ]);
    if (tableResponse?.code === "not_found" || rowResponse?.code === "not_found") {
      setMissing(true);
      return;
    }
    if (!tableResponse?.success || !tableResponse.table) throw new Error(tableResponse?.message || copy.loadFailed);
    if (!rowResponse?.success) throw new Error(rowResponse?.message || copy.loadFailed);
    setTable(tableResponse.table);
    setRows(rowResponse.rows || []);
    setNext(rowResponse.next || null);
    setMissing(false);
  }, [copy.loadFailed, decodedName, projectId]);

  useEffect(() => {
    let alive = true;
    setReady(false);
    load()
      .catch((err) => {
        if (alive) toast({ title: copy.loadFailed, description: err instanceof Error ? err.message : copy.loadFailed, variant: "destructive" });
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [copy.loadFailed, load, toast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable));
      if (typing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < TABLE_TABS.length) setTab(TABLE_TABS[index]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => Object.values(row.values || {}).join(" ").toLowerCase().includes(needle));
  }, [query, rows]);

  if (missing) return <Navigate to={`/console/projects/${projectId}/database`} replace />;

  const fillDraft = (row: ProjectRow | null) => {
    if (!table) return;
    const nextDraft: Record<string, string> = {};
    for (const column of table.columns) {
      const value = row?.values?.[column.name];
      nextDraft[column.name] = value == null ? "" : String(value);
    }
    setDraft(nextDraft);
    setEditing(Boolean(row));
    setInserting(true);
    setTab("data");
  };

  const saveRow = async (event: FormEvent) => {
    event.preventDefault();
    if (!table || saving) return;
    const values: Record<string, string | number | boolean | null> = {};
    for (const column of table.columns) {
      const raw = draft[column.name] ?? "";
      if (column.type === "number") values[column.name] = raw === "" ? null : Number(raw);
      else if (column.type === "boolean") values[column.name] = raw === "" ? null : raw === "true";
      else values[column.name] = raw;
    }
    setSaving(true);
    try {
      const response = await websiteApi.putProjectRow({ projectId, table: table.name, values });
      if (!response?.success) throw new Error(response?.message || copy.saveFailed);
      setDraft({});
      setEditing(false);
      setInserting(false);
      toast({ title: copy.saved });
      await load();
    } catch (err) {
      toast({ title: copy.saveFailed, description: err instanceof Error ? err.message : copy.saveFailed, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const removeRow = async () => {
    if (!table || !rowToDelete) return;
    try {
      const response = await websiteApi.deleteProjectRow({ projectId, table: table.name, pk: rowToDelete });
      if (!response?.success) throw new Error(response?.message || copy.saveFailed);
      setRowToDelete(null);
      toast({ title: copy.deleted });
      await load();
    } catch (err) {
      toast({ title: copy.saveFailed, description: err instanceof Error ? err.message : copy.saveFailed, variant: "destructive" });
    }
  };

  const removeTable = async () => {
    if (!table) return;
    try {
      const response = await websiteApi.deleteProjectTable({ projectId, table: table.name });
      if (!response?.success) throw new Error(response?.message || copy.saveFailed);
      toast({ title: copy.deleted });
      navigate(`/console/projects/${projectId}/database`);
    } catch (err) {
      toast({ title: copy.saveFailed, description: err instanceof Error ? err.message : copy.saveFailed, variant: "destructive" });
    }
  };

  const loadMore = async () => {
    if (!table || !next || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await websiteApi.listProjectRows({ projectId, table: table.name, limit: 100, after: next });
      if (!response?.success) throw new Error(response?.message || copy.loadFailed);
      setRows((current) => [...current, ...(response.rows || [])]);
      setNext(response.next || null);
    } catch (err) {
      toast({ title: copy.loadFailed, description: err instanceof Error ? err.message : copy.loadFailed, variant: "destructive" });
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => navigate(`/console/projects/${projectId}/database`)}
        className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {copy.backList}
      </button>
      {!ready || !table ? (
        <div className="site-list-row h-40 animate-pulse" />
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-mono text-lg">{table.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {copy.rows} {table.rowCount || 0} · {formatWhen(table.createdAt, locale)}
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-1 overflow-x-auto border-b">
            {TABLE_TABS.map((item, index) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={`border-b-2 px-3 py-2 text-sm ${tab === item ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}`}
              >
                {copy.tabs[item]}
                <span className="ml-1 text-xs text-muted-foreground">{index + 1}</span>
              </button>
            ))}
          </div>
          <div className="mt-5">
            {tab === "data" ? (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchRows} className="pl-9" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => void load()}>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      {copy.refresh}
                    </Button>
                    <Button size="sm" onClick={() => fillDraft(null)}>
                      <Plus className="mr-2 h-4 w-4" />
                      {copy.insert}
                    </Button>
                  </div>
                </div>
                {inserting ? (
                  <form className="grid gap-3 rounded-lg border p-4 md:grid-cols-2" onSubmit={saveRow}>
                    <p className="md:col-span-2 text-sm text-muted-foreground">{copy.primaryHint}</p>
                    {table.columns.map((column) => (
                      <Field key={column.name} label={`${column.name}${column.primary ? ` · ${copy.primary}` : ""}`}>
                        {column.type === "boolean" ? (
                          <select
                            value={draft[column.name] || ""}
                            onChange={(event) => setDraft((current) => ({ ...current, [column.name]: event.target.value }))}
                            className="stitch-select h-10"
                          >
                            <option value="" />
                            <option value="true">{copy.yes}</option>
                            <option value="false">{copy.no}</option>
                          </select>
                        ) : (
                          <Input
                            value={draft[column.name] || ""}
                            onChange={(event) => setDraft((current) => ({ ...current, [column.name]: event.target.value }))}
                          />
                        )}
                      </Field>
                    ))}
                    <div className="flex gap-2 md:col-span-2">
                      <Button type="submit" disabled={saving}>{editing ? copy.saveRow : copy.insert}</Button>
                      <Button type="button" variant="outline" onClick={() => { setInserting(false); setEditing(false); setDraft({}); }}>
                        {copy.cancelEdit}
                      </Button>
                    </div>
                  </form>
                ) : null}
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {table.columns.map((column) => (
                          <TableHead key={column.name}>{column.name}</TableHead>
                        ))}
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={table.columns.length + 1} className="text-muted-foreground">
                            {rows.length === 0 ? copy.emptyRows : copy.noMatch}
                          </TableCell>
                        </TableRow>
                      ) : filtered.map((row) => (
                        <TableRow key={row.pk} className="cursor-pointer" onClick={() => fillDraft(row)}>
                          {table.columns.map((column) => (
                            <TableCell key={column.name}>{displayValue(row.values?.[column.name], copy.yes, copy.no)}</TableCell>
                          ))}
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                setRowToDelete(row.pk);
                              }}
                            >
                              {copy.deleteRow}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
                    <span>{copy.rowTotal(filtered.length)}</span>
                    {next ? (
                      <Button type="button" variant="ghost" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
                        {copy.loadMore}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {tab === "schema" ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{copy.schemaHint}</p>
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{copy.columnName}</TableHead>
                        <TableHead>{copy.type}</TableHead>
                        <TableHead>{copy.primary}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {table.columns.map((column) => (
                        <TableRow key={column.name}>
                          <TableCell className="font-mono text-xs">{column.name}</TableCell>
                          <TableCell>{typeLabel[column.type]}</TableCell>
                          <TableCell>{column.primary ? copy.yes : ""}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}
            {tab === "settings" ? (
              <div className="max-w-lg space-y-3 rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">{copy.settingsHint}</p>
                <Button type="button" variant="outline" onClick={() => setDeleteTableOpen(true)}>{copy.deleteTable}</Button>
              </div>
            ) : null}
          </div>
          <ConfirmDestructive
            open={rowToDelete != null}
            onOpenChange={(open) => { if (!open) setRowToDelete(null); }}
            title={copy.deleteRowTitle}
            description={copy.deleteRowDesc}
            confirmLabel={copy.deleteRow}
            cancelLabel={copy.cancel}
            onConfirm={removeRow}
          />
          <ConfirmDestructive
            open={deleteTableOpen}
            onOpenChange={setDeleteTableOpen}
            title={copy.deleteTableTitle}
            description={copy.deleteTableDesc}
            confirmLabel={copy.deleteTable}
            cancelLabel={copy.cancel}
            onConfirm={removeTable}
          />
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
