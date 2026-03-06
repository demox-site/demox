import React, { useState, useEffect } from "react";
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
  DialogDescription,
  Popover,
  PopoverTrigger,
  PopoverContent,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Input
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
  Pencil,
  Tag,
  Check,
  X
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
    confirmUpload: "确认上传",
    deleteConfirmTitle: "确认删除？",
    deleteConfirmDesc: "此操作无法撤销。这将永久删除该站点及其所有资源。",
    deleteConfirmButton: "确认删除",
    redeployDisabledTooltip: "耐心点~部署完再点~",
    funnyMsgSmall1: "稍等片刻，马上就好~",
    funnyMsgSmall2: "快马加鞭~",
    funnyMsgSmall3: "就快了！！就快了！！",
    funnyMsgLarge1: "谁教你整这么大的部署包的？累死我算辣！！！",
    funnyMsgLarge2: "太大啦！太大啦！快不中啦！！",
    funnyMsgLarge3: "谢谢您这么看得起我~给我整这么一大坨~~",
    roleStandard: "普通用户",
    logoutSuccessTitle: "退出成功",
    logoutSuccessDesc: "您已成功退出登录",
    logoutFailedTitle: "退出失败",
    loadListFailed: "加载列表失败",
    loadFailedTitle: "加载失败",
    loadFailedDesc: "无法获取网站列表",
    nameEmptyTitle: "名称不能为空",
    nameEmptyDesc: "请输入一个有效的名称",
    savedTitle: "已保存",
    savedDesc: "站点名称已更新",
    saveFailedTitle: "保存失败",
    saveFailedDesc: "更新名称时出现错误",
    deployFailed: "部署失败",
    statusUploading: "正在上传",
    statusUnzipping: "正在解压",
    statusDeploying: "正在部署",
    redeploySuccessTitle: "重新部署成功",
    redeploySuccessDesc: "站点已成功重新部署",
    redeployFailedTitle: "重新部署失败",
    redeployFailedDesc: "重新部署过程中出现错误",
    save: "保存",
    editName: "编辑名称",
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
    confirmUpload: "Confirm upload",
    deleteConfirmTitle: "Are you sure?",
    deleteConfirmDesc: "This action cannot be undone. This will permanently delete the site and all its resources.",
    deleteConfirmButton: "Delete",
    redeployDisabledTooltip: "Patience, please wait for deployment to finish",
    funnyMsgSmall1: "Just a moment, almost done...",
    funnyMsgSmall2: "Working on it...",
    funnyMsgSmall3: "Almost there!! Almost there!!",
    funnyMsgLarge1: "Who taught you to make such a big package? I'm exhausted!!!",
    funnyMsgLarge2: "Too big! Too big! I can't take it!!",
    funnyMsgLarge3: "Thanks for thinking so highly of me~ giving me such a huge chunk~~",
    roleStandard: "Standard User",
    logoutSuccessTitle: "Logged out successfully",
    logoutSuccessDesc: "You have logged out successfully",
    logoutFailedTitle: "Logout failed",
    loadListFailed: "Failed to load list",
    loadFailedTitle: "Load failed",
    loadFailedDesc: "Unable to fetch website list",
    nameEmptyTitle: "Name cannot be empty",
    nameEmptyDesc: "Please enter a valid name",
    savedTitle: "Saved",
    savedDesc: "Website name updated",
    saveFailedTitle: "Save failed",
    saveFailedDesc: "Error updating name",
    deployFailed: "Deployment failed",
    statusUploading: "Uploading",
    statusUnzipping: "Unzipping",
    statusDeploying: "Deploying",
    redeploySuccessTitle: "Redeployment successful",
    redeploySuccessDesc: "Site successfully redeployed",
    redeployFailedTitle: "Redeployment failed",
    redeployFailedDesc: "Error occurred during redeployment",
    save: "Save",
    editName: "Edit Name"
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
  const wid = w.websiteId || "";
  if (wid && wid !== "undefined") return wid;
  const id = w._id || "";
  if (id && id !== "undefined") return id;
  const fn = w.fileName || "";
  if (fn && fn !== "undefined") return fn;
  return "未命名";
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
  if (n && n !== "undefined") return n;
  const wid = w.websiteId || "";
  if (wid && wid !== "undefined") return wid;
  const id = w._id || "";
  if (id && id !== "undefined") return id;
  const fn = w.fileName || "";
  if (fn && fn !== "undefined") return fn;
  return "未命名网站";
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
  const [uploadStatusText, setUploadStatusText] = useState("");
  const [uploadStage, setUploadStage] = useState(0); // 1: Uploading to Cloud, 2: Unzipping, 3: Uploading to COS
  const [funnyMessage, setFunnyMessage] = useState("");
  const [uploadFileSize, setUploadFileSize] = useState(0);
  const [deploying, setDeploying] = useState({});
  const [roleLimits, setRoleLimits] = useState(null);
  const fileInputRef = React.useRef(null);
  const [redeployOpen, setRedeployOpen] = useState(false);
  const [redeployWebsite, setRedeployWebsite] = useState(null);
  const [redeployFile, setRedeployFile] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [websiteToDelete, setWebsiteToDelete] = useState(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isRedeployDragActive, setIsRedeployDragActive] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [allTags, setAllTags] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [editingTagsId, setEditingTagsId] = useState(null);
  const [editingTagsValue, setEditingTagsValue] = useState("");
  const [allUsers, setAllUsers] = useState([]);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const t = translations[lang];
  useEffect(() => {
    checkAuthStatus();
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      loadWebsites();
    }
  }, [isLoggedIn]);

  useEffect(() => {
    let interval;
    if (uploading && uploadFileSize > 0) {
      const sizeMB = uploadFileSize / 1024 / 1024;
      let msgs = [];
      if (sizeMB <= 50) {
        msgs = [t.funnyMsgSmall1, t.funnyMsgSmall2, t.funnyMsgSmall3];
      } else {
        msgs = [
          t.funnyMsgLarge1,
          t.funnyMsgLarge2,
          t.funnyMsgLarge3
        ];
      }

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
            user.role_name = effectiveRole.name || t.roleStandard;
          } else {
            console.warn("No role limits found in database");
            // 禁止默认设置，仅设置角色名称
            user.role_name = t.roleStandard;
          }
        } catch (roleError) {
          console.warn("Fetch user roles failed:", roleError);
          // 忽略错误，降级为普通用户，并尝试获取普通用户限额
          user.roles = ["user"];
          user.role_name = t.roleStandard;

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
              user.role_name = userLimitFnRes.result.data[0].name || t.roleStandard;
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
        title: t.logoutSuccessTitle,
        description: t.logoutSuccessDesc
      });
      navigate("/", { replace: true });
    } catch (error) {
      toast({
        title: t.logoutFailedTitle,
        description: error.message,
        variant: "destructive"
      });
    }
  };

  /**
   * isTokenExpiredError
   * 判断错误是否为凭证过期相关（ACCESS_TOKEN_EXPIRED / invalid_grant 4026）
   */
  const isTokenExpiredError = (error) => {
    const code = error?.code || error?.error_code;
    const msg =
      error?.message || error?.msg || error?.error_description || "";
    return (
      code === "ACCESS_TOKEN_EXPIRED" ||
      code === 4026 ||
      String(msg).includes("ACCESS_TOKEN_EXPIRED") ||
      String(msg).includes("invalid_grant") ||
      String(msg).includes("invalid refresh token")
    );
  };

  /**
   * handleAuthError
   * 统一处理鉴权相关错误；凭证过期时弹框确认刷新页面
   */
  const handleAuthError = (error, fallbackToast = true) => {
    if (isTokenExpiredError(error)) {
      try {
        if (typeof window !== "undefined" && window.showTokenExpiredModal) {
          window.showTokenExpiredModal();
          return;
        }
      } catch {}
    }
    if (fallbackToast) {
      toast({
        title: t.loadFailedTitle,
        description:
          (error && (error.message || error.msg || error.error_description)) ||
          t.loadFailedDesc,
        variant: "destructive"
      });
    }
  };

  /**
   * 加载站点列表：普通用户仅加载自己的，管理员加载所有人的
   */
  const loadWebsites = async () => {
    try {
      const isAdmin = Array.isArray(user?.roles) && user.roles.includes("admin");
      const result = await app.callFunction({
        name: "deploy-website",
        data: isAdmin
          ? { action: "list_all", userId: user?.userId || "" }
          : { action: "list", userId: user?.userId || "" }
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
        
        // 提取所有标签并去重
        const tagsSet = new Set();
        sorted.forEach(w => {
          if (Array.isArray(w.tags)) {
            w.tags.forEach(tag => tagsSet.add(tag));
          }
        });
        setAllTags(Array.from(tagsSet).sort());

        // 管理员解析用户邮箱用于筛选
        if (isAdmin) {
          const uidSet = new Set(sorted.map(w => w.userId).filter(Boolean));
          const uniqueUids = Array.from(uidSet);
          if (uniqueUids.length > 0) {
            try {
              const emailRes = await app.callFunction({
                name: "deploy-website",
                data: { action: "resolve_user_emails", userIds: uniqueUids }
              });
              if (emailRes.result && emailRes.result.success) {
                setAllUsers(emailRes.result.users || []);
              } else {
                setAllUsers(uniqueUids.map(uid => ({ userId: uid, email: "" })));
              }
            } catch {
              setAllUsers(uniqueUids.map(uid => ({ userId: uid, email: "" })));
            }
          } else {
            setAllUsers([]);
          }
        } else {
          setAllUsers([]);
        }
      } else {
        throw new Error(result.result?.message || t.loadListFailed);
      }
    } catch (error) {
      console.error("Failed to load website list:", error);
      handleAuthError(error);
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
        title: t.nameEmptyTitle,
        description: t.nameEmptyDesc,
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
          title: t.savedTitle,
          description: t.savedDesc
        });
      } else {
        throw new Error(res.result?.message || t.saveFailedTitle);
      }
    } catch (error) {
      toast({
        title: t.saveFailedTitle,
        description: error.message || t.saveFailedDesc,
        variant: "destructive"
      });
    }
  };

  /**
   * parseTags
   * 解析逗号分隔的标签字符串为去重后的标签数组
   */
  const parseTags = (str) => {
    if (!str) return [];
    const arr = String(str)
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return Array.from(new Set(arr));
  };

  /**
   * joinTags
   * 将标签数组拼接为逗号分隔的字符串
   */
  const joinTags = (tags) => {
    return (Array.isArray(tags) ? tags : []).join(", ");
  };

  /**
   * startEditTags
   * 开始编辑站点标签
   */
  const startEditTags = (website) => {
    setEditingTagsId(website._id);
    setEditingTagsValue(Array.isArray(website.tags) ? website.tags.join(", ") : "");
  };

  /**
   * cancelEditTags
   * 取消编辑站点标签
   */
  const cancelEditTags = () => {
    setEditingTagsId(null);
    setEditingTagsValue("");
  };

  /**
   * saveEditTags
   * 保存站点标签
   */
  const saveEditTags = async (website) => {
    const tags = parseTags(editingTagsValue);
    
    // 简单验证
    if (tags.length > 20) {
      toast({
        title: "标签过多",
        description: "标签数量不能超过20个",
        variant: "destructive"
      });
      return;
    }

    try {
      const res = await app.callFunction({
        name: "deploy-website",
        data: {
          action: "update_tags",
          docId: website._id,
          userId: user.userId,
          tags
        }
      });

      if (res.result && res.result.success) {
        setWebsites((prev) => {
          const newWebsites = prev.map((w) =>
            w._id === website._id ? { ...w, tags, updatedAt: Date.now() } : w
          );
          
          // 更新全局 tags 列表
          const tagsSet = new Set();
          newWebsites.forEach(w => {
            if (Array.isArray(w.tags)) {
              w.tags.forEach(tag => tagsSet.add(tag));
            }
          });
          setAllTags(Array.from(tagsSet).sort());
          
          return newWebsites;
        });
        
        cancelEditTags();
        toast({
          title: t.savedTitle,
          description: "标签已更新"
        });
      } else {
        throw new Error(res.result?.message || t.saveFailedTitle);
      }
    } catch (error) {
      if (isTokenExpiredError(error)) {
        handleAuthError(error, false);
      } else {
        toast({
          title: t.saveFailedTitle,
          description: error.message || t.saveFailedDesc,
          variant: "destructive"
        });
      }
    }
  };

  /**
   * toggleFilterTag
   * 顶部筛选区：切换选择/取消选择某个标签
   */
  const toggleFilterTag = (tag) => {
    setSelectedTags((prev) => {
      if (prev.includes(tag)) {
        return prev.filter((t) => t !== tag);
      }
      return [...prev, tag];
    });
  };

  /**
   * clearFilterTags
   * 清空已选的筛选标签
   */
  const clearFilterTags = () => setSelectedTags([]);

  /**
   * getEmailByUserId
   * 根据 userId 获取邮箱（不存在则返回空字符串）
   */
  const getEmailByUserId = (uid) => {
    const u = allUsers.find((x) => x.userId === uid);
    return (u && u.email) || "";
  };

  /**
   * getUsersWithEmail
   * 仅保留有邮箱的用户列表（用于筛选下拉框展示）
   */
  const getUsersWithEmail = () => {
    return (allUsers || []).filter((u) => String(u?.email || "").trim());
  };

  /**
   * toggleSelectUserId
   * 切换选择/取消选择某个用户（值为 userId）
   */
  const toggleSelectUserId = (uid) => {
    uid = String(uid || "").trim();
    if (!uid) return;
    setSelectedUserIds((prev) => {
      if (prev.includes(uid)) {
        return prev.filter((e) => e !== uid);
      }
      return [...prev, uid];
    });
  };

  /**
   * clearSelectedUserIds
   * 清空已选用户
   */
  const clearSelectedUserIds = () => setSelectedUserIds([]);

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
    setUploadStatusText("");
    setUploadStage(1);
    setUploadFileSize(file.size);

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

      // Phase 1: Upload to Cloud Storage
      const totalSizeMB = (file.size / 1024 / 1024).toFixed(2);
      setUploadStatusText(`${t.statusUploading} (0MB / ${totalSizeMB}MB)`);
      
      const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const cloudPath = `tmp_uploads/${user.userId}/${taskId}.zip`;

      const uploadResult = await app.uploadFile({
        cloudPath,
        filePath: file,
        onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            const loadedMB = (progressEvent.loaded / 1024 / 1024).toFixed(2);
            const totalMB = (progressEvent.total / 1024 / 1024).toFixed(2);
            setUploadProgress(percentCompleted);
            setUploadStatusText(`${t.statusUploading} (${loadedMB}MB / ${totalMB}MB)`);
        }
      });

      const fileId = uploadResult.fileID;

      // Phase 2: Watch progress
      const watcher = db.collection('ai_builder_task_progress').doc(taskId).watch({
        onChange: (snapshot) => {
            if (snapshot.docs && snapshot.docs.length > 0) {
                const data = snapshot.docs[0];
                if (data.status === 'unzipping') {
                     setUploadStage(2);
                     setUploadStatusText(t.statusUnzipping);
                     setUploadProgress(100); 
                } else if (data.status === 'uploading') {
                     setUploadStage(3);
                     if (data.total > 0) {
                        const percent = Math.floor((data.current / data.total) * 100);
                        setUploadStatusText(`${t.statusDeploying} (${data.current}/${data.total})`);
                        setUploadProgress(percent);
                     }
                }
            }
        },
        onError: (err) => console.error('Watch error', err)
      });

      const deployResult = await app.callFunction({
        name: "deploy-website",
        data: {
          action: "upload_and_deploy",
          fileId,
          taskId,
          userId: user.userId,
          websiteId: websiteId,
          fileName: safeFileName
        }
      });

      watcher.close();

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
        throw new Error(deployResult.result?.message || t.deployFailed);
      }
    } catch (error) {
      console.error("Deployment failed:", error);
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
      setUploadStatusText("");
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

  /**
   * confirmDeleteWebsite
   * 触发删除确认弹窗
   */
  const confirmDeleteWebsite = (websiteId) => {
    const website = websites.find((w) => w._id === websiteId);
    if (website) {
      setWebsiteToDelete(website);
      setDeleteConfirmOpen(true);
    }
  };

  const executeDeleteWebsite = async () => {
    if (!websiteToDelete) return;
    const websiteId = websiteToDelete._id;

    try {
      // 使用云函数删除整站资源（COS + 数据库）
      const result = await app.callFunction({
        name: "deploy-website",
        data: {
          action: "delete",
          userId: websiteToDelete.userId,
          websiteId: websiteToDelete.websiteId || websiteToDelete._id,
          fileName: websiteToDelete.fileName,
          key: websiteToDelete.path // 直接传递数据库中的 path，提高删除准确性
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
        throw new Error(result.result?.message || t.toastDeleteFailedTitle);
      }
    } catch (error) {
      toast({
        title: t.toastDeleteFailedTitle,
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setDeleteConfirmOpen(false);
      setWebsiteToDelete(null);
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
        description: t.toastFileTooLargeDesc(Math.round(
          roleLimits.max_file_size / 1024 / 1024
        )),
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
          title: t.toastExpiredTitle,
          description: t.toastExpiredDesc,
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
          title: t.redeploySuccessTitle,
          description: t.redeploySuccessDesc
        });
        loadWebsites();
      } else {
        throw new Error(deployResult.result?.message || t.redeployFailedTitle);
      }
    } catch (error) {
      setDeploying((prev) => ({ ...prev, [website._id]: false }));
      setWebsites((prev) =>
        prev.map((w) =>
          w._id === website._id ? { ...w, status: "failed" } : w
        )
      );
      toast({
        title: t.redeployFailedTitle,
        description: error.message || t.redeployFailedDesc,
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
              <CardTitle className="text-zinc-100 flex items-center gap-2">
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
                    <span className="px-6 py-2 bg-zinc-100 text-black text-sm font-bold rounded-md hover:bg-zinc-300 transition-colors">
                      {t.uploadButton}
                    </span>
                  )}
                </label>
              </div>

              {uploading && (
                <div className="mt-8 max-w-xl mx-auto">
                  <div className="flex justify-between text-xs font-mono text-zinc-400 mb-2">
                    <span>{uploadStatusText || t.uploadProgressLabel}</span>
                    <span>{uploadProgress}% ({uploadStage}/3) </span>
                  </div>
                  <Progress
                    value={uploadProgress}
                    className="bg-zinc-900 h-2"
                    indicatorClassName={
                        uploadStage === 1 ? "bg-blue-400" :
                        uploadStage === 2 ? "bg-amber-400" :
                        uploadStage === 3 ? "bg-lime-400" : "bg-primary"
                    }
                  />
                  <div className="text-center mt-2 text-xs text-zinc-500 animate-pulse">
                      {funnyMessage}
                  </div>
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
                  className="border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 hover:border-zinc-100"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {t.refresh}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(Array.isArray(user?.roles) && user.roles.includes("admin")) && allUsers.length > 0 && (
                <div className="p-4 border-b border-zinc-900 flex flex-wrap gap-2 items-center bg-zinc-900/10">
                  <span className="text-xs text-zinc-500 mr-2 flex items-center gap-1">
                    <User className="w-3 h-3" />
                    用户:
                  </span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 hover:border-zinc-100"
                      >
                        {selectedUserIds.length === 0 ? "全部用户" : `已选 ${selectedUserIds.length} 人`}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-80" align="start">
                      <Command>
                        <CommandInput placeholder="搜索用户邮箱..." />
                        <CommandList>
                          <CommandEmpty>无匹配用户</CommandEmpty>
                          <CommandGroup heading="用户列表">
                            {getUsersWithEmail().map((u) => {
                              const label = String(u.email || "").trim();
                              const checked = selectedUserIds.includes(u.userId);
                              return (
                                <CommandItem
                                  key={u.userId}
                                  onSelect={() => toggleSelectUserId(u.userId)}
                                >
                                  <span className="truncate">{label}</span>
                                  {checked ? <Check className="ml-auto h-4 w-4 opacity-70" /> : null}
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {selectedUserIds.length > 0 && (
                    <Badge
                      variant="outline"
                      className="ml-2 cursor-pointer text-zinc-400 border-zinc-800 bg-zinc-900/50 hover:text-zinc-200 hover:border-zinc-700"
                      onClick={clearSelectedUserIds}
                    >
                      清空
                    </Badge>
                  )}
                </div>
              )}
              {allTags.length > 0 && (
                <div className="p-4 border-b border-zinc-900 flex flex-wrap gap-2 items-center bg-zinc-900/10">
                  <span className="text-xs text-zinc-500 mr-2 flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    筛选:
                  </span>
                  <Badge
                    variant={selectedTags.length === 0 ? "default" : "outline"}
                    className={`cursor-pointer transition-all ${
                      selectedTags.length === 0
                        ? "bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                        : "text-zinc-400 border-zinc-800 bg-zinc-900/50 hover:text-zinc-200 hover:border-zinc-700"
                    }`}
                    onClick={clearFilterTags}
                  >
                    全部
                  </Badge>
                  {allTags.map((tag) => {
                    const active = selectedTags.includes(tag);
                    return (
                      <Badge
                        key={tag}
                        variant={active ? "default" : "outline"}
                        className={`cursor-pointer transition-all ${
                          active
                            ? "bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                            : "text-zinc-400 border-zinc-800 bg-zinc-900/50 hover:text-zinc-200 hover:border-zinc-700"
                        }`}
                        onClick={() => toggleFilterTag(tag)}
                      >
                        {tag}
                      </Badge>
                    );
                  })}
                  {selectedTags.length > 0 && (
                    <Badge
                      variant="outline"
                      className="ml-2 cursor-pointer text-zinc-400 border-zinc-800 bg-zinc-900/50 hover:text-zinc-200 hover:border-zinc-700"
                      onClick={clearFilterTags}
                    >
                      清空
                    </Badge>
                  )}
                </div>
              )}
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
                {websites
                  .filter(w => {
                    const tagOk = selectedTags.length === 0 || (Array.isArray(w.tags) && w.tags.some((t) => selectedTags.includes(t)));
                    const userOk = selectedUserIds.length === 0 || (w.userId && selectedUserIds.includes(w.userId));
                    return tagOk && userOk;
                  })
                  .length === 0 && (
                    <div className="text-center py-12">
                      <p className="text-zinc-500 text-sm">
                        未找到包含标签 [{selectedTags.join(", ")}] 的项目
                      </p>
                    </div>
                  )}
                {websites
                  .filter(w => {
                    const tagOk = selectedTags.length === 0 || (Array.isArray(w.tags) && w.tags.some((t) => selectedTags.includes(t)));
                    const userOk = selectedUserIds.length === 0 || (w.userId && selectedUserIds.includes(w.userId));
                    return tagOk && userOk;
                  })
                  .map((website) => (
                  <div
                    key={website._id}
                    className="p-6 hover:bg-zinc-900/20 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 group"
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
                              </>
                            )}
                          </div>
                          {getStatusBadge(website.status)}
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
                                  if (e.key === 'Enter') saveEditTags(website);
                                  if (e.key === 'Escape') cancelEditTags();
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
                                        const next = parseTags(editingTagsValue).filter((t) => t !== tag);
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
                                    <span key={idx} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-700 transition-colors cursor-default">
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
                        <TooltipProvider delayDuration={0}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={-1}>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    if (website.status === 'processing' || deploying[website._id]) return;
                                    openRedeployDialog(website);
                                  }}
                                  className={`border-zinc-800 bg-zinc-900 text-zinc-400 ${
                                    (website.status === 'processing' || deploying[website._id]) 
                                      ? "opacity-50 cursor-not-allowed" 
                                      : "hover:bg-zinc-100 hover:text-zinc-900 hover:border-zinc-100"
                                  }`}
                                >
                                  <Upload className="w-4 h-4 mr-2" />
                                  {t.redeployButton}
                                </Button>
                              </span>
                            </TooltipTrigger>
                            {(website.status === 'processing' || deploying[website._id]) && (
                              <TooltipContent className="bg-zinc-100 text-zinc-900 border-zinc-200 font-bold">
                                <p>{t.redeployDisabledTooltip}</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>

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
                    className="border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 hover:border-zinc-100"
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
                    className="border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 hover:border-zinc-100"
                    disabled={!redeployFile}
                    onClick={submitRedeploy}
                  >
                    {t.confirmUpload}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          
          <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
            <AlertDialogContent className="bg-zinc-900 border-zinc-800">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-zinc-100">{t.deleteConfirmTitle}</AlertDialogTitle>
                <AlertDialogDescription className="text-zinc-400">
                  {t.deleteConfirmDesc}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100">
                  {t.cancel}
                </AlertDialogCancel>
                <AlertDialogAction 
                  className="bg-red-900/30 text-red-500 border border-red-900 hover:bg-red-900/50 hover:text-red-400"
                  onClick={executeDeleteWebsite}
                >
                  {t.deleteConfirmButton}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

        </div>

        {/* Background Grid Effect */}
        <div className="fixed inset-0 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] -z-10 pointer-events-none" />
      </div>
    </MainLayout>
  );
}
