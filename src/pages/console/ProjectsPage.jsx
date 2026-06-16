import React from "react";
import { useNavigate } from "react-router-dom";
// @ts-ignore;
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Badge
} from "@/components/ui";
// @ts-ignore;
import { FolderKanban, Loader2, Plus, ArrowRight, Globe2, Sparkles } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { translations } from "../home-translations";
import { useProjects } from "../use-projects";

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { language: lang } = useLanguage();
  const t = translations[lang];
  const projects = useProjects({
    t,
    handleAuthError: (error) => console.warn("Project page auth error:", error)
  });
  const [createOpen, setCreateOpen] = React.useState(false);

  React.useEffect(() => {
    projects.loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openProject = (project) => {
    if (!project?.id) return;
    navigate(`/console/projects/${project.id}/sites`);
  };

  const handleCreateOpenChange = (open) => {
    if (projects.creatingProject) return;
    setCreateOpen(open);
    if (!open) projects.setNewProjectName("");
  };

  const handleCreateProject = async (event) => {
    event.preventDefault();
    const project = await projects.createProject();
    if (project) {
      setCreateOpen(false);
      navigate(`/console/projects/${project.id}/sites`);
    }
  };

  const roleLabel = (role) => {
    if (role === "owner") return t.projectRoleOwner;
    if (role === "admin") return t.projectRoleAdmin;
    if (role === "member") return t.projectRoleMember;
    return role || "";
  };

  return (
    <div className="stitch-page">
      <div className="stitch-page-hero mb-8">
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="stitch-eyebrow">
              <Sparkles className="h-3.5 w-3.5" />
              {t.projectsTitle}
            </div>
            <h1 className="stitch-title">
              {t.projectSelectPageTitle}
            </h1>
            <p className="stitch-subtitle">
              {t.projectSelectPageDesc}
            </p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            className="stitch-primary rounded-full px-5"
          >
            <Plus className="mr-2 h-4 w-4" />
            {t.createProject}
          </Button>
        </div>
      </div>

      {projects.loadingProjects ? (
        <div className="stitch-panel flex items-center justify-center py-24 text-[var(--stitch-muted)]">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {t.loading}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(projects.activeProjects || []).map((project) => (
            <Card
              key={project.id}
              className="stitch-card group cursor-pointer overflow-hidden"
              onClick={() => openProject(project)}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="stitch-icon-tile">
                      <FolderKanban className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-lg font-semibold text-[var(--stitch-ink)]">
                        {project.name}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-[var(--stitch-muted)]">
                        ID: {project.id}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {project.role && (
                      <Badge className="border-[var(--stitch-line)] bg-[var(--stitch-blue-soft)] text-[var(--stitch-ink)]">
                        {roleLabel(project.role)}
                      </Badge>
                    )}
                    <ArrowRight className="h-4 w-4 text-[var(--stitch-muted)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--stitch-blue)]" />
                  </div>
                </div>
                <div className="mt-6">
                  <div className="flex items-center justify-between rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] px-3 py-2 text-sm text-[var(--stitch-muted)]">
                    <span className="inline-flex items-center gap-2">
                      <Globe2 className="h-4 w-4 text-[var(--stitch-blue)]" />
                      {t.projectSiteCount}
                    </span>
                    <span className="font-mono text-[var(--stitch-ink)]">
                      {project.websitesCount || 0}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
        <DialogContent className="border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)]">
          <DialogHeader>
            <DialogTitle>{t.createProjectDialogTitle}</DialogTitle>
            <DialogDescription className="text-[var(--stitch-muted)]">
              {t.createProjectDialogDesc}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateProject} className="space-y-5">
            <div className="space-y-2">
              <label
                htmlFor="project-page-new-project-name"
                className="text-xs font-mono uppercase tracking-[0.18em] text-[var(--stitch-muted)]"
              >
                {t.projectNameLabel}
              </label>
              <Input
                id="project-page-new-project-name"
                value={projects.newProjectName}
                onChange={(event) => projects.setNewProjectName(event.target.value)}
                placeholder={t.newProjectPlaceholder}
                className="border-[var(--stitch-line)] bg-[var(--stitch-surface)] text-[var(--stitch-ink)] placeholder:text-[var(--stitch-muted)]"
                autoFocus
                disabled={projects.creatingProject}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={projects.creatingProject}
                onClick={() => handleCreateOpenChange(false)}
                className="text-[var(--stitch-muted)] hover:bg-[var(--stitch-blue-soft)] hover:text-[var(--stitch-ink)]"
              >
                {t.cancel}
              </Button>
              <Button
                type="submit"
                disabled={projects.creatingProject}
                className="stitch-primary"
              >
                {projects.creatingProject ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {t.createProject}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
