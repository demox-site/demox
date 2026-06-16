import React from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
// @ts-ignore
import { Card, CardContent } from "@/components/ui";
// @ts-ignore
import { ShieldCheck } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { userManager } from "@/api";
import { translations } from "../home-translations";
import { useProjects } from "../use-projects";
import { ProjectMembersPanel } from "@/components/console/ProjectMembersDialog";

export default function ProjectMembersPage() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const { language: lang } = useLanguage();
  const t = translations[lang];
  const currentUser = React.useMemo(() => userManager.get(), []);
  const projects = useProjects({
    t,
    handleAuthError: (error) => console.warn("Project members page auth error:", error)
  });

  React.useEffect(() => {
    projects.loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentProject = projects.getProjectById(projectId) || null;
  const missingProject =
    projectId &&
    !projects.loadingProjects &&
    projects.activeProjects.length > 0 &&
    !currentProject;

  if (missingProject) {
    return <Navigate to="/console/projects" replace />;
  }

  const projectForPanel = currentProject || {
    id: projectId,
    name: t.defaultProjectName || "Project"
  };

  return (
    <div className="stitch-page">
      <Card className="stitch-panel overflow-hidden">
        <CardContent className="p-4 sm:p-6">
          <div className="mb-5 flex items-center gap-2 text-sm text-[var(--stitch-muted)]">
            <ShieldCheck className="h-4 w-4 text-[var(--stitch-blue)]" />
            {t.projectMembersDesc}
          </div>
          <ProjectMembersPanel
            project={projectForPanel}
            projectId={projectId}
            currentUser={currentUser}
            t={t}
            onLeave={() => navigate("/console/projects")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
