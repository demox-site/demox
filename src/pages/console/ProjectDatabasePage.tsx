import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Database } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { translations } from "../home-translations";
import { useProjects } from "../use-projects";

const texts = {
  zh: {
    title: "数据库",
    subtitle: "一个项目对应一个数据库。站点和函数共用这一份数据。",
    withProject: "每个项目一份",
    detail: "不在这里单独创建。控制台还不能查看连接信息。需要数据的函数以后从环境里访问，连接密码留在平台上。",
    project: "项目",
    scope: "范围"
  },
  en: {
    title: "Database",
    subtitle: "One project has one database. Sites and functions share it.",
    withProject: "One per project",
    detail: "There is no separate create action here. The console cannot show a connection yet. Functions that need data will read it from the environment later. The password stays on the platform.",
    project: "Project",
    scope: "Scope"
  }
} as const;

export default function ProjectDatabasePage() {
  const { projectId = "" } = useParams();
  const { language } = useLanguage();
  const t = texts[language === "en" ? "en" : "zh"];
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
          <p className="mt-5 text-sm leading-6 text-[var(--stitch-muted)]">{t.detail}</p>
        </section>
      )}
    </div>
  );
}
