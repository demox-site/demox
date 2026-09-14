import React from "react";
import { Navigate, useParams } from "react-router-dom";
import { Button, Input } from "@/components/ui";
import { Search, UploadCloud } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { translations } from "../home-translations";
import { useAuth } from "../use-auth";
import { useWebsites } from "../use-websites";
import { useProjects } from "../use-projects";
import { useFilters, websiteMatchesProject } from "../use-filters";
import SiteListRow from "@/components/home/SiteListRow";

function SitesSkeleton() {
  return (
    <div className="stitch-page">
      <div className="site-list">
        {[0, 1, 2].map((key) => (
          <div key={key} className="site-list-row h-28 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export default function SitesPage() {
  const { projectId } = useParams();
  const currentProjectId = projectId ? String(projectId) : "";
  const { language: lang } = useLanguage();
  const t = translations[lang];
  const auth = useAuth(t);
  const { isLoading, isLoggedIn, user, roleLimits, handleAuthError, navigate } = auth;
  const sites = useWebsites({ user, t, handleAuthError, projectId: currentProjectId });
  const projects = useProjects({ user, t, handleAuthError });
  const filters = useFilters({
    websites: sites.websites,
    allUsers: sites.allUsers,
    projectId: currentProjectId,
    enableProjectFilter: !!currentProjectId
  });
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!isLoggedIn) return;
    let alive = true;
    setReady(false);
    Promise.all([sites.loadWebsites(), projects.loadProjects()]).finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, currentProjectId]);

  if (isLoading) return <SitesSkeleton />;
  if (!isLoggedIn) return <Navigate to="/index" replace />;
  if (!ready) return <SitesSkeleton />;

  const missingProject =
    currentProjectId &&
    !projects.loadingProjects &&
    projects.activeProjects.length > 0 &&
    !projects.getProjectById(currentProjectId);

  if (missingProject) {
    return <Navigate to="/console/projects" replace />;
  }

  const currentProject = projects.getProjectById(currentProjectId);
  const projectCount = sites.websites.filter((website) =>
    websiteMatchesProject(website, currentProjectId)
  ).length;
  const limit = roleLimits?.deployment_limit;
  const quota =
    limit === null || limit === undefined ? `${projectCount} / ∞` : `${projectCount} / ${limit}`;
  const hasQuery = Boolean(String(filters.searchQuery || "").trim());
  const hasFilters = hasQuery || filters.selectedTags.length > 0;
  const goDeploy = () => {
    if (!currentProjectId) return;
    navigate(`/console/projects/${currentProjectId}/deploy`);
  };

  return (
    <div className="stitch-page">
      <div className="site-page-head">
        <div>
          <div className="site-page-kicker">{currentProject?.name || t.sitesPageTitle}</div>
          <h1 className="site-page-title">{t.sitesPageTitle}</h1>
          <p className="site-page-desc">{t.sitesPageDesc}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {roleLimits ? (
            <span className="font-mono text-sm text-[var(--stitch-muted)]">{quota}</span>
          ) : null}
          <Button className="stitch-primary rounded-full px-5" onClick={goDeploy}>
            <UploadCloud className="mr-2 h-4 w-4" />
            {t.startDeploy}
          </Button>
        </div>
      </div>

      {projectCount > 0 || hasFilters ? (
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--stitch-muted)]" />
            <Input
              value={filters.searchQuery}
              onChange={(event) => filters.setSearchQuery(event.target.value)}
              placeholder={t.sitesSearchPlaceholder}
              className="h-11 rounded-full border-[var(--stitch-line)] bg-[var(--stitch-surface)] pl-10"
            />
          </div>
          {filters.allTags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={filters.clearFilterTags}
                className={`site-tag ${filters.selectedTags.length === 0 ? "border-[var(--stitch-ink)] text-[var(--stitch-ink)]" : ""}`}
              >
                {t.filterAll}
              </button>
              {filters.allTags.map((tag) => {
                const active = filters.selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => filters.toggleFilterTag(tag)}
                    className={`site-tag ${active ? "border-[var(--stitch-ink)] text-[var(--stitch-ink)]" : ""}`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {filters.visibleWebsites.length === 0 ? (
        <div className="rounded-[1.6rem] border border-dashed border-[var(--stitch-line)] px-6 py-16 text-center">
          <div className="stitch-icon-tile mx-auto mb-4 h-14 w-14 rounded-2xl">
            <UploadCloud className="h-6 w-6" />
          </div>
          {hasFilters ? (
            <>
              <p className="font-medium text-[var(--stitch-ink)]">{t.emptySearchTitle}</p>
              <p className="mt-2 text-sm text-[var(--stitch-muted)]">
                {hasQuery ? t.emptySearchDesc(filters.searchQuery.trim()) : t.emptySearchTitle}
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-[var(--stitch-ink)]">{t.emptyTitle}</p>
              <p className="mt-2 text-sm text-[var(--stitch-muted)]">{t.emptyDesc}</p>
              <Button className="stitch-primary mt-6 rounded-full px-6" onClick={goDeploy}>
                {t.startDeploy}
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="site-list">
          {filters.visibleWebsites.map((website) => (
            <SiteListRow
              key={website._id}
              website={website}
              t={t}
              lang={lang}
              deploying={sites.deploying}
              onOpen={(item) =>
                navigate(
                  `/console/projects/${currentProjectId}/sites/${item.websiteId || item._id}`
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
