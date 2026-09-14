import React, { useEffect, useMemo, useState } from "react";
import { authApi, tokenManager, userManager } from "../api";
import { Button } from "@/components/ui";
import { Check, CheckCircle, Loader2, Lock, XCircle } from "lucide-react";
import { EmailLoginForm } from "@/components/EmailLoginForm";
import {
  buildOAuthErrorCallback,
  completeMcpAuthorization,
  parseMcpOAuthRequest,
  readOAuthSearchParams
} from "../lib/mcp-oauth";

export function MCPLogin() {
  const [status, setStatus] = useState<"pending" | "logging" | "success" | "error">(
    "pending"
  );
  const [errorMessage, setErrorMessage] = useState("");
  const parsed = useMemo(
    () => parseMcpOAuthRequest(readOAuthSearchParams(window.location)),
    []
  );

  const handleLoginSuccess = async () => {
    if (!parsed.ok) {
      setStatus("error");
      setErrorMessage(parsed.error);
      return;
    }
    try {
      setStatus("logging");
      if (!tokenManager.get() || !userManager.get()) {
        throw new Error("登录状态异常");
      }
      const callback = await completeMcpAuthorization(parsed.request, (payload) =>
        authApi.oauthAuthorize(payload)
      );
      setStatus("success");
      setTimeout(() => {
        window.location.href = callback;
      }, 1500);
    } catch (error: any) {
      if (parsed.ok) {
        window.location.href = buildOAuthErrorCallback(
          parsed.request.redirectUri,
          "server_error",
          error.message || "登录失败，请重试",
          parsed.request.state
        );
        return;
      }
      setStatus("error");
      setErrorMessage(error.message || "登录失败，请重试");
    }
  };

  useEffect(() => {
    if (!parsed.ok) {
      setStatus("error");
      setErrorMessage(parsed.error);
    }
  }, [parsed]);

  // 成功页面
  if (status === "success") {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <div className="bg-card border border-border rounded-lg p-8">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-success" />
              </div>
            </div>
            <h1 className="text-2xl font-bold mb-4">授权成功！</h1>
            <p className="text-muted-foreground mb-4">正在返回应用...</p>
            <div className="flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground mt-6">
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
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <div className="bg-card border border-destructive/50 rounded-lg p-8">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-destructive/20 flex items-center justify-center">
                <XCircle className="w-9 h-9 text-destructive" />
              </div>
            </div>
            <h1 className="text-2xl font-bold mb-4 text-destructive">授权失败</h1>
            <p className="text-muted-foreground mb-6">{errorMessage}</p>
            <Button onClick={() => window.close()}>
              关闭此页面
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 登录页面
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo 和标题 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 text-foreground">
            Demox
          </h1>
          <p className="text-muted-foreground">MCP 服务授权</p>
        </div>

        {/* 授权信息 */}
        <div className="bg-card border border-border rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">登录以授权 MCP 客户端</h2>

          <div className="space-y-3 text-sm text-muted-foreground">
            <p className="flex items-center gap-2">
              <Check className="w-4 h-4 text-success shrink-0" />
              部署静态网站
            </p>
            <p className="flex items-center gap-2">
              <Check className="w-4 h-4 text-success shrink-0" />
              查看网站列表
            </p>
            <p className="flex items-center gap-2">
              <Check className="w-4 h-4 text-success shrink-0" />
              删除网站
            </p>
          </div>

          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              您的凭证将安全地保存在本地，有效期 30 天
            </p>
          </div>
        </div>

        {/* 登录表单 */}
        <div className="bg-card border border-border rounded-lg p-6">
          {status === "logging" ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-foreground" />
              <p className="text-muted-foreground">正在处理授权...</p>
            </div>
          ) : (
            <EmailLoginForm onLoginSuccess={handleLoginSuccess} />
          )}
        </div>

        {/* 底部信息 */}
        <div className="mt-6 text-center text-xs text-muted-foreground">
          <p className="mb-2">
            登录即表示您同意我们的{" "}
            <a
              href="/terms"
              target="_blank"
              className="text-link hover:underline"
            >
              服务条款
            </a>{" "}
            和{" "}
            <a
              href="/privacy"
              target="_blank"
              className="text-link hover:underline"
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
