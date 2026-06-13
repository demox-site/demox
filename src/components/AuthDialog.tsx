import React, { useState, useEffect } from "react";
import { authApi } from "../api";
import { Github } from "lucide-react";
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

type LoginMode = 'password' | 'code';

export function AuthDialog({
  isOpen,
  onOpenChange,
  onLoginSuccess
}: AuthDialogProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loginMode, setLoginMode] = useState<LoginMode>("code");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setAgreed(false);
      setEmail("");
      setPassword("");
      setCode("");
      setCountdown(0);
    }
  }, [isOpen]);

  // 倒计时
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // 发送验证码
  const handleSendCode = async () => {
    if (!email) {
      toast({ title: "请输入邮箱", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      await authApi.sendCode(email, 'login');
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

    if (loginMode === 'code' && !code) {
      toast({ title: "请输入验证码", variant: "destructive" });
      return;
    }

    if (loginMode === 'password' && !password) {
      toast({ title: "请输入密码", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      if (loginMode === 'code') {
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

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] border-zinc-800 bg-zinc-900 text-zinc-100">
        <DialogHeader>
          <DialogTitle>登录 Demox</DialogTitle>
          <DialogDescription className="text-zinc-400">
            登录您的 Demox 账号
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-zinc-300">邮箱</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              className="bg-zinc-800 border-zinc-700 text-zinc-100 focus:border-zinc-500 placeholder:text-zinc-600"
            />
          </div>

          {loginMode === 'code' ? (
            <div className="space-y-2">
              <Label htmlFor="code" className="text-zinc-300">验证码</Label>
              <div className="flex gap-2">
                <Input
                  id="code"
                  type="text"
                  placeholder="6位验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="flex-1 bg-zinc-800 border-zinc-700 text-zinc-100 focus:border-zinc-500 placeholder:text-zinc-600"
                  maxLength={6}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendCode}
                  disabled={countdown > 0 || loading}
                  className="shrink-0 bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
                >
                  {countdown > 0 ? `${countdown}s` : "发送验证码"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="password" className="text-zinc-300">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 focus:border-zinc-500"
              />
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-zinc-500">
            <Checkbox
              id="agree"
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked as boolean)}
              className="mt-[2px]"
            />
            <label htmlFor="agree" className="leading-relaxed">
              我已阅读并同意{" "}
              <a href="/terms" className="underline underline-offset-4 decoration-zinc-600 hover:text-zinc-200">
                《服务条款》
              </a>{" "}
              和{" "}
              <a href="/privacy" className="underline underline-offset-4 decoration-zinc-600 hover:text-zinc-200">
                《隐私政策》
              </a>
            </label>
          </div>

          <Button
            type="submit"
            className="w-full bg-zinc-100 text-zinc-900 hover:bg-white"
            disabled={loading}
          >
            {loading ? "处理中..." : (loginMode === 'code' ? "登录 / 注册" : "登录")}
          </Button>

          <div className="flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-zinc-800" />
            <span className="text-xs text-zinc-600">或</span>
            <div className="h-px flex-1 bg-zinc-800" />
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => {
              if (!agreed) {
                toast({ title: "请先同意用户协议和隐私政策", variant: "destructive" });
                return;
              }
              authApi.startGithubLogin("login");
            }}
            className="w-full bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700"
          >
            <Github className="w-4 h-4 mr-2" />
            使用 GitHub 登录
          </Button>

          <div className="text-center text-sm">
            <Button
              type="button"
              variant="link"
              className="p-0 h-auto text-zinc-300 hover:text-zinc-100"
              onClick={() => setLoginMode(loginMode === 'code' ? 'password' : 'code')}
            >
              {loginMode === 'code' ? "使用密码登录" : "使用验证码登录 / 注册"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
