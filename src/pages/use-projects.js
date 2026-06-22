import { useMemo, useState } from "react";
import { websiteApi } from "../api";
import { useToast } from "@/components/ui";

const normalizeProject = (project) => ({
  ...project,
  id: String(project?.id || project?._id || ""),
  _id: String(project?._id || project?.id || ""),
  numericId: project?.numericId ? String(project.numericId) : null,
  projectKey: project?.projectKey || project?.project_key || project?.id || null,
  name: project?.name || "default",
  slug: project?.slug || "default",
  role: project?.role || project?.projectRole || null,
  ownerUserId: project?.ownerUserId || project?.userId || null,
  ownerEmail: project?.ownerEmail || "",
  ownerNickname: project?.ownerNickname || "",
  websitesCount: Number(project?.websitesCount || project?.websites_count || 0)
});

/**
 * useProjects
 * 管理当前用户的项目列表、创建项目和上传目标项目。
 */
export function useProjects({ t, handleAuthError }) {
  const { toast } = useToast();
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [uploadProjectId, setUploadProjectId] = useState(null);
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [projectBusyId, setProjectBusyId] = useState(null);

  const activeProjects = useMemo(
    () => (projects || []).filter((p) => !p.archived),
    [projects]
  );

  const defaultProject = useMemo(
    () => activeProjects.find((p) => p.slug === "default") || activeProjects[0] || null,
    [activeProjects]
  );

  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      const res = await websiteApi.listProjects();
      if (res && res.success) {
        const mapped = (res.projects || []).map(normalizeProject);
        setProjects(mapped);
        if (!uploadProjectId && mapped.length > 0) {
          const def = mapped.find((p) => p.slug === "default") || mapped[0];
          setUploadProjectId(def.id);
        }
      } else {
        throw new Error(res?.message || t.projectLoadFailed);
      }
    } catch (error) {
      handleAuthError(error, false);
      toast({
        title: t.projectLoadFailed,
        description: error.message || t.projectLoadFailedDesc,
        variant: "destructive"
      });
    } finally {
      setLoadingProjects(false);
    }
  };

  const createProject = async () => {
    const name = String(newProjectName || "").trim();
    if (!name) {
      toast({
        title: t.projectNameEmptyTitle,
        description: t.projectNameEmptyDesc,
        variant: "destructive"
      });
      return null;
    }
    setCreatingProject(true);
    try {
      const res = await websiteApi.createProject({ name });
      if (res && res.success && res.project) {
        const project = normalizeProject(res.project);
        setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
        setUploadProjectId(project.id);
        setNewProjectName("");
        toast({ title: t.projectCreatedTitle, description: t.projectCreatedDesc });
        return project;
      }
      throw new Error(res?.message || t.projectCreateFailed);
    } catch (error) {
      toast({
        title: t.projectCreateFailed,
        description: error.message || t.projectCreateFailedDesc,
        variant: "destructive"
      });
      return null;
    } finally {
      setCreatingProject(false);
    }
  };

  const startEditProject = (project) => {
    setEditingProjectId(project?.id || null);
    setEditingProjectName(project?.name || "");
  };

  const cancelEditProject = () => {
    setEditingProjectId(null);
    setEditingProjectName("");
  };

  const saveProjectName = async (project) => {
    const id = project?.id;
    const name = String(editingProjectName || "").trim();
    if (!id) return null;
    if (!name) {
      toast({
        title: t.projectNameEmptyTitle,
        description: t.projectNameEmptyDesc,
        variant: "destructive"
      });
      return null;
    }

    setProjectBusyId(id);
    try {
      const res = await websiteApi.updateProject({ id, name });
      if (res && res.success && res.project) {
        const nextProject = normalizeProject(res.project);
        setProjects((prev) =>
          prev.map((p) => (p.id === nextProject.id ? { ...p, ...nextProject } : p))
        );
        cancelEditProject();
        toast({ title: t.projectSavedTitle, description: t.projectSavedDesc });
        return nextProject;
      }
      throw new Error(res?.message || t.projectSaveFailedTitle);
    } catch (error) {
      toast({
        title: t.projectSaveFailedTitle,
        description: error.message || t.projectSaveFailedDesc,
        variant: "destructive"
      });
      return null;
    } finally {
      setProjectBusyId(null);
    }
  };

  const archiveProject = async (project) => {
    const id = project?.id;
    if (!id) return false;
    setProjectBusyId(id);
    try {
      const res = await websiteApi.archiveProject({ id, archived: true });
      if (res && res.success) {
        setProjects((prev) =>
          prev.map((p) => (p.id === String(id) ? { ...p, archived: true } : p))
        );
        if (String(uploadProjectId || "") === String(id)) {
          setUploadProjectId(defaultProject?.id || null);
        }
        toast({ title: t.projectArchivedTitle, description: t.projectArchivedDesc });
        return true;
      }
      throw new Error(res?.message || t.projectArchiveFailedTitle);
    } catch (error) {
      toast({
        title: t.projectArchiveFailedTitle,
        description: error.message || t.projectArchiveFailedDesc,
        variant: "destructive"
      });
      return false;
    } finally {
      setProjectBusyId(null);
    }
  };

  const getProjectById = (id) => {
    const key = String(id || "");
    return activeProjects.find((p) => p.id === key || p.numericId === key) || null;
  };

  const getUploadProject = (selectedProjectId) => {
    const selected = getProjectById(selectedProjectId);
    if (selected) return selected;
    return getProjectById(uploadProjectId) || defaultProject;
  };

  return {
    projects,
    activeProjects,
    defaultProject,
    loadingProjects,
    creatingProject,
    projectBusyId,
    newProjectName,
    setNewProjectName,
    editingProjectId,
    editingProjectName,
    setEditingProjectName,
    uploadProjectId,
    setUploadProjectId: (id) => setUploadProjectId(id ? String(id) : null),
    loadProjects,
    createProject,
    startEditProject,
    cancelEditProject,
    saveProjectName,
    archiveProject,
    getProjectById,
    getUploadProject
  };
}
