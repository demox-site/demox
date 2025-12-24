// @ts-ignore;
import React, { useState, useEffect } from 'react';
// @ts-ignore;
import { Button, Card, CardContent, CardHeader, CardTitle, Alert, AlertDescription, AlertTitle, Avatar, AvatarFallback, AvatarImage, Progress, Badge, useToast, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, Input, Label } from '@/components/ui';
// @ts-ignore;
import { Upload, Cloud, Globe, Trash2, ExternalLink, Plus, LogOut, User, FolderOpen, Clock, CheckCircle, XCircle, AlertCircle, RefreshCw } from 'lucide-react';
import cloudbase from "@cloudbase/js-sdk";
import env from '../configs/env';

// 初始化 CloudBase
const app = cloudbase.init({
  env: env.env
});
const auth = app.auth();

export default function Home(props) {
  const {
    $w,
    style
  } = props;
  const {
    toast
  } = useToast();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [websites, setWebsites] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deploying, setDeploying] = useState({});
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationId, setVerificationId] = useState('');
  const [countdown, setCountdown] = useState(0);
  const fileInputRef = React.useRef(null);
  useEffect(() => {
    checkAuthStatus();
  }, []);

  useEffect(() => {
    let timer;
    if (countdown > 0) {
      timer = setInterval(() => {
        setCountdown(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (isLoggedIn) {
      loadWebsites();
    }
  }, [isLoggedIn]);

  const checkAuthStatus = async () => {
    try {
      const loginState = await auth.getLoginState();
      
      // 只有在明确已登录且不是匿名登录的情况下才认为是已登录
      if (loginState && loginState.user && loginState.loginType !== 'ANONYMOUS') {
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
        if (loginState && loginState.loginType === 'ANONYMOUS') {
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

  const handleSendCode = async () => {
    if (!email) {
      toast({ title: "请输入邮箱", variant: "destructive" });
      return;
    }
    try {
      const result = await auth.getVerification({ email });
      if (result && result.verification_id) {
        setVerificationId(result.verification_id);
        toast({ title: "验证码已发送", description: "请前往邮箱查收" });
        setCountdown(60);
      } else {
        // 某些情况下可能不返回 ID，但通常应该返回
        toast({ title: "发送请求已提交", description: "请检查邮箱" });
        setCountdown(60);
      }
    } catch (error) {
      console.error(error);
      toast({
        title: "发送失败",
        description: error.message || "请稍后重试",
        variant: "destructive"
      });
    }
  };

  const handleEmailAuth = async () => {
    if (!email || !password) {
      toast({ title: "请输入邮箱和密码", variant: "destructive" });
      return;
    }
    try {
      if (isRegister) {
        if (!verificationCode) {
            toast({ title: "请输入验证码", variant: "destructive" });
            return;
        }
        if (!verificationId) {
            toast({ title: "请先发送验证码", variant: "destructive" });
            return;
        }

        // 1. 验证验证码获取 token
        const verifyResult = await auth.verify({
            verification_id: verificationId,
            verification_code: verificationCode
        });

        if (!verifyResult || !verifyResult.verification_token) {
             throw new Error("验证失败，未获取到令牌");
        }

        // 2. 使用 token 注册
        await auth.signUp({
            email,
            password,
            verification_token: verifyResult.verification_token
        });
        
        toast({ 
          title: "注册成功", 
          description: "已为您自动登录" 
        });
        
        // 注册成功后，通常会自动登录，检查状态
        await checkAuthStatus();
        setIsLoginOpen(false);
        setIsRegister(false);
      } else {
        // 登录流程：使用邮箱和密码登录
        await auth.signIn({
            username: email,
            password
        });
        
        await checkAuthStatus();
        setIsLoginOpen(false);
        toast({ title: "登录成功" });
      }
    } catch (error) {
      console.error(error);
      let errorMsg = error.message;
      // 优化错误提示
      if (error.code === 'CHECK_LOGIN_FAILED') {
          errorMsg = "邮箱或密码错误";
      } else if (error.code === 'INVALID_USERNAME_OR_PASSWORD') {
          errorMsg = "邮箱或密码错误";
      }
      
      toast({
        title: isRegister ? "注册失败" : "登录失败",
        description: errorMsg || "请检查信息是否正确",
        variant: "destructive"
      });
    }
  };
  const handleLogout = async () => {
    try {
      try {
        await auth.signOut();
      } catch (err) {
        // 忽略匿名登录被禁用的错误
        if (err?.code !== 'login_type_disabled' && err?.error !== 'login_type_disabled') {
          console.warn('SignOut error:', err);
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
        dataSourceName: 'websites',
        methodName: 'wedaGetRecordsV2',
        params: {
          filter: {
            where: {
              userId: {
                $eq: user?.userId || ''
              }
            }
          },
          select: {
            $master: true
          },
          orderBy: [{
            createdAt: 'desc'
          }],
          getCount: true,
          pageSize: 50,
          pageNumber: 1
        }
      });
      setWebsites(result.records || []);
    } catch (error) {
      console.error('加载网站列表失败:', error);
      // 如果数据源不存在，提示用户
      if (error.code === 'PERMISSION_DENIED' || error.message.includes('数据源不存在')) {
        toast({
          title: "数据源未配置",
          description: "请联系管理员创建 websites 数据模型",
          variant: "destructive"
        });
      }
    }
  };
  const handleFileUpload = async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.name.endsWith('.zip')) {
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
        onUploadProgress: progress => {
          setUploadProgress(Math.round(progress.loaded / progress.total * 100));
        }
      });

      // 保存网站信息到数据库
      const websiteData = {
        userId: user.userId,
        userName: user.nickName || user.name,
        fileName: file.name,
        fileId: uploadResult.fileID,
        status: 'processing',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const createResult = await $w.cloud.callDataSource({
        dataSourceName: 'websites',
        methodName: 'wedaCreateV2',
        params: {
          data: websiteData
        }
      });
      const websiteId = createResult.id;

      // 更新本地状态
      setWebsites(prev => [{
        _id: websiteId,
        ...websiteData
      }, ...prev]);
      toast({
        title: "上传成功",
        description: "文件已上传，正在处理部署..."
      });

      // 调用云函数处理部署
      setDeploying(prev => ({
        ...prev,
        [websiteId]: true
      }));
      const deployResult = await app.callFunction({
        name: 'deploy-website',
        data: {
          fileId: uploadResult.fileID,
          userId: user.userId,
          websiteId: websiteId,
          fileName: file.name
        }
      });
      setDeploying(prev => ({
        ...prev,
        [websiteId]: false
      }));
      if (deployResult.result && deployResult.result.success) {
        // 更新数据库中的部署信息
        await $w.cloud.callDataSource({
          dataSourceName: 'Websites',
          methodName: 'wedaUpdateV2',
          params: {
            filter: {
              where: {
                _id: {
                  $eq: websiteId
                }
              }
            },
            data: {
              status: 'deployed',
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
        throw new Error(deployResult.result?.message || '部署失败');
      }
    } catch (error) {
      console.error('部署失败:', error);
      toast({
        title: "部署失败",
        description: error.message || "部署过程中出现错误，请重试",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };
  const handleDeleteWebsite = async websiteId => {
    try {
      const website = websites.find(w => w._id === websiteId);
      if (!website) return;

      // 删除云存储文件
      if (website.fileId) {
        await app.deleteFile({
          fileList: [website.fileId]
        });
      }

      // 删除数据库记录
      await $w.cloud.callDataSource({
        dataSourceName: 'Websites',
        methodName: 'wedaDeleteV2',
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
      setWebsites(prev => prev.filter(w => w._id !== websiteId));
    } catch (error) {
      toast({
        title: "删除失败",
        description: error.message,
        variant: "destructive"
      });
    }
  };
  const handleRedeploy = async website => {
    try {
      setDeploying(prev => ({
        ...prev,
        [website._id]: true
      }));
      const deployResult = await app.callFunction({
        name: 'deploy-website',
        data: {
          fileId: website.fileId,
          userId: website.userId,
          websiteId: website._id,
          fileName: website.fileName
        }
      });
      setDeploying(prev => ({
        ...prev,
        [website._id]: false
      }));
      if (deployResult.result && deployResult.result.success) {
        // 更新数据库中的部署信息
        await $w.cloud.callDataSource({
          dataSourceName: 'Websites',
          methodName: 'wedaUpdateV2',
          params: {
            filter: {
              where: {
                _id: {
                  $eq: website._id
                }
              }
            },
            data: {
              status: 'deployed',
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
        throw new Error(deployResult.result?.message || '重新部署失败');
      }
    } catch (error) {
      setDeploying(prev => ({
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
  const getStatusBadge = status => {
    switch (status) {
      case 'deployed':
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />已部署</Badge>;
      case 'processing':
        return <Badge className="bg-blue-100 text-blue-800"><Clock className="w-3 h-3 mr-1" />部署中</Badge>;
      case 'failed':
        return <Badge className="bg-red-100 text-red-800"><XCircle className="w-3 h-3 mr-1" />部署失败</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800"><AlertCircle className="w-3 h-3 mr-1" />未知</Badge>;
    }
  };
  if (!isLoggedIn) {
    return <div style={style} className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
            <div className="container mx-auto px-4 py-16">
              <div className="max-w-4xl mx-auto text-center">
                <div className="mb-8">
                  <Cloud className="w-20 h-20 mx-auto text-blue-400 mb-4" />
                  <h1 className="text-5xl font-bold text-white mb-4 font-mono">CloudHost</h1>
                  <p className="text-xl text-blue-200 mb-8">共享云资源平台 - 轻松部署您的静态网站</p>
                </div>
                
                <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm mb-8">
                  <CardContent className="p-8">
                    <h2 className="text-2xl font-semibold text-white mb-6">开始使用</h2>
                    <div className="grid md:grid-cols-3 gap-6 text-left">
                      <div className="text-center">
                        <div className="w-12 h-12 bg-blue-500 rounded-lg flex items-center justify-center mx-auto mb-3">
                          <User className="w-6 h-6 text-white" />
                        </div>
                        <h3 className="text-white font-semibold mb-2">1. 注册登录</h3>
                        <p className="text-slate-400 text-sm">快速注册账号，开始您的云端之旅</p>
                      </div>
                      <div className="text-center">
                        <div className="w-12 h-12 bg-blue-500 rounded-lg flex items-center justify-center mx-auto mb-3">
                          <Upload className="w-6 h-6 text-white" />
                        </div>
                        <h3 className="text-white font-semibold mb-2">2. 上传代码</h3>
                        <p className="text-slate-400 text-sm">上传您的静态网站压缩包</p>
                      </div>
                      <div className="text-center">
                        <div className="w-12 h-12 bg-blue-500 rounded-lg flex items-center justify-center mx-auto mb-3">
                          <Globe className="w-6 h-6 text-white" />
                        </div>
                        <h3 className="text-white font-semibold mb-2">3. 立即访问</h3>
                        <p className="text-slate-400 text-sm">获得公网访问URL，即刻上线</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Button onClick={handleLogin} className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 text-lg font-mono">
                  立即登录
                </Button>

                <Dialog open={isLoginOpen} onOpenChange={setIsLoginOpen}>
                  <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                      <DialogTitle>{isRegister ? '注册账号' : '登录账号'}</DialogTitle>
                      <DialogDescription>
                        {isRegister ? '请输入您的邮箱、密码和验证码进行注册。' : '请输入您的邮箱和密码进行登录。'}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2 text-left">
                        <Label htmlFor="email">邮箱</Label>
                        <Input
                          id="email"
                          placeholder="name@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </div>
                      <div className="grid gap-2 text-left">
                        <Label htmlFor="password">密码</Label>
                        <Input
                          id="password"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </div>
                      {isRegister && (
                        <div className="grid gap-2 text-left">
                          <Label htmlFor="code">验证码</Label>
                          <div className="flex gap-2">
                            <Input
                              id="code"
                              placeholder="6位验证码"
                              value={verificationCode}
                              onChange={(e) => setVerificationCode(e.target.value)}
                            />
                            <Button 
                                variant="outline" 
                                onClick={handleSendCode}
                                disabled={countdown > 0}
                                type="button"
                            >
                                {countdown > 0 ? `${countdown}s` : '发送'}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-4">
                      <Button onClick={handleEmailAuth} className="w-full">
                        {isRegister ? '注册' : '登录'}
                      </Button>
                      <div className="text-center text-sm">
                        <span className="text-gray-500">
                          {isRegister ? '已有账号？' : '还没有账号？'}
                        </span>
                        <Button
                          variant="link"
                          className="p-0 h-auto ml-1"
                          onClick={() => setIsRegister(!isRegister)}
                        >
                          {isRegister ? '去登录' : '去注册'}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </div>;
  }
  return <div style={style} className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
          <div className="container mx-auto px-4 py-8">
            {/* Header */}
            <div className="flex justify-between items-center mb-8">
              <div className="flex items-center space-x-4">
                <Cloud className="w-8 h-8 text-blue-400" />
                <h1 className="text-3xl font-bold text-white font-mono">CloudHost</h1>
              </div>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={user?.avatarUrl} />
                    <AvatarFallback className="bg-slate-700 text-white">
                      {(user?.nickName || user?.email || user?.name || 'U')[0].toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-white">{user?.nickName || user?.email || user?.name || 'User'}</span>
                </div>
                <Button onClick={handleLogout} className="bg-white text-black hover:bg-gray-200">
                  <LogOut className="w-4 h-4 mr-2" />
                  退出
                </Button>
              </div>
            </div>

            {/* Upload Section */}
            <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm mb-8">
              <CardHeader>
                <CardTitle className="text-white flex items-center">
                  <Upload className="w-5 h-5 mr-2" />
                  上传新网站
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center">
                  <input ref={fileInputRef} type="file" accept=".zip" onChange={handleFileUpload} className="hidden" id="file-upload" disabled={uploading} />
                  <label htmlFor="file-upload" className={`cursor-pointer ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <FolderOpen className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                    <p className="text-white mb-2">
                      {uploading ? '正在上传...' : '点击或拖拽上传静态网站压缩包'}
                    </p>
                    <p className="text-slate-400 text-sm">支持 .zip 格式，必须包含根目录的 index.html 文件</p>
                  </label>
                </div>
                
                {uploading && <div className="mt-4">
                    <div className="flex justify-between text-sm text-white mb-2">
                      <span>上传进度</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <Progress value={uploadProgress} className="bg-slate-700" />
                  </div>}
              </CardContent>
            </Card>

            {/* Websites List */}
            <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-white flex items-center justify-between">
                  <div className="flex items-center">
                    <Globe className="w-5 h-5 mr-2" />
                    我的网站
                  </div>
                  <Button size="sm" onClick={loadWebsites} className="bg-white text-black hover:bg-gray-200">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    刷新
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {websites.length === 0 ? <div className="text-center py-8">
                    <Globe className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                    <p className="text-slate-400">还没有上传任何网站</p>
                    <p className="text-slate-500 text-sm mt-2">上传您的第一个静态网站开始使用吧</p>
                  </div> : <div className="space-y-4">
                    {websites.map(website => <div key={website._id} className="bg-slate-700/50 rounded-lg p-4 flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <h3 className="text-white font-semibold">{website.fileName}</h3>
                            {getStatusBadge(website.status)}
                            {deploying[website._id] && <Badge className="bg-yellow-100 text-yellow-800"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />处理中</Badge>}
                          </div>
                          <p className="text-slate-400 text-sm">
                            上传时间: {new Date(website.createdAt).toLocaleString()}
                          </p>
                          {website.deployedAt && <p className="text-slate-400 text-sm">
                            部署时间: {new Date(website.deployedAt).toLocaleString()}
                          </p>}
                          {website.url && <div className="flex items-center space-x-2 mt-2">
                              <span className="text-slate-400 text-sm">访问地址:</span>
                              <a href={website.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-sm flex items-center">
                                {website.url}
                                <ExternalLink className="w-3 h-3 ml-1" />
                              </a>
                            </div>}
                        </div>
                        <div className="flex items-center space-x-2">
                          {website.status === 'failed' && <Button variant="outline" size="sm" onClick={() => handleRedeploy(website)} className="border-blue-600 text-blue-400 hover:bg-blue-900/20" disabled={deploying[website._id]}>
                              <RefreshCw className="w-4 h-4" />
                            </Button>}
                          <Button variant="destructive" size="sm" onClick={() => handleDeleteWebsite(website._id)} className="bg-red-600 hover:bg-red-700">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>)}
                  </div>}
              </CardContent>
            </Card>
          </div>
        </div>;
}