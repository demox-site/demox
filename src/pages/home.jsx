import React from "react";
import { CheckCircle2, Copy, X, MessageSquare, ExternalLink } from "lucide-react";
import { Navigate, useParams } from "react-router-dom";
import { useLanguage } from "@/hooks/use-language";
import { translations } from "./home-translations";
import UploadSection from "@/components/home/UploadSection";
import { useAuth } from "./use-auth";
import { useWebsites } from "./use-websites";
import { useProjects } from "./use-projects";
import { useUpload } from "./use-upload";
import { track } from "@/lib/track";

/**
 * Home
 * 项目工作区的部署页：上传构建产物，拿到一个能打开的链接。
 */
export default function Home({ style }) {
  const { projectId } = useParams();
  const currentProjectId = projectId ? String(projectId) : "";
  const { language: lang } = useLanguage();
  const t = translations[lang];

  const auth = useAuth(t);
  const { isLoading, isLoggedIn, user, roleLimits, handleAuthError } = auth;

  const sites = useWebsites({ user, t, handleAuthError, projectId: currentProjectId });
  const { websites, setWebsites, setDeploying, loadWebsites } = sites;
  const projects = useProjects({ user, t, handleAuthError });
  const uploadProject = projects.getProjectById(currentProjectId) || projects.getUploadProject(currentProjectId);

  const upload = useUpload({
    user,
    roleLimits,
    websites,
    project: uploadProject,
    t,
    lang,
    navigate: auth.navigate,
    loadWebsites,
    setWebsites,
    setDeploying
  });

  React.useEffect(() => {
    if (isLoggedIn) {
      loadWebsites();
      projects.loadProjects();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  React.useEffect(() => {
    if (!currentProjectId) return;
    projects.setUploadProjectId(currentProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId]);

  if (isLoading) {
    return (
      <div style={style} className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-800 border-t-zinc-100" />
          <span className="animate-pulse font-mono text-sm text-[var(--stitch-muted)]">
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
    <div style={style} className="stitch-page">
      {upload.successBanner && (
        <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <p className="font-medium text-emerald-300">
                  {lang === "zh" ? "部署成功" : "Deployed successfully"}
                </p>
                <a
                  href={upload.successBanner.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1 text-sm text-[var(--stitch-muted)] underline underline-offset-2 hover:text-[var(--stitch-ink)]"
                >
                  {upload.successBanner.url}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            <button
              type="button"
              onClick={() => upload.setSuccessBanner(null)}
              className="text-[var(--stitch-muted)] hover:text-[var(--stitch-ink)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 border-t border-emerald-500/20 pt-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm text-[var(--stitch-ink)]">
              <MessageSquare className="h-4 w-4 text-[var(--stitch-muted)]" />
              {lang === "zh"
                ? "这个链接准备用来发给谁？遇到什么卡点？"
                : "Who are you sending this link to? Any blockers?"}
            </p>
            <div className="flex gap-2">
              <textarea
                readOnly
                value={
                  lang === "zh"
                    ? `链接：${upload.successBanner.url}\n用途：\n卡点：`
                    : `Link: ${upload.successBanner.url}\nUse case:\nBlockers:`
                }
                className="flex-1 resize-none rounded-lg border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-3 py-2 font-mono text-xs text-[var(--stitch-muted)]"
                rows={3}
                onClick={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                onClick={() => {
                  track("feedback_copy", { url: upload.successBanner.url });
                  navigator.clipboard?.writeText(
                    lang === "zh"
                      ? `链接：${upload.successBanner.url}\n用途：\n卡点：`
                      : `Link: ${upload.successBanner.url}\nUse case:\nBlockers:`
                  );
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] px-3 py-2 text-sm text-[var(--stitch-ink)] hover:border-[var(--stitch-muted)]"
              >
                <Copy className="h-3.5 w-3.5" />
                {lang === "zh" ? "复制" : "Copy"}
              </button>
            </div>
          </div>
        </div>
      )}

      <UploadSection
        t={t}
        lang={lang}
        roleLimits={roleLimits}
        isDragActive={upload.isDragActive}
        setIsDragActive={upload.setIsDragActive}
        uploadZipFile={upload.uploadZipFile}
        uploadDocFile={upload.uploadDocFile}
        uploadPdfFile={upload.uploadPdfFile}
        uploadSpreadsheetFile={upload.uploadSpreadsheetFile}
        uploadHtmlFile={upload.uploadHtmlFile}
        fileInputRef={upload.fileInputRef}
        uploading={upload.uploading}
        uploadStatusText={upload.uploadStatusText}
        uploadProgress={upload.uploadProgress}
        uploadStage={upload.uploadStage}
        funnyMessage={upload.funnyMessage}
      />
    </div>
  );
}
