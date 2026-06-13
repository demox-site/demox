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
  openRedeployDialog,
  openDomainDialog,
  confirmDeleteWebsite
}) {
  const isProcessing = website.status === "processing" || deploying[website._id];

  return (
    <div className="p-6 hover:bg-zinc-900/20 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex flex-col items-start gap-0.5 group">
            {editingId === website._id ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm rounded px-2 py-1 w-48 focus:outline-none focus:border-zinc-600"
                />
                <button
                  onClick={() => saveEditName(website)}
                  className="text-green-400 hover:text-green-300"
                  title={t.save}
                >
                  <CheckCircle className="w-4 h-4" />
                </button>
                <button
                  onClick={cancelEditName}
                  className="text-zinc-400 hover:text-zinc-300"
                  title={t.cancel}
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="text-zinc-100 font-bold truncate">
                    {getDisplayName(website)}
                  </h3>
                  <button
                    onClick={() => startEditName(website)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-zinc-200"
                    title={t.editName}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
                {(website.websiteId || website._id) && (
                  <span className="text-[11px] text-zinc-600 font-mono leading-none">
                    ID: {website.websiteId || website._id}
                  </span>
                )}
              </>
            )}
          </div>
          <StatusBadge status={website.status} t={t} />
          {deploying[website._id] && (
            <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
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
                className="h-7 text-xs bg-zinc-900/50 border-zinc-800 focus:border-zinc-600 text-zinc-100 placeholder:text-zinc-500"
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
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 transition-colors"
                  >
                    {tag}
                    <button
                      className="ml-1 text-zinc-400 hover:text-zinc-200"
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
                className="h-7 w-7 p-0 text-green-500 hover:text-green-400 hover:bg-green-500/10"
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
                className="h-7 w-7 p-0 text-zinc-500 hover:text-zinc-400 hover:bg-zinc-800"
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
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-700 transition-colors cursor-default"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className={`h-5 w-5 p-0 hover:bg-zinc-800 ${
                  Array.isArray(website.tags) && website.tags.length > 0
                    ? "text-zinc-600 hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    : "text-zinc-600 hover:text-zinc-400"
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

        <div className="flex flex-col sm:flex-row gap-4 text-sm text-zinc-500 font-mono mt-3">
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
                <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 max-w-full">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-300 hover:text-white text-sm font-mono truncate hover:underline underline-offset-4 decoration-zinc-600"
                  >
                    {d.host}
                  </a>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                      d.isDefault
                        ? "bg-zinc-800 text-zinc-400 border border-zinc-700/50"
                        : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                    }`}
                  >
                    {d.isDefault ? t.domainDefaultTag : t.domainCustomTag}
                  </span>
                </div>
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors"
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
                  className={`border-zinc-800 bg-zinc-900 text-zinc-400 ${
                    isProcessing
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-zinc-100 hover:text-zinc-900 hover:border-zinc-100"
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
          className={`border-zinc-800 bg-zinc-900 ${
            website.subdomain
              ? "text-green-400 hover:text-green-300 hover:bg-zinc-100 hover:!text-zinc-900"
              : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 hover:border-zinc-100"
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
          className="text-zinc-500 hover:text-red-400 hover:bg-red-950/30"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
