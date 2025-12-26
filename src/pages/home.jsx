import React, { useState, useEffect } from "react";
// @ts-ignore;
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Progress,
  Badge,
  useToast,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui";
// @ts-ignore;
import {
  Upload,
  Cloud,
  Globe,
  Trash2,
  ExternalLink,
  Plus,
  User,
  FolderOpen,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Pencil
} from "lucide-react";
import { app, auth, db } from "../cloudbase";
import { useNavigate, Navigate } from "react-router-dom";
import { MainLayout } from "@/layouts/MainLayout";
import { useLanguage } from "@/hooks/use-language";

const translations = {
  zh: {
    pageTitle: "部署控制台",
    pageSubtitlePrefix: "当前角色：",
    pageSubtitleFallback: "管理你的静态站点部署。",
    statusDeployed: "已部署",
    statusProcessing: "部署中",
    statusFailed: "失败",
    statusUnknown: "未知",
    loading: "加载中...",
    uploadCardTitle: "部署新项目",
    uploadLimitPrefix: "最大:",
    uploadLimitFilesPrefix: "文件数:",
    uploadLimitUnlimited: "无限",
    uploadTitleUploading: "上传中...",
    uploadTitleIdle: "将你的项目拖拽到此处",
    uploadDesc: "支持包含根目录 index.html 的 .zip 压缩包。",
    uploadButton: "选择文件",
    uploadProgressLabel: "上传中",
    deploymentsTitle: "部署记录",
    refresh: "刷新",
    emptyTitle: "暂无部署记录",
    emptyDesc: "上传你的第一个项目以开始使用。",
    createdAt: "创建时间：",
    deployedAt: "部署时间：",
    processingBadge: "处理中",
    redeployButton: "重新部署",
    toastInvalidFileTitle: "文件格式错误",
    toastInvalidFileDesc: "请上传 .zip 格式的压缩包",
    toastServiceDisabledTitle: "服务暂不可用",
    toastServiceDisabledDesc: "请联系开发者",
    toastLimitReachedTitle: "达到部署限制",
    toastLimitReachedDesc: (limit) => `您当前角色的部署上限为 ${limit} 个`,
    toastFileTooLargeTitle: "文件大小超出限制",
    toastFileTooLargeDesc: (sizeMb) => `文件大小不能超过 ${sizeMb}MB`,
    toastExpiredTitle: "登录已过期",
    toastExpiredDesc: "请重新登录",
    toastDeploySuccessTitle: "部署成功",
    toastDeploySuccessDesc: "网站已成功部署并可以访问",
    toastDeployFailedTitle: "部署失败",
    toastDeployFailedDesc: "部署过程中出现错误，请重试",
    toastDeleteSuccessTitle: "删除成功",
    toastDeleteSuccessDesc: "网站已成功删除",
    toastDeleteFailedTitle: "删除失败",
    toastRedeployTitle: "重新部署",
    toastRedeployDesc: "请选择要重新部署的 .zip 文件，上传后将覆盖原有站点文件",
    redeploySelectedTitle: "已选择文件",
    redeploySelectPrompt: "请选择 .zip 文件",
    redeployFileDesc: "支持 .zip 压缩包，根目录需包含 index.html",
    redeployChangeFile: "更改文件",
    redeployChooseFile: "选择文件",
    cancel: "取消",
    confirmUpload: "确认上传"
  },
  en: {
    pageTitle: "Deploy Console",
    pageSubtitlePrefix: "Current role: ",
    pageSubtitleFallback: "Manage your static site deployments.",
    statusDeployed: "Deployed",
    statusProcessing: "Deploying",
    statusFailed: "Failed",
    statusUnknown: "Unknown",
    loading: "Loading...",
    uploadCardTitle: "Deploy New Project",
    uploadLimitPrefix: "Max:",
    uploadLimitFilesPrefix: "Files:",
    uploadLimitUnlimited: "Unlimited",
    uploadTitleUploading: "Uploading...",
    uploadTitleIdle: "Drop your project here",
    uploadDesc:
      "Supports .zip files containing an index.html in the root directory.",
    uploadButton: "Select File",
    uploadProgressLabel: "UPLOADING",
    deploymentsTitle: "Deployments",
    refresh: "Refresh",
    emptyTitle: "No deployments yet",
    emptyDesc: "Upload your first project to get started.",
    createdAt: "Created: ",
    deployedAt: "Deployed: ",
    processingBadge: "Processing",
    redeployButton: "Redeploy",
    toastInvalidFileTitle: "Invalid file format",
    toastInvalidFileDesc: "Please upload a .zip archive.",
    toastServiceDisabledTitle: "Service unavailable",
    toastServiceDisabledDesc: "Please contact the developer.",
    toastLimitReachedTitle: "Deployment limit reached",
    toastLimitReachedDesc: (limit) =>
      `Your current role allows up to ${limit} deployments.`,
    toastFileTooLargeTitle: "File size exceeded",
    toastFileTooLargeDesc: (sizeMb) => `File size must not exceed ${sizeMb}MB.`,
    toastExpiredTitle: "Session expired",
    toastExpiredDesc: "Please sign in again.",
    toastDeploySuccessTitle: "Deployment successful",
    toastDeploySuccessDesc: "Your site has been deployed and is now live.",
    toastDeployFailedTitle: "Deployment failed",
    toastDeployFailedDesc: "An error occurred during deployment. Please retry.",
    toastDeleteSuccessTitle: "Deleted",
    toastDeleteSuccessDesc: "The site has been deleted.",
    toastDeleteFailedTitle: "Delete failed",
    toastRedeployTitle: "Redeploy",
    toastRedeployDesc:
      "Choose a .zip file to redeploy. It will overwrite existing files.",
    redeploySelectedTitle: "File selected",
    redeploySelectPrompt: "Choose a .zip file",
    redeployFileDesc:
      "Supports .zip archives with an index.html in the root directory.",
    redeployChangeFile: "Change file",
    redeployChooseFile: "Choose file",
    cancel: "Cancel",
    confirmUpload: "Confirm upload"
  }
};

