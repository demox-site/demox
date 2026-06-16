import React from "react";
// @ts-ignore;
import {
  Button,
  Badge,
  Input,
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
  Link2
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
 * 创建/修改时间、域名列表、重新部署/自定义域名/删除操作。
 * 所有状态与业务逻辑仍由父组件 Home 持有，这里只渲染与回调。
 */
export default function WebsiteCard({
  website,
  t,
  user,
  deploying,
  editingId,
  editingName,
  setEditingName,
  startEditName,
  saveEditName,
  cancelEditName,
  editingTagsId,
  editingTagsValue,
  setEditingTagsValue,
  startEditTags,
  saveEditTags,
  cancelEditTags,
  parseTags,
  joinTags,
  getEmailByUserId,
  openRedeployDialog,
  openDomainDialog,
  confirmDeleteWebsite
}) {
  const isProcessing = website.status === "processing" || deploying[website._id];

  return (
    <div className="p-6 hover:bg-muted/30 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex flex-col items-start gap-0.5 group">
            {editingId === website._id ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  className="bg-background border border-border text-foreground text-sm rounded px-2 py-1 w-48 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={() => saveEditName(website)}
                  className="text-success hover:opacity-80"
                  title={t.save}
                >
                  <CheckCircle className="w-4 h-4" />
                </button>
                <button
                  onClick={cancelEditName}
                  className="text-muted-foreground hover:text-foreground"
                  title={t.cancel}
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="text-foreground font-bold truncate">
                    {getDisplayName(website)}
                  </h3>
                  <button
                    onClick={() => startEditName(website)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                    title={t.editName}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
                {(website.websiteId || website._id) && (
                  <span className="text-[11px] text-muted-foreground font-mono leading-none">
                    ID: {website.websiteId || website._id}
                  </span>
                )}
              </>
            )}
          </div>
          <StatusBadge status={website.status} t={t} />
          {deploying[website._id] && (
            <Badge variant="warning">
              <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
              {t.processingBadge}
            </Badge>
          )}
        </div>

        <div className="flex items-center flex-wrap gap-2 mt-2">
          {editingTagsId === website._id ? (
            <div className="flex items-center gap-2 w-full max-w-md my-1">
              <Input
                value={editingTagsValue}
                onChange={(e) => setEditingTagsValue(e.target.value)}
                placeholder="输入标签，用逗号分隔"
                className="h-7 text-xs"
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
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-foreground border border-border"
                  >
                    {tag}
                    <button
                      className="ml-1 text-muted-foreground hover:text-foreground"
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
                className="h-7 w-7 p-0 text-success"
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
                className="h-7 w-7 p-0"
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
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border cursor-default"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className={`h-5 w-5 p-0 text-muted-foreground ${
                  Array.isArray(website.tags) && website.tags.length > 0
                    ? "opacity-0 group-hover:opacity-100 transition-opacity"
                    : ""
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

        <div className="flex flex-col sm:flex-row gap-4 text-sm text-muted-foreground font-mono mt-3">
          {Array.isArray(user?.roles) && user.roles.includes("admin") && website.userId && (
            <span>
              {t.creator}
              {getEmailByUserId(website.userId) || website.userId}
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
                <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-muted border border-border max-w-full">
                  <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground hover:text-link text-sm font-mono truncate hover:underline underline-offset-4"
                  >
                    {d.host}
                  </a>
                  <Badge variant={d.isDefault ? "outline" : "secondary"} className="text-[10px] shrink-0">
                    {d.isDefault ? t.domainDefaultTag : t.domainCustomTag}
                  </Badge>
                </div>
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
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
                  disabled={isProcessing}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {t.redeployButton}
                </Button>
              </span>
            </TooltipTrigger>
            {isProcessing && (
              <TooltipContent>
                <p>{t.redeployDisabledTooltip}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        <Button
          variant={website.subdomain ? "default" : "outline"}
          size="sm"
          onClick={() => openDomainDialog(website)}
          title={t.customDomain}
        >
          <Link2 className="w-4 h-4 mr-2" />
          {website.subdomain ? t.domainBound : t.customDomain}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => confirmDeleteWebsite(website._id)}
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
