import React, { useState, useEffect } from "react";
import { authApi } from "../api";
import { Github } from "lucide-react";
import { FeishuIcon } from "@/components/FeishuIcon";
import { useLanguage } from "@/hooks/use-language";
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

const translations = {
  zh: {
    title: "登录 Demox",
    description: "登录您的 Demox 账号",
    enterEmail: "请输入邮箱",
    codeSent: "验证码已发送",
    checkEmail: "请查收邮件",
    sendFailed: "发送失败",
    agreeRequired: "请同意用户协议和隐私政策",
    agreeFirst: "请先同意用户协议和隐私政策",
    enterCode: "请输入验证码",
    enterPassword: "请输入密码",
    signupSuccess: "注册成功",
    loginSuccess: "登录成功",
    welcomeNew: "欢迎使用 Demox",
    welcomeBack: "欢迎回来",
    loginFailed: "登录失败",
    feishuInit: "飞书登录正在初始化，请稍后重试",
    feishuFailed: "无法发起飞书登录",
    githubFailed: "无法发起 GitHub 登录",
    retryLater: "请稍后重试",
    email: "邮箱",
    code: "验证码",
    codePlaceholder: "6位验证码",
    sendCode: "发送验证码",
    password: "密码",
    passwordPlaceholder: "请输入密码",
    agreePrefix: "我已阅读并同意",
    terms: "《服务条款》",
    and: "和",
    privacy: "《隐私政策》",
    processing: "处理中...",
    loginOrSignup: "登录 / 注册",
    login: "登录",
    or: "或",
    github: "使用 GitHub 登录",
    feishu: "使用飞书登录",
    usePassword: "使用密码登录",
    useCode: "使用验证码登录 / 注册",
  },
  en: {
    title: "Log in to Demox",
    description: "Log in to your Demox account",
    enterEmail: "Please enter your email",
    codeSent: "Verification code sent",
    checkEmail: "Check your inbox",
    sendFailed: "Couldn't send the code",
    agreeRequired: "Please accept the Terms of Service and Privacy Policy",
    agreeFirst: "Please accept the Terms of Service and Privacy Policy first",
    enterCode: "Please enter the verification code",
    enterPassword: "Please enter your password",
    signupSuccess: "Account created",
    loginSuccess: "Logged in",
    welcomeNew: "Welcome to Demox",
    welcomeBack: "Welcome back",
    loginFailed: "Login failed",
    feishuInit: "Feishu login is still starting up. Please try again in a moment.",
    feishuFailed: "Couldn't start Feishu login",
    githubFailed: "Couldn't start GitHub login",
    retryLater: "Please try again later",
    email: "Email",
    code: "Verification code",
    codePlaceholder: "6-digit code",
    sendCode: "Send code",
    password: "Password",
    passwordPlaceholder: "Enter your password",
    agreePrefix: "I have read and agree to the",
    terms: "Terms of Service",
    and: "and",
    privacy: "Privacy Policy",
    processing: "Working...",
    loginOrSignup: "Log in / Sign up",
    login: "Log in",
    or: "or",
    github: "Continue with GitHub",
    feishu: "Continue with Feishu",
    usePassword: "Log in with password",
    useCode: "Log in / sign up with email code",
  },
};

export function AuthDialog({
  isOpen,
  onOpenChange,
  onLoginSuccess,
  presentation = "dialog",
  title,
  description
}: AuthDialogProps) {
  const { toast } = useToast();
  const { language } = useLanguage();
  const t = translations[language] || translations.zh;
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
      toast({ title: t.enterEmail, variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      await authApi.sendCode(email, "login");
      setCountdown(60);
      toast({ title: t.codeSent, description: t.checkEmail });
    } catch (error: any) {
      toast({
        title: t.sendFailed,
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
      toast({ title: t.enterEmail, variant: "destructive" });
      return;
    }

    if (!agreed) {
      toast({ title: t.agreeRequired, variant: "destructive" });
      return;
    }

    if (loginMode === "code" && !code) {
      toast({ title: t.enterCode, variant: "destructive" });
      return;
    }

    if (loginMode === "password" && !password) {
      toast({ title: t.enterPassword, variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      if (loginMode === "code") {
        const result = await authApi.loginWithCode(email, code);
        toast({
          title: result.isNewUser ? t.signupSuccess : t.loginSuccess,
          description: result.isNewUser ? t.welcomeNew : t.welcomeBack
        });
      } else {
        await authApi.login(email, password);
        toast({ title: t.loginSuccess, description: t.welcomeBack });
      }
      onLoginSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: t.loginFailed,
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
        title: t.agreeFirst,
        variant: "destructive"
      });
      return;
    }
    if (!feishuReady) {
      toast({ title: t.feishuInit });
      return;
    }

    setLoading(true);
    try {
      await authApi.startFeishuLogin("login", isSiteGate ? "_top" : "_self");
    } catch (error: unknown) {
      toast({
        title: t.feishuFailed,
        description: error instanceof Error ? error.message : t.retryLater,
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
          <DialogTitle>{title ?? t.title}</DialogTitle>
          <DialogDescription>{description ?? t.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t.email}</Label>
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
              <Label htmlFor="code">{t.code}</Label>
              <div className="flex gap-2">
                <Input
                  id="code"
                  type="text"
                  placeholder={t.codePlaceholder}
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
                  {countdown > 0 ? `${countdown}s` : t.sendCode}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="password">{t.password}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t.passwordPlaceholder}
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
              {t.agreePrefix}{" "}
              <a
                href="/terms"
                target={isSiteGate ? "_blank" : undefined}
                rel={isSiteGate ? "noopener noreferrer" : undefined}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t.terms}
              </a>{" "}
              {t.and}{" "}
              <a
                href="/privacy"
                target={isSiteGate ? "_blank" : undefined}
                rel={isSiteGate ? "noopener noreferrer" : undefined}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t.privacy}
              </a>
            </label>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t.processing : loginMode === "code" ? t.loginOrSignup : t.login}
          </Button>

          <div className="flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">{t.or}</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => {
              if (!agreed) {
                toast({
                  title: t.agreeFirst,
                  variant: "destructive"
                });
                return;
              }
              try {
                authApi.startGithubLogin("login", isSiteGate ? "_top" : "_self");
              } catch (error: unknown) {
                toast({
                  title: t.githubFailed,
                  description: error instanceof Error ? error.message : t.retryLater,
                  variant: "destructive"
                });
              }
            }}
            className="w-full"
          >
            <Github className="w-4 h-4 mr-2" />
            {t.github}
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
              {t.feishu}
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
              {loginMode === "code" ? t.usePassword : t.useCode}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
