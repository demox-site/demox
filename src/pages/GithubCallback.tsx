import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi, tokenManager } from "../api";
import { CheckCircle, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui";
import {
  consumeSiteAuthHandoff,
  consumeSiteAuthNext,
  submitSiteAuthCompletion
} from "@/lib/site-auth";

// 解析 OAuth 回调参数。browser history 下走 ?code=...&state=...；
// 兼容旧的 hash 形式(#/github-callback?code=...)，避免历史链接失效。
function getCallbackParams() {
  const search = window.location.search;
  if (search && search.length > 1) return new URLSearchParams(search);
  const hash = window.location.hash;
  const queryIndex = hash.indexOf("?");
  if (queryIndex === -1) return new URLSearchParams();
  return new URLSearchParams(hash.substring(queryIndex + 1));
}

export function GithubCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"logging" | "success" | "error">(
    "logging"
  );
  const [message, setMessage] = useState("正在使用 GitHub 登录...");
  // StrictMode 下 effect 会跑两次，code 只能用一次，用 ref 守卫
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = getCallbackParams();
    const code = params.get("code");
    const returnedState = params.get("state");
    const oauthError = params.get("error");
    const savedState = sessionStorage.getItem("github_oauth_state");
    sessionStorage.removeItem("github_oauth_state");

    const fail = (msg: string) => {
      setStatus("error");
      setMessage(msg);
    };

    if (oauthError) {
      fail(`GitHub 授权被拒绝: ${oauthError}`);
      return;
    }
    if (!code) {
      fail("缺少授权码 code");
      return;
    }
    // 校验 state，防 CSRF
    if (!returnedState || returnedState !== savedState) {
      fail("授权状态校验失败，请重试");
      return;
    }

    const isBind = returnedState.startsWith("bind.");

    authApi
      .githubLogin(code)
      .then((res) => {
        if (!res.success) throw new Error("登录失败");

        // github_id 无主：需要用户选择「创建新账号 / 关联已有账号」
        if (res.needsChoice && res.githubTicket) {
          sessionStorage.setItem(
            "github_link_ctx",
            JSON.stringify({
              ticket: res.githubTicket,
              githubEmail: res.githubEmail || null,
              matchedAccount: res.matchedAccount || { exists: false, emailMasked: null }
            })
          );
          navigate("/github-link", { replace: true });
          return;
        }

        setStatus("success");
        const privateSiteNext = !isBind ? consumeSiteAuthNext() : null;
        const privateSiteHandoff = !isBind ? consumeSiteAuthHandoff() : false;
        setMessage(
          res.bound
            ? "GitHub 账号绑定成功"
            : privateSiteNext
            ? "登录成功，正在返回私有站点..."
            : res.isNewUser
            ? "注册成功，正在进入控制台..."
            : "登录成功，正在进入控制台..."
        );
        setTimeout(() => {
          if (privateSiteNext) {
            const token = tokenManager.get();
            if (
              privateSiteHandoff && token &&
              submitSiteAuthCompletion(privateSiteNext, token)
            ) return;
            window.location.href = privateSiteNext;
            return;
          }
          navigate(isBind ? "/console/settings" : "/console/projects", {
            replace: true
          });
        }, 1200);
      })
      .catch((e) => fail(e.message || "GitHub 登录失败"));
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
      <div className="flex flex-col items-center gap-5 max-w-sm text-center">
        {status === "logging" && (
          <Loader2 className="w-10 h-10 text-muted-foreground animate-spin" />
        )}
        {status === "success" && (
          <CheckCircle className="w-10 h-10 text-success" />
        )}
        {status === "error" && <XCircle className="w-10 h-10 text-destructive" />}

        <p className="text-sm text-muted-foreground">{message}</p>

        {status === "error" && (
          <Button onClick={() => navigate("/index", { replace: true })}>
            返回首页
          </Button>
        )}
      </div>
    </div>
  );
}

export default GithubCallback;