/**
 * sanitizeFileName
 * 对文件名进行安全清洗，替换云存储不支持的字符，避免上传失败
 */
const sanitizeFileName = (name) =>
  String(name).replace(/[^0-9a-zA-Z/_\-\.\s\u4e00-\u9fa5]/g, "_");

/**
 * generateWebsiteId
 * 生成 8 位由大写字母与数字组成的随机字符串，满足域名片段要求
 */
const generateWebsiteId = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
};

/**
 * getWebsiteDisplayName
 * 站点显示名称优先使用 websiteId（wid），其次使用文档 _id，最后回退为文件名
 */
const getWebsiteDisplayName = (w) => {
  if (!w) return "";
  return w.websiteId || w._id || w.fileName || "";
};

/**
 * formatTimestamp
 * 将时间戳或日期对象格式化为精确到秒的本地时间字符串
 */
const formatTimestamp = (ts) => {
  if (!ts) return "";
  const d =
    ts instanceof Date
      ? ts
      : typeof ts === "number"
      ? new Date(ts)
      : new Date(String(ts));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
};

/**
 * getComparableTimestamp
 * 提取用于排序的时间戳（优先使用 updatedAt，其次 createdAt）
 */
const getComparableTimestamp = (w) => {
  const v = w?.updatedAt || w?.createdAt || 0;
  const d =
    v instanceof Date
      ? v
      : typeof v === "number"
      ? new Date(v)
      : new Date(String(v));
  return Number(d.getTime() || 0);
};

/**
 * getDisplayName
 * 站点显示名称优先使用数据库中 name；其次使用 websiteId（wid），再其次 _id 或文件名
 */
const getDisplayName = (w) => {
  if (!w) return "";
  const n = (w.name || "").trim();
  if (n) return n;
  return w.websiteId || w._id || w.fileName || "";
};

/**
 * Home
 * 用户登录、上传、部署、列表、删除的主页面
 * 剔除 Weda 相关依赖，统一通过云函数与后端交互
 */
