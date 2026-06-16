import React from "react";
// @ts-ignore;
import {
  Button,
  Badge,
  Input,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
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
  LockKeyhole
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
  confirmDeleteWebsite
}) {
  const isProcessing = website.status === "processing" || deploying[website._id];
  const canMoveProject =
    showProjectInfo &&
    Array.isArray(projects) &&
    projects.length > 0 &&
    (!website.userId || website.userId === user?.userId);
  const currentProjectName = website.projectName || (website.projectId ? t.defaultProjectName : "");
  const isPrivate = website.visibility === "private";
  const isPublic = !isPrivate;
  const creatorName = String(website.userNickname || "").trim();
  const canChangeVisibility =
    !website.userId ||
    website.userId === user?.userId ||
    (Array.isArray(user?.roles) && user.roles.includes("admin"));

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
                  <button
                    onClick={() => startEditName(website)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--stitch-muted)] hover:text-[var(--stitch-blue)]"
                    title={t.editName}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
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
            <div className="flex items-center gap-2 my-1">
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
              <Button
                variant="ghost"
                size="sm"
                className={`h-5 w-5 p-0 hover:bg-[var(--stitch-blue-soft)] ${
                  Array.isArray(website.tags) && website.tags.length > 0
                    ? "text-[var(--stitch-muted)] hover:text-[var(--stitch-ink)] opacity-0 group-hover:opacity-100 transition-opacity"
                    : "text-[var(--stitch-muted)] hover:text-[var(--stitch-ink)]"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  startEditTags(website);
                }}
                title="编辑标签"
              >
                <Tag className="w-3 h-3" />
              </Button>
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
          {Array.isArray(user?.roles) && user.roles.includes("admin") && website.userId && (
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
        {canMoveProject && (
          <select
            value={website.projectId || ""}
            disabled={isProcessing}
            onChange={(e) => {
              const project = projects.find((p) => String(p.id) === String(e.target.value));
              if (project && moveWebsiteToProject) moveWebsiteToProject(website, project);
            }}
            className="h-9 max-w-[150px] rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] px-2 text-xs text-[var(--stitch-muted)] outline-none transition-colors hover:border-[var(--stitch-blue)] hover:text-[var(--stitch-ink)] focus:border-[var(--stitch-blue)] disabled:cursor-not-allowed disabled:opacity-50"
            title={t.moveToProject}
          >
            {!website.projectId && <option value="">{t.noProject}</option>}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        )}

        {canChangeVisibility && (
          <div
            className="flex h-9 items-center gap-2 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] px-2.5 text-xs text-[var(--stitch-muted)]"
            title={t.visibilityToggleTitle}
          >
            <span className={isPublic ? "text-[var(--stitch-ink)]" : "text-[var(--stitch-muted)]"}>
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

        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={-1}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (isProcessing) return;
                    openRedeployDialog(website);
                  }}
                  className={`stitch-action rounded-full ${
                    isProcessing
                      ? "opacity-50 cursor-not-allowed"
                      : ""
                  }`}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {t.redeployButton}
                </Button>
              </span>
            </TooltipTrigger>
            {isProcessing && (
              <TooltipContent className="bg-zinc-100 text-zinc-900 border-zinc-200 font-bold">
                <p>{t.redeployDisabledTooltip}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        <Button
          variant="outline"
          size="sm"
          onClick={() => openDomainDialog(website)}
          className={`stitch-action rounded-full ${
            website.subdomain
              ? "!text-[var(--stitch-ink)]"
              : ""
          }`}
          title={t.customDomain}
        >
          <Link2 className="w-4 h-4 mr-2" />
          {website.subdomain ? t.domainBound : t.customDomain}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => confirmDeleteWebsite(website._id)}
          className="text-[var(--stitch-muted)] hover:bg-[var(--stitch-blue-soft)] hover:text-[var(--stitch-ink)]"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
