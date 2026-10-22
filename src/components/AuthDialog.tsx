import React, { useState, useEffect } from "react";
import { authApi, loginThrottledUntil } from "../api";
import { LoginThrottleNotice } from "@/components/LoginThrottleNotice";
import {
  LOGIN_FORM_SINK_NAME,
  keepEmbeddedLoginModeOnSubmit,
  loginFormSubmitTarget,
  readEmbeddedLoginMode,
  writeEmbeddedLoginMode
} from "@/lib/embedded-login-mode";
import { embeddedGateCopy, embeddedGateFormCopy } from "@/lib/embedded-gate-language";
import { Github } from "lucide-react";
import { FeishuIcon } from "@/components/FeishuIcon";
import { useLanguage } from "@/hooks/use-language";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface AuthDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onLoginSuccess: () => void;
  presentation?: "dialog" | "site-gate";
  title?: string;
  description?: string;
}

type LoginMode = "password" | "code";

function embeddedModeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

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
  const [throttleUntil, setThrottleUntil] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loginMode, setLoginMode] = useState<LoginMode>(() =>
    presentation === "site-gate" ? readEmbeddedLoginMode(embeddedModeStorage()) : "code"
  );
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [feishuReady, setFeishuReady] = useState(false);
  const isSiteGate = presentation === "site-gate";
  const t = {
    ...(translations[language] || translations.zh),
    ...(isSiteGate ? embeddedGateFormCopy(embeddedGateCopy(language)) : null)
  };

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

  const selectLoginMode = (mode: LoginMode) => {
    setLoginMode(mode);
    if (isSiteGate) writeEmbeddedLoginMode(embeddedModeStorage(), mode);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 记住这次提交时的模式。原生提交或登录门重挂都不能把它打回验证码。
    const submittedMode: LoginMode = isSiteGate
      ? keepEmbeddedLoginModeOnSubmit(embeddedModeStorage(), loginMode)
      : loginMode;

    if (!email) {
      toast({ title: t.enterEmail, variant: "destructive" });
      return;
    }

    if (!agreed) {
      toast({ title: t.agreeRequired, variant: "destructive" });
      return;
    }

    if (submittedMode === "code" && !code) {
      toast({ title: t.enterCode, variant: "destructive" });
      return;
    }

    if (submittedMode === "password" && !password) {
      toast({ title: t.enterPassword, variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      if (submittedMode === "code") {
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
      // 站点门是嵌在 iframe 里的，关掉再打开会把内容卸掉。密码模式不能跟着这次成功提交一起丢。
      if (!isSiteGate) onOpenChange(false);
    } catch (error: any) {
      const until = loginThrottledUntil(error);
      if (until) {
        // 限速不是出错：不弹红色 toast，在表单里用墨色提示要等多久。
        setThrottleUntil(until);
      } else {
        toast({
          title: t.loginFailed,
          description: error.message,
          variant: "destructive"
        });
      }
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
            ? "max-h-[calc(100dvh-4.5rem)] w-[calc(100%-2rem)] max-w-[400px] gap-3 overflow-y-auto rounded-[12px] border border-[#e5e5e3] !bg-[#ffffff] p-4 !text-[#111111] shadow-[0_1px_2px_rgba(17,17,17,0.06)] sm:rounded-[12px] sm:p-5"
            : "sm:max-w-[425px]"
        }
        overlayClassName={isSiteGate ? "bg-transparent" : undefined}
        showClose={!isSiteGate}
        onEscapeKeyDown={isSiteGate ? (event) => event.preventDefault() : undefined}
        onPointerDownOutside={isSiteGate ? (event) => event.preventDefault() : undefined}
      >
        <DialogHeader className={isSiteGate ? "space-y-1 text-left sm:text-left" : undefined}>
          <DialogTitle className={isSiteGate ? "text-left text-[#111111]" : undefined}>{title ?? t.title}</DialogTitle>
          <DialogDescription className={isSiteGate ? "text-left text-[#6b6b6b]" : undefined}>{description ?? t.description}</DialogDescription>
        </DialogHeader>
        <iframe
          name={LOGIN_FORM_SINK_NAME}
          title="login-sink"
          aria-hidden="true"
          tabIndex={-1}
          className="hidden"
        />
        <form
          {...loginFormSubmitTarget()}
          onSubmit={handleSubmit}
          noValidate
          className={isSiteGate ? "space-y-3" : "space-y-4"}
        >
          <div className="space-y-2">
            <Label htmlFor="email" className={isSiteGate ? "text-[#111111]" : undefined}>{t.email}</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              className={isSiteGate ? "border-[#e5e5e3] !bg-[#ffffff] !text-[#111111] placeholder:!text-[#6b6b6b]" : undefined}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setThrottleUntil(null);
              }}
            />
          </div>

          {loginMode === "code" ? (
            <div className="space-y-2">
              <Label htmlFor="code" className={isSiteGate ? "text-[#111111]" : undefined}>{t.code}</Label>
              <div className="flex gap-2">
                <Input
                  id="code"
                  type="text"
                  placeholder={t.codePlaceholder}
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  className={isSiteGate ? "flex-1 border-[#e5e5e3] !bg-[#ffffff] !text-[#111111] placeholder:!text-[#6b6b6b]" : "flex-1"}
                  maxLength={6}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendCode}
                  disabled={countdown > 0 || loading}
                  className={isSiteGate ? "shrink-0 !border-[#e5e5e3] !bg-[#ffffff] !text-[#111111] hover:!bg-[#f7f7f5]" : "shrink-0"}
                >
                  {countdown > 0 ? `${countdown}s` : t.sendCode}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="password" className={isSiteGate ? "text-[#111111]" : undefined}>{t.password}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t.passwordPlaceholder}
                className={isSiteGate ? "border-[#e5e5e3] !bg-[#ffffff] !text-[#111111] placeholder:!text-[#6b6b6b]" : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          <div className={isSiteGate ? "flex items-start gap-2 text-xs text-[#6b6b6b]" : "flex items-start gap-2 text-xs text-muted-foreground"}>
            <Checkbox
              id="agree"
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked as boolean)}
              className={isSiteGate ? "mt-[2px] border-[#e5e5e3] data-[state=checked]:border-[#111111] data-[state=checked]:bg-[#111111] data-[state=checked]:text-[#ffffff]" : "mt-[2px]"}
            />
            <label htmlFor="agree" className="leading-relaxed">
              {isSiteGate ? (
                language === "en" ? (
                  <>
                    {t.agreePrefix}{" "}
                    <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-[#111111]">{t.terms}</a>
                    {" "}{t.and}{" "}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-[#111111]">{t.privacy}</a>
                  </>
                ) : (
                  <>
                    {t.agreePrefix}
                    <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-[#111111]">{t.terms}</a>
                    {t.and}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-[#111111]">{t.privacy}</a>
                  </>
                )
              ) : (
                <>
                  {t.agreePrefix}{" "}
                  <a href="/terms" className="underline underline-offset-4 hover:text-foreground">{t.terms}</a>
                  {" "}{t.and}{" "}
                  <a href="/privacy" className="underline underline-offset-4 hover:text-foreground">{t.privacy}</a>
                </>
              )}
            </label>
          </div>

          {loginMode === "password" && throttleUntil ? (
            <LoginThrottleNotice until={throttleUntil} lang={language === "en" ? "en" : "zh"} onDone={() => setThrottleUntil(null)} />
          ) : null}

          <Button
            type="submit"
            className={isSiteGate ? "w-full !bg-[#111111] !text-[#ffffff] hover:!bg-[#111111] hover:!opacity-90" : "w-full"}
            disabled={loading || (loginMode === "password" && !!throttleUntil)}
          >
            {loading ? t.processing : loginMode === "code" ? t.loginOrSignup : t.login}
          </Button>

          <div className={isSiteGate ? "flex items-center gap-3" : "flex items-center gap-3 py-1"}>
            <div className={isSiteGate ? "h-px flex-1 bg-[#e5e5e3]" : "h-px flex-1 bg-border"} />
            <span className={isSiteGate ? "text-xs text-[#6b6b6b]" : "text-xs text-muted-foreground"}>{t.or}</span>
            <div className={isSiteGate ? "h-px flex-1 bg-[#e5e5e3]" : "h-px flex-1 bg-border"} />
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
            className={isSiteGate ? "w-full !border-[#e5e5e3] !bg-[#ffffff] !text-[#111111] hover:!bg-[#f7f7f5]" : "w-full"}
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
              className={isSiteGate ? "w-full !border-[#e5e5e3] !bg-[#ffffff] !text-[#111111] hover:!bg-[#f7f7f5]" : "w-full"}
            >
              <FeishuIcon className="w-4 h-4 mr-2" />
              {t.feishu}
            </Button>
          )}

          <div className={isSiteGate ? "text-left text-sm" : "text-center text-sm"}>
            <Button
              type="button"
              variant="link"
              className={isSiteGate ? "h-auto p-0 !text-[#111111] hover:!text-[#111111]" : "p-0 h-auto"}
              onClick={() => selectLoginMode(loginMode === "code" ? "password" : "code")}
            >
              {loginMode === "code" ? t.usePassword : t.useCode}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
