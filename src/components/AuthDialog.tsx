import React, { useState, useEffect } from "react";
import { authApi } from "../api";
import { Github } from "lucide-react";
import { FeishuIcon } from "@/components/FeishuIcon";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input,
  Label,
  useToast,
  Checkbox
} from "@/components/ui";

interface AuthDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onLoginSuccess: () => void;
  presentation?: "dialog" | "site-gate";
  title?: string;
  description?: string;
}

type LoginMode = "password" | "code";

export function AuthDialog({
  isOpen,
  onOpenChange,
  onLoginSuccess,
  presentation = "dialog",
  title = "登录 Demox",
  description = "登录您的 Demox 账号"
}: AuthDialogProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loginMode, setLoginMode] = useState<LoginMode>("code");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [feishuReady, setFeishuReady] = useState(false);
  const isSiteGate = presentation === "site-gate";

  useEffect(() => {
    if (!isOpen) {
      setAgreed(false);
      setEmail("");
      setPassword("");
      setCode("");
      setCountdown(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !authApi.isFeishuConfigured()) return;
    let active = true;
    setFeishuReady(false);
    authApi
      .prepareFeishuLogin()
      .then(() => {
        if (active) setFeishuReady(true);
      })
      .catch(() => {
        if (active) setFeishuReady(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSendCode = async () => {
    if (!email) {
      toast({ title: "请输入邮箱", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      await authApi.sendCode(email, "login");
      setCountdown(60);
      toast({ title: "验证码已发送", description: "请查收邮件" });
    } catch (error: any) {
      toast({
        title: "发送失败",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      toast({ title: "请输入邮箱", variant: "destructive" });
      return;
    }

    if (!agreed) {
      toast({ title: "请同意用户协议和隐私政策", variant: "destructive" });
      return;
    }

    if (loginMode === "code" && !code) {
      toast({ title: "请输入验证码", variant: "destructive" });
      return;
    }

    if (loginMode === "password" && !password) {
      toast({ title: "请输入密码", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      if (loginMode === "code") {
        const result = await authApi.loginWithCode(email, code);
        toast({
          title: result.isNewUser ? "注册成功" : "登录成功",
          description: result.isNewUser ? "欢迎使用 Demox" : "欢迎回来"
        });
      } else {
        await authApi.login(email, password);
        toast({ title: "登录成功", description: "欢迎回来" });
      }
      onLoginSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "登录失败",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFeishuLogin = async () => {
    if (!agreed) {
      toast({
        title: "请先同意用户协议和隐私政策",
        variant: "destructive"
      });
      return;
    }
    if (!feishuReady) {
      toast({ title: "飞书登录正在初始化，请稍后重试" });
      return;
    }

    setLoading(true);
    try {
      await authApi.startFeishuLogin("login", isSiteGate ? "_top" : "_self");
    } catch (error: unknown) {
      toast({
        title: "无法发起飞书登录",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive"
      });
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!isSiteGate || open) onOpenChange(open);
      }}
    >
      <DialogContent
        className={
          isSiteGate
            ? "max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[425px] overflow-y-auto rounded-2xl border-white/15 bg-background/95 shadow-2xl shadow-black/40 backdrop-blur-xl"
            : "sm:max-w-[425px]"
        }
        overlayClassName={isSiteGate ? "bg-black/15" : undefined}
        showClose={!isSiteGate}
        onEscapeKeyDown={isSiteGate ? (event) => event.preventDefault() : undefined}
        onPointerDownOutside={isSiteGate ? (event) => event.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {loginMode === "code" ? (
            <div className="space-y-2">
              <Label htmlFor="code">验证码</Label>
              <div className="flex gap-2">
                <Input
                  id="code"
                  type="text"
                  placeholder="6位验证码"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  className="flex-1"
                  maxLength={6}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendCode}
                  disabled={countdown > 0 || loading}
                  className="shrink-0"
                >
                  {countdown > 0 ? `${countdown}s` : "发送验证码"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Checkbox
              id="agree"
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked as boolean)}
              className="mt-[2px]"
            />
            <label htmlFor="agree" className="leading-relaxed">
              我已阅读并同意{" "}
              <a
                href="/terms"
                target={isSiteGate ? "_blank" : undefined}
                rel={isSiteGate ? "noopener noreferrer" : undefined}
                className="underline underline-offset-4 hover:text-foreground"
              >
                《服务条款》
              </a>{" "}
              和{" "}
              <a
                href="/privacy"
                target={isSiteGate ? "_blank" : undefined}
                rel={isSiteGate ? "noopener noreferrer" : undefined}
                className="underline underline-offset-4 hover:text-foreground"
              >
                《隐私政策》
              </a>
            </label>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "处理中..." : loginMode === "code" ? "登录 / 注册" : "登录"}
          </Button>

          <div className="flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">或</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => {
              if (!agreed) {
                toast({
                  title: "请先同意用户协议和隐私政策",
                  variant: "destructive"
                });
                return;
              }
              authApi.startGithubLogin("login", isSiteGate ? "_top" : "_self");
            }}
            className="w-full"
          >
            <Github className="w-4 h-4 mr-2" />
            使用 GitHub 登录
          </Button>

          {authApi.isFeishuConfigured() && (
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={handleFeishuLogin}
              className="w-full"
            >
              <FeishuIcon className="w-4 h-4 mr-2" />
              使用飞书登录
            </Button>
          )}

          <div className="text-center text-sm">
            <Button
              type="button"
              variant="link"
              className="p-0 h-auto"
              onClick={() =>
                setLoginMode(loginMode === "code" ? "password" : "code")
              }
            >
              {loginMode === "code" ? "使用密码登录" : "使用验证码登录 / 注册"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
