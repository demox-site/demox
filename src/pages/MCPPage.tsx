import React, { useState } from 'react';
import { MainLayout } from "@/layouts/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Terminal,
  Code,
  Settings,
  Key,
  Globe,
  BookOpen,
  Copy,
  CheckCircle,
  Download,
  FileCode,
  AlertCircle,
  ChevronRight,
  ExternalLink
} from "lucide-react";
import { useLanguage } from "@/hooks/use-language";

const translations = {
  zh: {
    pageTitle: "MCP 管理中心",
    pageSubtitle: "配置 Demox MCP 服务器，享受 AI 助手部署网站的能力",
    configGuide: "配置指南",
    usageGuide: "使用说明",
    examples: "示例对话",
    faq: "常见问题",
    serverConfig: "1. MCP 服务器配置",
    serverConfigDesc: "将以下配置添加到您的 AI 工具配置文件中",
    restartDesc: "配置完成后，重启您的 AI 工具以应用新配置",
    firstUseDesc: "首次调用 MCP 工具时会自动打开浏览器登录",
    supportedTools: "支持的 AI 工具",
    fileFormats: "支持的文件格式",
    fileSize: "文件大小限制",
    revokeAuth: "撤销授权",
    tokenExpired: "Token 过期怎么办？",
    maxSize: "最大文件大小限制？",
    supportTools: "支持哪些 AI 工具？",
    howRevoke: "如何撤销授权？",
    copySuccess: "已复制到剪贴板",
    startConfig: "开始配置",
    loginNow: "立即登录",
    manageAuth: "管理权限",
    tokenExpires: "Access Token: 5 分钟",
    refreshToken: "Refresh Token: 30 天",
    autoLogin: "Token 过期时自动打开浏览器，无需手动操作",
    credentialStorage: "登录成功后，凭证会保存在本地 ~/.demox/token.json"
  },
  en: {
    pageTitle: "MCP Management Center",
    pageSubtitle: "Configure Demox MCP server, enjoy AI assistant website deployment capabilities",
    configGuide: "Setup Guide",
    usageGuide: "Usage Guide",
    examples: "Example Dialogs",
    faq: "FAQ",
    serverConfig: "1. MCP Server Configuration",
    serverConfigDesc: "Add the following configuration to your AI tool configuration file",
    restartDesc: "After configuration, restart your AI tool to apply the new configuration",
    firstUseDesc: "First time using MCP tools will automatically open browser login",
    supportedTools: "Supported AI Tools",
    fileFormats: "Supported File Formats",
    fileSize: "File Size Limit",
    revokeAuth: "Revoke Authorization",
    tokenExpired: "What to do when token expires?",
    maxSize: "Maximum file size limit?",
    supportTools: "Which AI tools are supported?",
    howRevoke: "How to revoke authorization?",
    copySuccess: "Copied to clipboard",
    startConfig: "Start Configuration",
    loginNow: "Login Now",
    manageAuth: "Manage Permissions",
    tokenExpires: "Access Token: 5 minutes",
    refreshToken: "Refresh Token: 30 days",
    autoLogin: "When token expires, automatically opens browser, no manual operation required",
    credentialStorage: "After successful login, credentials are saved locally at ~/.demox/token.json"
  }
};

