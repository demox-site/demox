import React, { useEffect, useState } from "react";
import { tokenManager, userManager } from "../api";
import { Loader2 } from "lucide-react";

// 解析 OAuth 参数。browser history 下走 ?client_id=...；
// 兼容旧的 hash 形式(#/mcp-authorize?...)，避免历史链接失效。
function getOAuthParams() {
  const search = window.location.search;
  if (search && search.length > 1) return new URLSearchParams(search);
  const hash = window.location.hash;
  const queryIndex = hash.indexOf("?");
  if (queryIndex === -1) return new URLSearchParams();
  return new URLSearchParams(hash.substring(queryIndex + 1));
}

export function MCPAuthorize() {
  const [status, setStatus] = useState<"checking" | "redirecting">("checking");

  const params = getOAuthParams();
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
        const token = tokenManager.get();
        const user = userManager.get();
        isLoggedIn = !!(token && user);
        console.log("[MCPAuthorize] 登录状态:", isLoggedIn);
      } catch (error) {
        console.error("[MCPAuthorize] 检查登录状态失败:", error);
        isLoggedIn = false;
      }

      // 2. 如果未登录，跳转到登录页面
      if (!isLoggedIn) {
        const loginUrl = `${window.location.origin}/mcp-login?client_id=${clientId || ""}&redirect_uri=${encodeURIComponent(redirectUri || "")}&state=${state || ""}&scope=${scope || ""}&response_type=${responseType || ""}`;
        console.log("[MCPAuthorize] 未登录，跳转到:", loginUrl);
        window.location.href = loginUrl;
        return;
      }

      // 3. 已登录，直接获取 Token 并返回
      setStatus("redirecting");
      console.log("[MCPAuthorize] 已登录，获取 Token...");

      const accessToken = tokenManager.get() || "";
      const user = userManager.get();
      const userId = user?.userId || "";

      console.log("[MCPAuthorize] 获取到 Token:", { userId, hasToken: !!accessToken });

      // 4. 直接返回 Token（无需授权码交换）
      const callbackUrl = new URL(redirectUri || "");
      callbackUrl.searchParams.set("access_token", accessToken);
      callbackUrl.searchParams.set("refresh_token", accessToken);
      callbackUrl.searchParams.set("user_id", userId);
      callbackUrl.searchParams.set("state", state || "");

      console.log("[MCPAuthorize] 重定向到回调:", callbackUrl.toString());
      window.location.href = callbackUrl.toString();
    } catch (error: any) {
      console.error("[MCPAuthorize] 授权失败:", error);
      console.error("[MCPAuthorize] 错误堆栈:", error.stack);
      // 跳转到错误页面
      const errorUrl = `${window.location.origin}/mcp-login?error=${encodeURIComponent(error.message || "network request error")}`;
      window.location.href = errorUrl;
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-12 h-12 animate-spin text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">
          {status === "checking" ? "正在检查登录状态..." : "正在处理授权..."}
        </p>
      </div>
    </div>
  );
}
