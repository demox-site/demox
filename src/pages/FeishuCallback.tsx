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

function getCallbackParams() {
  const search = window.location.search;
  if (search && search.length > 1) return new URLSearchParams(search);
  const hash = window.location.hash;
  const queryIndex = hash.indexOf("?");
  if (queryIndex === -1) return new URLSearchParams();
  return new URLSearchParams(hash.substring(queryIndex + 1));
}

export function FeishuCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"logging" | "success" | "error">("logging");
  const [message, setMessage] = useState("正在使用飞书登录...");
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = getCallbackParams();
    const code = params.get("code");
    const returnedState = params.get("state");
    const oauthError = params.get("error");
    const savedState = sessionStorage.getItem("feishu_oauth_state");
    const codeVerifier = sessionStorage.getItem("feishu_pkce_verifier");
    sessionStorage.removeItem("feishu_oauth_state");
    sessionStorage.removeItem("feishu_pkce_verifier");

    const fail = (value: string) => {
      setStatus("error");
      setMessage(value);
    };

    if (!returnedState || returnedState !== savedState) {
      fail("授权状态校验失败，请重新发起飞书登录");
      return;
    }
    if (oauthError) {
      fail(`飞书授权被拒绝: ${oauthError}`);
      return;
    }
    if (!code || !codeVerifier) {
      fail("飞书授权信息不完整，请重新登录");
      return;
    }

    const isBind = returnedState.startsWith("bind.");
    authApi
      .feishuLogin(code, codeVerifier)
      .then((res) => {
        if (!res.success) throw new Error("登录失败");

        if (res.needsChoice && res.feishuTicket) {
          sessionStorage.setItem(
            "feishu_link_ctx",
            JSON.stringify({
              ticket: res.feishuTicket,
              feishuName: res.feishuName || "飞书用户"
            })
          );
          navigate("/feishu-link", { replace: true });
          return;
        }

        setStatus("success");
        const privateSiteNext = !isBind ? consumeSiteAuthNext() : null;
        const privateSiteHandoff = !isBind ? consumeSiteAuthHandoff() : false;
        setMessage(
          res.bound
            ? "飞书账号绑定成功"
            : privateSiteNext
            ? "登录成功，正在返回私有站点..."
            : "登录成功，正在进入控制台..."
        );

        setTimeout(() => {
          if (privateSiteNext) {
            const token = tokenManager.get();
            if (
              privateSiteHandoff &&
              token &&
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
      .catch((error: unknown) => {
        fail(error instanceof Error ? error.message : "飞书登录失败");
      });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
      <div className="flex max-w-sm flex-col items-center gap-5 text-center">
        {status === "logging" && (
          <Loader2 className="w-10 h-10 text-muted-foreground animate-spin" />
        )}
        {status === "success" && <CheckCircle className="w-10 h-10 text-success" />}
        {status === "error" && <XCircle className="w-10 h-10 text-destructive" />}
        <p className="text-sm text-muted-foreground">{message}</p>
        {status === "error" && (
          <Button onClick={() => navigate("/index", { replace: true })}>返回首页</Button>
        )}
      </div>
    </div>
  );
}

export default FeishuCallback;
