import { useState, useEffect } from "react";
import { websiteApi, mapWebsiteRow } from "../api";
import { useToast } from "@/components/ui";
import {
  getComparableTimestamp,
  getDisplayName,
  isTokenExpiredError,
  parseTags
} from "@/lib/website-utils";

/**
 * useWebsites
 * 站点列表的加载与维护：拉取、名称内联编辑、标签内联编辑、删除。
 * @param {{ t:Record<string,any>, handleAuthError:Function }} deps
 */
export function useWebsites({ t, handleAuthError }) {
  const { toast } = useToast();
  const [websites, setWebsites] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  // 部署中状态：{ [websiteId]: boolean }，上传/重新部署/卡片三处共用
  const [deploying, setDeploying] = useState({});

  // 名称编辑
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  // 标签编辑
  const [editingTagsId, setEditingTagsId] = useState(null);
  const [editingTagsValue, setEditingTagsValue] = useState("");
  // 删除确认
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [websiteToDelete, setWebsiteToDelete] = useState(null);

  /**
   * 加载“我的站点”：管理员在这里也只看自己的站点。
   */
  const loadWebsites = async () => {
    try {
      const result = await websiteApi.list();
      if (result && result.success) {
        const mapped = (result.websites || []).map((row) => ({
          ...mapWebsiteRow(row),
          status: "deployed"
        }));
        const sorted = mapped.sort(
          (a, b) => getComparableTimestamp(b) - getComparableTimestamp(a)
        );
        setWebsites(sorted);
        setAllUsers([]);
      } else {
        throw new Error(result?.message || t.loadListFailed);
      }
    } catch (error) {
      console.error("Failed to load website list:", error);
      handleAuthError(error);
    }
  };

  // 名称编辑 ---------------------------------------------------------------
  const startEditName = (website) => {
    setEditingId(website._id);
    setEditingName(getDisplayName(website));
  };

  const cancelEditName = () => {
    setEditingId(null);
    setEditingName("");
  };

  const saveEditName = async (website) => {
    const name = String(editingName || "").trim();
    if (!name) {
      toast({
        title: t.nameEmptyTitle,
        description: t.nameEmptyDesc,
        variant: "destructive"
      });
      return;
    }
    try {
      const res = await websiteApi.updateName(website._id, name);
      if (res && res.success) {
        setWebsites((prev) =>
          prev.map((w) =>
            w._id === website._id ? { ...w, name, updatedAt: Date.now() } : w
          )
        );
        cancelEditName();
        toast({ title: t.savedTitle, description: t.savedDesc });
      } else {
        throw new Error(res?.message || t.saveFailedTitle);
      }
    } catch (error) {
      toast({
        title: t.saveFailedTitle,
        description: error.message || t.saveFailedDesc,
        variant: "destructive"
      });
    }
  };

  // 标签编辑 ---------------------------------------------------------------
  const startEditTags = (website) => {
    setEditingTagsId(website._id);
    setEditingTagsValue(Array.isArray(website.tags) ? website.tags.join(", ") : "");
  };

  const cancelEditTags = () => {
    setEditingTagsId(null);
    setEditingTagsValue("");
  };

  const saveEditTags = async (website) => {
    const tags = parseTags(editingTagsValue);
    if (tags.length > 20) {
      toast({
        title: "标签过多",
        description: "标签数量不能超过20个",
        variant: "destructive"
      });
      return;
    }
    try {
      const res = await websiteApi.updateTags(website._id, tags);
      if (res && res.success) {
        setWebsites((prev) =>
          prev.map((w) =>
            w._id === website._id ? { ...w, tags, updatedAt: Date.now() } : w
          )
        );
        cancelEditTags();
        toast({ title: t.savedTitle, description: "标签已更新" });
      } else {
        throw new Error(res?.message || t.saveFailedTitle);
      }
    } catch (error) {
      if (isTokenExpiredError(error)) {
        handleAuthError(error, false);
      } else {
        toast({
          title: t.saveFailedTitle,
          description: error.message || t.saveFailedDesc,
          variant: "destructive"
        });
      }
    }
  };

  // 项目归属 ---------------------------------------------------------------
  const moveWebsiteToProject = async (website, project) => {
    if (!website || !project) return;
    try {
      const res = await websiteApi.setWebsiteProject({
        docId: website._id,
        projectId: project.id || project._id
      });
      if (res && res.success) {
        const nextProject = res.project || project;
        setWebsites((prev) =>
          prev.map((w) =>
            w._id === website._id
              ? {
                  ...w,
                  projectId: String(nextProject.id || nextProject._id || project.id),
                  projectName: nextProject.name || project.name,
                  projectSlug: nextProject.slug || project.slug,
                  updatedAt: Date.now()
                }
              : w
          )
        );
        toast({
          title: t.projectMoveSuccessTitle,
          description: t.projectMoveSuccessDesc(nextProject.name || project.name)
        });
      } else {
        throw new Error(res?.message || t.projectMoveFailedTitle);
      }
    } catch (error) {
      toast({
        title: t.projectMoveFailedTitle,
        description: error.message || t.projectMoveFailedDesc,
        variant: "destructive"
      });
    }
  };

  // 访问级别 ---------------------------------------------------------------
  const setWebsiteVisibility = async (website, visibility) => {
    if (!website) return;
    const nextVisibility = visibility === "private" ? "private" : "public";
    const previousVisibility = website.visibility === "private" ? "private" : "public";

    setWebsites((prev) =>
      prev.map((w) =>
        w._id === website._id
          ? { ...w, visibility: nextVisibility, updatedAt: Date.now() }
          : w
      )
    );

    try {
      const res = await websiteApi.updateVisibility({
        docId: website._id,
        visibility: nextVisibility
      });
      if (!res || !res.success) {
        throw new Error(res?.message || t.visibilitySaveFailedTitle);
      }
      toast({
        title: nextVisibility === "private" ? t.visibilityPrivateTitle : t.visibilityPublicTitle,
        description:
          nextVisibility === "private"
            ? t.visibilityPrivateDesc
            : t.visibilityPublicDesc
      });
    } catch (error) {
      setWebsites((prev) =>
        prev.map((w) =>
          w._id === website._id
            ? { ...w, visibility: previousVisibility, updatedAt: Date.now() }
            : w
        )
      );
      toast({
        title: t.visibilitySaveFailedTitle,
        description: error.message || t.visibilitySaveFailedDesc,
        variant: "destructive"
      });
    }
  };

  // 删除 -------------------------------------------------------------------
  const confirmDeleteWebsite = (websiteId) => {
    const website = websites.find((w) => w._id === websiteId);
    if (website) {
      setWebsiteToDelete(website);
      setDeleteConfirmOpen(true);
    }
  };

  const executeDeleteWebsite = async () => {
    if (!websiteToDelete) return;
    const websiteId = websiteToDelete._id;
    try {
      const result = await websiteApi.delete(
        websiteToDelete.websiteId || websiteToDelete._id
      );
      if (result && result.success) {
        toast({
          title: t.toastDeleteSuccessTitle,
          description: t.toastDeleteSuccessDesc
        });
        setWebsites((prev) => prev.filter((w) => w._id !== websiteId));
      } else {
        throw new Error(result?.message || t.toastDeleteFailedTitle);
      }
    } catch (error) {
      toast({
        title: t.toastDeleteFailedTitle,
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setDeleteConfirmOpen(false);
      setWebsiteToDelete(null);
    }
  };

  /**
   * getEmailByUserId
   * 根据 userId 获取邮箱（不存在则返回空字符串）
   */
  const getEmailByUserId = (uid) => {
    const u = allUsers.find((x) => x.userId === uid);
    return (u && u.email) || "";
  };

  return {
    websites,
    setWebsites,
    deploying,
    setDeploying,
    allUsers,
    loadWebsites,
    // 名称编辑
    editingId,
    editingName,
    setEditingName,
    startEditName,
    saveEditName,
    cancelEditName,
    // 标签编辑
    editingTagsId,
    editingTagsValue,
    setEditingTagsValue,
    startEditTags,
    saveEditTags,
    cancelEditTags,
    // 项目
    moveWebsiteToProject,
    // 访问级别
    setWebsiteVisibility,
    // 删除
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    confirmDeleteWebsite,
    executeDeleteWebsite,
    // 派生
    getEmailByUserId
  };
}
