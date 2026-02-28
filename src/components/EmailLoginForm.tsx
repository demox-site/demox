import React, { useState, useEffect } from "react";
import { authApi } from "../api";
import {
  Button,
  Input,
  Label,
  useToast,
  Checkbox
} from "@/components/ui";

interface EmailLoginFormProps {
  onLoginSuccess: () => void;
}

export function EmailLoginForm({ onLoginSuccess }: EmailLoginFormProps) {
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginWithCode, setLoginWithCode] = useState(true);
  const [verificationCode, setVerificationCode] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

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

  const handleSendCode = async () => {
    if (!email) {
      toast({ title: "请输入邮箱", variant: "destructive" });
      return;
    }
    try {
      setLoading(true);
      await authApi.sendCode(email, 'login');
      toast({ title: "验证码已发送", description: "请前往邮箱查收" });
      setCountdown(60);
    } catch (error: unknown) {
      console.error(error);
      const message = error instanceof Error ? error.message : "发送失败";
      toast({
        title: "发送失败",
        description: message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

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

    setLoading(true);
    try {
      if (loginWithCode) {
        if (!verificationCode) {
          toast({ title: "请输入验证码", variant: "destructive" });
          setLoading(false);
          return;
        }

        const result = await authApi.loginWithCode(email, verificationCode);
        if (result.isNewUser) {
          toast({ title: "注册成功", description: "已自动登录" });
        } else {
          toast({ title: "登录成功" });
        }
      } else {
        if (!password) {
          toast({ title: "请输入密码", variant: "destructive" });
          setLoading(false);
          return;
        }
        await authApi.login(email, password);
        toast({ title: "登录成功" });
      }

      onLoginSuccess();
    } catch (error: unknown) {
      console.error(error);
      const message = error instanceof Error ? error.message : "登录失败";
      toast({
        title: "登录失败",
        description: message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2 text-left">
        <Label htmlFor="email" className="text-zinc-300">
          邮箱
        </Label>
        <Input
          id="email"
          type="email"
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
      {loginWithCode && (
        <div className="grid gap-2 text-left">
          <Label htmlFor="code" className="text-zinc-300">
            验证码
          </Label>
          <div className="flex gap-2">
            <Input
              id="code"
              placeholder="6位验证码"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
              className="bg-zinc-900 border-zinc-700 text-zinc-100 focus:border-zinc-500 placeholder:text-zinc-600"
            />
            <Button
              variant="outline"
              onClick={handleSendCode}
              disabled={countdown > 0 || loading}
              type="button"
              className="bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 shrink-0"
            >
              {countdown > 0 ? `${countdown}s` : "发送验证码"}
            </Button>
          </div>
        </div>
      )}
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
            </p>
          </div>
        </div>
        <Button
          onClick={handleEmailAuth}
          disabled={loading}
          className="w-full bg-zinc-100 text-black hover:bg-zinc-200"
        >
          {loading ? "处理中..." : (loginWithCode ? "登录 / 注册" : "登录")}
        </Button>
        <div className="text-center text-sm">
          <Button
            variant="link"
            className="p-0 h-auto ml-1 text-zinc-300 hover:text-zinc-100"
            onClick={() => setLoginWithCode(!loginWithCode)}
          >
            {loginWithCode ? "使用密码登录" : "使用验证码登录 / 注册"}
          </Button>
        </div>
      </div>
    </div>
  );
}
