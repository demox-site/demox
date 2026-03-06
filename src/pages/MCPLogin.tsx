import React, { useState } from "react";
import { tokenManager, userManager } from "../api";
import { Button } from "@/components/ui";
import { CheckCircle, Loader2 } from "lucide-react";
import { EmailLoginForm } from "@/components/EmailLoginForm";

// 从 hash 路由中解析查询参数
function getHashParams() {
  const hash = window.location.hash; // #/mcp-login?client_id=xxx&...
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return new URLSearchParams();

  const queryString = hash.substring(queryIndex + 1);
  return new URLSearchParams(queryString);
}

export function MCPLogin() {
  const [status, setStatus] = useState<"pending" | "logging" | "success" | "error">(
    "pending"
  );
  const [errorMessage, setErrorMessage] = useState("");

  const params = getHashParams();
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state");
  const scope = params.get("scope");

  // 验证客户端
  const validateClient = () => {
    if (!clientId) {
      return "缺少客户端 ID";
    }

    // 官方客户端配置（硬编码，避免数据库权限问题）
    const officialClients: Record<string, { isActive: boolean; redirectUris: string[] }> = {
      "demox-mcp-client": {
        isActive: true,
        redirectUris: [
          "http://localhost:39897/callback",
          "http://localhost:*/callback"
        ]
      }
    };

    const clientConfig = officialClients[clientId];
    if (!clientConfig) {
      return "无效的客户端 ID";
    }

    if (!clientConfig.isActive) {
      return "客户端未激活";
    }

    // 支持通配符匹配
    const isValidRedirect = clientConfig.redirectUris.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(redirectUri || '');
      }
      return pattern === redirectUri;
    });

    if (!isValidRedirect) {
      return "无效的回调地址";
    }

    return null;
  };

  const handleLoginSuccess = async () => {
    try {
      setStatus("logging");

      // 获取 Token 和用户信息
      const accessToken = tokenManager.get();
      const user = userManager.get();

      if (!accessToken || !user) {
        throw new Error("登录状态异常");
      }

      console.log("[MCPLogin] 获取到 Token 和用户信息", { userId: user.userId, hasToken: !!accessToken });

      // 构建回调 URL
      const callbackUrl = new URL(redirectUri || "");
      callbackUrl.searchParams.set("access_token", accessToken);
      callbackUrl.searchParams.set("refresh_token", accessToken);
      callbackUrl.searchParams.set("user_id", user.userId);
      callbackUrl.searchParams.set("state", state || "");

      console.log("[MCPLogin] 准备跳转到回调地址");

      setStatus("success");

      // 延迟跳转（让用户看到成功页面）
      setTimeout(() => {
        window.location.href = callbackUrl.toString();
      }, 1500);
    } catch (error: any) {
      console.error("登录失败:", error);
      setStatus("error");
      setErrorMessage(error.message || "登录失败，请重试");
    }
  };

  // 验证参数
  const validationError = validateClient();
  if (validationError && status === "pending") {
    // 首次加载时验证
    if (!clientId || !redirectUri || !state) {
      setStatus("error");
      setErrorMessage("缺少必需的 OAuth 参数");
    } else if (validationError) {
      setStatus("error");
      setErrorMessage(validationError);
    }
  }

  // 成功页面
  if (status === "success") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-black to-zinc-900 text-white flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
            </div>
            <h1 className="text-2xl font-bold mb-4">授权成功！</h1>
            <p className="text-zinc-400 mb-4">
              正在返回应用...
            </p>
            <div className="flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
            <p className="text-sm text-zinc-500 mt-6">
              如果页面没有自动跳转，请点击浏览器的返回按钮
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 错误页面
  if (status === "error") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-black to-zinc-900 text-white flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <div className="bg-zinc-900/50 border border-red-900 rounded-lg p-8">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-4xl">❌</span>
              </div>
            </div>
            <h1 className="text-2xl font-bold mb-4 text-red-400">授权失败</h1>
            <p className="text-zinc-400 mb-6">{errorMessage}</p>
            <Button
              onClick={() => window.close()}
              className="bg-zinc-800 hover:bg-zinc-700"
            >
              关闭此页面
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 登录页面
  return (
    <div className="min-h-screen bg-gradient-to-b from-black to-zinc-900 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo 和标题 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Demox
          </h1>
          <p className="text-zinc-400">MCP 服务授权</p>
        </div>

        {/* 授权信息 */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">登录以授权 MCP 客户端</h2>

          <div className="space-y-3 text-sm text-zinc-400">
            <p className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              部署静态网站
            </p>
            <p className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              查看网站列表
            </p>
            <p className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              删除网站
            </p>
          </div>

          <div className="mt-4 pt-4 border-t border-zinc-800">
            <p className="text-xs text-zinc-500">
              🔒 您的凭证将安全地保存在本地，有效期 30 天
            </p>
          </div>
        </div>

        {/* 登录表单 */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
          {status === "logging" ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <p className="text-zinc-400">正在处理授权...</p>
            </div>
          ) : (
            <EmailLoginForm onLoginSuccess={handleLoginSuccess} />
          )}
        </div>

        {/* 底部信息 */}
        <div className="mt-6 text-center text-xs text-zinc-500">
          <p className="mb-2">
            登录即表示您同意我们的{" "}
            <a
              href="#/terms"
              target="_blank"
              className="text-blue-400 hover:underline"
            >
              服务条款
            </a>{" "}
            和{" "}
            <a
              href="#/privacy"
              target="_blank"
              className="text-blue-400 hover:underline"
            >
              隐私政策
            </a>
          </p>
          <p>© 2025 Demox. Powered by Tencent Cloud.</p>
        </div>
      </div>
    </div>
  );
}
