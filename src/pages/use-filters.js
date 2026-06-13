import { useState, useMemo } from "react";

/**
 * useFilters
 * 站点列表的标签筛选与用户筛选（管理员）。
 * 暴露已筛选的 visibleWebsites，避免在 JSX 里重复写两遍 filter。
 * @param {{ websites:any[], allUsers:any[] }} deps
 */
export function useFilters({ websites, allUsers }) {
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedUserIds, setSelectedUserIds] = useState([]);

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
        return tagOk && userOk;
      }),
    [websites, selectedTags, selectedUserIds]
  );

  return {
    selectedTags,
    selectedUserIds,
    toggleFilterTag,
    clearFilterTags,
    toggleSelectUserId,
    clearSelectedUserIds,
    getUsersWithEmail,
    visibleWebsites
  };
}
