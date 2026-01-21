import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { Download, Book, MessageCircle, ExternalLink } from "lucide-react";

export function MCPSetup() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  // MCP 配置内容
  const mcpConfig = {
    mcpServers: {
      demox: {
        command: "npx",
        args: ["-y", "@demox/mcp-server"],
        env: {
          DEMOX_CLIENT_ID: "demox-mcp-client",
          DEMOX_AUTH_URL: "https://localhost:8080/mcp/authorize",
          DEMOX_API_BASE: "https://localhost:8080",
          DEMOX_SERVER_ENV: "moyu-3g5pbxld00f4aead",
        },
      },
    },
  };

  // 下载配置文件
  const handleDownloadConfig = () => {
    const blob = new Blob([JSON.stringify(mcpConfig, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "demox-mcp.json";
    a.click();

    URL.revokeObjectURL(url);
  };

  // 复制配置到剪贴板
  const handleCopyConfig = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(mcpConfig, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("复制失败:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-black to-zinc-900 text-white">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* 头部 */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Demox MCP 服务配置
          </h1>
          <p className="text-zinc-400 text-lg">
            将 Demox 部署能力集成到您喜爱的 AI 工具中
          </p>
        </div>

        {/* 什么是 MCP */}
        <Card className="mb-8 bg-zinc-900/50 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-2xl">什么是 MCP？</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-zinc-300">
            <p>
              MCP (Model Context Protocol) 是 AI 助手与工具之间的标准化协议。
              通过配置 MCP 服务，您可以在 Claude Desktop、Cursor 等 AI 工具中直接调用 Demox
              的部署能力。
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <div className="text-2xl mb-2">🚀</div>
                <h3 className="font-semibold mb-1">一键部署</h3>
                <p className="text-sm text-zinc-400">
                  通过对话即可部署网站到 Demox 平台
                </p>
              </div>
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <div className="text-2xl mb-2">🔐</div>
                <h3 className="font-semibold mb-1">安全认证</h3>
                <p className="text-sm text-zinc-400">
                  使用 OAuth 2.0 标准认证流程
                </p>
              </div>
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <div className="text-2xl mb-2">💻</div>
                <h3 className="font-semibold mb-1">无缝集成</h3>
                <p className="text-sm text-zinc-400">
                  支持主流 AI 编程工具
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 配置步骤 */}
        <Card className="mb-8 bg-zinc-900/50 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-2xl">配置步骤</CardTitle>
            <CardDescription className="text-zinc-400">
              按照以下步骤完成 MCP 服务配置
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {/* 步骤 1 */}
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center font-bold">
                1
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg mb-2">下载配置文件</h3>
                <p className="text-zinc-400 mb-4">
                  点击下方按钮下载 MCP 配置文件（demox-mcp.json）
                </p>
                <div className="flex gap-3">
                  <Button
                    onClick={handleDownloadConfig}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    下载配置文件
                  </Button>
                  <Button
                    onClick={handleCopyConfig}
                    variant="outline"
                    className="border-zinc-700 hover:bg-zinc-800"
                  >
                    {copied ? "已复制" : "复制配置"}
                  </Button>
                </div>
              </div>
            </div>

            {/* 步骤 2 */}
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center font-bold">
                2
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg mb-2">导入配置文件</h3>
                <p className="text-zinc-400 mb-4">
                  根据您使用的 AI 工具，将配置文件导入到相应位置：
                </p>

                <div className="space-y-3">
                  <div className="bg-zinc-800/50 rounded-lg p-4">
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <span className="text-lg">💻</span>
                      Claude Desktop / Claude Code
                    </h4>
                    <div className="text-sm text-zinc-400 space-y-2">
                      <p>
                        <strong>macOS:</strong>{" "}
                        <code className="bg-zinc-900 px-2 py-1 rounded">
                          ~/Library/Application Support/Claude/claude_desktop_config.json
                        </code>
                      </p>
                      <p>
                        <strong>Windows:</strong>{" "}
                        <code className="bg-zinc-900 px-2 py-1 rounded">
                          %APPDATA%/Claude/claude_desktop_config.json
                        </code>
                      </p>
                    </div>
                  </div>

                  <div className="bg-zinc-800/50 rounded-lg p-4">
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <span className="text-lg">⚡</span>
                      Cursor AI
                    </h4>
                    <div className="text-sm text-zinc-400 space-y-2">
                      <p>
                        <strong>macOS / Linux:</strong>{" "}
                        <code className="bg-zinc-900 px-2 py-1 rounded">
                          ~/.cursor/mcp.json
                        </code>
                      </p>
                      <p>
                        <strong>Windows:</strong>{" "}
                        <code className="bg-zinc-900 px-2 py-1 rounded">
                          %APPDATA%/Cursor/mcp.json
                        </code>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 步骤 3 */}
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center font-bold">
                3
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg mb-2">重启并首次使用</h3>
                <p className="text-zinc-400 mb-4">
                  重启您的 AI 工具，首次调用 MCP 工具时会自动打开浏览器登录。
                </p>
                <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4">
                  <p className="text-sm text-blue-200">
                    💡 <strong>提示：</strong>登录成功后，凭证会保存在本地（~/.demox/token.json），
                    有效期 30 天。过期后会自动弹出重新登录。
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 可用工具 */}
        <Card className="mb-8 bg-zinc-900/50 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-2xl">可用工具</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <h4 className="font-semibold mb-2">deploy_website</h4>
                <p className="text-sm text-zinc-400">部署静态网站到 Demox 平台</p>
              </div>
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <h4 className="font-semibold mb-2">list_websites</h4>
                <p className="text-sm text-zinc-400">获取所有网站列表</p>
              </div>
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <h4 className="font-semibold mb-2">get_website</h4>
                <p className="text-sm text-zinc-400">获取网站详细信息</p>
              </div>
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <h4 className="font-semibold mb-2">delete_website</h4>
                <p className="text-sm text-zinc-400">删除指定网站</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 使用示例 */}
        <Card className="mb-8 bg-zinc-900/50 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-2xl">使用示例</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2">在 Claude Desktop 中</h4>
              <div className="bg-zinc-950 rounded-lg p-4 text-sm font-mono">
                <p className="text-zinc-300 mb-2">
                  <span className="text-blue-400">用户:</span> 我有一个打包好的网站
                  ZIP 文件，帮我部署到 Demox
                </p>
                <p className="text-zinc-300 mb-2">
                  <span className="text-green-400">Claude:</span> 好的，我来帮您部署。
                  请提供 ZIP 文件的路径。
                </p>
                <p className="text-zinc-300 mb-2">
                  <span className="text-blue-400">用户:</span>{" "}
                  /Users/xxx/my-website.zip
                </p>
                <p className="text-zinc-300">
                  <span className="text-green-400">Claude:</span> 正在部署网站... ✅
                  网站部署成功！访问地址: https://demox.site/xxx
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 常见问题 */}
        <Card className="mb-8 bg-zinc-900/50 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-2xl">常见问题</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2 text-zinc-200">
                Token 过期怎么办？
              </h4>
              <p className="text-sm text-zinc-400">
                Token 有效期为 30 天，过期后会自动弹出浏览器重新登录。
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-zinc-200">
                如何撤销授权？
              </h4>
              <p className="text-sm text-zinc-400">
                删除本地 Token 文件：{" "}
                <code className="bg-zinc-950 px-2 py-1 rounded">
                  rm ~/.demox/token.json
                </code>
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-zinc-200">
                支持哪些 AI 工具？
              </h4>
              <p className="text-sm text-zinc-400">
                Claude Desktop、Claude Code、Cursor AI、Cline (VS Code
                插件)等支持 MCP 协议的工具。
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 帮助链接 */}
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4 justify-center">
              <Button
                variant="outline"
                className="border-zinc-700 hover:bg-zinc-800"
                onClick={() => window.open("https://docs.demox.site", "_blank")}
              >
                <Book className="w-4 h-4 mr-2" />
                完整文档
                <ExternalLink className="w-3 h-3 ml-2" />
              </Button>
              <Button
                variant="outline"
                className="border-zinc-700 hover:bg-zinc-800"
                onClick={() =>
                  window.open("https://github.com/demox/mcp-server/issues", "_blank")
                }
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                提交问题
                <ExternalLink className="w-3 h-3 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
