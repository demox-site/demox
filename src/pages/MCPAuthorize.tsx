import React, { useEffect, useState } from "react";
import { authApi, tokenManager, userManager } from "../api";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useLanguage } from "@/hooks/use-language";
import {
  buildMcpLoginUrl,
  buildOAuthErrorCallback,
  completeMcpAuthorization,
  loadThirdPartyClient,
  parseMcpOAuthRequest,
  readOAuthSearchParams
} from "../lib/mcp-oauth";

const translations = {
  zh: {
    checking: "正在检查登录状态...",
    redirecting: "正在处理授权...",
    invalid: "授权参数无效",
    clientInvalid: "这个应用没有登记，或回调地址不匹配",
    consentTitle: (name: string) => `${name} 请求读取你的 Demox 账号身份`,
    consentBody: "它会拿到你的账号 ID 和邮箱，不能查看或修改你的网站。",
    signedInAs: "当前账号",
    allow: "同意",
    deny: "取消",
    denied: "用户取消了授权"
  },
  en: {
    checking: "Checking your sign-in...",
    redirecting: "Processing authorization...",
    invalid: "Invalid authorization request",
    clientInvalid: "This app is not registered, or its callback URL does not match",
    consentTitle: (name: string) => `${name} wants to confirm your Demox identity`,
    consentBody: "It will receive your account ID and email. It cannot see or change your sites.",
    signedInAs: "Signed in as",
    allow: "Allow",
    deny: "Cancel",
    denied: "The user denied the request"
  }
};

export function MCPAuthorize() {
  const { language } = useLanguage();
  const tr = translations[language === "en" ? "en" : "zh"];
  const [status, setStatus] = useState<"checking" | "consent" | "redirecting" | "error">("checking");
  const [errorMessage, setErrorMessage] = useState("");
  const [clientName, setClientName] = useState("");
  const [parsed] = useState(() => parseMcpOAuthRequest(readOAuthSearchParams(window.location)));

  useEffect(() => {
    handleAuthorize();
  }, []);

  const fail = (message: string) => {
    setStatus("error");
    setErrorMessage(message);
  };

  const issue = async () => {
    if (!parsed.ok) return;
    try {
      setStatus("redirecting");
      window.location.href = await completeMcpAuthorization(parsed.request, (payload) =>
        authApi.oauthAuthorize(payload)
      );
    } catch (error: any) {
      window.location.href = buildOAuthErrorCallback(
        parsed.request.redirectUri,
        "server_error",
        error.message || "authorization failed",
        parsed.request.state
      );
    }
  };

  const handleAuthorize = async () => {
    if (!parsed.ok) {
      if (parsed.redirectUri && parsed.redirectSafe === true) {
        window.location.href = buildOAuthErrorCallback(parsed.redirectUri, "invalid_request", parsed.error, parsed.state);
        return;
      }
      return fail(parsed.error || tr.invalid);
    }

    // Third-party client: the server must confirm client_id + exact redirect URI + scopes first.
    // Until then we never redirect to the requested URI, not even with an error.
    if (!parsed.request.official) {
      try {
        const client = await loadThirdPartyClient(parsed.request, (payload) => authApi.oauthClient(payload));
        setClientName(client.name);
      } catch {
        return fail(tr.clientInvalid);
      }
    }

    const isLoggedIn = Boolean(tokenManager.get() && userManager.get());
    if (!isLoggedIn) {
      window.location.href = buildMcpLoginUrl(window.location.origin, parsed.request);
      return;
    }

    if (parsed.request.official) return issue();
    setStatus("consent");
  };

  const deny = () => {
    if (!parsed.ok) return;
    window.location.href = buildOAuthErrorCallback(parsed.request.redirectUri, "access_denied", tr.denied, parsed.request.state);
  };

  if (status === "error") {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-destructive">{errorMessage || tr.invalid}</p>
      </div>
    );
  }

  if (status === "consent") {
    const user = userManager.get() as { email?: string } | null;
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
        <div className="bg-card border border-border rounded-lg p-8 max-w-md w-full">
          <h1 className="text-xl font-semibold mb-3">{tr.consentTitle(clientName)}</h1>
          <p className="text-muted-foreground mb-4">{tr.consentBody}</p>
          {user?.email ? (
            <p className="text-sm text-muted-foreground mb-6">
              {tr.signedInAs}: <span className="text-foreground">{user.email}</span>
            </p>
          ) : null}
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={deny}>{tr.deny}</Button>
            <Button onClick={issue}>{tr.allow}</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-12 h-12 animate-spin text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">{status === "checking" ? tr.checking : tr.redirecting}</p>
      </div>
    </div>
  );
}
