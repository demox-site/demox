import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, Outlet, useNavigate, useParams } from "react-router-dom";
import { Button, Input } from "@/components/ui";
import { ArrowLeft, Plus } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { websiteApi, type ProjectColumn, type ProjectRow, type ProjectTable } from "@/api";
import { translations } from "../home-translations";
import { useProjects } from "../use-projects";

const texts = {
  zh: {
    title: "数据库",
    subtitle: "这个项目里的表。点进去查看表里的数据。",
    createTable: "创建表",
    tableName: "表名",
    columnName: "列名",
    columnType: "类型",
    addColumn: "添加列",
    emptyTables: "还没有表。",
    emptyRows: "还没有数据。",
    backList: "返回表列表",
    columns: "列",
    text: "文本",
    number: "数字",
    boolean: "是/否",
    yes: "是",
    no: "否",
    primary: "主键",
    primaryHint: "选一列文本作为主键。同一主键再次保存会覆盖这一行。",
    addRow: "添加一行",
    deleteRow: "删除",
    loadFailed: "加载失败",
    saveFailed: "保存失败",
    nameRule: "名称以字母开头，只能用小写字母、数字和下划线。"
  },
  en: {
    title: "Database",
    subtitle: "Tables in this project. Open one to see its data.",
    createTable: "Create table",
    tableName: "Table name",
    columnName: "Column",
    columnType: "Type",
    addColumn: "Add column",
    emptyTables: "No tables yet.",
    emptyRows: "No rows yet.",
    backList: "Back to tables",
    columns: "Columns",
    text: "Text",
    number: "Number",
    boolean: "Yes / no",
    yes: "Yes",
    no: "No",
    primary: "Primary",
    primaryHint: "Pick one text column as the primary key. Saving the same key replaces that row.",
    addRow: "Add row",
    deleteRow: "Delete",
    loadFailed: "Could not load",
    saveFailed: "Could not save",
    nameRule: "Names start with a letter and use lowercase letters, digits, and underscores."
  }
} as const;

type ColumnDraft = { name: string; type: ProjectColumn["type"]; primary: boolean };

function useDatabaseCopy() {
  const { language } = useLanguage();
  return texts[language === "en" ? "en" : "zh"];
}

function displayValue(value: string | number | boolean | null | undefined, yes: string, no: string) {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? yes : no;
  return String(value);
}

export default function ProjectDatabaseLayout() {
  const { projectId = "" } = useParams();
  const { language } = useLanguage();
  const projects = useProjects({
    t: translations[language === "en" ? "en" : "zh"],
    handleAuthError: (error) => console.warn("Project database page auth error:", error)
  });
  const [ready, setReady] = useState(false);

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

  if (missingProject) {
    return <Navigate to="/console/projects" replace />;
  }

  if (!ready) {
    return (
      <div className="stitch-page max-w-3xl">
        <div className="site-list-row h-40 animate-pulse" />
      </div>
    );
  }

  return <Outlet />;
}

