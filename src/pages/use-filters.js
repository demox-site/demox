import { useState, useMemo } from "react";

/**
 * useFilters
 * 站点列表的标签筛选与用户筛选（管理员）。
 * 暴露已筛选的 visibleWebsites，避免在 JSX 里重复写两遍 filter。
 * @param {{ websites:any[], allUsers:any[], enableProjectFilter?:boolean }} deps
 */
export function useFilters({ websites, allUsers, enableProjectFilter = true }) {
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);

  // 标签筛选 ---------------------------------------------------------------
  const toggleFilterTag = (tag) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]
    );
  };
  const clearFilterTags = () => setSelectedTags([]);

  // 用户筛选（管理员）------------------------------------------------------
  const toggleSelectUserId = (uid) => {
    uid = String(uid || "").trim();
    if (!uid) return;
    setSelectedUserIds((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]
    );
  };
  const clearSelectedUserIds = () => setSelectedUserIds([]);

  // 项目上下文：必选单选，不提供清空态。
  const selectProjectId = (projectId) => {
    const id = String(projectId || "").trim();
    if (!id) return;
    setSelectedProjectId(id);
  };

  /**
   * getUsersWithEmail
   * 仅保留有邮箱的用户列表（用于筛选下拉框展示）
   */
  const getUsersWithEmail = () =>
    (allUsers || []).filter((u) => String(u?.email || "").trim());

  // 已筛选的站点列表
  const visibleWebsites = useMemo(
    () =>
      (websites || []).filter((w) => {
        const tagOk =
          selectedTags.length === 0 ||
          (Array.isArray(w.tags) && w.tags.some((tag) => selectedTags.includes(tag)));
        const userOk =
          selectedUserIds.length === 0 ||
          (w.userId && selectedUserIds.includes(w.userId));
        const projectOk =
          !enableProjectFilter ||
          !selectedProjectId ||
          (w.projectId && String(w.projectId) === String(selectedProjectId)) ||
          (w.projectInternalId && String(w.projectInternalId) === String(selectedProjectId));
        return tagOk && userOk && projectOk;
      }),
    [websites, selectedTags, selectedUserIds, selectedProjectId, enableProjectFilter]
  );

  return {
    selectedTags,
    selectedUserIds,
    selectedProjectId,
    selectProjectId,
    toggleFilterTag,
    clearFilterTags,
    toggleSelectUserId,
    clearSelectedUserIds,
    getUsersWithEmail,
    visibleWebsites
  };
}
