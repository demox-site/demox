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
  useToast
} from "@/components/ui";
// @ts-ignore;
import {
  Upload,
  Cloud,
  Globe,
  Trash2,
  ExternalLink,
  Plus,
  LogOut,
  User,
  FolderOpen,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw
} from "lucide-react";
import { app, auth, db } from "../cloudbase";
import { useNavigate, Navigate } from "react-router-dom";

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
 * Home
 * 用户登录、上传、部署、列表、删除的主页面
 * 剔除 Weda 相关依赖，统一通过云函数与后端交互
 */
export default function Home(props) {
  const { style } = props;
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [websites, setWebsites] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deploying, setDeploying] = useState({});
  const [roleLimits, setRoleLimits] = useState(null);
  const fileInputRef = React.useRef(null);
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
          console.log(candidateRoles)
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
             console.warn("Cloud function getRoleLimits failed:", limitFnRes.result);
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
            
            if (userLimitFnRes.result && userLimitFnRes.result.code === 0 && userLimitFnRes.result.data.length > 0) {
                setRoleLimits(userLimitFnRes.result.data[0]);
                user.role_name = userLimitFnRes.result.data[0].name || "普通用户";
            }
          } catch (limitError) {
            console.warn("Fallback fetch 'user' role limit failed:", limitError);
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
        setWebsites(mapped);
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
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.name.endsWith(".zip")) {
      toast({
        title: "文件格式错误",
        description: "请上传 .zip 格式的压缩包",
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
          title: "达到部署限制",
          description: `您当前角色的部署上限为 ${roleLimits.deployment_limit} 个`,
          variant: "destructive"
        });
        return;
      }
      if (
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
    }

    setUploading(true);
    setUploadProgress(0);
    let websiteId = null;

    try {
      // 确保存在登录态；若无则跳转回首页
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
      const cloudPath = `websites/${user.userId}/${Date.now()}_${safeFileName}`;

      // 生成 websiteId，并先更新本地状态
      websiteId = generateWebsiteId();
      const websiteData = {
        userId: user.userId,
        userName: user.nickName || user.name,
        fileName: safeFileName,
        status: "processing",
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      setWebsites((prev) => [{ _id: websiteId, ...websiteData }, ...prev]);
      setDeploying((prev) => ({ ...prev, [websiteId]: true }));

      // 将文件读取为 Base64，交由云函数上传并部署
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
        // 部署成功后直接刷新列表（从 resource-game 集合查询）
        toast({
          title: "部署成功",
          description: "网站已成功部署并可以访问"
        });

        // 重新加载网站列表
        loadWebsites();
      } else {
        throw new Error(deployResult.result?.message || "部署失败");
      }
    } catch (error) {
      console.error("部署失败:", error);
      
      if (websiteId) {
        // 更新状态为失败
        setWebsites((prev) => 
          prev.map(w => 
            w._id === websiteId 
              ? { ...w, status: "failed" } 
              : w
          )
        );
        
        setDeploying((prev) => ({
          ...prev,
          [websiteId]: false
        }));
      }

      toast({
        title: "部署失败",
        description: error.message || "部署过程中出现错误，请重试",
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
          title: "删除成功",
          description: "网站已成功删除"
        });
        // 从本地状态中移除
        setWebsites((prev) => prev.filter((w) => w._id !== websiteId));
      } else {
        throw new Error(result.result?.message || "删除失败");
      }
    } catch (error) {
      toast({
        title: "删除失败",
        description: error.message,
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
            Deployed
          </Badge>
        );
      case "processing":
        return (
          <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 border">
            <Clock className="w-3 h-3 mr-1" />
            Deploying
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/10 text-red-500 border-red-500/20 border">
            <XCircle className="w-3 h-3 mr-1" />
            Failed
          </Badge>
        );
      default:
        return (
          <Badge className="bg-zinc-500/10 text-zinc-500 border-zinc-500/20 border">
            <AlertCircle className="w-3 h-3 mr-1" />
            Unknown
          </Badge>
        );
    }
  };

  if (isLoading) {
    return (
      <div
        style={style}
        className="min-h-screen bg-black text-zinc-100 font-sans flex items-center justify-center"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-zinc-800 border-t-zinc-100 rounded-full animate-spin"></div>
          <span className="text-zinc-500 font-mono text-sm animate-pulse">
            Loading...
          </span>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/" replace />;
  }

  return (
    <div
      style={style}
      className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white"
    >
      <div className="container mx-auto px-4 py-8 relative z-10">
        {/* Header */}
        <div className="flex justify-between items-center mb-12 border-b border-zinc-800 pb-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-zinc-100 rounded-sm flex items-center justify-center">
              <span className="text-black text-sm font-bold">C</span>
            </div>
            <span className="text-xl font-bold tracking-tight">
              CloudHost<span className="animate-pulse">_</span>
            </span>
          </div>
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-3 bg-zinc-900/50 px-4 py-2 rounded-full border border-zinc-800">
              <Avatar className="w-8 h-8">
                <AvatarImage src={user?.avatarUrl} />
                <AvatarFallback className="bg-zinc-700 text-zinc-300 text-xs">
                  {(user?.nickName ||
                    user?.email ||
                    user?.name ||
                    "U")[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col text-left">
                <span className="text-zinc-300 text-sm font-mono leading-tight">
                  {user?.nickName || user?.email || user?.name || "User"}
                </span>
                <span className="text-[10px] text-zinc-500 font-mono font-bold leading-tight mt-0.5">
                  {user?.role_name || "普通用户"}
                </span>
              </div>
            </div>
            <Button
              onClick={handleLogout}
              variant="ghost"
              className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>

        {/* Upload Section */}
        <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm mb-12 overflow-hidden relative group">
          <div className="absolute inset-0 bg-gradient-to-r from-zinc-900/20 to-transparent pointer-events-none" />
          <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
            <CardTitle className="text-zinc-100 flex items-center gap-2">
              <Upload className="w-5 h-5 text-zinc-400" />
              Deploy New Project
              {roleLimits && (
                <span className="text-xs text-zinc-500 font-mono ml-2 font-normal">
                  (最大:{" "}
                  {roleLimits.max_file_size
                    ? Math.round(roleLimits.max_file_size / 1024 / 1024) + "MB"
                    : "无限"}
                  , 文件数:{" "}
                  {roleLimits.max_file_count
                    ? roleLimits.max_file_count
                    : "无限"}
                  )
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8">
            <div className="border-2 border-dashed border-zinc-800 rounded-lg p-12 text-center hover:border-zinc-600 transition-colors bg-zinc-900/20 group-hover:bg-zinc-900/30">
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
                  {uploading ? "Uploading..." : "Drop your project here"}
                </h3>
                <p className="text-zinc-500 mb-6 max-w-sm mx-auto">
                  Support .zip file containing an index.html in the root
                  directory.
                </p>
                {!uploading && (
                  <span className="px-6 py-2 bg-zinc-100 text-black text-sm font-bold rounded-md hover:bg-zinc-300 transition-colors">
                    Select File
                  </span>
                )}
              </label>
            </div>

            {uploading && (
              <div className="mt-8 max-w-xl mx-auto">
                <div className="flex justify-between text-xs font-mono text-zinc-400 mb-2">
                  <span>UPLOADING</span>
                  <span>{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="bg-zinc-900 h-2" />
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
                Deployments
                {roleLimits && (
                  <span className="text-sm text-zinc-500 font-mono ml-2">
                    ({websites.length}/
                    {(roleLimits.deployment_limit === null || roleLimits.deployment_limit === undefined)
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
                Refresh
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {websites.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-full bg-zinc-900/50 flex items-center justify-center mx-auto mb-4 border border-zinc-800">
                  <Globe className="w-8 h-8 text-zinc-600" />
                </div>
                <p className="text-zinc-400 font-medium">No deployments yet</p>
                <p className="text-zinc-600 text-sm mt-2">
                  Upload your first project to get started.
                </p>
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
                        <h3 className="text-zinc-100 font-bold truncate">
                          {website.fileName}
                        </h3>
                        {getStatusBadge(website.status)}
                        {deploying[website._id] && (
                          <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                            <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                            Processing
                          </Badge>
                        )}
                      </div>

                      <div className="flex flex-col sm:flex-row gap-4 text-sm text-zinc-500 font-mono mt-3">
                        <span>
                          Created:{" "}
                          {new Date(website.createdAt).toLocaleDateString()}
                        </span>
                        {website.deployedAt && (
                          <span>
                            Deployed:{" "}
                            {new Date(website.deployedAt).toLocaleDateString()}
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

        {/* Background Grid Effect */}
        <div className="fixed inset-0 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] -z-10 pointer-events-none" />
      </div>
    </div>
  );
}
