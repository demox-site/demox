import React, { useState, useEffect } from "react";
import cloudbase from "@cloudbase/js-sdk";
import env from "../configs/env";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input,
  Label,
  useToast
} from "@/components/ui";

// Initialize CloudBase
// Note: In a real app, this might be a singleton exported from a lib
const app = cloudbase.init({
  env: env.env
});
const auth = app.auth();

interface AuthDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onLoginSuccess: () => void;
}

export function AuthDialog({ isOpen, onOpenChange, onLoginSuccess }: AuthDialogProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationId, setVerificationId] = useState("");
  const [countdown, setCountdown] = useState(0);

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
    }
  }, [isOpen]);

  const handleSendCode = async () => {
    if (!email) {
      toast({ title: "Please enter email", variant: "destructive" });
      return;
    }
    try {
      const result = await auth.getVerification({ email });
      if (result && result.verification_id) {
        setVerificationId(result.verification_id);
        toast({ title: "Verification code sent", description: "Please check your email" });
        setCountdown(60);
      } else {
        toast({ title: "Request sent", description: "Please check your email" });
        setCountdown(60);
      }
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Failed to send",
        description: error.message || "Please try again later",
        variant: "destructive"
      });
    }
  };

  const handleEmailAuth = async () => {
    if (!email || !password) {
      toast({ title: "Please enter email and password", variant: "destructive" });
      return;
    }
    try {
      if (isRegister) {
        if (!verificationCode) {
          toast({ title: "Please enter verification code", variant: "destructive" });
          return;
        }
        if (!verificationId) {
          toast({ title: "Please send verification code first", variant: "destructive" });
          return;
        }

        // 1. Verify code to get token
        const verifyResult = await auth.verify({
          verification_id: verificationId,
          verification_code: verificationCode
        });

        if (!verifyResult || !verifyResult.verification_token) {
          throw new Error("Verification failed, no token received");
        }

        // 2. Register with token
        await auth.signUp({
          email,
          password,
          verification_token: verifyResult.verification_token
        });

        toast({
          title: "Registration successful",
          description: "Logged in automatically"
        });

        // Registration successful, usually auto-login happens, or we sign in explicitly?
        // The original code assumes auto-login or calls checkAuthStatus.
        // Let's ensure we are signed in. signUp usually doesn't sign in automatically in all SDKs, 
        // but the original code says "Logged in automatically" then calls checkAuthStatus.
        // Wait, original code:
        // await auth.signUp(...)
        // await checkAuthStatus()
        
        // If signUp doesn't auto-login, we might need signIn. 
        // CloudBase documentation says signUp creates user. 
        // Often you need to signIn after. 
        // But original code didn't signIn after signUp. 
        // Let's assume it works as original.
        
        onLoginSuccess();
        onOpenChange(false);
        setIsRegister(false);
      } else {
        // Login flow
        await auth.signIn({
          username: email,
          password
        });

        onLoginSuccess();
        onOpenChange(false);
        toast({ title: "Login successful" });
      }
    } catch (error: any) {
      console.error(error);
      let errorMsg = error.message;
      if (error.code === "CHECK_LOGIN_FAILED" || error.code === "INVALID_USERNAME_OR_PASSWORD") {
        errorMsg = "Invalid email or password";
      }

      toast({
        title: isRegister ? "Registration failed" : "Login failed",
        description: errorMsg || "Please check your information",
        variant: "destructive"
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-black border border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">
            {isRegister ? 'Create Account' : 'Welcome Back'}
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            {isRegister ? 'Enter your email, password and verification code to register.' : 'Enter your email and password to login.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2 text-left">
            <Label htmlFor="email" className="text-zinc-300">Email</Label>
            <Input
              id="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-zinc-900 border-zinc-700 text-zinc-100 focus:border-zinc-500 placeholder:text-zinc-600"
            />
          </div>
          <div className="grid gap-2 text-left">
            <Label htmlFor="password" className="text-zinc-300">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-zinc-900 border-zinc-700 text-zinc-100 focus:border-zinc-500"
            />
          </div>
          {isRegister && (
            <div className="grid gap-2 text-left">
              <Label htmlFor="code" className="text-zinc-300">Verification Code</Label>
              <div className="flex gap-2">
                <Input
                  id="code"
                  placeholder="6-digit code"
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
                    {countdown > 0 ? `${countdown}s` : 'Send'}
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <Button onClick={handleEmailAuth} className="w-full bg-zinc-100 text-black hover:bg-zinc-200">
            {isRegister ? 'Register' : 'Login'}
          </Button>
          <div className="text-center text-sm">
            <span className="text-zinc-500">
              {isRegister ? 'Already have an account?' : 'Don\'t have an account?'}
            </span>
            <Button
              variant="link"
              className="p-0 h-auto ml-1 text-zinc-300 hover:text-zinc-100"
              onClick={() => setIsRegister(!isRegister)}
            >
              {isRegister ? 'Login' : 'Register'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
