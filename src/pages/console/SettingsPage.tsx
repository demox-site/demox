import React, { useEffect, useState } from "react";
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

  const [nickname, setNickname] = useState(user?.nickname || "");
  const [accountEmail, setAccountEmail] = useState(user?.email || "");
  const [savingProfile, setSavingProfile] = useState(false);
  // 绑定状态以后端 /auth/me 为准；localStorage 的 user 不一定含 githubId
  const [githubBound, setGithubBound] = useState<boolean>(!!user?.githubId);
  const [githubLogin, setGithubLogin] = useState<string | null>(
    user?.githubLogin || null
  );

  // 进入页面时拉取真实账号信息，刷新绑定状态并回写本地
  useEffect(() => {
    let alive = true;
    authApi
      .getCurrentUser()
      .then((res) => {
        if (!alive || !res?.success || !res.user) return;
        const u = res.user;
        setGithubBound(!!u.githubId);
        setGithubLogin(u.githubLogin || null);
        setNickname(u.nickname || "");
        setAccountEmail(u.email || "");
        // 回写本地，保持其它页面一致
        const local = userManager.get() || {};
        userManager.set({
          ...local,
          userId: u.id || local.userId,
          email: u.email || local.email,
          githubId: u.githubId || null,
          githubLogin: u.githubLogin || null,
          avatarUrl: u.avatarUrl || null,
          nickname: u.nickname || "",
          roles: u.roles || local.roles
        });
      })
      .catch(() => {
        /* 拉取失败则维持本地状态 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const notImplemented = () =>
    toast({ title: t.todo, variant: "destructive" });

  const handleSaveProfile = async () => {
    const nextNickname = nickname.trim();
    if (!nextNickname) {
      toast({
        title: language === "zh" ? "昵称不能为空" : "Nickname is required",
        variant: "destructive"
      });
      return;
    }
    if (nextNickname.length > 80) {
      toast({
        title: language === "zh" ? "昵称过长" : "Nickname is too long",
        description: language === "zh" ? "最多 80 个字符" : "Use 80 characters or fewer",
        variant: "destructive"
      });
      return;
    }

    setSavingProfile(true);
    try {
      const res = await authApi.updateProfile({ nickname: nextNickname });
      const updatedUser = res.user || {};
      const finalNickname = updatedUser.nickname || res.nickname || nextNickname;
      const local = userManager.get() || {};
      userManager.set({
        ...local,
        userId: updatedUser.id || local.userId,
        email: updatedUser.email || local.email,
        githubId: updatedUser.githubId || local.githubId || null,
        githubLogin: updatedUser.githubLogin || local.githubLogin || null,
        avatarUrl: updatedUser.avatarUrl || local.avatarUrl || null,
        nickname: finalNickname
      });
      setNickname(finalNickname);
      toast({ title: t.saved });
    } catch (error: any) {
      toast({
        title: language === "zh" ? "保存失败" : "Save failed",
        description: error?.message || "",
        variant: "destructive"
      });
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="stitch-page max-w-3xl">
      <div className="stitch-page-hero mb-8">
        <div className="stitch-eyebrow">
          <UserIcon className="h-3.5 w-3.5" />
          {t.tabProfile}
        </div>
        <h1 className="stitch-title">{t.title}</h1>
        <p className="stitch-subtitle">{t.subtitle}</p>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="border border-[var(--stitch-line)] bg-[var(--stitch-surface)]">
          <TabsTrigger value="profile">{t.tabProfile}</TabsTrigger>
          <TabsTrigger value="security">{t.tabSecurity}</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <Card className="stitch-panel">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[var(--stitch-ink)]">
                <UserIcon className="w-4 h-4 text-[var(--stitch-blue)]" />
                {t.profileTitle}
              </CardTitle>
              <CardDescription className="text-[var(--stitch-muted)]">
                {t.profileDesc}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[var(--stitch-ink)]">{t.nickname}</Label>
                <Input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="max-w-sm border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[var(--stitch-ink)]">{t.email}</Label>
                <Input
                  value={accountEmail}
                  disabled
                  className="max-w-sm border-[var(--stitch-line)] bg-[var(--stitch-surface)] text-[var(--stitch-muted)]"
                />
              </div>
              <Button
                onClick={handleSaveProfile}
                disabled={savingProfile}
                className="stitch-primary rounded-full"
              >
                {savingProfile ? "..." : t.save}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-6 space-y-6">
          <Card className="stitch-panel">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[var(--stitch-ink)]">
                <Lock className="w-4 h-4 text-[var(--stitch-blue)]" />
                {t.passwordTitle}
              </CardTitle>
              <CardDescription className="text-[var(--stitch-muted)]">
                {t.passwordDesc}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-sm">
              <div className="space-y-2">
                <Label className="text-[var(--stitch-ink)]">{t.currentPassword}</Label>
                <Input
                  type="password"
                  className="border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[var(--stitch-ink)]">{t.newPassword}</Label>
                <Input
                  type="password"
                  className="border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[var(--stitch-ink)]">{t.confirmPassword}</Label>
                <Input
                  type="password"
                  className="border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)]"
                />
              </div>
              <Button
                onClick={notImplemented}
                className="stitch-primary rounded-full"
              >
                {t.updatePassword}
              </Button>
            </CardContent>
          </Card>

          <Card className="stitch-panel">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[var(--stitch-ink)]">
                <Github className="w-4 h-4 text-[var(--stitch-blue)]" />
                {t.bindingTitle}
              </CardTitle>
              <CardDescription className="text-[var(--stitch-muted)]">
                {t.bindingDesc}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] p-4">
                <div className="flex items-center gap-3">
                  <Github className="w-5 h-5 text-[var(--stitch-ink)]" />
                  <div className="flex flex-col">
                    <span className="text-sm text-[var(--stitch-ink)]">{t.github}</span>
                    <span className="text-xs text-[var(--stitch-muted)]">
                      {githubBound
                        ? githubLogin
                          ? `${t.bound} · @${githubLogin}`
                          : t.bound
                        : t.notBound}
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
                  className="stitch-action rounded-full"
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
