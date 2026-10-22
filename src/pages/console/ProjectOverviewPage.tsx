import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui";
import { Code2, Database, Globe } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { functionsApi, mapWebsiteRow, websiteApi } from "@/api";
import { getDisplayName } from "@/lib/website-utils";
import { translations } from "../home-translations";
import { useProjects } from "../use-projects";
import { websiteMatchesProject } from "../use-filters";

const texts = {
  zh: {
    title: "概览",
    subtitle: "这个项目的站点和函数。它们共用这一个数据库。",
    sites: "站点",
    functions: "函数",
    database: "数据库",
    databaseHint: "这个项目有一个数据库。表在里面查看。",
    viewTables: "查看表",
    recentSites: "站点",
    emptySites: "还没有站点。",
    openSites: "去站点",
    loadFailed: "概览加载失败",
    functionWarning: "有的函数列表没有加载出来。"
  },
  en: {
    title: "Overview",
    subtitle: "Sites and functions in this project. They share this one database.",
    sites: "Sites",
    functions: "Functions",
    database: "Database",
    databaseHint: "This project has one database. Open it to see its tables.",
    viewTables: "View tables",
    recentSites: "Sites",
    emptySites: "No sites yet.",
    openSites: "Go to sites",
    loadFailed: "Failed to load the overview",
    functionWarning: "Some function lists did not load."
  }
} as const;

type SiteRow = {
  websiteId: string;
  name: string;
  url: string;
};

export default function ProjectOverviewPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const lang = language === "en" ? "en" : "zh";
  const t = texts[lang];
  const copy = translations[lang];
  const projects = useProjects({
    t: copy,
    handleAuthError: (error) => console.warn("Project overview auth error:", error)
  });
  const [ready, setReady] = useState(false);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [functionCount, setFunctionCount] = useState(0);
  const [functionWarning, setFunctionWarning] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    const response = await websiteApi.list({ projectId });
    const rows: SiteRow[] = (response.websites || [])
      .map(mapWebsiteRow)
      .filter((site) => websiteMatchesProject(site, projectId))
      .map((site) => ({
        websiteId: String(site.websiteId || site._id || ""),
        name: getDisplayName(site),
        url: String(site.url || "")
      }))
      .filter((site) => site.websiteId);
    setSites(rows);

    const scopeIds = [...new Set([projectId, ...rows.map((site) => site.websiteId)].filter(Boolean))];
    const listed = await Promise.all(
      scopeIds.map(async (scopeId) => {
        try {
          const result = await functionsApi.list(scopeId);
          return { count: (result.functions || []).length, error: false };
        } catch {
          return { count: 0, error: scopeId === projectId };
        }
      })
    );
    setFunctionCount(listed.reduce((sum, item) => sum + item.count, 0));
    setFunctionWarning(listed.some((item) => item.error));
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    setReady(false);
    Promise.all([projects.loadProjects(), load()])
      .catch((error) => {
        if (alive) setLoadError(error instanceof Error ? error.message : t.loadFailed);
      })
      .finally(() => {
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

  const base = `/console/projects/${projectId}`;
  const roleLabel = (role?: string | null) => {
    if (role === "owner") return copy.projectRoleOwner;
    if (role === "admin") return copy.projectRoleAdmin;
    if (role === "member") return copy.projectRoleMember;
    return "";
  };

  return (
    <div className="stitch-page">
      <div className="site-page-head">
        <div>
          <div className="site-page-kicker">{currentProject?.name || t.title}</div>
          <h1 className="site-page-title">{t.title}</h1>
          <p className="site-page-desc">{t.subtitle}</p>
        </div>
        {roleLabel(currentProject?.role) ? (
          <span className="font-mono text-sm text-[var(--stitch-muted)]">{roleLabel(currentProject?.role)}</span>
        ) : null}
      </div>

      {!ready ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-32 animate-pulse rounded-[1.4rem] border border-[var(--stitch-line)]" />
          ))}
        </div>
      ) : loadError ? (
        <div className="rounded-[1.6rem] border border-dashed border-[var(--stitch-line)] px-6 py-16 text-center">
          <p className="font-medium text-[var(--stitch-ink)]">{t.loadFailed}</p>
          <p className="mt-2 text-sm text-[var(--stitch-muted)]">{loadError}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-3">
            <button
              type="button"
              onClick={() => navigate(`${base}/sites`)}
              className="rounded-[1.4rem] border border-[var(--stitch-line)] p-5 text-left transition-colors hover:bg-[var(--stitch-surface)]"
            >
              <span className="inline-flex items-center gap-2 text-sm text-[var(--stitch-muted)]">
                <Globe className="h-4 w-4" />
                {t.sites}
              </span>
              <span className="mt-3 block font-mono text-3xl text-[var(--stitch-ink)]">{sites.length}</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(`${base}/functions`)}
              className="rounded-[1.4rem] border border-[var(--stitch-line)] p-5 text-left transition-colors hover:bg-[var(--stitch-surface)]"
            >
              <span className="inline-flex items-center gap-2 text-sm text-[var(--stitch-muted)]">
                <Code2 className="h-4 w-4" />
                {t.functions}
              </span>
              <span className="mt-3 block font-mono text-3xl text-[var(--stitch-ink)]">{functionCount}</span>
              {functionWarning ? (
                <span className="mt-2 block text-xs text-[var(--stitch-muted)]">{t.functionWarning}</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => navigate(`${base}/database`)}
              className="rounded-[1.4rem] border border-[var(--stitch-line)] p-5 text-left transition-colors hover:bg-[var(--stitch-surface)]"
            >
              <span className="inline-flex items-center gap-2 text-sm text-[var(--stitch-muted)]">
                <Database className="h-4 w-4" />
                {t.database}
              </span>
              <span className="mt-3 block text-sm text-[var(--stitch-ink)]">{t.databaseHint}</span>
              <span className="mt-3 block text-sm text-[var(--stitch-muted)]">{t.viewTables}</span>
            </button>
          </div>

          <section className="overflow-hidden rounded-[1.4rem] border border-[var(--stitch-line)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--stitch-line)] px-4 py-3">
              <div className="font-medium text-[var(--stitch-ink)]">{t.recentSites}</div>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={() => navigate(`${base}/sites`)}
              >
                {t.openSites}
              </Button>
            </div>
            {sites.length === 0 ? (
              <p className="px-4 py-6 text-sm text-[var(--stitch-muted)]">{t.emptySites}</p>
            ) : (
              <ul>
                {sites.slice(0, 8).map((site) => (
                  <li key={site.websiteId} className="border-t border-[var(--stitch-line)] first:border-t-0">
                    <button
                      type="button"
                      onClick={() => navigate(`${base}/sites/${site.websiteId}`)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--stitch-surface)]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-[var(--stitch-ink)]">{site.name}</span>
                        <span className="block truncate font-mono text-xs text-[var(--stitch-muted)]">{site.websiteId}</span>
                      </span>
                      {site.url ? (
                        <span className="hidden truncate font-mono text-xs text-[var(--stitch-muted)] sm:block">{site.url}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
