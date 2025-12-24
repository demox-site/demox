// @ts-ignore;
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
import cloudbase from "@cloudbase/js-sdk";
import env from "../configs/env";
import { AuthDialog } from "@/components/AuthDialog";

// 初始化 CloudBase
const app = cloudbase.init({
  env: env.env
});
const auth = app.auth();

export default function Home(props) {
  const { $w, style } = props;
  const { toast } = useToast();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [websites, setWebsites] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deploying, setDeploying] = useState({});
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const fileInputRef = React.useRef(null);
  useEffect(() => {
    checkAuthStatus();
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      loadWebsites();
    }
  }, [isLoggedIn]);

  const checkAuthStatus = async () => {
    try {
      const loginState = await auth.getLoginState();

      // 只有在明确已登录且不是匿名登录的情况下才认为是已登录
      if (
        loginState &&
        loginState.user &&
        loginState.loginType !== "ANONYMOUS"
      ) {
        // 使用 CloudBase SDK 的用户对象，适配 Weda 字段
        const user = {
          ...loginState.user,
          userId: loginState.user.uid,
          openId: loginState.user.uid, // 适配 openId
          nickName: loginState.user.nickName,
          email: loginState.user.email
        };
        setIsLoggedIn(true);
        setUser(user);
      } else {
        // 如果是匿名登录，强制退出
        if (loginState && loginState.loginType === "ANONYMOUS") {
          await auth.signOut();
        }
        setIsLoggedIn(false);
        setUser(null);
      }
    } catch (e) {
      console.warn("Auth check failed:", e);
      setIsLoggedIn(false);
      setUser(null);
    }
  };
  const handleLogin = () => {
    setIsLoginOpen(true);
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
    } catch (error) {
      toast({
        title: "退出失败",
        description: error.message,
        variant: "destructive"
      });
    }
  };
  const loadWebsites = async () => {
    try {
      const result = await $w.cloud.callDataSource({
        dataSourceName: "websites",
        methodName: "wedaGetRecordsV2",
        params: {
          filter: {
            where: {
              userId: {
                $eq: user?.userId || ""
              }
            }
          },
          select: {
            $master: true
          },
          orderBy: [
            {
              createdAt: "desc"
            }
          ],
          getCount: true,
          pageSize: 50,
          pageNumber: 1
        }
      });
      setWebsites(result.records || []);
    } catch (error) {
      console.error("加载网站列表失败:", error);
      // 如果数据源不存在，提示用户
      if (
        error.code === "PERMISSION_DENIED" ||
        error.message.includes("数据源不存在")
      ) {
        toast({
          title: "数据源未配置",
          description: "请联系管理员创建 websites 数据模型",
          variant: "destructive"
        });
      }
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
    setUploading(true);
    setUploadProgress(0);
    try {
      // 上传文件到云存储
      const uploadResult = await app.uploadFile({
        cloudPath: `websites/${user.userId}/${Date.now()}_${file.name}`,
        filePath: file,
        onUploadProgress: (progress) => {
          setUploadProgress(
            Math.round((progress.loaded / progress.total) * 100)
          );
        }
      });

      // 保存网站信息到数据库
      const websiteData = {
        userId: user.userId,
        userName: user.nickName || user.name,
        fileName: file.name,
        fileId: uploadResult.fileID,
        status: "processing",
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const createResult = await $w.cloud.callDataSource({
        dataSourceName: "websites",
        methodName: "wedaCreateV2",
        params: {
          data: websiteData
        }
      });
      const websiteId = createResult.id;

      // 更新本地状态
      setWebsites((prev) => [
        {
          _id: websiteId,
          ...websiteData
        },
        ...prev
      ]);
      toast({
        title: "上传成功",
        description: "文件已上传，正在处理部署..."
      });

      // 调用云函数处理部署
      setDeploying((prev) => ({
        ...prev,
        [websiteId]: true
      }));
      const deployResult = await app.callFunction({
        name: "deploy-website",
        data: {
          fileId: uploadResult.fileID,
          userId: user.userId,
          websiteId: websiteId,
          fileName: file.name
        }
      });
      setDeploying((prev) => ({
        ...prev,
        [websiteId]: false
      }));
      if (deployResult.result && deployResult.result.success) {
        // 更新数据库中的部署信息
        await $w.cloud.callDataSource({
          dataSourceName: "Websites",
          methodName: "wedaUpdateV2",
          params: {
            filter: {
              where: {
                _id: {
                  $eq: websiteId
                }
              }
            },
            data: {
              status: "deployed",
              url: deployResult.result.url,
              websitePath: deployResult.result.websitePath,
              deployedAt: Date.now(),
              updatedAt: Date.now()
            }
          }
        });
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

      // 删除云存储文件
      if (website.fileId) {
        await app.deleteFile({
          fileList: [website.fileId]
        });
      }

      // 删除数据库记录
      await $w.cloud.callDataSource({
        dataSourceName: "Websites",
        methodName: "wedaDeleteV2",
        params: {
          filter: {
            where: {
              _id: {
                $eq: websiteId
              }
            }
          }
        }
      });
      toast({
        title: "删除成功",
        description: "网站已成功删除"
      });

      // 从本地状态中移除
      setWebsites((prev) => prev.filter((w) => w._id !== websiteId));
    } catch (error) {
      toast({
        title: "删除失败",
        description: error.message,
        variant: "destructive"
      });
    }
  };
  const handleRedeploy = async (website) => {
    try {
      setDeploying((prev) => ({
        ...prev,
        [website._id]: true
      }));
      const deployResult = await app.callFunction({
        name: "deploy-website",
        data: {
          fileId: website.fileId,
          userId: website.userId,
          websiteId: website._id,
          fileName: website.fileName
        }
      });
      setDeploying((prev) => ({
        ...prev,
        [website._id]: false
      }));
      if (deployResult.result && deployResult.result.success) {
        // 更新数据库中的部署信息
        await $w.cloud.callDataSource({
          dataSourceName: "Websites",
          methodName: "wedaUpdateV2",
          params: {
            filter: {
              where: {
                _id: {
                  $eq: website._id
                }
              }
            },
            data: {
              status: "deployed",
              url: deployResult.result.url,
              websitePath: deployResult.result.websitePath,
              deployedAt: Date.now(),
              updatedAt: Date.now()
            }
          }
        });
        toast({
          title: "重新部署成功",
          description: "网站已重新部署"
        });
        loadWebsites();
      } else {
        throw new Error(deployResult.result?.message || "重新部署失败");
      }
    } catch (error) {
      setDeploying((prev) => ({
        ...prev,
        [website._id]: false
      }));
      toast({
        title: "重新部署失败",
        description: error.message,
        variant: "destructive"
      });
    }
  };
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
  if (!isLoggedIn) {
    return (
      <div
        style={style}
        className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white"
      >
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-4xl mx-auto text-center">
            <div className="mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-800 bg-zinc-900/50 mb-8">
                <span className="flex h-2 w-2 rounded-full bg-zinc-400 animate-pulse"></span>
                <span className="text-xs font-mono text-zinc-400">
                  CloudHost v2.0
                </span>
              </div>
              <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-zinc-100 to-zinc-500">
                Deploy Static Sites.
                <br />
                <span className="text-white">Instantly.</span>
              </h1>
              <p className="text-lg md:text-xl text-zinc-400 mb-10 max-w-2xl mx-auto leading-relaxed">
                Drag, drop, global CDN. No config required. Designed for
                developers who want speed without the hassle.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6 text-left mb-16">
              {[
                {
                  icon: <User className="text-zinc-100" size={24} />,
                  title: "1. Register & Login",
                  desc: "Quick sign up to start your cloud journey."
                },
                {
                  icon: <Upload className="text-zinc-100" size={24} />,
                  title: "2. Upload Code",
                  desc: "Upload your static website zip file."
                },
                {
                  icon: <Globe className="text-zinc-100" size={24} />,
                  title: "3. Visit Instantly",
                  desc: "Get a public URL and go live immediately."
                }
              ].map((item, i) => (
                <div
                  key={i}
                  className="p-6 rounded-lg border border-zinc-900 bg-zinc-950/50 hover:border-zinc-700 transition-colors group"
                >
                  <div className="w-12 h-12 rounded-lg bg-zinc-900 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    {item.icon}
                  </div>
                  <h3 className="text-xl font-semibold mb-2 text-zinc-100">
                    {item.title}
                  </h3>
                  <p className="text-zinc-400 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>

            <Button
              onClick={handleLogin}
              className="w-full sm:w-auto px-8 py-3 bg-zinc-100 text-black font-semibold rounded-md hover:-translate-y-1 transition-transform duration-300 shadow-[0_0_15px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)]"
            >
              Login to Deploy
            </Button>

            <AuthDialog
              isOpen={isLoginOpen}
              onOpenChange={setIsLoginOpen}
              onLoginSuccess={checkAuthStatus}
            />
          </div>
        </div>

        {/* Background Grid Effect */}
        <div className="fixed inset-0 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] -z-10 pointer-events-none" />
      </div>
    );
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
              <Avatar className="w-6 h-6">
                <AvatarImage src={user?.avatarUrl} />
                <AvatarFallback className="bg-zinc-700 text-zinc-300 text-xs">
                  {(user?.nickName ||
                    user?.email ||
                    user?.name ||
                    "U")[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-zinc-300 text-sm font-mono">
                {user?.nickName || user?.email || user?.name || "User"}
              </span>
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
                      {website.status === "failed" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRedeploy(website)}
                          className="border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 bg-transparent"
                          disabled={deploying[website._id]}
                        >
                          <RefreshCw className="w-4 h-4" />
                        </Button>
                      )}
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
