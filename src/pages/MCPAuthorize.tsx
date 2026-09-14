import React, { useEffect, useState } from "react";
import { authApi, tokenManager, userManager } from "../api";
import { Loader2 } from "lucide-react";
import {
  buildMcpLoginUrl,
  buildOAuthErrorCallback,
  completeMcpAuthorization,
  parseMcpOAuthRequest,
  readOAuthSearchParams
} from "../lib/mcp-oauth";

export function MCPAuthorize() {
  const [status, setStatus] = useState<"checking" | "redirecting" | "error">("checking");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    handleAuthorize();
  }, []);

  const handleAuthorize = async () => {
    const parsed = parseMcpOAuthRequest(readOAuthSearchParams(window.location));
    if (!parsed.ok) {
      if (parsed.redirectUri && parsed.redirectSafe !== false) {
        window.location.href = buildOAuthErrorCallback(
          parsed.redirectUri,
          "invalid_request",
          parsed.error,
          parsed.state
        );
        return;
      }
      setStatus("error");
      setErrorMessage(parsed.error);
      return;
    }

    try {
      const isLoggedIn = Boolean(tokenManager.get() && userManager.get());
      if (!isLoggedIn) {
        window.location.href = buildMcpLoginUrl(window.location.origin, parsed.request);
        return;
      }

      setStatus("redirecting");
      window.location.href = await completeMcpAuthorization(parsed.request, (payload) =>
        authApi.oauthAuthorize(payload)
      );
    } catch (error: any) {
      window.location.href = buildOAuthErrorCallback(
        parsed.request.redirectUri,
        "server_error",
        error.message || "授权失败",
        parsed.request.state
      );
    }
  };

  if (status === "error") {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-destructive">{errorMessage || "授权参数无效"}</p>
      </div>
    );
  }

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
