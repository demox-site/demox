import React, { useState, useEffect } from "react";
import { authApi } from "../api";
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
  const [isRegister, setIsRegister] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setAgreed(false);
      setEmail("");
      setPassword("");
      setCode("");
      setCodeSent(false);
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
      await authApi.sendCode(email, isRegister ? 'register' : 'login');
      setCodeSent(true);
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
      if (isRegister) {
        if (loginMode === 'code') {
          await authApi.loginWithCode(email, code);
        } else {
          await authApi.register(email, password);
        }
        toast({ title: "注册成功", description: "欢迎使用 Demox" });
      } else {
        if (loginMode === 'code') {
          await authApi.loginWithCode(email, code);
        } else {
          await authApi.login(email, password);
        }
        toast({ title: "登录成功", description: "欢迎回来" });
      }
      onLoginSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: isRegister ? "注册失败" : "登录失败",
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
          <DialogTitle>{isRegister ? "注册账号" : "登录"}</DialogTitle>
          <DialogDescription className="text-zinc-400">
            {isRegister ? "创建您的 Demox 账号" : "登录您的 Demox 账号"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              placeholder="请输入邮箱"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setCodeSent(false);
              }}
              className="border-zinc-700 bg-zinc-800"
            />
          </div>

          {/* 登录方式切换 */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant={loginMode === 'code' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLoginMode('code')}
              className={`flex-1 ${loginMode === 'code' ? 'bg-zinc-100 text-zinc-900' : 'border-zinc-700 text-zinc-400'}`}
            >
              验证码登录
            </Button>
            <Button
              type="button"
              variant={loginMode === 'password' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLoginMode('password')}
              className={`flex-1 ${loginMode === 'password' ? 'bg-zinc-100 text-zinc-900' : 'border-zinc-700 text-zinc-400'}`}
            >
              密码登录
            </Button>
          </div>

          {loginMode === 'code' ? (
            <div className="space-y-2">
              <Label htmlFor="code">验证码</Label>
              <div className="flex gap-2">
                <Input
                  id="code"
                  type="text"
                  placeholder="请输入6位验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="flex-1 border-zinc-700 bg-zinc-800"
                  maxLength={6}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendCode}
                  disabled={countdown > 0 || loading}
                  className="shrink-0 border-zinc-700 text-zinc-300"
                >
                  {countdown > 0 ? `${countdown}s` : (codeSent ? '重新发送' : '发送验证码')}
                </Button>
              </div>
              {codeSent && (
                <p className="text-xs text-zinc-500">验证码已发送到您的邮箱，10分钟内有效</p>
              )}
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
                className="border-zinc-700 bg-zinc-800"
              />
            </div>
          )}

          <div className="flex items-center space-x-2">
            <Checkbox
              id="agree"
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked as boolean)}
            />
            <label htmlFor="agree" className="text-sm text-zinc-400">
              我已阅读并同意{" "}
              <a href="/#/terms" className="text-blue-400 hover:underline">
                用户协议
              </a>{" "}
              和{" "}
              <a href="/#/privacy" className="text-blue-400 hover:underline">
                隐私政策
              </a>
            </label>
          </div>
          <Button
            type="submit"
            className="w-full bg-zinc-100 text-zinc-900 hover:bg-white"
            disabled={loading}
          >
            {loading ? "处理中..." : (isRegister ? "注册" : "登录")}
          </Button>
          <div className="flex justify-between text-sm text-zinc-400">
            <button
              type="button"
              onClick={() => setIsRegister(!isRegister)}
              className="text-blue-400 hover:underline"
            >
              {isRegister ? "已有账号？立即登录" : "没有账号？立即注册"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
