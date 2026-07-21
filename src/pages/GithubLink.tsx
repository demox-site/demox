import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi, tokenManager } from "../api";
import { EmailLoginForm } from "@/components/EmailLoginForm";
import { Button, useToast } from "@/components/ui";
import { Github, UserPlus, Link2, Loader2, ArrowLeft } from "lucide-react";
import {
  consumeSiteAuthHandoff,
  consumeSiteAuthNext,
  submitSiteAuthCompletion
} from "@/lib/site-auth";

interface LinkCtx {
  ticket: string;
  githubEmail: string | null;
  matchedAccount: { exists: boolean; emailMasked: string | null };
}

function readCtx(): LinkCtx | null {
  try {
    const raw = sessionStorage.getItem("github_link_ctx");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function GithubLink() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [ctx] = useState<LinkCtx | null>(() => readCtx());
  const [mode, setMode] = useState<"choice" | "link">("choice");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ctx) navigate("/index", { replace: true });
  }, [ctx, navigate]);

  if (!ctx) return null;

  const finishCreate = async () => {
    setLoading(true);
    try {
      const res = await authApi.githubFinalize(ctx.ticket, "create");
      if (!res.success) throw new Error("创建失败");
      sessionStorage.removeItem("github_link_ctx");
      const privateSiteNext = consumeSiteAuthNext();
      const privateSiteHandoff = consumeSiteAuthHandoff();
      toast({ title: "注册成功", description: "正在进入控制台..." });
      if (privateSiteNext) {
        const token = tokenManager.get();
        if (
          privateSiteHandoff && token &&
          submitSiteAuthCompletion(privateSiteNext, token)
        ) return;
        window.location.href = privateSiteNext;
        return;
      }
      navigate("/console/projects", { replace: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "创建失败";
      toast({ title: "创建失败", description: msg, variant: "destructive" });
      setLoading(false);
    }
  };

  const finishLink = async () => {
    setLoading(true);
    try {
      const res = await authApi.githubFinalize(ctx.ticket, "link");
      if (!res.success) throw new Error("关联失败");
      sessionStorage.removeItem("github_link_ctx");
      const privateSiteNext = consumeSiteAuthNext();
      const privateSiteHandoff = consumeSiteAuthHandoff();
      toast({ title: "关联成功", description: "GitHub 已绑定到该账号" });
      if (privateSiteNext) {
        const token = tokenManager.get();
        if (
          privateSiteHandoff && token &&
          submitSiteAuthCompletion(privateSiteNext, token)
        ) return;
        window.location.href = privateSiteNext;
        return;
      }
      navigate("/console/settings", { replace: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "关联失败";
      toast({ title: "关联失败", description: msg, variant: "destructive" });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 rounded-full bg-muted border border-border flex items-center justify-center mb-4">
            <Github className="w-6 h-6 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">GitHub 账号</h1>
          {ctx.githubEmail && (
            <p className="text-sm text-muted-foreground mt-2 font-mono">
              {ctx.githubEmail}
            </p>
          )}
        </div>

        {mode === "choice" ? (
          <div className="space-y-3">
            {ctx.matchedAccount.exists ? (
              <p className="text-sm text-muted-foreground text-center mb-4">
                检测到已有账号{" "}
                <span className="text-foreground font-mono">
                  {ctx.matchedAccount.emailMasked}
                </span>
                ，是你的吗？关联后即可用 GitHub 登录该账号。
              </p>
            ) : (
              <p className="text-sm text-muted-foreground text-center mb-4">
                这是首次使用该 GitHub 账号。你可以创建新账号，或关联到你已有的
                Demox 账号。
              </p>
            )}

            <button
              type="button"
              onClick={() => setMode("link")}
              className="w-full flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left hover:bg-muted/60 transition-colors"
            >
              <Link2 className="w-5 h-5 text-muted-foreground shrink-0" />
              <div>
                <div className="text-sm font-medium">关联到已有账号</div>
                <div className="text-xs text-muted-foreground">
                  登录你的 Demox 账号，把 GitHub 绑定上去
                </div>
              </div>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={finishCreate}
              className="w-full flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4 text-left hover:bg-muted/60 transition-colors disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 text-muted-foreground animate-spin shrink-0" />
              ) : (
                <UserPlus className="w-5 h-5 text-muted-foreground shrink-0" />
              )}
              <div>
                <div className="text-sm font-medium">创建新账号</div>
                <div className="text-xs text-muted-foreground">
                  用这个 GitHub 账号注册一个全新的 Demox 账号
                </div>
              </div>
            </button>

            <div className="text-center pt-2">
              <Button variant="link" onClick={() => navigate("/index", { replace: true })}>
                取消
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setMode("choice")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              返回
            </button>
            <p className="text-sm text-muted-foreground">
              登录你要关联的 Demox 账号，验证通过后会自动把 GitHub 绑定上去。
            </p>
            <div className="rounded-lg border border-border bg-card p-5">
              <EmailLoginForm onLoginSuccess={finishLink} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default GithubLink;
