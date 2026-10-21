import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { Button, Input, useToast } from "@/components/ui";
import { ConfirmDestructive } from "@/components/ui/confirm-destructive";
import { ProjectMembersPanel } from "@/components/console/ProjectMembersDialog";
import { Loader2, Trash2 } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { userManager, websiteApi } from "@/api";
import { translations } from "../home-translations";
import { useProjects } from "../use-projects";

const texts = {
  zh: {
    title: "项目设置",
    subtitle: "修改项目名称，管理成员，或删除没有站点的项目。",
    nameSection: "名称",
    membersSection: "成员",
    deleteSection: "删除",
    deleteHint: "删除会去掉这个空项目。项目里还有站点时不能删除。",
    defaultKept: "这个默认项目留在账号里。",
    nameReadOnly: "项目名称由 owner 或 admin 修改。",
    domainsStay: "站点的域名在进入具体站点后的站点设置里。"
  },
  en: {
    title: "Project settings",
    subtitle: "Rename the project, manage members, or delete a project that has no sites.",
    nameSection: "Name",
    membersSection: "Members",
    deleteSection: "Delete",
    deleteHint: "Deleting removes this empty project. A project that still has sites stays.",
    defaultKept: "This default project stays on the account.",
    nameReadOnly: "Owners and admins can change the project name.",
    domainsStay: "A site's domains live in that site's settings."
  }
} as const;

type OutletUser = {
  user?: {
    userId?: string;
    email?: string;
  } | null;
};

export default function ProjectSettingsPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const lang = language === "en" ? "en" : "zh";
  const page = texts[lang];
  const t = translations[lang];
  const { toast } = useToast();
  const outlet = (useOutletContext() || {}) as OutletUser;
  const currentUser = outlet.user || userManager.get();
  const projects = useProjects({
    t,
    handleAuthError: (error) => console.warn("Project settings auth error:", error)
  });
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [seededId, setSeededId] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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

  useEffect(() => {
    if (!currentProject?.id || seededId === currentProject.id) return;
    setName(currentProject.name || "");
    setSeededId(currentProject.id);
  }, [currentProject, seededId]);

  const missingProject =
    projectId &&
    !projects.loadingProjects &&
    projects.activeProjects.length > 0 &&
    !currentProject;

  if (missingProject) {
    return <Navigate to="/console/projects" replace />;
  }

  const role = currentProject?.role || "";
  const canWrite = role === "owner" || role === "admin";
  const canDelete = role === "owner" && currentProject?.slug !== "default";
  const blockedBySites = (currentProject?.websitesCount || 0) > 0;
  const base = `/console/projects/${projectId}`;

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentProject?.id || !canWrite || saving) return;
    const nextName = name.trim();
    if (!nextName) {
      toast({
        title: t.projectNameEmptyTitle,
        description: t.projectNameEmptyDesc,
        variant: "destructive"
      });
      return;
    }
    setSaving(true);
    try {
      const res = await websiteApi.updateProject({ id: currentProject.id, name: nextName });
      if (!res?.success) throw new Error(res?.message || t.projectSaveFailedTitle);
      setName(String(res.project?.name || nextName));
      window.dispatchEvent(new Event("demox-projects-changed"));
      await projects.loadProjects();
      toast({ title: t.projectSavedTitle, description: t.projectSavedDesc });
    } catch (error) {
      toast({
        title: t.projectSaveFailedTitle,
        description: error instanceof Error ? error.message : t.projectSaveFailedDesc,
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!currentProject || blockedBySites) return;
    const deleted = await projects.deleteProject(currentProject);
    if (!deleted) return;
    setDeleteOpen(false);
    window.dispatchEvent(new Event("demox-projects-changed"));
    navigate("/console/projects");
  };

  return (
    <div className="stitch-page">
      <div className="site-page-head">
        <div>
          <div className="site-page-kicker">{currentProject?.name || page.title}</div>
          <h1 className="site-page-title">{page.title}</h1>
          <p className="site-page-desc">{page.subtitle}</p>
        </div>
      </div>

      {!ready ? (
        <div className="h-40 animate-pulse rounded-[1.4rem] border border-[var(--stitch-line)]" />
      ) : (
        <div className="flex flex-col gap-6">
          <section className="rounded-[1.4rem] border border-[var(--stitch-line)] p-4 sm:p-6">
            <h2 className="text-sm font-medium text-[var(--stitch-ink)]">{page.nameSection}</h2>
            <form onSubmit={saveName} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-2">
                <label
                  htmlFor="project-settings-name"
                  className="text-xs font-mono uppercase tracking-[0.18em] text-[var(--stitch-muted)]"
                >
                  {t.projectNameLabel}
                </label>
                <Input
                  id="project-settings-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={!canWrite || saving}
                  className="border-[var(--stitch-line)] bg-[var(--stitch-surface)] text-[var(--stitch-ink)]"
                />
              </div>
              {canWrite ? (
                <Button type="submit" disabled={saving} className="stitch-primary rounded-full px-6">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t.save}
                </Button>
              ) : null}
            </form>
            {!canWrite ? (
              <p className="mt-3 text-sm text-[var(--stitch-muted)]">{page.nameReadOnly}</p>
            ) : null}
            <p className="mt-3 text-sm text-[var(--stitch-muted)]">{page.domainsStay}</p>
          </section>

          <section className="rounded-[1.4rem] border border-[var(--stitch-line)] p-4 sm:p-6">
            <h2 className="text-sm font-medium text-[var(--stitch-ink)]">{page.membersSection}</h2>
            <p className="mt-2 text-sm text-[var(--stitch-muted)]">{t.projectMembersDesc}</p>
            <div className="mt-4">
              <ProjectMembersPanel
                project={currentProject || { id: projectId, name: t.defaultProjectName || "Project" }}
                projectId={projectId}
                currentUser={currentUser}
                t={t}
                onLeave={() => navigate("/console/projects")}
              />
            </div>
          </section>

          <section className="rounded-[1.4rem] border border-[var(--stitch-line)] p-4 sm:p-6">
            <h2 className="text-sm font-medium text-[var(--stitch-ink)]">{page.deleteSection}</h2>
            {canDelete ? (
              <>
                <p className="mt-2 text-sm text-[var(--stitch-muted)]">{page.deleteHint}</p>
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-4 rounded-full text-[var(--stitch-muted)] hover:bg-[var(--stitch-blue-soft)] hover:text-[var(--stitch-ink)]"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t.deleteProject}
                </Button>
              </>
            ) : (
              <p className="mt-2 text-sm text-[var(--stitch-muted)]">
                {currentProject?.slug === "default" ? page.defaultKept : page.deleteHint}
              </p>
            )}
          </section>
        </div>
      )}

      <ConfirmDestructive
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !projects.projectBusyId) setDeleteOpen(false);
        }}
        title={t.projectDeleteDialogTitle}
        description={blockedBySites
          ? t.projectDeleteBlockedSites
          : t.projectDeleteDialogDesc(currentProject?.name || "")}
        confirmLabel={t.projectDeleteConfirm}
        cancelLabel={t.cancel}
        icon={<Trash2 className="mr-2 h-4 w-4" aria-hidden />}
        busy={!!projects.projectBusyId}
        disabled={blockedBySites}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
