import React from "react";
import { useNavigate } from "react-router-dom";
// @ts-ignore;
import {
  Button,
  Badge,
  Input,
  Switch,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui";
// @ts-ignore;
import {
  Upload,
  Trash2,
  ExternalLink,
  CheckCircle,
  XCircle,
  RefreshCw,
  Pencil,
  Tag,
  Check,
  X,
  Link2,
  FolderKanban,
  Globe2,
  LockKeyhole,
  BarChart3,
  Settings2,
  Search
} from "lucide-react";
import StatusBadge from "./StatusBadge";
import {
  getDisplayName,
  getSiteDomains,
  formatTimestamp
} from "@/lib/website-utils";

/**
 * WebsiteCard
 * 部署列表中的单条站点卡片：名称内联编辑、标签内联编辑、状态徽章、
 * 创建/修改时间、域名列表、公开/私有、重新部署/自定义域名/删除操作。
 */
export default function WebsiteCard({
  website,
  t,
  user,
  deploying,
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
  parseTags,
  joinTags,
  // 其它
  getEmailByUserId,
  showProjectInfo = true,
  projects = [],
  moveWebsiteToProject,
  setWebsiteVisibility,
  openRedeployDialog,
  openDomainDialog,
  openSeoDialog,
  confirmDeleteWebsite
}) {
  const navigate = useNavigate();
  const isProcessing = website.status === "processing" || deploying[website._id];
  const isPlatformAdmin = Array.isArray(user?.roles) && user.roles.includes("admin");
  const isSiteOwner = !website.userId || website.userId === user?.userId;
  const canManageByProject = ["owner", "admin"].includes(website.projectRole || "");
  const canViewAnalyticsByProject = !!website.projectRole;
  const canManageSite = isSiteOwner || isPlatformAdmin || canManageByProject;
  const canViewAnalytics = isSiteOwner || isPlatformAdmin || canViewAnalyticsByProject;
  const canMoveProject =
    canManageSite &&
    Array.isArray(projects) &&
    projects.length > 0;
  const currentProjectName = website.projectName || (website.projectId ? t.defaultProjectName : "");
  const isPrivate = website.visibility === "private";
  const isPublic = !isPrivate;
  const creatorName = String(website.userNickname || "").trim();
  const canChangeVisibility = canManageSite;
  const analyticsPath = website.projectId && (website.websiteId || website._id)
    ? `/console/projects/${website.projectId}/sites/${website.websiteId || website._id}/analytics`
    : "";
  const settingsActionClass =
    "rounded-xl border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground";

  return (
    <div className="stitch-site-row p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex flex-col items-start gap-0.5 group">
            {editingId === website._id ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  className="w-48 rounded-lg border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] px-2 py-1 text-sm text-[var(--stitch-ink)] focus:border-[var(--stitch-blue)] focus:outline-none"
                />
                <button
                  onClick={() => saveEditName(website)}
                  className="text-[var(--stitch-ink)] hover:text-[var(--stitch-muted)]"
                  title={t.save}
                >
                  <CheckCircle className="w-4 h-4" />
                </button>
                <button
                  onClick={cancelEditName}
                  className="text-[var(--stitch-muted)] hover:text-[var(--stitch-ink)]"
                  title={t.cancel}
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="text-[var(--stitch-ink)] font-bold truncate">
                    {getDisplayName(website)}
                  </h3>
                  {canManageSite && (
                    <button
                      type="button"
                      onClick={() => startEditName(website)}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-blue-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--stitch-muted)] transition-colors hover:text-[var(--stitch-ink)]"
                      title={t.editName || "编辑名称"}
                    >
                      <Pencil className="h-3 w-3" />
                      {t.editName || "编辑名称"}
                    </button>
                  )}
                </div>
                {(website.websiteId || website._id) && (
                  <span className="text-[11px] text-[var(--stitch-muted)] font-mono leading-none">
                    ID: {website.websiteId || website._id}
                  </span>
                )}
              </>
            )}
          </div>
          <StatusBadge status={website.status} t={t} />
          <Badge
            className={
              isPrivate
                ? "stitch-status-private"
                : "stitch-status-public"
            }
          >
            {isPrivate ? (
              <LockKeyhole className="w-3 h-3 mr-1" />
            ) : (
              <Globe2 className="w-3 h-3 mr-1" />
            )}
            {isPrivate ? t.visibilityPrivate : t.visibilityPublic}
          </Badge>
          {deploying[website._id] && (
            <Badge className="border-[var(--stitch-line)] bg-[var(--stitch-blue-soft)] text-[var(--stitch-ink)]">
              <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
              {t.processingBadge}
            </Badge>
          )}
        </div>

        {/* Tags Section */}
        <div className="flex items-center flex-wrap gap-2 mt-2">
          {editingTagsId === website._id ? (
            <div className="flex items-center gap-2 w-full max-w-md my-1">
              <Input
                value={editingTagsValue}
                onChange={(e) => setEditingTagsValue(e.target.value)}
                placeholder="输入标签，用逗号分隔"
                className="h-7 text-xs bg-[var(--stitch-surface-strong)] border-[var(--stitch-line)] focus:border-[var(--stitch-blue)] text-[var(--stitch-ink)] placeholder:text-[var(--stitch-muted)]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEditTags(website);
                  if (e.key === "Escape") cancelEditTags();
                }}
                onClick={(e) => e.stopPropagation()}
              />
              <div className="flex items-center gap-1 flex-wrap">
                {parseTags(editingTagsValue).map((tag, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[var(--stitch-blue-soft)] text-[var(--stitch-ink)] border border-[var(--stitch-line)] transition-colors"
                  >
                    {tag}
                    <button
                      className="ml-1 text-[var(--stitch-muted)] hover:text-[var(--stitch-ink)]"
                      title="删除该标签"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = parseTags(editingTagsValue).filter((x) => x !== tag);
                        setEditingTagsValue(joinTags(next));
                      }}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-[var(--stitch-ink)] hover:text-[var(--stitch-muted)] hover:bg-[var(--stitch-blue-soft)]"
                onClick={(e) => {
                  e.stopPropagation();
                  saveEditTags(website);
                }}
              >
                <Check className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-[var(--stitch-muted)] hover:text-[var(--stitch-ink)] hover:bg-[var(--stitch-blue-soft)]"
                onClick={(e) => {
                  e.stopPropagation();
                  cancelEditTags();
                }}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 my-1 flex-wrap">
              {Array.isArray(website.tags) && website.tags.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {website.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[var(--stitch-blue-soft)] text-[var(--stitch-ink)] border border-[var(--stitch-line)] transition-colors cursor-default"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {canManageSite && (
                <button
                  type="button"
                  onClick={() => startEditTags(website)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[var(--stitch-blue-soft)] text-[var(--stitch-muted)] border border-[var(--stitch-line)] transition-colors hover:text-[var(--stitch-ink)]"
                  title={t.editTags || "编辑标签"}
                >
                  <Tag className="h-3 w-3" />
                  {t.editTags || "编辑标签"}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-4 text-sm text-[var(--stitch-muted)] font-mono mt-3">
          {showProjectInfo && currentProjectName && (
            <span className="inline-flex items-center gap-1">
              <FolderKanban className="h-3.5 w-3.5" />
              {t.projectLabel}
              {currentProjectName}
            </span>
          )}
          {isPlatformAdmin && website.userId && (
            <span>
              {t.creator}
              {creatorName || "—"}
            </span>
          )}
          <span>
            {t.createdAt}
            {formatTimestamp(website.createdAt)}
          </span>
          {(website.updatedAt || website.deployedAt) && (
            <span>
              {t.deployedAt}
              {formatTimestamp(website.updatedAt || website.deployedAt)}
            </span>
          )}
        </div>

        {getSiteDomains(website).length > 0 && (
          <div className="flex flex-col gap-2 mt-3">
            {getSiteDomains(website).map((d) => (
              <div key={d.host} className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--stitch-surface-strong)] border border-[var(--stitch-line)] max-w-full">
                  <span className="w-2 h-2 rounded-full bg-[var(--stitch-ink)] animate-pulse"></span>
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--stitch-ink)] hover:text-[var(--stitch-blue)] text-sm font-mono truncate hover:underline underline-offset-4 decoration-[var(--stitch-blue)]"
                  >
                    {d.host}
                  </a>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                      d.isDefault
                        ? "bg-[var(--stitch-blue-soft)] text-[var(--stitch-muted)] border border-[var(--stitch-line)]"
                        : "bg-[var(--stitch-blue-soft)] text-[var(--stitch-ink)] border border-[var(--stitch-line)]"
                    }`}
                  >
                    {d.isDefault ? t.domainDefaultTag : t.domainCustomTag}
                  </span>
                </div>
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-[var(--stitch-muted)] hover:text-[var(--stitch-blue)] transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {(canViewAnalytics || canManageSite) && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="stitch-action rounded-full">
                <Settings2 className="w-4 h-4 mr-2" />
                {t.siteSettings || "设置"}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[330px] rounded-2xl border-border bg-popover p-3 text-popover-foreground shadow-[0_24px_70px_rgba(0,0,0,.18)]"
            >
              <div className="mb-3 px-1">
                <div className="text-sm font-black">{t.siteSettingsTitle || "站点设置"}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {getDisplayName(website)}
                </div>
              </div>

              <div className="space-y-2">
                {canViewAnalytics && analyticsPath && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(analyticsPath)}
                    className={`${settingsActionClass} w-full justify-start`}
                  >
                    <BarChart3 className="w-4 h-4 mr-2" />
                    {t.analyticsButton || "分析"}
                  </Button>
                )}

                {canMoveProject && (
                  <div className="rounded-xl border border-border bg-muted/50 p-3">
                    <label className="mb-2 flex items-center gap-2 text-xs font-bold text-muted-foreground">
                      <FolderKanban className="h-3.5 w-3.5" />
                      {t.moveToProject}
                    </label>
                    <select
                      value={website.projectId || ""}
                      disabled={isProcessing}
                      onChange={(e) => {
                        const nextProjectId = String(e.target.value || "");
                        if (!nextProjectId || nextProjectId === String(website.projectId || "")) return;
                        const project = projects.find((p) => String(p.id) === nextProjectId);
                        if (project && moveWebsiteToProject) moveWebsiteToProject(website, project);
                      }}
                      className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none transition-colors focus:border-ring disabled:cursor-not-allowed disabled:opacity-50"
                      title={t.moveToProject}
                    >
                      {!website.projectId && <option value="">{t.noProject}</option>}
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {canChangeVisibility && (
                  <div
                    className="flex items-center justify-between rounded-xl border border-border bg-muted/50 px-3 py-2.5 text-sm text-foreground"
                    title={t.visibilityToggleTitle}
                  >
                    <span className="flex items-center gap-2">
                      {isPublic ? <Globe2 className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
                      {isPublic ? t.visibilityPublic : t.visibilityPrivate}
                    </span>
                    <Switch
                      checked={isPublic}
                      disabled={isProcessing}
                      onCheckedChange={(checked) => {
                        if (setWebsiteVisibility) {
                          setWebsiteVisibility(website, checked ? "public" : "private");
                        }
                      }}
                      className="scale-75"
                    />
                  </div>
                )}

                {canManageSite && (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isProcessing}
                      onClick={() => openRedeployDialog(website)}
                      className={`${settingsActionClass} justify-start`}
                      title={isProcessing ? t.redeployDisabledTooltip : t.redeployButton}
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {t.redeployButton}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openDomainDialog(website)}
                      className={`${settingsActionClass} justify-start`}
                      title={t.customDomain}
                    >
                      <Link2 className="w-4 h-4 mr-2" />
                      {website.subdomain ? t.domainBound : t.customDomain}
                    </Button>
                  </div>
                )}

                {canManageSite && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openSeoDialog && openSeoDialog(website)}
                    className={`${settingsActionClass} w-full justify-start`}
                    title={t.seoSettings || "SEO"}
                  >
                    <Search className="w-4 h-4 mr-2" />
                    {t.seoSettings || "SEO"}
                  </Button>
                )}

                {canManageSite && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => confirmDeleteWebsite(website._id)}
                    className="w-full justify-start rounded-xl text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    {t.deleteSite || "删除站点"}
                  </Button>
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
