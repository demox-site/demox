import { useEffect, useState, useMemo } from "react";

const normalizeProjectId = (projectId) => String(projectId || "").trim();

export const websiteMatchesProject = (website, projectId, enableProjectFilter = true) => {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!enableProjectFilter || !normalizedProjectId) return true;
  return Boolean(
    (website?.projectId && String(website.projectId) === normalizedProjectId) ||
    (website?.projectInternalId &&
      String(website.projectInternalId) === normalizedProjectId)
  );
};

export const extractProjectTags = (
  websites,
  projectId,
  enableProjectFilter = true
) => {
  const tags = new Set();
  (websites || []).forEach((website) => {
    if (!websiteMatchesProject(website, projectId, enableProjectFilter)) return;
    if (Array.isArray(website.tags)) {
      website.tags.forEach((tag) => tags.add(tag));
    }
  });
  return Array.from(tags).sort();
};

/**
 * useFilters
 * 站点列表的标签筛选与用户筛选（管理员）。
 * 暴露已筛选的 visibleWebsites，避免在 JSX 里重复写两遍 filter。
 * @param {{ websites:any[], allUsers:any[], projectId?:string, enableProjectFilter?:boolean }} deps
 */
export function useFilters({
  websites,
  allUsers,
  projectId,
  enableProjectFilter = true
}) {
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(
    () => normalizeProjectId(projectId) || null
  );
  const scopedProjectId = normalizeProjectId(projectId) || selectedProjectId;

  const allTags = useMemo(
    () => extractProjectTags(websites, scopedProjectId, enableProjectFilter),
    [websites, scopedProjectId, enableProjectFilter]
  );
  const activeSelectedTags = useMemo(
    () => selectedTags.filter((tag) => allTags.includes(tag)),
    [selectedTags, allTags]
  );

  // 切换项目或标签被删完后，移除当前项目中已经不可用的筛选条件。
  useEffect(() => {
    setSelectedTags((prev) => {
      const next = prev.filter((tag) => allTags.includes(tag));
      return next.length === prev.length ? prev : next;
    });
  }, [allTags]);

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
    const id = normalizeProjectId(projectId);
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
          activeSelectedTags.length === 0 ||
          (Array.isArray(w.tags) &&
            w.tags.some((tag) => activeSelectedTags.includes(tag)));
        const userOk =
          selectedUserIds.length === 0 ||
          (w.userId && selectedUserIds.includes(w.userId));
        const projectOk =
          websiteMatchesProject(w, scopedProjectId, enableProjectFilter);
        return tagOk && userOk && projectOk;
      }),
    [websites, activeSelectedTags, selectedUserIds, scopedProjectId, enableProjectFilter]
  );

  return {
    allTags,
    selectedTags: activeSelectedTags,
    selectedUserIds,
    selectedProjectId: scopedProjectId,
    selectProjectId,
    toggleFilterTag,
    clearFilterTags,
    toggleSelectUserId,
    clearSelectedUserIds,
    getUsersWithEmail,
    visibleWebsites
  };
}
