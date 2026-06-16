import React from "react";
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
  Input
} from "@/components/ui";
// @ts-ignore;
import { Archive, Check, FolderKanban, Loader2, Pencil, Plus, X } from "lucide-react";

/**
 * ProjectBar
 * 控制台项目切换与创建入口。项目为必选单选上下文，可叠加标签/用户筛选。
 */
export default function ProjectBar({
  t,
  projects,
  selectedProjectId,
  onSelectProject,
  newProjectName,
  setNewProjectName,
  creatingProject,
  onCreateProject,
  editingProjectId,
  editingProjectName,
  setEditingProjectName,
  projectBusyId,
  onStartEditProject,
  onCancelEditProject,
  onSaveProjectName,
  onArchiveProject,
  countsByProject
}) {
  const [createOpen, setCreateOpen] = React.useState(false);

  const handleCreateOpenChange = (open) => {
    if (creatingProject) return;
    setCreateOpen(open);
    if (!open) setNewProjectName("");
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    const project = await onCreateProject();
    if (project) {
      onSelectProject(project.id);
      setCreateOpen(false);
    }
  };
  const activeProject = (projects || []).find(
    (project) => String(project.id) === String(selectedProjectId || "")
  );
  const fallbackProject = (projects || []).find(
    (project) =>
      String(project.id) !== String(activeProject?.id || "") &&
      project.slug === "default"
  ) ||
    (projects || []).find(
      (project) => String(project.id) !== String(activeProject?.id || "")
    );
  const isEditingActive =
    activeProject && String(editingProjectId || "") === String(activeProject.id);
  const activeBusy =
    activeProject && String(projectBusyId || "") === String(activeProject.id);

  return (
    <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm mb-6 overflow-hidden">
      <CardContent className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <span className="mr-1 inline-flex items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-zinc-500">
              <FolderKanban className="h-4 w-4" />
              {t.projectsTitle}
            </span>
            <select
              value={selectedProjectId || ""}
              onChange={(event) => onSelectProject(event.target.value)}
              required
              disabled={(projects || []).length === 0}
              className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition-colors hover:border-zinc-700 focus:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-xs"
            >
              {(projects || []).length === 0 && (
                <option value="">{t.projectSelectEmpty}</option>
              )}
              {(projects || []).map((project) => {
                const count = countsByProject[String(project.id)] || 0;
                return (
                  <option key={project.id} value={project.id}>
                    {project.name} ({count})
                  </option>
                );
              })}
            </select>
          </div>

          <div className="flex w-full justify-end sm:w-auto">
            <Button
              type="button"
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="h-9 shrink-0 bg-zinc-100 text-zinc-900 hover:bg-zinc-300"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t.createProject}
            </Button>
          </div>
        </div>

        {activeProject && (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-zinc-900 bg-zinc-950/70 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-zinc-600">
                {t.currentProject}
              </div>
              <div className="mt-1 flex items-center gap-2">
                {isEditingActive ? (
                  <Input
                    value={editingProjectName}
                    onChange={(e) => setEditingProjectName(e.target.value)}
                    className="h-8 w-56 border-zinc-800 bg-zinc-900/70 text-sm text-zinc-100"
                    autoFocus
                    disabled={!!activeBusy}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSaveProjectName(activeProject);
                      if (e.key === "Escape") onCancelEditProject();
                    }}
                  />
                ) : (
                  <>
                    <span className="truncate text-sm font-semibold text-zinc-100">
                      {activeProject.name}
                    </span>
                    <span className="font-mono text-xs text-zinc-600">
                      ID: {activeProject.id}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isEditingActive ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!activeBusy}
                    onClick={() => onSaveProjectName(activeProject)}
                    className="h-8 border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900"
                  >
                    {activeBusy ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-3.5 w-3.5" />
                    )}
                    {t.save}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!!activeBusy}
                    onClick={onCancelEditProject}
                    className="h-8 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                  >
                    <X className="mr-2 h-3.5 w-3.5" />
                    {t.cancel}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onStartEditProject(activeProject)}
                    className="h-8 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                  >
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    {t.renameProject}
                  </Button>
                  {activeProject.slug !== "default" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!!activeBusy}
                      onClick={async () => {
                        const archived = await onArchiveProject(activeProject);
                        if (archived && fallbackProject) onSelectProject(fallbackProject.id);
                      }}
                      className="h-8 text-zinc-500 hover:bg-red-950/30 hover:text-red-400"
                    >
                      {activeBusy ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Archive className="mr-2 h-3.5 w-3.5" />
                      )}
                      {t.archiveProject}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
        <DialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
          <DialogHeader>
            <DialogTitle>{t.createProjectDialogTitle}</DialogTitle>
            <DialogDescription className="text-zinc-400">
              {t.createProjectDialogDesc}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <label
                htmlFor="new-project-name"
                className="text-xs font-mono uppercase tracking-[0.18em] text-zinc-500"
              >
                {t.projectNameLabel}
              </label>
              <Input
                id="new-project-name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder={t.newProjectPlaceholder}
                className="border-zinc-800 bg-zinc-950/70 text-zinc-100 placeholder:text-zinc-600"
                autoFocus
                disabled={creatingProject}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={creatingProject}
                onClick={() => handleCreateOpenChange(false)}
                className="text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              >
                {t.cancel}
              </Button>
              <Button
                type="submit"
                disabled={creatingProject}
                className="bg-zinc-100 text-zinc-900 hover:bg-zinc-300"
              >
                {creatingProject ? (
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
    </Card>
  );
}
