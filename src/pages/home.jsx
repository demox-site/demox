import React from "react";
// @ts-ignore;
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandGroup,
  CommandEmpty,
  Badge,
  Popover,
  PopoverTrigger,
  PopoverContent
} from "@/components/ui";
// @ts-ignore;
import { Globe, User, RefreshCw, Tag, Check } from "lucide-react";
import { Navigate } from "react-router-dom";
import { useLanguage } from "@/hooks/use-language";
import { translations } from "./home-translations";
import { parseTags, joinTags } from "@/lib/website-utils";
import DeleteConfirmDialog from "@/components/home/DeleteConfirmDialog";
import RedeployDialog from "@/components/home/RedeployDialog";
import DomainDialog from "@/components/home/DomainDialog";
import UploadSection from "@/components/home/UploadSection";
import WebsiteCard from "@/components/home/WebsiteCard";
import { useAuth } from "./use-auth";
import { useWebsites } from "./use-websites";
import { useUpload } from "./use-upload";
import { useRedeploy } from "./use-redeploy";
import { useDomainDialog } from "./use-domain-dialog";
import { useFilters } from "./use-filters";

/**
 * Home
 * 部署控制台主页面。状态与业务逻辑拆分到 use-* hooks，本组件只负责装配与渲染。
 */
export default function Home(props) {
  const { style } = props;
  const { language: lang } = useLanguage();
  const t = translations[lang];

  const auth = useAuth(t);
  const { isLoading, isLoggedIn, user, roleLimits, handleAuthError, navigate } = auth;

  const sites = useWebsites({ user, t, handleAuthError });
  const {
    websites,
    setWebsites,
    deploying,
    setDeploying,
    allTags,
    allUsers,
    loadWebsites
  } = sites;

  const upload = useUpload({
    user,
    roleLimits,
    websites,
    t,
    navigate,
    loadWebsites,
    setWebsites,
    setDeploying
  });

  const redeploy = useRedeploy({
    roleLimits,
    t,
    navigate,
    loadWebsites,
    setWebsites,
    setDeploying
  });

  const domain = useDomainDialog({ t, setWebsites });

  const filters = useFilters({ websites, allUsers });
  const { visibleWebsites } = filters;

  // 登录成功后加载站点列表
  React.useEffect(() => {
    if (isLoggedIn) loadWebsites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  if (isLoading) {
    return (
      <div style={style} className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-muted border-t-foreground rounded-full animate-spin"></div>
          <span className="text-muted-foreground font-mono text-sm animate-pulse">
            {t.loading}
          </span>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/index" replace />;
  }

  const isAdmin = Array.isArray(user?.roles) && user.roles.includes("admin");

  return (
    <>
      <div style={style} className="relative z-10">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-10">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              {t.pageTitle}
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              {user?.role_name
                ? `${t.pageSubtitlePrefix}${user.role_name}`
                : t.pageSubtitleFallback}
            </p>
          </div>

          <UploadSection
            t={t}
            lang={lang}
            roleLimits={roleLimits}
            isDragActive={upload.isDragActive}
            setIsDragActive={upload.setIsDragActive}
            uploadZipFile={upload.uploadZipFile}
            uploadDocFile={upload.uploadDocFile}
            uploadPdfFile={upload.uploadPdfFile}
            fileInputRef={upload.fileInputRef}
            uploading={upload.uploading}
            uploadStatusText={upload.uploadStatusText}
            uploadProgress={upload.uploadProgress}
            uploadStage={upload.uploadStage}
            funnyMessage={upload.funnyMessage}
          />

          {/* Websites List */}
          <Card className="border-border">
            <CardHeader className="border-b border-border bg-muted/30">
              <CardTitle className="text-foreground flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="w-5 h-5 text-muted-foreground" />
                  {t.deploymentsTitle}
                  {roleLimits && (
                    <span className="text-sm text-muted-foreground font-mono ml-2">
                      ({websites.length}/
                      {roleLimits.deployment_limit === null ||
                      roleLimits.deployment_limit === undefined
                        ? "∞"
                        : roleLimits.deployment_limit}
                      )
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={loadWebsites}
                  variant="outline"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {t.refresh}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isAdmin && allUsers.length > 0 && (
                <div className="p-4 border-b border-border flex flex-wrap gap-2 items-center bg-muted/20">
                  <span className="text-xs text-muted-foreground mr-2 flex items-center gap-1">
                    <User className="w-3 h-3" />
                    用户:
                  </span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                      >
                        {filters.selectedUserIds.length === 0
                          ? "全部用户"
                          : `已选 ${filters.selectedUserIds.length} 人`}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-80" align="start">
                      <Command>
                        <CommandInput placeholder="搜索用户邮箱..." />
                        <CommandList>
                          <CommandEmpty>无匹配用户</CommandEmpty>
                          <CommandGroup heading="用户列表">
                            {filters.getUsersWithEmail().map((u) => {
                              const label = String(u.email || "").trim();
                              const checked = filters.selectedUserIds.includes(u.userId);
                              return (
                                <CommandItem
                                  key={u.userId}
                                  onSelect={() => filters.toggleSelectUserId(u.userId)}
                                >
                                  <span className="truncate">{label}</span>
                                  {checked ? (
                                    <Check className="ml-auto h-4 w-4 opacity-70" />
                                  ) : null}
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {filters.selectedUserIds.length > 0 && (
                    <Badge
                      variant="outline"
                      className="ml-2 cursor-pointer"
                      onClick={filters.clearSelectedUserIds}
                    >
                      清空
                    </Badge>
                  )}
                </div>
              )}
              {allTags.length > 0 && (
                <div className="p-4 border-b border-border flex flex-wrap gap-2 items-center bg-muted/20">
                  <span className="text-xs text-muted-foreground mr-2 flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    筛选:
                  </span>
                  <Badge
                    variant={filters.selectedTags.length === 0 ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={filters.clearFilterTags}
                  >
                    全部
                  </Badge>
                  {allTags.map((tag) => {
                    const active = filters.selectedTags.includes(tag);
                    return (
                      <Badge
                        key={tag}
                        variant={active ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => filters.toggleFilterTag(tag)}
                      >
                        {tag}
                      </Badge>
                    );
                  })}
                  {filters.selectedTags.length > 0 && (
                    <Badge
                      variant="outline"
                      className="ml-2 cursor-pointer"
                      onClick={filters.clearFilterTags}
                    >
                      清空
                    </Badge>
                  )}
                </div>
              )}
              {websites.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4 border border-border">
                    <Globe className="w-8 h-8 text-muted-foreground/50" />
                  </div>
                  <p className="text-muted-foreground font-medium">{t.emptyTitle}</p>
                  <p className="text-muted-foreground/70 text-sm mt-2">{t.emptyDesc}</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {visibleWebsites.length === 0 && (
                    <div className="text-center py-12">
                      <p className="text-muted-foreground text-sm">
                        未找到包含标签 [{filters.selectedTags.join(", ")}] 的项目
                      </p>
                    </div>
                  )}
                  {visibleWebsites.map((website) => (
                    <WebsiteCard
                      key={website._id}
                      website={website}
                      t={t}
                      user={user}
                      deploying={deploying}
                      editingId={sites.editingId}
                      editingName={sites.editingName}
                      setEditingName={sites.setEditingName}
                      startEditName={sites.startEditName}
                      saveEditName={sites.saveEditName}
                      cancelEditName={sites.cancelEditName}
                      editingTagsId={sites.editingTagsId}
                      editingTagsValue={sites.editingTagsValue}
                      setEditingTagsValue={sites.setEditingTagsValue}
                      startEditTags={sites.startEditTags}
                      saveEditTags={sites.saveEditTags}
                      cancelEditTags={sites.cancelEditTags}
                      parseTags={parseTags}
                      joinTags={joinTags}
                      getEmailByUserId={sites.getEmailByUserId}
                      openRedeployDialog={redeploy.openRedeployDialog}
                      openDomainDialog={domain.openDomainDialog}
                      confirmDeleteWebsite={sites.confirmDeleteWebsite}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <DomainDialog
            open={domain.domainOpen}
            onOpenChange={domain.setDomainOpen}
            domainInfo={domain.domainInfo}
            setDomainInfo={domain.setDomainInfo}
            domainInput={domain.domainInput}
            setDomainInput={domain.setDomainInput}
            domainCheck={domain.domainCheck}
            domainBusy={domain.domainBusy}
            onBind={domain.bindDomain}
            onUnbind={domain.unbindDomain}
            onCopy={domain.copyCname}
            t={t}
          />

          <RedeployDialog
            open={redeploy.redeployOpen}
            onOpenChange={redeploy.setRedeployOpen}
            redeployFile={redeploy.redeployFile}
            isDragActive={redeploy.isRedeployDragActive}
            onDragEnter={redeploy.onRedeployDragEnter}
            onDragOver={redeploy.onRedeployDragOver}
            onDragLeave={redeploy.onRedeployDragLeave}
            onDrop={redeploy.onRedeployDrop}
            onFileChange={redeploy.handleRedeployFileChange}
            onCancel={redeploy.closeRedeployDialog}
            onConfirm={redeploy.submitRedeploy}
            t={t}
          />

          <DeleteConfirmDialog
            open={sites.deleteConfirmOpen}
            onOpenChange={sites.setDeleteConfirmOpen}
            onConfirm={sites.executeDeleteWebsite}
            t={t}
          />
        </div>

        {/* Background Grid Effect */}
        <div className="fixed inset-0 bg-[linear-gradient(to_right,var(--grid-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--grid-line)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] -z-10 pointer-events-none" />
      </div>
    </>
  );
}
