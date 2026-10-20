import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Button, Input } from "@/components/ui";
import { Database, Plus } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { translations } from "../home-translations";
import { useProjects } from "../use-projects";

const texts = {
  zh: {
    title: "数据库",
    subtitle: "一个项目对应一个数据库。下面在这一份里创建表。",
    withProject: "每个项目一份",
    project: "项目",
    scope: "范围",
    createTable: "创建表",
    tableName: "表名",
    columnName: "列名",
    columnType: "类型",
    addColumn: "添加列",
    emptyTables: "还没有表。",
    text: "文本",
    number: "数字",
    boolean: "是/否"
  },
  en: {
    title: "Database",
    subtitle: "One project has one database. Create tables in it below.",
    withProject: "One per project",
    project: "Project",
    scope: "Scope",
    createTable: "Create table",
    tableName: "Table name",
    columnName: "Column",
    columnType: "Type",
    addColumn: "Add column",
    emptyTables: "No tables yet.",
    text: "Text",
    number: "Number",
    boolean: "Yes / no"
  }
} as const;

type ColumnDraft = { name: string; type: "text" | "number" | "boolean" };
type TableDraft = { name: string; columns: ColumnDraft[] };

export default function ProjectDatabasePage() {
  const { projectId = "" } = useParams();
  const { language } = useLanguage();
  const t = texts[language === "en" ? "en" : "zh"];
  const projects = useProjects({
    t: translations[language === "en" ? "en" : "zh"],
    handleAuthError: (error) => console.warn("Project database page auth error:", error)
  });
  const [ready, setReady] = useState(false);
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>([{ name: "", type: "text" }]);
  const [tables, setTables] = useState<TableDraft[]>([]);
  const typeLabel = { text: t.text, number: t.number, boolean: t.boolean };

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

  const createTable = (event: FormEvent) => {
    event.preventDefault();
    const name = tableName.trim();
    const nextColumns = columns
      .map((column) => ({ ...column, name: column.name.trim() }))
      .filter((column) => column.name);
    if (!name || nextColumns.length === 0) return;
    setTables((current) => [...current, { name, columns: nextColumns }]);
    setTableName("");
    setColumns([{ name: "", type: "text" }]);
  };

  return (
    <div className="stitch-page max-w-3xl">
      <div className="site-page-head">
        <div>
          <div className="site-page-kicker">{currentProject?.name || t.title}</div>
          <h1 className="site-page-title">{t.title}</h1>
          <p className="site-page-desc">{t.subtitle}</p>
        </div>
      </div>

      {!ready ? (
        <div className="site-list-row h-40 animate-pulse" />
      ) : (
        <section className="rounded-[1.6rem] border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-6">
          <div className="stitch-icon-tile mb-5 h-14 w-14 rounded-2xl">
            <Database className="h-6 w-6" />
          </div>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--stitch-muted)]">{t.project}</dt>
              <dd className="mt-1 text-lg font-semibold text-[var(--stitch-ink)]">
                {currentProject?.name || projectId}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--stitch-muted)]">{t.scope}</dt>
              <dd className="mt-1 text-lg font-semibold text-[var(--stitch-ink)]">{t.withProject}</dd>
            </div>
          </dl>
        </section>
      )}

      {ready ? (
        <section className="mt-6 rounded-[1.6rem] border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-6">
          <h2 className="text-lg font-semibold text-[var(--stitch-ink)]">{t.createTable}</h2>
          <form className="mt-4 flex flex-col gap-3" onSubmit={createTable}>
            <label className="flex flex-col gap-1.5 text-sm text-[var(--stitch-muted)]">
              {t.tableName}
              <Input
                value={tableName}
                onChange={(event) => setTableName(event.target.value)}
                className="h-11 rounded-full border-[var(--stitch-line)] bg-[var(--stitch-surface)]"
              />
            </label>
            {columns.map((column, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <label className="flex flex-col gap-1.5 text-sm text-[var(--stitch-muted)]">
                  {t.columnName}
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
                </label>
                <label className="flex flex-col gap-1.5 text-sm text-[var(--stitch-muted)]">
                  {t.columnType}
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
                </label>
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
          <div className="mt-6 border-t border-[var(--stitch-line)] pt-4">
            {tables.length === 0 ? (
              <p className="text-sm text-[var(--stitch-muted)]">{t.emptyTables}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {tables.map((table) => (
                  <li key={table.name}>
                    <div className="font-medium text-[var(--stitch-ink)]">{table.name}</div>
                    <div className="mt-1 font-mono text-xs text-[var(--stitch-muted)]">
                      {table.columns.map((column) => `${column.name} ${typeLabel[column.type]}`).join(" · ")}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
