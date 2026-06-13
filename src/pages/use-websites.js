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
 * recomputeAllTags
 * 从站点列表中提取去重排序后的标签集合
 */
const recomputeAllTags = (list) => {
  const tagsSet = new Set();
  (list || []).forEach((w) => {
    if (Array.isArray(w.tags)) w.tags.forEach((tag) => tagsSet.add(tag));
  });
  return Array.from(tagsSet).sort();
};

/**
 * useWebsites
 * 站点列表的加载与维护：拉取、名称内联编辑、标签内联编辑、删除。
 * 同时维护派生的 allTags / allUsers（供筛选区使用）。
 * @param {{ user:any, t:Record<string,any>, handleAuthError:Function }} deps
 */
export function useWebsites({ user, t, handleAuthError }) {
  const { toast } = useToast();
  const [websites, setWebsites] = useState([]);
  const [allTags, setAllTags] = useState([]);
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
   * 加载站点列表：普通用户仅加载自己的，管理员加载所有人的
   */
  const loadWebsites = async () => {
    try {
      const isAdmin = Array.isArray(user?.roles) && user.roles.includes("admin");
      const result = isAdmin ? await websiteApi.listAll() : await websiteApi.list();
      if (result && result.success) {
        const mapped = (result.websites || []).map((row) => ({
          ...mapWebsiteRow(row),
          status: "deployed"
        }));
        const sorted = mapped.sort(
          (a, b) => getComparableTimestamp(b) - getComparableTimestamp(a)
        );
        setWebsites(sorted);
        setAllTags(recomputeAllTags(sorted));

        // 管理员解析用户邮箱用于筛选
        if (isAdmin) {
          const uidSet = new Set(sorted.map((w) => w.userId).filter(Boolean));
          const uniqueUids = Array.from(uidSet);
          if (uniqueUids.length > 0) {
            try {
              const emailRes = await websiteApi.resolveUserEmails(uniqueUids);
              if (emailRes && emailRes.success) {
                setAllUsers(emailRes.users || []);
              } else {
                setAllUsers(uniqueUids.map((uid) => ({ userId: uid, email: "" })));
              }
            } catch {
              setAllUsers(uniqueUids.map((uid) => ({ userId: uid, email: "" })));
            }
          } else {
            setAllUsers([]);
          }
        } else {
          setAllUsers([]);
        }
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
        setWebsites((prev) => {
          const next = prev.map((w) =>
            w._id === website._id ? { ...w, tags, updatedAt: Date.now() } : w
          );
          setAllTags(recomputeAllTags(next));
          return next;
        });
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
    allTags,
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
    // 删除
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    confirmDeleteWebsite,
    executeDeleteWebsite,
    // 派生
    getEmailByUserId
  };
}