export function ProjectDatabaseList() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const t = useDatabaseCopy();
  const [tables, setTables] = useState<ProjectTable[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await websiteApi.listProjectTables(projectId);
    if (!response?.success) throw new Error(response?.message || t.loadFailed);
    setTables(response.tables || []);
  }, [projectId, t.loadFailed]);

  useEffect(() => {
    let alive = true;
    setReady(false);
    setError("");
    load()
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : t.loadFailed);
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [load, t.loadFailed]);

  return (
    <div className="stitch-page max-w-3xl">
      <div className="site-page-head">
        <div>
          <h1 className="site-page-title">{t.title}</h1>
          <p className="site-page-desc">{t.subtitle}</p>
        </div>
        <Button
          className="stitch-primary rounded-full px-5"
          onClick={() => navigate(`/console/projects/${projectId}/database/new`)}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t.createTable}
        </Button>
      </div>

      {!ready ? (
        <div className="site-list-row h-28 animate-pulse" />
      ) : error ? (
        <div className="rounded-[1.6rem] border border-dashed border-[var(--stitch-line)] px-6 py-16 text-center">
          <p className="font-medium text-[var(--stitch-ink)]">{t.loadFailed}</p>
          <p className="mt-2 text-sm text-[var(--stitch-muted)]">{error}</p>
        </div>
      ) : tables.length === 0 ? (
        <div className="rounded-[1.6rem] border border-dashed border-[var(--stitch-line)] px-6 py-16 text-center">
          <p className="font-medium text-[var(--stitch-ink)]">{t.emptyTables}</p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-[1.4rem] border border-[var(--stitch-line)]">
          {tables.map((table) => (
            <li key={table.name} className="border-t border-[var(--stitch-line)] first:border-t-0">
              <button
                type="button"
                onClick={() => navigate(`/console/projects/${projectId}/database/tables/${encodeURIComponent(table.name)}`)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--stitch-surface)]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--stitch-ink)]">{table.name}</span>
                  <span className="block truncate font-mono text-xs text-[var(--stitch-muted)]">
                    {t.columns} {table.columns.map((column) => column.name).join(", ")}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-[var(--stitch-muted)]">{table.rowCount || 0}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProjectDatabaseCreate() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const t = useDatabaseCopy();
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>([{ name: "", type: "text", primary: true }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const back = () => navigate(`/console/projects/${projectId}/database`);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const name = tableName.trim();
    const nextColumns = columns
      .map((column) => ({ ...column, name: column.name.trim() }))
      .filter((column) => column.name);
    if (!name || nextColumns.length === 0 || !nextColumns.some((column) => column.primary)) return;
    setSaving(true);
    setError("");
    try {
      const response = await websiteApi.createProjectTable({ projectId, name, columns: nextColumns });
      if (!response?.success) throw new Error(response?.message || t.saveFailed);
      back();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.saveFailed);
      setSaving(false);
    }
  };

  return (
    <div className="stitch-page max-w-3xl">
      <button
        type="button"
        onClick={back}
        className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-[var(--stitch-muted)] transition-colors hover:text-[var(--stitch-ink)]"
      >
        <ArrowLeft className="h-4 w-4" />
        {t.backList}
      </button>
      <h1 className="site-page-title">{t.createTable}</h1>
      <p className="site-page-desc">{t.primaryHint} {t.nameRule}</p>
      <form className="mt-6 flex max-w-xl flex-col gap-3" onSubmit={onSubmit}>
        <Field label={t.tableName}>
          <Input
            value={tableName}
            onChange={(event) => setTableName(event.target.value)}
            className="h-11 rounded-full border-[var(--stitch-line)] bg-[var(--stitch-surface)]"
          />
        </Field>
        {columns.map((column, index) => (
          <div key={index} className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
            <Field label={t.columnName}>
              <Input
                value={column.name}
                onChange={(event) => {
                  const value = event.target.value;
                  setColumns((current) => current.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, name: value } : item
                  )));
                }}
                className="h-11 rounded-full border-[var(--stitch-line)] bg-[var(--stitch-surface)]"
              />
            </Field>
            <Field label={t.columnType}>
              <select
                value={column.type}
                onChange={(event) => {
                  const value = event.target.value as ColumnDraft["type"];
                  setColumns((current) => current.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, type: value, primary: value === "text" ? item.primary : false } : item
                  )));
                }}
                className="stitch-select h-11"
              >
                <option value="text">{t.text}</option>
                <option value="number">{t.number}</option>
                <option value="boolean">{t.boolean}</option>
              </select>
            </Field>
            <label className="flex h-11 items-center gap-2 text-sm text-[var(--stitch-muted)]">
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
              {t.primary}
            </label>
          </div>
        ))}
        {error ? <p className="text-sm text-[var(--stitch-muted)]">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="stitch-action rounded-full px-5"
            onClick={() => setColumns((current) => [...current, { name: "", type: "text", primary: false }])}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t.addColumn}
          </Button>
          <Button type="submit" disabled={saving} className="stitch-primary rounded-full px-5">
            {t.createTable}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function ProjectDatabaseTable() {
  const { projectId = "", tableName = "" } = useParams();
  const navigate = useNavigate();
  const t = useDatabaseCopy();
  const decodedName = decodeURIComponent(tableName);
  const [table, setTable] = useState<ProjectTable | null>(null);
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const typeLabel = { text: t.text, number: t.number, boolean: t.boolean };
  const yesNo = [t.yes, t.no];

  const load = useCallback(async () => {
    const [tableResponse, rowResponse] = await Promise.all([
      websiteApi.getProjectTable({ projectId, table: decodedName }),
      websiteApi.listProjectRows({ projectId, table: decodedName, limit: 100 })
    ]);
    if (tableResponse?.code === "not_found" || rowResponse?.code === "not_found") {
      setMissing(true);
      return;
    }
    if (!tableResponse?.success || !tableResponse.table) throw new Error(tableResponse?.message || t.loadFailed);
    if (!rowResponse?.success) throw new Error(rowResponse?.message || t.loadFailed);
    setTable(tableResponse.table);
    setRows(rowResponse.rows || []);
    setMissing(false);
  }, [decodedName, projectId, t.loadFailed]);

  useEffect(() => {
    let alive = true;
    setReady(false);
    setError("");
    load()
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : t.loadFailed);
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [load, t.loadFailed]);

  if (missing) {
    return <Navigate to={`/console/projects/${projectId}/database`} replace />;
  }

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
    setError("");
    try {
      const response = await websiteApi.putProjectRow({ projectId, table: table.name, values });
      if (!response?.success) throw new Error(response?.message || t.saveFailed);
      setDraft({});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const removeRow = async (pk: string) => {
    if (!table) return;
    setError("");
    try {
      const response = await websiteApi.deleteProjectRow({ projectId, table: table.name, pk });
      if (!response?.success) throw new Error(response?.message || t.saveFailed);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.saveFailed);
    }
  };

  return (
    <div className="stitch-page">
      <button
        type="button"
        onClick={() => navigate(`/console/projects/${projectId}/database`)}
        className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-[var(--stitch-muted)] transition-colors hover:text-[var(--stitch-ink)]"
      >
        <ArrowLeft className="h-4 w-4" />
        {t.backList}
      </button>
      {!ready || !table ? (
        <div className="site-list-row h-40 animate-pulse" />
      ) : (
        <>
          <h1 className="site-page-title">{table.name}</h1>
          <p className="site-page-desc">
            {table.columns.map((column) => `${column.name} ${typeLabel[column.type]}${column.primary ? ` ${t.primary}` : ""}`).join(" · ")}
          </p>
          {error ? <p className="mt-3 text-sm text-[var(--stitch-muted)]">{error}</p> : null}
          <div className="mt-6 overflow-x-auto rounded-[1.4rem] border border-[var(--stitch-line)]">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="border-b border-[var(--stitch-line)] text-[var(--stitch-muted)]">
                <tr>
                  {table.columns.map((column) => (
                    <th key={column.name} className="px-4 py-3 font-medium">{column.name}</th>
                  ))}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-[var(--stitch-muted)]" colSpan={table.columns.length + 1}>
                      {t.emptyRows}
                    </td>
                  </tr>
                ) : rows.map((row) => (
                  <tr key={row.pk} className="border-t border-[var(--stitch-line)]">
                    {table.columns.map((column) => (
                      <td key={column.name} className="px-4 py-3 text-[var(--stitch-ink)]">
                        {displayValue(row.values?.[column.name], yesNo[0] || "", yesNo[1] || "")}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => removeRow(row.pk)}
                        className="text-xs text-[var(--stitch-muted)] hover:text-[var(--stitch-ink)]"
                      >
                        {t.deleteRow}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form className="mt-6 grid gap-3 md:grid-cols-2" onSubmit={saveRow}>
            {table.columns.map((column) => (
              <Field key={column.name} label={`${column.name}${column.primary ? ` · ${t.primary}` : ""}`}>
                {column.type === "boolean" ? (
                  <select
                    value={draft[column.name] || ""}
                    onChange={(event) => setDraft((current) => ({ ...current, [column.name]: event.target.value }))}
                    className="stitch-select h-11"
                  >
                    <option value="" />
                    <option value="true">{yesNo[0]}</option>
                    <option value="false">{yesNo[1]}</option>
                  </select>
                ) : (
                  <Input
                    value={draft[column.name] || ""}
                    onChange={(event) => setDraft((current) => ({ ...current, [column.name]: event.target.value }))}
                    className="h-11 rounded-full border-[var(--stitch-line)] bg-[var(--stitch-surface)]"
                  />
                )}
              </Field>
            ))}
            <div className="md:col-span-2">
              <Button type="submit" disabled={saving} className="stitch-primary rounded-full px-5">
                {t.addRow}
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm text-[var(--stitch-muted)]">
      {label}
      {children}
    </label>
  );
}
