import { useState, useRef, useEffect } from "react";
import { websiteApi, tokenManager, userManager } from "../api";
import { useToast } from "@/components/ui";
import {
  sanitizeFileName,
  generateWebsiteId,
  getComparableTimestamp
} from "@/lib/website-utils";
import { buildSiteZipFile, isSupportedDoc } from "@/lib/doc-to-site";
import { buildPdfSiteZipFile, isSupportedPdf } from "@/lib/pdf-to-site";
import {
  buildSpreadsheetSiteZipFile,
  isSupportedSpreadsheet
} from "@/lib/spreadsheet-to-site";
import { buildHtmlSiteZipFile, isSupportedHtml } from "@/lib/html-to-site";
import { validateStaticZipFile } from "@/lib/static-zip-validator";

/**
 * fileToBase64
 * 将文件读为 base64（去掉 dataURL 前缀），可选地上报读取进度
 */
const fileToBase64 = (file, onProgress) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    if (onProgress) {
      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded * 100) / e.total), e.loaded);
        }
      };
    }
    reader.onload = () => {
      const res = String(reader.result || "");
      resolve(res.includes(",") ? res.split(",")[1] : res);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

/**
 * useUpload
 * 首页上传区的状态机：校验、读文件、调用部署、进度与趣味文案。
 * @param {{
 *   user:any, roleLimits:any, websites:any[], project:any, t:Record<string,any>,
 *   navigate:Function, loadWebsites:Function,
 *   setWebsites:Function, setDeploying:Function
 * }} deps
 */
export function useUpload({
  user,
  roleLimits,
  websites,
  project,
  t,
  lang,
  navigate,
  loadWebsites,
  setWebsites,
  setDeploying
}) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatusText, setUploadStatusText] = useState("");
  const [uploadStage, setUploadStage] = useState(0); // 1: Cloud, 2: Unzip, 3: COS
  const [funnyMessage, setFunnyMessage] = useState("");
  const [uploadFileSize, setUploadFileSize] = useState(0);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef(null);

  // 上传中轮播趣味文案
  useEffect(() => {
    let interval;
    if (uploading && uploadFileSize > 0) {
      const sizeMB = uploadFileSize / 1024 / 1024;
      const msgs =
        sizeMB <= 50
          ? [t.funnyMsgSmall1, t.funnyMsgSmall2, t.funnyMsgSmall3]
          : [t.funnyMsgLarge1, t.funnyMsgLarge2, t.funnyMsgLarge3];
      let index = 0;
      setFunnyMessage(msgs[0]);
      interval = setInterval(() => {
        index = (index + 1) % msgs.length;
        setFunnyMessage(msgs[index]);
      }, 3000);
    } else {
      setFunnyMessage("");
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [uploading, uploadFileSize, t]);

  /**
   * uploadZipFile
   * 通用上传入口：支持按钮选择与拖拽区域的 .zip 文件上传
   */
  const uploadZipFile = async (file) => {
    if (!file) return;
    if (!String(file.name || "").toLowerCase().endsWith(".zip")) {
      toast({
        title: t.toastInvalidFileTitle,
        description: t.toastInvalidFileDesc,
        variant: "destructive"
      });
      return;
    }

    if (roleLimits && roleLimits.enabled === false) {
      toast({
        title: t.toastServiceDisabledTitle,
        description: t.toastServiceDisabledDesc,
        variant: "destructive"
      });
      return;
    }

    if (roleLimits) {
      if (
        roleLimits.deployment_limit !== null &&
        websites.length >= roleLimits.deployment_limit
      ) {
        toast({
          title: t.toastLimitReachedTitle,
          description: t.toastLimitReachedDesc(roleLimits.deployment_limit),
          variant: "destructive"
        });
        return;
      }
      if (
        roleLimits.max_file_size !== null &&
        file.size > roleLimits.max_file_size
      ) {
        toast({
          title: t.toastFileTooLargeTitle,
          description: t.toastFileTooLargeDesc(
            Math.round(roleLimits.max_file_size / 1024 / 1024)
          ),
          variant: "destructive"
        });
        return;
      }
    }

    if (!project?.id) {
      toast({
        title: t.projectRequiredTitle,
        description: t.projectRequiredDesc,
        variant: "destructive"
      });
      return;
    }

    const zipCheck = await validateStaticZipFile(file, lang);
    if (!zipCheck.valid) {
      toast({
        title: zipCheck.title || t.toastInvalidFileTitle,
        description: zipCheck.message || t.toastInvalidFileDesc,
        variant: "destructive"
      });
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadStatusText("");
    setUploadStage(1);
    setUploadFileSize(file.size);

    let websiteId = null;

    try {
      const token = tokenManager.get();
      const storedUser = userManager.get();
      if (!token || !storedUser || !storedUser.userId) {
        toast({
          title: t.toastExpiredTitle,
          description: t.toastExpiredDesc,
          variant: "destructive"
        });
        navigate("/");
        return;
      }

      const safeFileName = sanitizeFileName(file.name);

      // 生成 websiteId，并先更新本地状态
      websiteId = generateWebsiteId();
      const now = Date.now();
      const websiteData = {
        userId: user.userId,
        userName: user.nickname || "",
        fileName: safeFileName,
        projectId: project?.id ? String(project.id) : null,
        projectName: project?.name || null,
        projectSlug: project?.slug || null,
        status: "processing",
        createdAt: now,
        updatedAt: now
      };
      setWebsites((prev) => {
        const next = [{ _id: websiteId, ...websiteData }, ...prev];
        return next.sort(
          (a, b) => getComparableTimestamp(b) - getComparableTimestamp(a)
        );
      });
      setDeploying((prev) => ({ ...prev, [websiteId]: true }));

      // Phase 1: 读文件为 base64
      const totalSizeMB = (file.size / 1024 / 1024).toFixed(2);
      setUploadStatusText(`${t.statusUploading} (0MB / ${totalSizeMB}MB)`);
      setUploadStage(2);

      const fileContentBase64 = await fileToBase64(file, (percent, loaded) => {
        const loadedMB = (loaded / 1024 / 1024).toFixed(2);
        setUploadProgress(percent);
        setUploadStatusText(`${t.statusUploading} (${loadedMB}MB / ${totalSizeMB}MB)`);
      });

      // Phase 2: 上传并部署(SCF)
      setUploadStage(3);
      setUploadProgress(100);
      setUploadStatusText(t.statusDeploying);

      const deployResult = await websiteApi.uploadAndDeploy({
        fileContentBase64,
        fileName: safeFileName,
        websiteId,
        projectId: project?.id || undefined
      });

      setDeploying((prev) => ({ ...prev, [websiteId]: false }));
      if (deployResult && deployResult.success) {
        toast({
          title: t.toastDeploySuccessTitle,
          description: t.toastDeploySuccessDesc
        });
        loadWebsites();
      } else {
        throw new Error(deployResult?.message || t.deployFailed);
      }
    } catch (error) {
      console.error("Deployment failed:", error);
      if (websiteId) {
        setWebsites((prev) =>
          prev.map((w) => (w._id === websiteId ? { ...w, status: "failed" } : w))
        );
        setDeploying((prev) => ({ ...prev, [websiteId]: false }));
      }
      toast({
        title: t.toastDeployFailedTitle,
        description: error.message || t.toastDeployFailedDesc,
        variant: "destructive"
      });
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadStatusText("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /**
   * uploadDocFile
   * 文档模式入口：把 .md/.txt/.docx 等文字文档用所选模板渲染成站点，
   * 在浏览器端打包为 .zip 后复用 uploadZipFile 走既有部署流程。
   * @param {File|null} file 文字文档
   * @param {string} templateId 模板 id（insight / warm / dark）
   */
  const uploadDocFile = async (file, templateId) => {
    if (!file) return;
    if (!isSupportedDoc(file)) {
      toast({
        title: t.toastInvalidDocTitle,
        description: t.toastInvalidDocDesc,
        variant: "destructive"
      });
      return;
    }

    let zipFile;
    try {
      const built = await buildSiteZipFile({ file, templateId });
      zipFile = built.zipFile;
    } catch (error) {
      console.error("Document parse failed:", error);
      const isLegacyDoc = error && error.message === "UNSUPPORTED_DOC";
      toast({
        title: t.toastDocParseFailedTitle,
        description: isLegacyDoc ? t.toastLegacyDocDesc : t.toastDocParseFailedDesc,
        variant: "destructive"
      });
      return;
    }

    await uploadZipFile(zipFile);
  };

  /**
   * uploadPdfFile
   * PDF 模式入口：用 pdf.js 逐页渲染成图片，生成画册式 index.html，
   * 在浏览器端打包为 .zip 后复用 uploadZipFile 走既有部署流程。
   * @param {File|null} file PDF 文件
   */
  const uploadPdfFile = async (file) => {
    if (!file) return;
    if (!isSupportedPdf(file)) {
      toast({
        title: t.toastInvalidPdfTitle,
        description: t.toastInvalidPdfDesc,
        variant: "destructive"
      });
      return;
    }

    let zipFile;
    try {
      // 渲染阶段：先进入 uploading 状态，显示逐页渲染进度
      setUploading(true);
      setUploadProgress(0);
      setUploadStage(1);
      setUploadFileSize(file.size);
      setUploadStatusText(`${t.statusRenderingPdf} (0/0)`);

      const built = await buildPdfSiteZipFile({
        file,
        onProgress: (current, total) => {
          setUploadStatusText(`${t.statusRenderingPdf} (${current}/${total})`);
          setUploadProgress(Math.round((current / total) * 100));
        }
      });
      zipFile = built.zipFile;
    } catch (error) {
      console.error("PDF render failed:", error);
      setUploading(false);
      setUploadStatusText("");
      setUploadProgress(0);
      toast({
        title: t.toastPdfPackFailedTitle,
        description: t.toastPdfPackFailedDesc,
        variant: "destructive"
      });
      return;
    }

    // 渲染完成，交给 uploadZipFile 走上传/部署流程（其内部会重置状态）
    await uploadZipFile(zipFile);
  };

  /**
   * uploadSpreadsheetFile
   * 表格模式入口：解析 CSV/Excel 为多 sheet 表格网页，
   * 在浏览器端打包为 .zip 后复用 uploadZipFile 走既有部署流程。
   * @param {File|null} file 表格文件
   */
  const uploadSpreadsheetFile = async (file) => {
    if (!file) return;
    if (!isSupportedSpreadsheet(file)) {
      toast({
        title: t.toastInvalidSheetTitle,
        description: t.toastInvalidSheetDesc,
        variant: "destructive"
      });
      return;
    }

    let zipFile;
    try {
      setUploading(true);
      setUploadProgress(0);
      setUploadStage(1);
      setUploadFileSize(file.size);
      setUploadStatusText(t.statusParsingSheet);

      const built = await buildSpreadsheetSiteZipFile({ file });
      zipFile = built.zipFile;
    } catch (error) {
      console.error("Spreadsheet parse failed:", error);
      setUploading(false);
      setUploadStatusText("");
      setUploadProgress(0);
      toast({
        title: t.toastSheetParseFailedTitle,
        description: t.toastSheetParseFailedDesc,
        variant: "destructive"
      });
      return;
    }

    // 解析完成，交给 uploadZipFile 走上传/部署流程
    await uploadZipFile(zipFile);
  };

  /**
   * uploadHtmlFile
   * 单 HTML 模式入口：把单个 .html/.htm 文件作为 index.html 打包成 .zip，
   * 复用 uploadZipFile 走既有部署流程。
   * @param {File|null} file HTML 文件
   */
  const uploadHtmlFile = async (file) => {
    if (!file) return;
    if (!isSupportedHtml(file)) {
      toast({
        title: t.toastInvalidHtmlTitle,
        description: t.toastInvalidHtmlDesc,
        variant: "destructive"
      });
      return;
    }

    let zipFile;
    try {
      setUploading(true);
      setUploadProgress(0);
      setUploadStage(1);
      setUploadFileSize(file.size);
      setUploadStatusText(t.statusPackagingHtml);

      const built = await buildHtmlSiteZipFile({ file });
      zipFile = built.zipFile;
    } catch (error) {
      console.error("HTML pack failed:", error);
      setUploading(false);
      setUploadStatusText("");
      setUploadProgress(0);
      toast({
        title: t.toastHtmlPackFailedTitle,
        description: t.toastHtmlPackFailedDesc,
        variant: "destructive"
      });
      return;
    }

    // 打包完成，交给 uploadZipFile 走上传/部署流程
    await uploadZipFile(zipFile);
  };

  return {
    uploading,
    uploadProgress,
    uploadStatusText,
    uploadStage,
    funnyMessage,
    isDragActive,
    setIsDragActive,
    fileInputRef,
    uploadZipFile,
    uploadDocFile,
    uploadPdfFile,
    uploadSpreadsheetFile,
    uploadHtmlFile
  };
}
