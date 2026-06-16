import { useState } from "react";
import { websiteApi, tokenManager, userManager } from "../api";
import { useToast } from "@/components/ui";
import { sanitizeFileName, getComparableTimestamp } from "@/lib/website-utils";

/**
 * fileToBase64
 * 将文件读为 base64（去掉 dataURL 前缀）
 */
const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || "");
      resolve(res.includes(",") ? res.split(",")[1] : res);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

/**
 * useRedeploy
 * 重新部署弹窗：选择/拖拽 .zip 覆盖原站点。
 * @param {{
 *   roleLimits:any, t:Record<string,any>, navigate:Function,
 *   loadWebsites:Function, setWebsites:Function, setDeploying:Function
 * }} deps
 */
export function useRedeploy({
  roleLimits,
  t,
  navigate,
  loadWebsites,
  setWebsites,
  setDeploying
}) {
  const { toast } = useToast();
  const [redeployOpen, setRedeployOpen] = useState(false);
  const [redeployWebsite, setRedeployWebsite] = useState(null);
  const [redeployFile, setRedeployFile] = useState(null);
  const [isRedeployDragActive, setIsRedeployDragActive] = useState(false);

  const openRedeployDialog = (website) => {
    setRedeployWebsite(website);
    setRedeployFile(null);
    setRedeployOpen(true);
  };

  const closeRedeployDialog = () => {
    setRedeployOpen(false);
    setRedeployFile(null);
    setRedeployWebsite(null);
  };

  const handleRedeployFileChange = (e) => {
    const f = e.target.files && e.target.files[0];
    setRedeployFile(f || null);
  };

  const onRedeployDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRedeployDragActive(true);
  };

  const onRedeployDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRedeployDragActive(true);
  };

  const onRedeployDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRedeployDragActive(false);
  };

  const onRedeployDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRedeployDragActive(false);
    const items = e.dataTransfer?.files;
    const f = items && items.length > 0 ? items[0] : null;
    if (f) setRedeployFile(f);
  };

  /**
   * submitRedeploy
   * 使用所选 .zip 文件对目标站点进行覆盖式重新部署
   */
  const submitRedeploy = async () => {
    if (!redeployWebsite || !redeployFile) return;
    const website = redeployWebsite;
    const file = redeployFile;

    if (!file.name.endsWith(".zip")) {
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

    if (
      roleLimits &&
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

    try {
      // 立即关闭弹窗并返回控制台，同时将对应站点状态置为 Deploying
      closeRedeployDialog();
      setWebsites((prev) =>
        prev
          .map((w) =>
            w._id === website._id
              ? { ...w, status: "processing", updatedAt: Date.now() }
              : w
          )
          .sort((a, b) => getComparableTimestamp(b) - getComparableTimestamp(a))
      );
      setDeploying((prev) => ({ ...prev, [website._id]: true }));
      navigate("/console/projects");

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
      const fileContentBase64 = await fileToBase64(file);

      const deployResult = await websiteApi.uploadAndDeploy({
        fileContentBase64,
        fileName: safeFileName,
        websiteId: website.websiteId || website._id
      });

      setDeploying((prev) => ({ ...prev, [website._id]: false }));

      if (deployResult && deployResult.success) {
        toast({
          title: t.redeploySuccessTitle,
          description: t.redeploySuccessDesc
        });
        loadWebsites();
      } else {
        throw new Error(deployResult?.message || t.redeployFailedTitle);
      }
    } catch (error) {
      setDeploying((prev) => ({ ...prev, [website._id]: false }));
      setWebsites((prev) =>
        prev.map((w) => (w._id === website._id ? { ...w, status: "failed" } : w))
      );
      toast({
        title: t.redeployFailedTitle,
        description: error.message || t.redeployFailedDesc,
        variant: "destructive"
      });
    }
  };

  return {
    redeployOpen,
    setRedeployOpen,
    redeployFile,
    isRedeployDragActive,
    openRedeployDialog,
    closeRedeployDialog,
    handleRedeployFileChange,
    onRedeployDragEnter,
    onRedeployDragOver,
    onRedeployDragLeave,
    onRedeployDrop,
    submitRedeploy
  };
}