export default function Home(props) {
  const { style } = props;
  const { toast } = useToast();
  const navigate = useNavigate();
  const { language: lang } = useLanguage();
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [websites, setWebsites] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deploying, setDeploying] = useState({});
  const [roleLimits, setRoleLimits] = useState(null);
  const fileInputRef = React.useRef(null);
  const [redeployOpen, setRedeployOpen] = useState(false);
  const [redeployWebsite, setRedeployWebsite] = useState(null);
  const [redeployFile, setRedeployFile] = useState(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isRedeployDragActive, setIsRedeployDragActive] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const t = translations[lang];
  useEffect(() => {
    checkAuthStatus();
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      loadWebsites();
    }
  }, [isLoggedIn]);

  /**
   * checkAuthStatus
   * 检查 CloudBase 登录态；允许匿名登录，保持统一的用户对象结构
   */
  const checkAuthStatus = async (retry = true) => {
    console.log("Checking auth status...");
    try {
      const loginState = await auth.getLoginState();
      console.log("Login state:", loginState);

      // 允许匿名登录，统一将登录态视为有效
      if (loginState && loginState.user) {
        console.log("User logged in:", loginState.user);
        // 使用 CloudBase SDK 的用户对象，适配 Weda 字段
        const user = {
          ...loginState.user,
          userId: loginState.user.uid,
          openId: loginState.user.uid, // 适配 openId
          nickName: loginState.user.nickName,
          email: loginState.user.email
        };

        // 查询用户身份 (user_roles)
        try {
          const roleRes = await db
            .collection("ai_builder_user_roles")
            .doc(loginState.user.uid)
            .get();

          if (roleRes.data && roleRes.data.length > 0) {
            // 数据库中保存的是 role: ['admin', 'vip']
            user.roles = roleRes.data[0].role;
          } else {
            user.roles = ["user"]; // 未查到则赋予普通用户角色
          }

          // Fetch role limits
          // Default to 'user' role
          let candidateRoles = ["user"];
          if (user.roles && user.roles.length > 0) {
            candidateRoles = [...candidateRoles, ...user.roles];
          }
          // Remove duplicates
          candidateRoles = [...new Set(candidateRoles)];
          // Use Cloud Function to fetch role limits to avoid ACL issues
          const limitFnRes = await app.callFunction({
            name: "getRoleLimits",
            data: {
              roles: candidateRoles
            }
          });

          let limitRes = { data: [] };
          if (limitFnRes.result && limitFnRes.result.code === 0) {
            limitRes.data = limitFnRes.result.data;
          } else {
            console.warn(
              "Cloud function getRoleLimits failed:",
              limitFnRes.result
            );
          }

          if (limitRes.data && limitRes.data.length > 0) {
            // Sort by priority descending
            const sortedRoles = limitRes.data.sort(
              (a, b) => (b.priority || 0) - (a.priority || 0)
            );
            // Use the highest priority role
            const effectiveRole = sortedRoles[0];
            setRoleLimits(effectiveRole);
            user.role_name = effectiveRole.name || "普通用户";
          } else {
            console.warn("No role limits found in database");
            // 禁止默认设置，仅设置角色名称
            user.role_name = "普通用户";
          }
        } catch (roleError) {
          console.warn("Fetch user roles failed:", roleError);
          // 忽略错误，降级为普通用户，并尝试获取普通用户限额
          user.roles = ["user"];
          user.role_name = "普通用户";

          try {
            const userLimitFnRes = await app.callFunction({
              name: "getRoleLimits",
              data: { roles: ["user"] }
            });

            if (
              userLimitFnRes.result &&
              userLimitFnRes.result.code === 0 &&
              userLimitFnRes.result.data.length > 0
            ) {
              setRoleLimits(userLimitFnRes.result.data[0]);
              user.role_name = userLimitFnRes.result.data[0].name || "普通用户";
            }
          } catch (limitError) {
            console.warn(
              "Fallback fetch 'user' role limit failed:",
              limitError
            );
          }
        }

        setIsLoggedIn(true);
        setUser(user);
        setIsLoading(false);
      } else {
        if (retry) {
          console.log("No user found, retrying in 500ms...");
          setTimeout(() => checkAuthStatus(false), 500);
          return;
        }
        console.warn("No user found in login state");
        setIsLoggedIn(false);
        setUser(null);
        setIsLoading(false);
      }
    } catch (e) {
      console.warn("Auth check failed:", e);
      if (retry) {
        console.log("Auth check error, retrying in 500ms...");
        setTimeout(() => checkAuthStatus(false), 500);
        return;
      }
      setIsLoggedIn(false);
      setUser(null);
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      try {
        await auth.signOut();
      } catch (err) {
        // 忽略匿名登录被禁用的错误
        if (
          err?.code !== "login_type_disabled" &&
          err?.error !== "login_type_disabled"
        ) {
          console.warn("SignOut error:", err);
        }
      }

      setIsLoggedIn(false);
      setUser(null);
      setWebsites([]);
      toast({
        title: "退出成功",
        description: "您已成功退出登录"
      });
      navigate("/", { replace: true });
    } catch (error) {
      toast({
        title: "退出失败",
        description: error.message,
        variant: "destructive"
      });
    }
  };
  /**
   * 加载当前用户的站点列表（从 resource-game 集合）
   */
  const loadWebsites = async () => {
    try {
      const result = await app.callFunction({
        name: "deploy-website",
        data: {
          action: "list",
          userId: user?.userId || ""
        }
      });
      if (result.result && result.result.success) {
        const mapped = (result.result.files || []).map((item) => ({
          ...item,
          status: "deployed"
        }));
        const sorted = mapped.sort(
          (a, b) => getComparableTimestamp(b) - getComparableTimestamp(a)
        );
        setWebsites(sorted);
      } else {
        throw new Error(result.result?.message || "加载列表失败");
      }
    } catch (error) {
      console.error("加载网站列表失败:", error);
      toast({
        title: "加载失败",
        description: error.message || "无法获取网站列表",
        variant: "destructive"
      });
    }
  };

  /**
   * startEditName
   * 开始编辑站点名称
   */
  const startEditName = (website) => {
    setEditingId(website._id);
    setEditingName(getDisplayName(website));
  };

  /**
   * cancelEditName
   * 取消编辑站点名称
   */
  const cancelEditName = () => {
    setEditingId(null);
    setEditingName("");
  };

  /**
   * saveEditName
   * 保存站点名称到 resource-game 文档的 name 字段
   */
  const saveEditName = async (website) => {
    const name = String(editingName || "").trim();
    if (!name) {
      toast({
        title: "名称不能为空",
        description: "请输入一个有效的名称",
        variant: "destructive"
      });
      return;
    }
    try {
      const res = await app.callFunction({
        name: "deploy-website",
        data: {
          action: "update_name",
          docId: website._id,
          userId: user.userId,
          name
        }
      });
      if (res.result && res.result.success) {
        setWebsites((prev) =>
          prev.map((w) =>
            w._id === website._id ? { ...w, name, updatedAt: Date.now() } : w
          )
        );
        cancelEditName();
        toast({
          title: "已保存",
          description: "站点名称已更新"
        });
      } else {
        throw new Error(res.result?.message || "保存失败");
      }
    } catch (error) {
      toast({
        title: "保存失败",
        description: error.message || "更新名称时出现错误",
        variant: "destructive"
      });
    }
  };

  /**
   * uploadZipFile
   * 通用上传入口：支持按钮选择与拖拽区域的 .zip 文件上传
   */
  const uploadZipFile = async (file) => {
    if (!file) return;
    if (!file.name.endsWith(".zip")) {
      toast({
        title: t.toastInvalidFileTitle,
        description: t.toastInvalidFileDesc,
        variant: "destructive"
      });
      return;
    }

    // 若角色未启用，禁止进行部署相关操作
    if (roleLimits && roleLimits.enabled === false) {
      toast({
        title: t.toastServiceDisabledTitle,
        description: t.toastServiceDisabledDesc,
        variant: "destructive"
      });
      return;
    }

    // Check limits
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

    setUploading(true);
    setUploadProgress(0);
    let websiteId = null;

    try {
      const state = await auth.getLoginState();
      if (!state || !state.user) {
        toast({
          title: t.toastExpiredTitle,
          description: t.toastExpiredDesc,
          variant: "destructive"
        });
        navigate("/");
        return;
      }

      const safeFileName = sanitizeFileName(file.name);
      const cloudPath = `websites/${user.userId}/${Date.now()}_${safeFileName}`;

      // 生成 websiteId，并先更新本地状态，创建时间记录到秒
      websiteId = generateWebsiteId();
      const now = Date.now();
      const websiteData = {
        userId: user.userId,
        userName: user.nickName || user.name,
        fileName: safeFileName,
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

      const toBase64 = (f) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = String(reader.result || "");
            const base64 = res.includes(",") ? res.split(",")[1] : res;
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(f);
        });
      const fileContentBase64 = await toBase64(file);

      const deployResult = await app.callFunction({
        name: "deploy-website",
        data: {
          action: "upload_and_deploy",
          cloudPath,
          fileContentBase64,
          userId: user.userId,
          websiteId: websiteId,
          fileName: safeFileName
        }
      });
      setDeploying((prev) => ({
        ...prev,
        [websiteId]: false
      }));
      if (deployResult.result && deployResult.result.success) {
        toast({
          title: t.toastDeploySuccessTitle,
          description: t.toastDeploySuccessDesc
        });
        loadWebsites();
      } else {
        throw new Error(deployResult.result?.message || "部署失败");
      }
    } catch (error) {
      console.error("部署失败:", error);
      if (websiteId) {
        setWebsites((prev) =>
          prev.map((w) =>
            w._id === websiteId ? { ...w, status: "failed" } : w
          )
        );
        setDeploying((prev) => ({
          ...prev,
          [websiteId]: false
        }));
      }
      toast({
        title: t.toastDeployFailedTitle,
        description: error.message || t.toastDeployFailedDesc,
        variant: "destructive"
      });
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  /**
   * handleFileUpload
   * 选择文件上传事件处理：委托给 uploadZipFile
   */
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    await uploadZipFile(file);
  };
  const handleDeleteWebsite = async (websiteId) => {
    try {
      const website = websites.find((w) => w._id === websiteId);
      if (!website) return;

      // 使用云函数删除整站资源（COS + 数据库）
      const result = await app.callFunction({
        name: "deploy-website",
        data: {
          action: "delete",
          userId: website.userId,
          websiteId: website.websiteId || website._id,
          fileName: website.fileName,
          key: website.path // 直接传递数据库中的 path，提高删除准确性
        }
      });

      if (result.result && result.result.success) {
        toast({
          title: t.toastDeleteSuccessTitle,
          description: t.toastDeleteSuccessDesc
        });
        // 从本地状态中移除
        setWebsites((prev) => prev.filter((w) => w._id !== websiteId));
      } else {
        throw new Error(result.result?.message || "删除失败");
      }
    } catch (error) {
      toast({
        title: t.toastDeleteFailedTitle,
        description: error.message,
        variant: "destructive"
      });
    }
  };

  /**
   * openRedeployDialog
   * 打开重新部署弹窗并设置目标站点
   */
  const openRedeployDialog = (website) => {
    setRedeployWebsite(website);
    setRedeployFile(null);
    setRedeployOpen(true);
  };

  /**
   * handleRedeployFileChange
   * 处理重新部署弹窗中的文件选择
   */
  const handleRedeployFileChange = (e) => {
    const f = e.target.files && e.target.files[0];
    setRedeployFile(f || null);
  };

  /**
   * onRedeployDragEnter
   * 重新部署弹窗：拖拽进入高亮
   */
  const onRedeployDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRedeployDragActive(true);
  };

  /**
   * onRedeployDragOver
   * 重新部署弹窗：拖拽经过保持高亮
   */
  const onRedeployDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRedeployDragActive(true);
  };

  /**
   * onRedeployDragLeave
   * 重新部署弹窗：拖拽离开取消高亮
   */
  const onRedeployDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRedeployDragActive(false);
  };

  /**
   * onRedeployDrop
   * 重新部署弹窗：拖拽文件释放即选中待上传文件
   */
  const onRedeployDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRedeployDragActive(false);
    const items = e.dataTransfer?.files;
    const f = items && items.length > 0 ? items[0] : null;
    if (f) {
      setRedeployFile(f);
    }
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
        title: "文件格式错误",
        description: "请上传 .zip 格式的压缩包",
        variant: "destructive"
      });
      return;
    }

    if (roleLimits && roleLimits.enabled === false) {
      toast({
        title: "服务暂不可用",
        description: "请联系开发者",
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
        title: "文件大小超出限制",
        description: `文件大小不能超过 ${Math.round(
          roleLimits.max_file_size / 1024 / 1024
        )}MB`,
        variant: "destructive"
      });
      return;
    }

    try {
      // 立即关闭弹窗并返回主页，同时将对应站点状态置为 Deploying
      setRedeployOpen(false);
      setRedeployFile(null);
      setRedeployWebsite(null);
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
      navigate("/home");

      const state = await auth.getLoginState();
      if (!state || !state.user) {
        toast({
          title: "登录已过期",
          description: "请重新登录",
          variant: "destructive"
        });
        navigate("/");
        return;
      }

      const safeFileName = sanitizeFileName(file.name);
      const cloudPath = `websites/${
        user.userId
      }/redeploy_${Date.now()}_${safeFileName}`;

      const toBase64 = (f) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = String(reader.result || "");
            const base64 = res.includes(",") ? res.split(",")[1] : res;
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(f);
        });
      const fileContentBase64 = await toBase64(file);

      const deployResult = await app.callFunction({
        name: "deploy-website",
        data: {
          action: "upload_and_deploy",
          cloudPath,
          fileContentBase64,
          userId: user.userId,
          websiteId: website.websiteId || website._id,
          fileName: safeFileName
        }
      });

      setDeploying((prev) => ({ ...prev, [website._id]: false }));

      if (deployResult.result && deployResult.result.success) {
        toast({
          title: "重新部署成功",
          description: deployResult.result.message || "站点已成功重新部署"
        });
        loadWebsites();
      } else {
        throw new Error(deployResult.result?.message || "重新部署失败");
      }
    } catch (error) {
      setDeploying((prev) => ({ ...prev, [website._id]: false }));
      setWebsites((prev) =>
        prev.map((w) =>
          w._id === website._id ? { ...w, status: "failed" } : w
        )
      );
      toast({
        title: "重新部署失败",
        description: error.message || "重新部署过程中出现错误",
        variant: "destructive"
      });
    }
  };

  /**
   * 根据状态渲染状态徽章
   */
  const getStatusBadge = (status) => {
    switch (status) {
      case "deployed":
        return (
          <Badge className="bg-green-500/10 text-green-500 border-green-500/20 border">
            <CheckCircle className="w-3 h-3 mr-1" />
            {t.statusDeployed}
          </Badge>
        );
      case "processing":
        return (
          <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 border">
            <Clock className="w-3 h-3 mr-1" />
            {t.statusProcessing}
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/10 text-red-500 border-red-500/20 border">
            <XCircle className="w-3 h-3 mr-1" />
            {t.statusFailed}
          </Badge>
        );
      default:
        return (
          <Badge className="bg-zinc-500/10 text-zinc-500 border-zinc-500/20 border">
            <AlertCircle className="w-3 h-3 mr-1" />
            {t.statusUnknown}
          </Badge>
        );
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div style={style} className="flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-4 border-zinc-800 border-t-zinc-100 rounded-full animate-spin"></div>
            <span className="text-zinc-500 font-mono text-sm animate-pulse">
              {t.loading}
            </span>
          </div>
        </div>
      </MainLayout>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/" replace />;
  }

  return (
    <MainLayout>
      <div style={style} className="relative z-10">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-10">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              {t.pageTitle}
            </h1>
            <p className="text-sm text-zinc-500 mt-2">
              {user?.role_name
                ? `${t.pageSubtitlePrefix}${user.role_name}`
                : t.pageSubtitleFallback}
            </p>
          </div>

          {/* Upload Section */}
          <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm mb-12 overflow-hidden relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-zinc-900/20 to-transparent pointer-events-none" />
            <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
              <CardTitle className="text-zinc-100 flex items中心 gap-2">
                <Upload className="w-5 h-5 text-zinc-400" />
                {t.uploadCardTitle}
                {roleLimits && (
                  <span className="text-xs text-zinc-500 font-mono ml-2 font-normal">
                    ({t.uploadLimitPrefix}{" "}
                    {roleLimits.max_file_size
                      ? Math.round(roleLimits.max_file_size / 1024 / 1024) +
                        "MB"
                      : t.uploadLimitUnlimited}
                    , {t.uploadLimitFilesPrefix}{" "}
                    {roleLimits.max_file_count
                      ? roleLimits.max_file_count
                      : t.uploadLimitUnlimited}
                    )
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8">
              <div
                className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                  isDragActive
                    ? "border-zinc-600 bg-zinc-900/30"
                    : "border-zinc-800 bg-zinc-900/20"
                } group-hover:bg-zinc-900/30`}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragActive(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragActive(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragActive(false);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragActive(false);
                  const items = e.dataTransfer?.files;
                  const file = items && items.length > 0 ? items[0] : null;
                  await uploadZipFile(file);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                  disabled={uploading}
                />
                <label
                  htmlFor="file-upload"
                  className={`cursor-pointer ${
                    uploading ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center mx-auto mb-6 border border-zinc-800 group-hover:scale-110 transition-transform duration-300">
                    <FolderOpen className="w-8 h-8 text-zinc-400" />
                  </div>
                  <h3 className="text-xl font-bold text-zinc-100 mb-2">
                    {uploading ? t.uploadTitleUploading : t.uploadTitleIdle}
                  </h3>
                  <p className="text-zinc-500 mb-6 max-w-sm mx-auto">
                    {t.uploadDesc}
                  </p>
                  {!uploading && (
                    <span className="px-6 py-2 bg-zinc-100 text黑 text-sm font-bold rounded-md hover:bg-zinc-300 transition-colors">
                      {t.uploadButton}
                    </span>
                  )}
                </label>
              </div>

              {uploading && (
                <div className="mt-8 max-w-xl mx-auto">
                  <div className="flex justify-between text-xs font-mono text-zinc-400 mb-2">
                    <span>{t.uploadProgressLabel}</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <Progress
                    value={uploadProgress}
                    className="bg-zinc-900 h-2"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Websites List */}
          <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm">
            <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
              <CardTitle className="text-zinc-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="w-5 h-5 text-zinc-400" />
                  {t.deploymentsTitle}
                  {roleLimits && (
                    <span className="text-sm text-zinc-500 font-mono ml-2">
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
                  className="border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {t.refresh}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {websites.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-16 h-16 rounded-full bg-zinc-900/50 flex items-center justify-center mx-auto mb-4 border border-zinc-800">
                    <Globe className="w-8 h-8 text-zinc-600" />
                  </div>
                  <p className="text-zinc-400 font-medium">{t.emptyTitle}</p>
                  <p className="text-zinc-600 text-sm mt-2">{t.emptyDesc}</p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-900">
                  {websites.map((website) => (
                    <div
                      key={website._id}
                      className="p-6 hover:bg-zinc-900/20 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="flex items-center gap-2 group">
                            {editingId === website._id ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={editingName}
                                  onChange={(e) =>
                                    setEditingName(e.target.value)
                                  }
                                  className="bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm rounded px-2 py-1 w-48 focus:outline-none focus:border-zinc-600"
                                />
                                <button
                                  onClick={() => saveEditName(website)}
                                  className="text-green-400 hover:text-green-300"
                                  title="保存"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={cancelEditName}
                                  className="text-zinc-400 hover:text-zinc-300"
                                  title="取消"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <>
                                <h3 className="text-zinc-100 font-bold truncate">
                                  {getDisplayName(website)}
                                </h3>
                                <button
                                  onClick={() => startEditName(website)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-zinc-200"
                                  title="编辑名称"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                          {getStatusBadge(website.status)}
                          {deploying[website._id] && (
                            <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                              <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                              处理中
                            </Badge>
                          )}
                        </div>

                        <div className="flex flex-col sm:flex-row gap-4 text-sm text-zinc-500 font-mono mt-3">
                          <span>
                            {t.createdAt}
                            {formatTimestamp(website.createdAt)}
                          </span>
                          {(website.updatedAt || website.deployedAt) && (
                            <span>
                              {t.deployedAt}
                              {formatTimestamp(
                                website.updatedAt || website.deployedAt
                              )}
                            </span>
                          )}
                        </div>

                        {website.url && (
                          <div className="flex items-center gap-2 mt-3">
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 max-w-full">
                              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                              <a
                                href={website.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-zinc-300 hover:text-white text-sm font-mono truncate hover:underline underline-offset-4 decoration-zinc-600"
                              >
                                {website.url}
                              </a>
                            </div>
                            <a
                              href={website.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openRedeployDialog(website)}
                          className="border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700"
                        >
                          <Upload className="w-4 h-4 mr-2" />
                          {t.redeployButton}
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteWebsite(website._id)}
                          className="text-zinc-500 hover:text-red-400 hover:bg-red-950/30"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Dialog open={redeployOpen} onOpenChange={setRedeployOpen}>
            <DialogContent className="bg-zinc-900 border-zinc-800">
              <DialogHeader>
                <DialogTitle className="text-zinc-100">
                  {t.toastRedeployTitle}
                </DialogTitle>
                <DialogDescription className="text-zinc-400">
                  {t.toastRedeployDesc}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-6">
                <div
                  className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                    isRedeployDragActive
                      ? "border-zinc-600 bg-zinc-900/30"
                      : "border-zinc-800 bg-zinc-900/20"
                  }`}
                  onDragEnter={onRedeployDragEnter}
                  onDragOver={onRedeployDragOver}
                  onDragLeave={onRedeployDragLeave}
                  onDrop={onRedeployDrop}
                >
                  <input
                    id="redeploy-file-input"
                    type="file"
                    accept=".zip"
                    onChange={handleRedeployFileChange}
                    className="hidden"
                  />
                  <label
                    htmlFor="redeploy-file-input"
                    className="cursor-pointer"
                  >
                    <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center mx-auto mb-6 border border-zinc-800">
                      <FolderOpen className="w-8 h-8 text-zinc-400" />
                    </div>
                    <h3 className="text-xl font-bold text-zinc-100 mb-2">
                      {redeployFile
                        ? t.redeploySelectedTitle
                        : t.redeploySelectPrompt}
                    </h3>
                    <p className="text-zinc-500 mb-6 max-w-sm mx-auto">
                      {redeployFile ? redeployFile.name : t.redeployFileDesc}
                    </p>
                    <span className="px-6 py-2 bg-zinc-100 text-black text-sm font-bold rounded-md hover:bg-zinc-300 transition-colors">
                      {redeployFile
                        ? t.redeployChangeFile
                        : t.redeployChooseFile}
                    </span>
                  </label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    className="bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    onClick={() => {
                      setRedeployOpen(false);
                      setRedeployFile(null);
                      setRedeployWebsite(null);
                    }}
                  >
                    {t.cancel}
                  </Button>
                  <Button
                    variant="outline"
                    className="bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    disabled={!redeployFile}
                    onClick={submitRedeploy}
                  >
                    {t.confirmUpload}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Background Grid Effect */}
        <div className="fixed inset-0 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] -z-10 pointer-events-none" />
      </div>
    </MainLayout>
  );
}
