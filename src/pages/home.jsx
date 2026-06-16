import React from "react";
// @ts-ignore;
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge
} from "@/components/ui";
// @ts-ignore;
import { Globe, RefreshCw, Tag, UploadCloud } from "lucide-react";
import { Navigate, useParams } from "react-router-dom";
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
import { useProjects } from "./use-projects";
import { useUpload } from "./use-upload";
import { useRedeploy } from "./use-redeploy";
import { useDomainDialog } from "./use-domain-dialog";
import { useFilters } from "./use-filters";

/**
 * Home
 * 项目工作区页面。部署与站点列表共用业务 hooks，视觉保持线上版的简洁暗色风格。
 */
export default function Home(props) {
  const { style, mode = "sites" } = props;
  const isDeployMode = mode === "deploy";
  const { projectId } = useParams();
  const currentProjectId = projectId ? String(projectId) : "";
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

  const projects = useProjects({ user, t, handleAuthError });

  const filters = useFilters({
    websites,
    allUsers,
    enableProjectFilter: !!currentProjectId
  });
  const { visibleWebsites } = filters;

  const uploadProject =
    projects.getProjectById(currentProjectId) ||
    projects.getUploadProject(filters.selectedProjectId);

  const upload = useUpload({
    user,
    roleLimits,
    websites,
    project: uploadProject,
    t,
    lang,
    navigate,
    loadWebsites,
    setWebsites,
    setDeploying
  });

  const redeploy = useRedeploy({
    roleLimits,
    t,
    lang,
    navigate,
    loadWebsites,
    setWebsites,
    setDeploying
  });

  const domain = useDomainDialog({ t, setWebsites });

  // 登录成功后加载站点和项目列表。
  React.useEffect(() => {
    if (isLoggedIn) {
      loadWebsites();
      projects.loadProjects();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  // 项目工作区由 URL 中的 projectId 决定，上传和列表筛选保持同一个项目上下文。
  React.useEffect(() => {
    if (!currentProjectId) return;
    filters.selectProjectId(currentProjectId);
    projects.setUploadProjectId(currentProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId]);

  if (isLoading) {
    return (
      <div style={style} className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-zinc-800 border-t-zinc-100 rounded-full animate-spin"></div>
          <span className="font-mono text-sm text-[var(--stitch-muted)] animate-pulse">
            {t.loading}
          </span>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/index" replace />;
  }

  const missingProject =
    currentProjectId &&
    !projects.loadingProjects &&
    projects.activeProjects.length > 0 &&
    !projects.getProjectById(currentProjectId);

  if (missingProject) {
    return <Navigate to="/console/projects" replace />;
  }

  return (
    <>
      <div style={style} className="stitch-page">
          {isDeployMode ? (
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
          ) : (
            <Card className="stitch-panel overflow-hidden">
              <CardHeader className="border-b border-[var(--stitch-line)] bg-[var(--stitch-surface)]">
                <CardTitle className="flex flex-col gap-3 text-zinc-100 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2 text-[var(--stitch-ink)]">
                    <Globe className="w-5 h-5 text-[var(--stitch-blue)]" />
                    <span>{t.deploymentsTitle}</span>
                    {roleLimits && (
                      <span className="text-sm text-[var(--stitch-muted)] font-mono ml-2">
                        ({visibleWebsites.length}/
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
                    className="stitch-action rounded-full px-4"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {t.refresh}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {allTags.length > 0 && (
                  <div className="p-4 border-b border-[var(--stitch-line)] flex flex-wrap gap-2 items-center bg-[var(--stitch-surface)]">
                    <span className="text-xs text-[var(--stitch-muted)] mr-2 flex items-center gap-1">
                      <Tag className="w-3 h-3" />
                      筛选:
                    </span>
                    <Badge
                      variant={filters.selectedTags.length === 0 ? "default" : "outline"}
                      className={`cursor-pointer transition-all ${
                        filters.selectedTags.length === 0
                          ? "stitch-primary"
                          : "text-[var(--stitch-muted)] border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] hover:text-[var(--stitch-ink)] hover:border-[var(--stitch-blue)]"
                      }`}
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
                          className={`cursor-pointer transition-all ${
                            active
                              ? "stitch-primary"
                              : "text-[var(--stitch-muted)] border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] hover:text-[var(--stitch-ink)] hover:border-[var(--stitch-blue)]"
                          }`}
                          onClick={() => filters.toggleFilterTag(tag)}
                        >
                          {tag}
                        </Badge>
                      );
                    })}
                    {filters.selectedTags.length > 0 && (
                      <Badge
                        variant="outline"
                        className="ml-2 cursor-pointer text-[var(--stitch-muted)] border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] hover:text-[var(--stitch-ink)] hover:border-[var(--stitch-blue)]"
                        onClick={filters.clearFilterTags}
                      >
                        清空
                      </Badge>
                    )}
                  </div>
                )}

                {visibleWebsites.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="stitch-icon-tile mx-auto mb-4 h-16 w-16 rounded-2xl">
                      <UploadCloud className="w-8 h-8" />
                    </div>
                    {filters.selectedTags.length > 0 ? (
                      <p className="text-[var(--stitch-muted)] text-sm">
                        未找到包含标签 [{filters.selectedTags.join(", ")}] 的项目
                      </p>
                    ) : (
                      <>
                        <p className="text-[var(--stitch-ink)] font-medium">{t.emptyTitle}</p>
                        <p className="text-[var(--stitch-muted)] text-sm mt-2">{t.emptyDesc}</p>
                      </>
                    )}
                  </div>
                ) : (
                  <div>
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
                        showProjectInfo={false}
                        projects={projects.activeProjects}
                        moveWebsiteToProject={sites.moveWebsiteToProject}
                        setWebsiteVisibility={sites.setWebsiteVisibility}
                        openRedeployDialog={redeploy.openRedeployDialog}
                        openDomainDialog={domain.openDomainDialog}
                        confirmDeleteWebsite={sites.confirmDeleteWebsite}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {!isDeployMode && (
            <>
              <DomainDialog
                open={domain.domainOpen}
                onOpenChange={domain.setDomainOpen}
                domainInfo={domain.domainInfo}
                setDomainInfo={domain.setDomainInfo}
	                domainInput={domain.domainInput}
	                setDomainInput={domain.setDomainInput}
	                domainSuffix={domain.domainSuffix}
	                setDomainSuffix={domain.setDomainSuffix}
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
            </>
          )}
        </div>
    </>
  );
}
