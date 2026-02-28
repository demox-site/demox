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

export function AuthDialog({
  isOpen,
  onOpenChange,
  onLoginSuccess
}: AuthDialogProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setAgreed(false);
      setEmail("");
      setPassword("");
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast({ title: "请输入邮箱和密码", variant: "destructive" });
      return;
    }

    if (!agreed) {
      toast({ title: "请同意用户协议和隐私政策", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      if (isRegister) {
        await authApi.register(email, password);
        toast({ title: "注册成功", description: "欢迎使用 Demox" });
      } else {
        await authApi.login(email, password);
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
              onChange={(e) => setEmail(e.target.value)}
              className="border-zinc-700 bg-zinc-800"
            />
          </div>
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
          <div className="text-center text-sm text-zinc-400">
            {isRegister ? "已有账号？" : "没有账号？"}{" "}
            <button
              type="button"
              onClick={() => setIsRegister(!isRegister)}
              className="text-blue-400 hover:underline"
            >
              {isRegister ? "立即登录" : "立即注册"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
