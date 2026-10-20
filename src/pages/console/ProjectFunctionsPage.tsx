import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui";
import { Code2, Plus } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { functionsApi, mapWebsiteRow, websiteApi, type SiteFunction } from "@/api";
import { getDisplayName } from "@/lib/website-utils";
import { translations } from "../home-translations";
import { useProjects } from "../use-projects";
import { websiteMatchesProject } from "../use-filters";

const texts = {
  zh: {
    title: "函数",
    subtitle: "函数属于这个项目。现有函数仍挂在站点的 /api 路径上，从这里打开。",
    emptySites: "还没有站点。先部署一个站点，函数会挂在它的 /api 路径上。",
    emptySitesAction: "去站点",
    emptyFunctions: "这个站点还没有函数。",
    loadFailed: "函数列表加载失败",
    create: "新建",
    path: "路径",
    active: "已发布",
    unpublished: "未发布",
    total: (count: number) => `共 ${count} 个函数`
  },
  en: {
    title: "Functions",
    subtitle: "Functions belong to this project. Existing ones still live on a site's /api path. Open them here.",
    emptySites: "No sites yet. Deploy one first. Functions hang off its /api path.",
    emptySitesAction: "Go to sites",
    emptyFunctions: "This site has no functions yet.",
    loadFailed: "Failed to load functions",
    create: "Create",
    path: "Path",
    active: "Published",
    unpublished: "Draft",
    total: (count: number) => `${count} functions`
  }
} as const;

function functionPath(item: Pick<SiteFunction, "slug" | "routes">) {
  const route = (item.routes || [])[0];
  if (route) return route.startsWith("/") ? route : `/${route}`;
  return `/api/${String(item.slug || "").trim()}`;
}

function isPublished(item: SiteFunction) {
  if (item.publishedVersion) return true;
  return String(item.status || "").toLowerCase() === "active";
}

type SiteRow = {
  websiteId: string;
  name: string;
};

type SiteFunctions = {
  site: SiteRow;
  functions: SiteFunction[];
  error: string;
};

export default function ProjectFunctionsPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = texts[language === "en" ? "en" : "zh"];
  const projects = useProjects({
    t: translations[language === "en" ? "en" : "zh"],
    handleAuthError: (error) => console.warn("Project functions page auth error:", error)
  });
  const [ready, setReady] = useState(false);
  const [groups, setGroups] = useState<SiteFunctions[]>([]);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    const response = await websiteApi.list({ projectId });
    const sites: SiteRow[] = (response.websites || [])
      .map(mapWebsiteRow)
      .filter((site) => websiteMatchesProject(site, projectId))
      .map((site) => ({
        websiteId: String(site.websiteId || site._id || ""),
        name: getDisplayName(site)
      }))
      .filter((site) => site.websiteId);

    const next = await Promise.all(
      sites.map(async (site) => {
        try {
          const listed = await functionsApi.list(site.websiteId);
          return { site, functions: listed.functions || [], error: "" };
        } catch (error) {
          return {
            site,
            functions: [],
            error: error instanceof Error ? error.message : t.loadFailed
          };
        }
      })
    );
    setGroups(next);
  }, [projectId, t.loadFailed]);

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

  const total = groups.reduce((sum, group) => sum + group.functions.length, 0);
  const openSite = (websiteId: string, functionId = "") => {
    const query = functionId ? `?fn=${encodeURIComponent(functionId)}` : "";
    navigate(`/console/projects/${projectId}/sites/${websiteId}/functions${query}`);
  };

  return (
    <div className="stitch-page">
      <div className="site-page-head">
        <div>
          <div className="site-page-kicker">{currentProject?.name || t.title}</div>
          <h1 className="site-page-title">{t.title}</h1>
          <p className="site-page-desc">{t.subtitle}</p>
        </div>
        {ready && groups.length > 0 ? (
          <span className="font-mono text-sm text-[var(--stitch-muted)]">{t.total(total)}</span>
        ) : null}
      </div>

      {!ready ? (
        <div className="site-list">
          {[0, 1].map((key) => (
            <div key={key} className="site-list-row h-28 animate-pulse" />
          ))}
        </div>
      ) : loadError ? (
        <div className="rounded-[1.6rem] border border-dashed border-[var(--stitch-line)] px-6 py-16 text-center">
          <p className="font-medium text-[var(--stitch-ink)]">{t.loadFailed}</p>
          <p className="mt-2 text-sm text-[var(--stitch-muted)]">{loadError}</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-[1.6rem] border border-dashed border-[var(--stitch-line)] px-6 py-16 text-center">
          <div className="stitch-icon-tile mx-auto mb-4 h-14 w-14 rounded-2xl">
            <Code2 className="h-6 w-6" />
          </div>
          <p className="font-medium text-[var(--stitch-ink)]">{t.emptySites}</p>
          <Button
            className="stitch-primary mt-6 rounded-full px-6"
            onClick={() => navigate(`/console/projects/${projectId}/sites`)}
          >
            {t.emptySitesAction}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.site.websiteId} className="overflow-hidden rounded-[1.4rem] border border-[var(--stitch-line)]">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--stitch-line)] px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-[var(--stitch-ink)]">{group.site.name}</div>
                  <div className="truncate font-mono text-xs text-[var(--stitch-muted)]">{group.site.websiteId}</div>
                </div>
                <Button
                  size="sm"
                  className="stitch-primary rounded-full"
                  onClick={() => openSite(group.site.websiteId)}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  {t.create}
                </Button>
              </div>
              {group.error ? (
                <p className="px-4 py-6 text-sm text-[var(--stitch-muted)]">{group.error}</p>
              ) : group.functions.length === 0 ? (
                <p className="px-4 py-6 text-sm text-[var(--stitch-muted)]">{t.emptyFunctions}</p>
              ) : (
                <ul>
                  {group.functions.map((item) => (
                    <li key={item.functionId} className="border-t border-[var(--stitch-line)] first:border-t-0">
                      <button
                        type="button"
                        onClick={() => openSite(group.site.websiteId, item.functionId)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--stitch-surface)]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-[var(--stitch-ink)]">{item.name}</span>
                          <span className="block truncate font-mono text-xs text-[var(--stitch-muted)]">
                            {t.path} {functionPath(item)}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-[var(--stitch-muted)]">
                          {isPublished(item) ? t.active : t.unpublished}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
