import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi, tokenManager } from "../api";
import { EmailLoginForm } from "@/components/EmailLoginForm";
import { FeishuIcon } from "@/components/FeishuIcon";
import { Button, useToast } from "@/components/ui";
import { ArrowLeft, Link2, Loader2, UserPlus } from "lucide-react";
import {
  consumeSiteAuthHandoff,
  consumeSiteAuthNext,
  submitSiteAuthCompletion
} from "@/lib/site-auth";

interface LinkCtx {
  ticket: string;
  feishuName: string;
}

function readCtx(): LinkCtx | null {
  try {
    const raw = sessionStorage.getItem("feishu_link_ctx");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function FeishuLink() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [ctx] = useState<LinkCtx | null>(() => readCtx());
  const [mode, setMode] = useState<"choice" | "link">("choice");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ctx) navigate("/index", { replace: true });
  }, [ctx, navigate]);

  if (!ctx) return null;

  const continueAfterLogin = (settings: boolean) => {
    const privateSiteNext = consumeSiteAuthNext();
    const privateSiteHandoff = consumeSiteAuthHandoff();
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
    navigate(settings ? "/console/settings" : "/console/projects", { replace: true });
  };

  const finishCreate = async () => {
    setLoading(true);
    try {
      const res = await authApi.feishuFinalize(ctx.ticket, "create");
      if (!res.success) throw new Error("创建失败");
      sessionStorage.removeItem("feishu_link_ctx");
      toast({ title: "注册成功", description: "正在进入控制台..." });
      continueAfterLogin(false);
    } catch (error: unknown) {
      toast({
        title: "创建失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive"
      });
      setLoading(false);
    }
  };

  const finishLink = async () => {
    setLoading(true);
    try {
      const res = await authApi.feishuFinalize(ctx.ticket, "link");
      if (!res.success) throw new Error("关联失败");
      sessionStorage.removeItem("feishu_link_ctx");
      toast({ title: "关联成功", description: "飞书已绑定到该账号" });
      continueAfterLogin(true);
    } catch (error: unknown) {
      toast({
        title: "关联失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive"
      });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted">
            <FeishuIcon className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">飞书账号</h1>
          <p className="mt-2 text-sm text-muted-foreground">{ctx.feishuName}</p>
        </div>

        {mode === "choice" ? (
          <div className="space-y-3">
            <p className="mb-4 text-center text-sm text-muted-foreground">
              这是首次使用该飞书账号。你可以创建新账号，或先登录已有 Demox 账号再完成关联。
            </p>

            <button
              type="button"
              onClick={() => setMode("link")}
              className="w-full flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left hover:bg-muted/60 transition-colors"
            >
              <Link2 className="w-5 h-5 text-muted-foreground shrink-0" />
              <div>
                <div className="text-sm font-medium">关联到已有账号</div>
                <div className="text-xs text-muted-foreground">
                  验证已有 Demox 账号后再绑定飞书
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
                  使用这个飞书身份注册新的 Demox 账号
                </div>
              </div>
            </button>

            <div className="pt-2 text-center">
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
              登录你要关联的 Demox 账号，验证通过后会自动绑定飞书。
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

export default FeishuLink;