export const MCPPage: React.FC = () => {
  const { language: lang } = useLanguage();
  const t = translations[lang];

  const [copied, setCopied] = useState(false);

  const configJson = {
    "mcpServers": {
      "demox": {
        "command": "npx",
        "args": ["-y", "@demox-site/mcp-server"]
      }
    }
  };

  const copyToClipboard = (text: string | any) => {
    const textToCopy = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const platformConfigs = {
    claude: {
      name: "Claude Desktop / Claude Code",
      configPath: {
        macOS: "~/Library/Application Support/Claude/claude_desktop_config.json",
        windows: "%APPDATA%/Claude/claude_desktop_config.json",
        linux: "~/.config/Claude/claude_desktop_config.json"
      }
    },
    cursor: {
      name: "Cursor AI",
      configPath: {
        macOS: "~/.cursor/mcp.json",
        linux: "~/.cursor/mcp.json",
        windows: "%APPDATA%/Cursor/mcp.json"
      }
    },
    cline: {
      name: "Cline (VS Code 插件)",
      configPath: {
        all: "~/.cline/mcp.json"
      }
    },
    continue: {
      name: "Continue (VS Code 插件)",
      configPath: {
        all: "~/.continue/mcp.json"
      }
    }
  };

  return (
    <MainLayout>
      <div className="relative z-10">
        {/* 页面标题 */}
        <div className="mb-12 text-center">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            {t.pageTitle}
          </h1>
          <p className="text-sm text-zinc-500 max-w-3xl mx-auto leading-relaxed">
            {t.pageSubtitle}
          </p>
        </div>

        <Tabs defaultValue="setup" className="w-full max-w-7xl mx-auto">
          <TabsList className="grid w-full grid-cols-4 bg-zinc-900 border border-zinc-800">
            <TabsTrigger value="setup" className="text-zinc-400 data-[state=active]:bg-zinc-100 data-[state=active]:text-zinc-900">
              {t.configGuide}
            </TabsTrigger>
            <TabsTrigger value="usage" className="text-zinc-400 data-[state=active]:bg-zinc-100 data-[state=active]:text-zinc-900">
              {t.usageGuide}
            </TabsTrigger>
            <TabsTrigger value="examples" className="text-zinc-400 data-[state=active]:bg-zinc-100 data-[state=active]:text-zinc-900">
              {t.examples}
            </TabsTrigger>
            <TabsTrigger value="faq" className="text-zinc-400 data-[state=active]:bg-zinc-100 data-[state=active]:text-zinc-900">
              {t.faq}
            </TabsTrigger>
          </TabsList>

          {/* 配置指南 */}
          <TabsContent value="setup" className="space-y-8 mt-8">
            <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm">
              <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
                <CardTitle className="text-zinc-100 flex items-center gap-2">
                  <Code className="h-5 w-5 text-zinc-400" />
                  {t.serverConfig}
                </CardTitle>
                <p className="text-sm text-zinc-400 mt-1">
                  {t.serverConfigDesc}
                </p>
              </CardHeader>
              <CardContent className="p-8">
                <div className="relative">
                  <pre className="bg-zinc-900 text-zinc-200 p-4 rounded-lg overflow-x-auto text-sm font-mono">
                    <code>{JSON.stringify(configJson, null, 2)}</code>
                  </pre>
                  <Button
                    size="sm"
                    className="absolute top-3 right-3 bg-zinc-100 text-black hover:bg-zinc-200"
                    onClick={() => copyToClipboard(configJson)}
                  >
                    {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>

                <Alert className="mt-6 border-zinc-700 bg-zinc-900/50">
                  <AlertCircle className="h-4 w-4 text-zinc-400" />
                  <AlertTitle className="text-zinc-300">配置文件路径</AlertTitle>
                  <AlertDescription className="text-zinc-400">
                    根据您使用的 AI 工具，将配置导入到相应位置：
                  </AlertDescription>
                </Alert>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                  {Object.entries(platformConfigs).map(([key, platform]) => (
                    <Card key={key} className="bg-zinc-900/50 border-zinc-800">
                      <CardHeader className="border-b border-zinc-800 bg-zinc-900/30">
                        <CardTitle className="text-lg text-zinc-100">
                          {platform.name}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {Object.entries(platform.configPath).map(([os, path]) => (
                          <div key={os} className="flex items-center justify-between p-3 bg-zinc-900/50 rounded border border-zinc-800">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs text-zinc-500 border-zinc-700">
                                {os}
                              </Badge>
                              <span className="text-sm font-mono text-zinc-400">{path}</span>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
                              onClick={() => copyToClipboard({ [platform.name]: { [os]: path } })}
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-7xl mx-auto">
              <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm">
                <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
                  <CardTitle className="text-zinc-100 flex items-center gap-2">
                    <Settings className="h-5 w-5 text-zinc-400" />
                    2. {t.restartDesc.split('，')[0]}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-8">
                  <div className="flex items-center gap-3 p-4 bg-zinc-900 rounded-lg border border-zinc-700">
                    <CheckCircle className="h-6 w-6 text-zinc-300" />
                    <p className="text-zinc-300">{t.restartDesc}</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm">
                <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
                  <CardTitle className="text-zinc-100 flex items-center gap-2">
                    <Key className="h-5 w-5 text-zinc-400" />
                    3. {t.firstUseDesc.split('时')[0]}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-8 space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-700">
                      <h4 className="font-semibold text-zinc-300 mb-2">Token 有效期</h4>
                      <ul className="space-y-1 text-sm text-zinc-400">
                        <li>• {t.tokenExpires}</li>
                        <li>• {t.refreshToken}</li>
                      </ul>
                    </div>
                    <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-700">
                      <h4 className="font-semibold text-zinc-300 mb-2">{t.autoLogin.split('，')[0]}</h4>
                      <p className="text-sm text-zinc-400">
                        {t.autoLogin.split('，')[1]}
                      </p>
                    </div>
                  </div>
                  <Alert className="border-zinc-700 bg-zinc-900/50">
                    <FileCode className="h-4 w-4 text-zinc-400" />
                    <AlertTitle className="text-zinc-300">{t.credentialStorage}</AlertTitle>
                  </Alert>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 使用说明 */}
          <TabsContent value="usage" className="space-y-8 mt-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-7xl mx-auto">
              <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm">
                <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
                  <CardTitle className="text-zinc-100 flex items-center gap-2">
                    <Globe className="h-5 w-5 text-zinc-400" />
                    {t.supportedTools}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-8">
                  <div className="space-y-3">
                    {Object.entries(platformConfigs).map(([key, platform]) => (
                      <div key={key} className="flex items-center justify-between p-3 bg-zinc-900/50 rounded border border-zinc-800">
                        <span className="text-sm font-medium text-zinc-300">{platform.name}</span>
                        <Badge className="bg-zinc-800 text-zinc-300 border-zinc-700">
                          已支持
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm">
                <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
                  <CardTitle className="text-zinc-100 flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-zinc-400" />
                    {t.fileFormats}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-8 space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="h-4 w-4 text-zinc-300" />
                      <span className="text-sm text-zinc-400">本地 ZIP 文件：./dist.zip</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <CheckCircle className="h-4 w-4 text-zinc-300" />
                      <span className="text-sm text-zinc-400">本地目录：./dist（自动打包成 ZIP）</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <CheckCircle className="h-4 w-4 text-zinc-300" />
                      <span className="text-sm text-zinc-400">HTTPS URL：https://example.com/file.zip</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <AlertCircle className="h-4 w-4 text-zinc-500" />
                      <span className="text-sm text-zinc-500">其他压缩格式（tar.gz, rar 等）</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <AlertCircle className="h-4 w-4 text-zinc-500" />
                      <span className="text-sm text-zinc-500">Base64 编码内容</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm max-w-7xl mx-auto">
              <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
                <CardTitle className="text-zinc-100 flex items-center gap-2">
                  <Download className="h-5 w-5 text-zinc-400" />
                  {t.fileSize}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="flex items-center gap-4 p-4 bg-zinc-900 rounded-lg border border-zinc-700">
                  <div className="w-12 h-12 bg-zinc-800 rounded-lg flex items-center justify-center">
                    <Download className="h-6 w-6 text-zinc-300" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-zinc-300 mb-1">最大文件大小：500MB</h4>
                    <p className="text-sm text-zinc-400">
                      大文件会被流式传输，不会占用大量内存
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Alert className="border-zinc-700 bg-zinc-900/50 max-w-7xl mx-auto">
              <AlertCircle className="h-4 w-4 text-zinc-400" />
              <AlertTitle className="text-zinc-300">{t.revokeAuth}</AlertTitle>
              <AlertDescription className="text-zinc-400">
                如需撤销授权，删除本地 Token 文件：
                <code className="bg-zinc-800 px-2 py-1 rounded mx-2 text-zinc-300">rm ~/.demox/token.json</code>
                {t.howRevoke.split('。')[0]}
              </AlertDescription>
            </Alert>
          </TabsContent>

          {/* 示例对话 */}
          <TabsContent value="examples" className="space-y-8 mt-8">
            <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm max-w-7xl mx-auto">
              <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
                <CardTitle>场景示例</CardTitle>
                <p className="text-sm text-zinc-400">
                  以下是如何使用 Demox MCP 工具的示例对话
                </p>
              </CardHeader>
              <CardContent className="p-8 space-y-8">
                {/* 场景 1 */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-zinc-300 text-lg">场景 1：部署新网站</h3>
                  <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
                    <div className="text-sm text-zinc-500 mb-3">用户输入：</div>
                    <div className="text-zinc-200 mb-6 font-mono text-base">
                      把我的 react 项目的 build 目录部署到 Demox
                    </div>
                    <div className="text-sm text-zinc-500 mb-3">AI 助手响应：</div>
                    <div className="text-zinc-200 space-y-2">
                      <p>我来帮您部署 React 项目的 build 目录。</p>
                      <div className="space-y-1">
                        <span className="text-zinc-300">[正在打包目录 ./build...]</span>
                        <span className="text-zinc-300">[文件大小: 2.3MB]</span>
                      </div>
                      <p className="text-zinc-300 mt-4">✅ 网站部署成功！</p>
                      <div className="mt-2 space-y-1 text-sm">
                        <p>网站名称: build</p>
                        <p>网站 ID: XYZ67890</p>
                        <p>访问地址: <span className="text-zinc-400 hover:underline cursor-pointer">https://xyz67890.demox.site</span></p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 场景 2 */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-zinc-300 text-lg">场景 2：更新现有网站</h3>
                  <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
                    <div className="text-sm text-zinc-500 mb-3">用户输入：</div>
                    <div className="text-zinc-200 mb-6 font-mono text-base">
                      更新网站 ABC12345
                    </div>
                    <div className="text-sm text-zinc-500 mb-3">AI 助手响应：</div>
                    <div className="text-zinc-200 space-y-2">
                      <p>我来帮您更新网站 ABC12345。</p>
                      <div className="space-y-1">
                        <span className="text-zinc-300">[文件大小: 2.5MB]</span>
                      </div>
                      <p className="text-zinc-300 mt-4">✅ 网站部署成功！</p>
                      <div className="mt-2 space-y-1 text-sm">
                        <p>网站名称: my-project</p>
                        <p>网站 ID: ABC12345</p>
                        <p>访问地址: <span className="text-zinc-400 hover:underline cursor-pointer">https://abc12345.demox.site</span></p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 场景 3 */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-zinc-300 text-lg">场景 3：查看所有网站</h3>
                  <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
                    <div className="text-sm text-zinc-500 mb-3">用户输入：</div>
                    <div className="text-zinc-200 mb-6 font-mono text-base">
                      显示我部署的所有网站
                    </div>
                    <div className="text-sm text-zinc-500 mb-3">AI 助手响应：</div>
                    <div className="text-zinc-200">
                      <p>我来帮您查看所有已部署的网站。</p>
                      <p className="text-zinc-300 mt-4">📋 您的网站列表（共 3 个）</p>

                      <div className="mt-4 space-y-4">
                        <div className="border-l-2 border-zinc-600 pl-4">
                          <p className="text-zinc-300 font-semibold">my-portfolio</p>
                          <p className="text-sm text-zinc-400 mt-1">
                            ID: <span className="bg-zinc-800 px-1 rounded">ABC12345</span>
                          </p>
                          <p className="text-sm text-zinc-400">
                            URL: <span className="text-zinc-400 hover:underline cursor-pointer">https://abc12345.demox.site</span>
                          </p>
                          <p className="text-sm text-zinc-500 mt-1">
                            创建时间: 2026-01-20 14:30:00
                          </p>
                        </div>

                        <div className="border-l-2 border-zinc-600 pl-4">
                          <p className="text-zinc-300 font-semibold">blog</p>
                          <p className="text-sm text-zinc-400 mt-1">
                            ID: <span className="bg-zinc-800 px-1 rounded">XYZ67890</span>
                          </p>
                          <p className="text-sm text-zinc-400">
                            URL: <span className="text-zinc-400 hover:underline cursor-pointer">https://xyz67890.demox.site</span>
                          </p>
                          <p className="text-sm text-zinc-500 mt-1">
                            创建时间: 2026-01-21 09:15:00
                          </p>
                        </div>

                        <div className="border-l-2 border-zinc-600 pl-4">
                          <p className="text-zinc-300 font-semibold">docs</p>
                          <p className="text-sm text-zinc-400 mt-1">
                            ID: <span className="bg-zinc-800 px-1 rounded">DEF24680</span>
                          </p>
                          <p className="text-sm text-zinc-400">
                            URL: <span className="text-zinc-400 hover:underline cursor-pointer">https://def24680.demox.site</span>
                          </p>
                          <p className="text-sm text-zinc-500 mt-1">
                            创建时间: 2026-01-22 16:45:00
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 常见问题 */}
          <TabsContent value="faq" className="space-y-8 mt-8">
            <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm max-w-4xl mx-auto">
              <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
                <CardTitle className="text-xl text-zinc-100">常见问题解答</CardTitle>
              </CardHeader>
              <CardContent className="p-8 space-y-8">
                <div className="space-y-6">
                  <div>
                    <h3 className="font-semibold text-lg mb-3 text-zinc-300 flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-zinc-400" />
                      {t.tokenExpired}
                    </h3>
                    <p className="text-zinc-400 leading-relaxed">
                      系统会在 Token 过期时自动打开浏览器登录，无需手动操作。登录成功后会自动重试失败的工具调用。
                    </p>
                  </div>

                  <div>
                    <h3 className="font-semibold text-lg mb-3 text-zinc-300 flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-zinc-400" />
                      {t.maxSize}
                    </h3>
                    <p className="text-zinc-400 leading-relaxed">
                      最大支持 500MB 文件。大文件会被流式传输，不会占用大量内存。
                    </p>
                  </div>

                  <div>
                    <h3 className="font-semibold text-lg mb-3 text-zinc-300 flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-zinc-400" />
                      {t.supportTools}
                    </h3>
                    <p className="text-zinc-400 leading-relaxed">
                      支持 Claude Desktop/Claude Code、Cursor AI、Cline、Continue 等主流 AI 工具。
                    </p>
                  </div>

                  <div>
                    <h3 className="font-semibold text-lg mb-3 text-zinc-300 flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-zinc-400" />
                      {t.howRevoke}
                    </h3>
                    <p className="text-zinc-400 leading-relaxed">
                      删除本地 Token 文件：<code className="bg-zinc-800 px-2 py-1 rounded">rm ~/.demox/token.json</code>
                      下次使用时会自动触发重新登录。
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 网格背景装饰 */}
        <div className="fixed inset-0 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] -z-10 pointer-events-none" />
      </div>
    </MainLayout>
  );
};