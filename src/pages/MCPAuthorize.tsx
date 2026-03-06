import React, { useEffect, useState } from "react";
import { auth, app } from "../cloudbase";
import { Loader2 } from "lucide-react";

// 从 hash 路由中解析查询参数
function getHashParams() {
  const hash = window.location.hash; // #/mcp-authorize?client_id=xxx&...
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return new URLSearchParams();

  const queryString = hash.substring(queryIndex + 1);
  return new URLSearchParams(queryString);
}

export function MCPAuthorize() {
  const [status, setStatus] = useState<"checking" | "redirecting">("checking");

  const params = getHashParams();
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state");
  const scope = params.get("scope");
  const responseType = params.get("response_type");

  useEffect(() => {
    handleAuthorize();
  }, []);

  const handleAuthorize = async () => {
    try {
      console.log("[MCPAuthorize] 开始授权流程", { clientId, redirectUri, state, scope });

      // 1. 检查用户是否已登录
      let isLoggedIn = false;
      try {
        const loginState = await auth.getLoginState();
        isLoggedIn = !!loginState;
        console.log("[MCPAuthorize] 登录状态:", isLoggedIn);
      } catch (error) {
        console.error("[MCPAuthorize] 检查登录状态失败:", error);
        isLoggedIn = false;
      }

      // 2. 如果未登录，跳转到登录页面
      if (!isLoggedIn) {
        const loginUrl = `${window.location.origin}/#/mcp-login?client_id=${clientId || ""}&redirect_uri=${encodeURIComponent(redirectUri || "")}&state=${state || ""}&scope=${scope || ""}&response_type=${responseType || ""}`;
        console.log("[MCPAuthorize] 未登录，跳转到:", loginUrl);
        window.location.href = loginUrl;
        return;
      }

      // 3. 已登录，直接获取 Token 并返回
      setStatus("redirecting");
      console.log("[MCPAuthorize] 已登录，获取 CloudBase Token...");

      const accessTokenResult = await auth.getAccessToken();
      const userInfo = await auth.getUserInfo();
      const userId = userInfo?.uid || "";

      // 提取实际的 access token 字符串
      const accessToken = typeof accessTokenResult === 'object'
        ? (accessTokenResult as any).accessToken || JSON.stringify(accessTokenResult)
        : accessTokenResult;

      console.log("[MCPAuthorize] 获取到 Token:", { userId, hasToken: !!accessToken });

      // 4. 直接返回 Token（无需授权码交换）
      const callbackUrl = new URL(redirectUri || "");
      callbackUrl.searchParams.set("access_token", accessToken);
      callbackUrl.searchParams.set("refresh_token", accessToken); // CloudBase 自动处理刷新
      callbackUrl.searchParams.set("user_id", userId);
      callbackUrl.searchParams.set("state", state || "");

      console.log("[MCPAuthorize] 重定向到回调:", callbackUrl.toString());
      window.location.href = callbackUrl.toString();
    } catch (error: any) {
      console.error("[MCPAuthorize] 授权失败:", error);
      console.error("[MCPAuthorize] 错误堆栈:", error.stack);
      // 跳转到错误页面
      const errorUrl = `${window.location.origin}/#/mcp-login?error=${encodeURIComponent(error.message || "network request error")}`;
      window.location.href = errorUrl;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-black to-zinc-900 text-white flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-12 h-12 animate-spin text-blue-500 mx-auto mb-4" />
        <p className="text-zinc-400">
          {status === "checking" ? "正在检查登录状态..." : "正在处理授权..."}
        </p>
      </div>
    </div>
  );
}
