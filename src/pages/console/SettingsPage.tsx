import React, { useState } from "react";
import { userManager, authApi } from "@/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
  Button,
  Input,
  Label,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  useToast
} from "@/components/ui";
import { Github, Lock, User as UserIcon } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";

const texts = {
  zh: {
    title: "账号设置",
    subtitle: "管理你的资料、安全选项与第三方登录绑定。",
    tabProfile: "基本资料",
    tabSecurity: "安全",
    profileTitle: "基本资料",
    profileDesc: "你的公开身份信息。",
    nickname: "昵称",
    email: "邮箱",
    save: "保存",
    saved: "已保存",
    passwordTitle: "登录密码",
    passwordDesc: "设置或修改用于密码登录的密码。",
    currentPassword: "当前密码",
    newPassword: "新密码",
    confirmPassword: "确认新密码",
    updatePassword: "更新密码",
    bindingTitle: "第三方登录",
    bindingDesc: "绑定后可使用第三方账号一键登录。",
    github: "GitHub",
    bind: "绑定",
    unbind: "解绑",
    notBound: "未绑定",
    bound: "已绑定",
    todo: "后端接口待接入"
  },
  en: {
    title: "Settings",
    subtitle: "Manage your profile, security and third-party login bindings.",
    tabProfile: "Profile",
    tabSecurity: "Security",
    profileTitle: "Profile",
    profileDesc: "Your public identity.",
    nickname: "Nickname",
    email: "Email",
    save: "Save",
    saved: "Saved",
    passwordTitle: "Password",
    passwordDesc: "Set or change your login password.",
    currentPassword: "Current password",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    updatePassword: "Update password",
    bindingTitle: "Third-party login",
    bindingDesc: "Bind an account to enable one-click sign-in.",
    github: "GitHub",
    bind: "Bind",
    unbind: "Unbind",
    notBound: "Not bound",
    bound: "Bound",
    todo: "Backend endpoint pending"
  }
} as const;

const SettingsPage: React.FC = () => {
  const { language } = useLanguage();
  const t = texts[language];
  const { toast } = useToast();
  const user = userManager.get();

  const [nickname, setNickname] = useState(
    user?.nickname || user?.email?.split("@")[0] || ""
  );
  const githubBound = !!user?.githubId;

  const notImplemented = () =>
    toast({ title: t.todo, variant: "destructive" });

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-sm text-zinc-500 mt-2">{t.subtitle}</p>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="bg-zinc-900/50 border border-zinc-800">
          <TabsTrigger value="profile">{t.tabProfile}</TabsTrigger>
          <TabsTrigger value="security">{t.tabSecurity}</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <Card className="bg-zinc-950/50 border-zinc-900">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-zinc-100">
                <UserIcon className="w-4 h-4 text-zinc-400" />
                {t.profileTitle}
              </CardTitle>
              <CardDescription className="text-zinc-500">
                {t.profileDesc}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-zinc-300">{t.nickname}</Label>
                <Input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 max-w-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-300">{t.email}</Label>
                <Input
                  value={user?.email || ""}
                  disabled
                  className="bg-zinc-900 border-zinc-800 text-zinc-500 max-w-sm"
                />
              </div>
              <Button
                onClick={notImplemented}
                className="bg-zinc-100 text-black hover:bg-white"
              >
                {t.save}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-6 space-y-6">
          <Card className="bg-zinc-950/50 border-zinc-900">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-zinc-100">
                <Lock className="w-4 h-4 text-zinc-400" />
                {t.passwordTitle}
              </CardTitle>
              <CardDescription className="text-zinc-500">
                {t.passwordDesc}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-sm">
              <div className="space-y-2">
                <Label className="text-zinc-300">{t.currentPassword}</Label>
                <Input
                  type="password"
                  className="bg-zinc-900 border-zinc-800 text-zinc-100"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-300">{t.newPassword}</Label>
                <Input
                  type="password"
                  className="bg-zinc-900 border-zinc-800 text-zinc-100"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-300">{t.confirmPassword}</Label>
                <Input
                  type="password"
                  className="bg-zinc-900 border-zinc-800 text-zinc-100"
                />
              </div>
              <Button
                onClick={notImplemented}
                className="bg-zinc-100 text-black hover:bg-white"
              >
                {t.updatePassword}
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-zinc-950/50 border-zinc-900">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-zinc-100">
                <Github className="w-4 h-4 text-zinc-400" />
                {t.bindingTitle}
              </CardTitle>
              <CardDescription className="text-zinc-500">
                {t.bindingDesc}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-3">
                  <Github className="w-5 h-5 text-zinc-300" />
                  <div className="flex flex-col">
                    <span className="text-sm text-zinc-100">{t.github}</span>
                    <span className="text-xs text-zinc-500">
                      {githubBound ? t.bound : t.notBound}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() =>
                    githubBound
                      ? notImplemented()
                      : authApi.startGithubLogin("bind")
                  }
                  className="bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                >
                  {githubBound ? t.unbind : t.bind}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SettingsPage;
