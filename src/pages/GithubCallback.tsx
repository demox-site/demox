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
import {
  clearOAuthCallbackSearch,
  consumeGithubOAuthFlow,
  describeGithubLoginError
} from "@/lib/github-oauth";

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
  const [retryMode, setRetryMode] = useState<"login" | "bind">("login");
  // StrictMode 下 effect 会跑两次，code 只能用一次，用 ref 守卫
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = getCallbackParams();
    const code = params.get("code");
    const returnedState = params.get("state");
    const oauthError = params.get("error");
    // 尽早清掉 URL 上的 code，避免浏览器缓存/刷新重复消耗授权码
    clearOAuthCallbackSearch();

    const flow = returnedState ? consumeGithubOAuthFlow(returnedState) : null;
    const mode = flow?.mode || (returnedState?.startsWith("bind.") ? "bind" : "login");
    setRetryMode(mode);

    const fail = (msg: string) => {
      setStatus("error");
      setMessage(msg);
    };

    if (!returnedState || !flow) {
      fail("授权状态校验失败，请重新发起 GitHub 登录");
      return;
    }
    if (oauthError) {
      fail(`GitHub 授权被拒绝: ${oauthError}`);
      return;
    }
    if (!code) {
      fail("缺少授权码 code，请重新发起 GitHub 登录");
      return;
    }

    const isBind = mode === "bind";

    authApi
      .githubLogin(code, mode)
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
      .catch((e) => fail(describeGithubLoginError(e)));
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
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              onClick={() => {
                try {
                  authApi.startGithubLogin(retryMode);
                } catch (error: unknown) {
                  setMessage(
                    error instanceof Error ? error.message : "无法重新发起 GitHub 登录"
                  );
                }
              }}
            >
              {retryMode === "bind" ? "重新绑定 GitHub" : "重新 GitHub 登录"}
            </Button>
            <Button variant="outline" onClick={() => navigate("/index", { replace: true })}>
              返回首页
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default GithubCallback;
