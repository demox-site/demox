import React, { useState, useEffect } from "react";
import { app, auth } from "../cloudbase";
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
}

export function AuthDialog({
  isOpen,
  onOpenChange,
  onLoginSuccess
}: AuthDialogProps) {
  const { toast } = useToast();
  interface VerificationInfo {
    verification_id: string;
    expires_in?: number;
    is_user?: boolean;
  }
  /**
   * 提取错误消息
   */
  function getErrorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [loginWithCode, setLoginWithCode] = useState(true);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationId, setVerificationId] = useState("");
  const [verificationInfo, setVerificationInfo] =
    useState<VerificationInfo | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [countdown]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      // Optional: reset form fields if desired, but keeping them might be better UX
      // For now we won't reset email/password to allow user to correct mistakes
      // But maybe reset mode?
      setAgreed(false);
    }
  }, [isOpen]);

  useEffect(() => {
    setAgreed(false);
  }, [isRegister, loginWithCode]);

  /**
   * 发送验证码
   * - 注册模式：仅向未注册邮箱发送验证码（target: 'NOT_USER'）
   * - 登录模式：仅向已注册邮箱发送验证码（target: 'USER'）
   */
  const handleSendCode = async () => {
    if (!email) {
      toast({ title: "请输入邮箱", variant: "destructive" });
      return;
    }
    try {
      const result = await auth.getVerification({
        email,
        target: isRegister ? "NOT_USER" : "USER"
      });
      if (typeof result?.is_user === "boolean") {
        if (isRegister && result.is_user) {
          toast({
            title: "该邮箱已注册，无法发送验证码",
            variant: "destructive"
          });
          return;
        }
        if (!isRegister && !result.is_user) {
          toast({
            title: "该邮箱尚未注册，无法发送验证码登录",
            variant: "destructive"
          });
          return;
        }
      }
      if (result && result.verification_id) {
        setVerificationId(result.verification_id);
        setVerificationInfo(result);
        toast({ title: "验证码已发送", description: "请前往邮箱查收" });
        setCountdown(60);
      } else {
        setVerificationInfo(result);
        toast({ title: "请求已发送", description: "请前往邮箱查收" });
        setCountdown(60);
      }
    } catch (error: unknown) {
      console.error(error);
      toast({
        title: "发送失败",
        description: getErrorMessage(error) || "请稍后重试",
        variant: "destructive"
      });
    }
  };

  /**
   * 邮箱登录/注册
   * - 登录（密码）：username+password
   * - 登录（验证码）：signInWithEmail(verificationInfo, verificationCode, email)
   * - 注册（验证码+密码）：verify -> signUp
   */
  const handleEmailAuth = async () => {
    if (!email) {
      toast({ title: "请输入邮箱", variant: "destructive" });
      return;
    }
    if (!agreed) {
      toast({
        title: "请先勾选协议",
        description: "请阅读并同意服务条款与隐私政策后再继续",
        variant: "destructive"
      });
      return;
    }
    if (!isRegister && !loginWithCode && !password) {
      toast({ title: "请输入密码", variant: "destructive" });
      return;
    }
    try {
      if (isRegister) {
        if (!verificationCode) {
          toast({ title: "请输入验证码", variant: "destructive" });
          return;
        }
        if (!verificationId) {
          toast({ title: "请先发送验证码", variant: "destructive" });
          return;
        }

        // 1. Verify code to get token
        const verifyResult = await auth.verify({
          verification_id: verificationId,
          verification_code: verificationCode
        });

        if (!verifyResult || !verifyResult.verification_token) {
          throw new Error("验证码校验失败");
        }

        // 2. Register with token
        await auth.signUp({
          email,
          password,
          verification_token: verifyResult.verification_token
        });

        toast({
          title: "注册成功",
          description: "已自动登录"
        });

        onLoginSuccess();
        onOpenChange(false);
        setIsRegister(false);
      } else {
        if (loginWithCode) {
          if (!verificationCode) {
            toast({ title: "请输入验证码", variant: "destructive" });
            return;
          }
          if (!verificationInfo || !verificationInfo.verification_id) {
            toast({ title: "请先发送验证码", variant: "destructive" });
            return;
          }
          await auth.signInWithEmail({
            verificationInfo,
            verificationCode,
            email
          });
        } else {
          await auth.signIn({
            username: email,
            password
          });
        }

        onLoginSuccess();
        onOpenChange(false);
        toast({ title: "登录成功" });
      }
    } catch (error: unknown) {
      console.error(error);
      let errorMsg = getErrorMessage(error);
      const errCode = (error as unknown as Record<string, unknown>)["code"];
      if (
        errCode === "CHECK_LOGIN_FAILED" ||
        errCode === "INVALID_USERNAME_OR_PASSWORD"
      ) {
        errorMsg = "邮箱或密码错误";
      }

      toast({
        title: isRegister ? "注册失败" : "登录失败",
        description: errorMsg || "请检查输入信息",
        variant: "destructive"
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-black border border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">
            {isRegister ? "创建账户" : "欢迎回来"}
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            {isRegister
              ? "输入邮箱、密码和验证码进行注册"
              : loginWithCode
              ? "输入邮箱与验证码进行登录"
              : "输入邮箱与密码进行登录"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2 text-left">
            <Label htmlFor="email" className="text-zinc-300">
              邮箱
            </Label>
            <Input
              id="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-zinc-900 border-zinc-700 text-zinc-100 focus:border-zinc-500 placeholder:text-zinc-600"
            />
          </div>
          {!loginWithCode && (
            <div className="grid gap-2 text-left">
              <Label htmlFor="password" className="text-zinc-300">
                密码
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-zinc-900 border-zinc-700 text-zinc-100 focus:border-zinc-500"
              />
            </div>
          )}
          {(isRegister || loginWithCode) && (
            <div className="grid gap-2 text-left">
              <Label htmlFor="code" className="text-zinc-300">
                验证码
              </Label>
              <div className="flex gap-2">
                <Input
                  id="code"
                  placeholder="6位验证码"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  className="bg-zinc-900 border-zinc-700 text-zinc-100 focus:border-zinc-500 placeholder:text-zinc-600"
                />
                <Button
                  variant="outline"
                  onClick={handleSendCode}
                  disabled={countdown > 0}
                  type="button"
                  className="bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  {countdown > 0 ? `${countdown}s` : "发送验证码"}
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2 text-xs text-zinc-500">
            <Checkbox
              id="auth-agree"
              checked={agreed}
              onCheckedChange={(v) => setAgreed(!!v)}
              className="mt-[2px]"
            />
            <div className="space-y-1">
              <p>
                我已阅读并同意{" "}
                <button
                  type="button"
                  className="underline underline-offset-4 decoration-zinc-600 hover:text-zinc-200"
                  onClick={() => window.open("#/terms", "_blank")}
                >
                  《服务条款》
                </button>{" "}
                和{" "}
                <button
                  type="button"
                  className="underline underline-offset-4 decoration-zinc-600 hover:text-zinc-200"
                  onClick={() => window.open("#/privacy", "_blank")}
                >
                  《隐私政策》
                </button>
                ，并知晓上传内容将接受自动审核，审核结果可能导致内容下线或封禁。
              </p>
            </div>
          </div>
          <Button
            onClick={handleEmailAuth}
            className="w-full bg-zinc-100 text-black hover:bg-zinc-200"
          >
            {isRegister ? "注册" : "登录"}
          </Button>
          <div className="text-center text-sm">
            <span className="text-zinc-500">
              {isRegister ? "已有账户？" : "没有账户？"}
            </span>
            <Button
              variant="link"
              className="p-0 h-auto ml-1 text-zinc-300 hover:text-zinc-100"
              onClick={() => setIsRegister(!isRegister)}
            >
              {isRegister ? "去登录" : "去注册"}
            </Button>
            {!isRegister && (
              <>
                <span className="text-zinc-500 mx-1">·</span>
                <Button
                  variant="link"
                  className="p-0 h-auto ml-1 text-zinc-300 hover:text-zinc-100"
                  onClick={() => setLoginWithCode(!loginWithCode)}
                >
                  {loginWithCode ? "使用密码登录" : "使用验证码登录"}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
