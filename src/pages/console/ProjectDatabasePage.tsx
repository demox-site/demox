import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, Outlet, useNavigate, useParams } from "react-router-dom";
import { Button, Input } from "@/components/ui";
import { ArrowLeft, Plus } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
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
    boolean: "是/否"
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
    boolean: "Yes / no"
  }
} as const;

type ColumnDraft = { name: string; type: "text" | "number" | "boolean" };
type TableRecord = { name: string; columns: ColumnDraft[]; rows: Array<Record<string, string>> };

type DatabaseStore = {
  tables: TableRecord[];
  addTable: (table: TableRecord) => void;
};

const DatabaseContext = createContext<DatabaseStore | null>(null);

function useDatabaseStore() {
  const store = useContext(DatabaseContext);
  if (!store) throw new Error("Database store missing");
  return store;
}

function useDatabaseCopy() {
  const { language } = useLanguage();
  return texts[language === "en" ? "en" : "zh"];
}

export default function ProjectDatabaseLayout() {
  const { projectId = "" } = useParams();
  const { language } = useLanguage();
  const projects = useProjects({
    t: translations[language === "en" ? "en" : "zh"],
    handleAuthError: (error) => console.warn("Project database page auth error:", error)
  });
  const [ready, setReady] = useState(false);
  const [tables, setTables] = useState<TableRecord[]>([]);

  useEffect(() => {
    let alive = true;
    setReady(false);
    setTables([]);
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

  return (
    <DatabaseContext.Provider
      value={{
        tables,
        addTable: (table) => setTables((current) => (
          current.some((item) => item.name === table.name) ? current : [...current, table]
        ))
      }}
    >
      <Outlet />
    </DatabaseContext.Provider>
  );
}

export function ProjectDatabaseList() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const t = useDatabaseCopy();
  const { tables } = useDatabaseStore();

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

      {tables.length === 0 ? (
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
                <span className="shrink-0 text-xs text-[var(--stitch-muted)]">{table.rows.length}</span>
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
  const { addTable } = useDatabaseStore();
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>([{ name: "", type: "text" }]);

  const back = () => navigate(`/console/projects/${projectId}/database`);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const name = tableName.trim();
    const nextColumns = columns
      .map((column) => ({ ...column, name: column.name.trim() }))
      .filter((column) => column.name);
    if (!name || nextColumns.length === 0) return;
    addTable({ name, columns: nextColumns, rows: [] });
    back();
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
      <form className="mt-6 flex max-w-xl flex-col gap-3" onSubmit={onSubmit}>
        <Field label={t.tableName}>
          <Input
            value={tableName}
            onChange={(event) => setTableName(event.target.value)}
            className="h-11 rounded-full border-[var(--stitch-line)] bg-[var(--stitch-surface)]"
          />
        </Field>
        {columns.map((column, index) => (
          <div key={index} className="grid gap-3 sm:grid-cols-[1fr_140px]">
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
                    itemIndex === index ? { ...item, type: value } : item
                  )));
                }}
                className="stitch-select h-11"
              >
                <option value="text">{t.text}</option>
                <option value="number">{t.number}</option>
                <option value="boolean">{t.boolean}</option>
              </select>
            </Field>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="stitch-action rounded-full px-5"
            onClick={() => setColumns((current) => [...current, { name: "", type: "text" }])}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t.addColumn}
          </Button>
          <Button type="submit" className="stitch-primary rounded-full px-5">
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
  const { tables } = useDatabaseStore();
  const decodedName = decodeURIComponent(tableName);
  const table = tables.find((item) => item.name === decodedName);
  const typeLabel = { text: t.text, number: t.number, boolean: t.boolean };

  if (!table) {
    return <Navigate to={`/console/projects/${projectId}/database`} replace />;
  }

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
      <h1 className="site-page-title">{table.name}</h1>
      <p className="site-page-desc">
        {table.columns.map((column) => `${column.name} ${typeLabel[column.type]}`).join(" · ")}
      </p>
      <div className="mt-6 overflow-x-auto rounded-[1.4rem] border border-[var(--stitch-line)]">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="border-b border-[var(--stitch-line)] text-[var(--stitch-muted)]">
            <tr>
              {table.columns.map((column) => (
                <th key={column.name} className="px-4 py-3 font-medium">{column.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-[var(--stitch-muted)]" colSpan={table.columns.length}>
                  {t.emptyRows}
                </td>
              </tr>
            ) : table.rows.map((row, index) => (
              <tr key={index} className="border-t border-[var(--stitch-line)]">
                {table.columns.map((column) => (
                  <td key={column.name} className="px-4 py-3 text-[var(--stitch-ink)]">{row[column.name] || ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
