import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi, userManager, isLoggedIn } from "@/api";
import { AuthDialog } from "@/components/AuthDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useLanguage } from "@/hooks/use-language";
import logo from "@/assets/logo.png";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Languages,
  User,
  LogOut,
  LayoutDashboard,
  Menu,
  X,
  CreditCard,
  FileText,
  Terminal
} from "lucide-react";

const navbarTexts = {
  zh: {
    pricing: "价格",
    log: "日志",
    mcp: "文档",
    login: "登录",
    console: "控制台",
    logout: "退出登录",
    settings: "账号设置"
  },
  en: {
    pricing: "Pricing",
    log: "Log",
    mcp: "Docs",
    login: "Login",
    console: "Console",
    logout: "Log out",
    settings: "Settings"
  }
} as const;

const maskEmail = (email: string) => {
  if (!email) return "";
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  const maskedName =
    name.length > 2 ? `${name.slice(0, 2)}...${name.slice(-1)}` : name;
  return `${maskedName}@${domain}`;
};

export const MainHeader: React.FC = () => {
  const navigate = useNavigate();
  const { language: lang, toggleLanguage: toggleLang } = useLanguage();
  const [user, setUser] = useState<any>(null);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const t = navbarTexts[lang];

  useEffect(() => {
    const checkLoginState = () => {
      const currentUser = userManager.get();
      if (currentUser) {
        setUser(currentUser);
      }
    };
    checkLoginState();
  }, []);

  const handleLoginSuccess = () => {
    const currentUser = userManager.get();
    if (currentUser) {
      setUser(currentUser);
    }
    navigate("/console/sites");
  };

  const handleLogout = () => {
    authApi.logout();
    setUser(null);
    navigate("/index");
  };

  return (
    <>
      <nav className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo Area */}
            <button
              type="button"
              onClick={() => navigate("/index")}
              className="flex items-center gap-2 group"
            >
              <img
                src={logo}
                alt="Demox"
                className="h-8 w-auto object-contain group-hover:scale-105 transition-transform duration-300 invert dark:invert-0"
              />
            </button>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-6">
              {/* Language Switcher - Always visible */}
              <button
                type="button"
                onClick={toggleLang}
                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted/80"
              >
                <Languages size={16} />
                <span className="text-xs font-mono uppercase">{lang}</span>
              </button>

              {/* Theme Switcher - system / light / dark */}
              <ThemeToggle />

              {/* Global navigation: Pricing & Log & MCP */}
              <button
                type="button"
                onClick={() => navigate("/pricing")}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {t.pricing}
              </button>
              <button
                type="button"
                onClick={() => navigate("/log")}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {t.log}
              </button>
              <button
                type="button"
                onClick={() => navigate("/doc")}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {t.mcp}
              </button>

              {user ? (
                <>
                  <div className="w-px h-4 bg-border mx-2" />

                  {/* Console CTA - Primary Action */}
                  <button
                    type="button"
                    onClick={() => navigate("/console/sites")}
                    className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground text-sm font-bold rounded-md hover:opacity-90 transition-opacity"
                  >
                    <LayoutDashboard size={16} />
                    {t.console}
                  </button>

                  {/* User Dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="ml-2 outline-none rounded-full ring-offset-2 ring-offset-background focus:ring-2 focus:ring-ring transition-all">
                        <Avatar className="h-9 w-9 border border-border hover:border-foreground/20 transition-colors">
                          <AvatarFallback className="bg-muted text-muted-foreground text-xs font-mono">
                            {user.email?.[0]?.toUpperCase() || <User size={16} />}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      className="w-64 p-1.5"
                      align="end"
                      sideOffset={8}
                    >
                      {/* User Info Header */}
                      <div className="flex items-center gap-3 p-2 mb-1 border-b border-border pb-3">
                        <Avatar className="h-8 w-8 border border-border">
                          <AvatarFallback className="bg-muted text-muted-foreground text-xs">
                            <User size={14} />
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col overflow-hidden">
                          <span className="text-sm font-medium text-foreground truncate">
                            User
                          </span>
                          <span className="text-xs text-muted-foreground truncate font-mono">
                            {maskEmail(user.email)}
                          </span>
                        </div>
                      </div>

                      <DropdownMenuSeparator className="my-1" />

                      <DropdownMenuItem
                        onClick={handleLogout}
                        className="cursor-pointer text-destructive focus:text-destructive my-0.5"
                      >
                        <LogOut className="mr-2 h-4 w-4" />
                        <span>{t.logout}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <>
                  <div className="w-px h-4 bg-border mx-2" />
                  <button
                    type="button"
                    onClick={() => setIsLoginOpen(true)}
                    className="px-4 py-2 text-sm font-medium border border-border text-foreground rounded-md hover:bg-muted transition-colors"
                  >
                    {t.login}
                  </button>
                </>
              )}
            </div>

            {/* Mobile Menu Toggle */}
            <div className="md:hidden flex items-center gap-4">
              {user && (
                <button
                  type="button"
                  onClick={() => navigate("/console/sites")}
                  className="p-2 text-muted-foreground hover:text-foreground"
                >
                  <LayoutDashboard size={20} />
                </button>
              )}
              <button
                type="button"
                onClick={toggleLang}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <Languages size={20} />
                <span className="text-xs font-mono uppercase">{lang}</span>
              </button>
              <ThemeToggle size={20} />
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="text-muted-foreground hover:text-foreground"
              >
                {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Dropdown */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-b border-border bg-background animate-in slide-in-from-top-2 duration-200">
            <div className="px-4 py-4 space-y-4">
              <button
                type="button"
                onClick={() => navigate("/pricing")}
                className="flex items-center gap-3 text-sm text-muted-foreground hover:text-foreground w-full text-left p-2 rounded-md hover:bg-muted"
              >
                <CreditCard size={16} />
                {t.pricing}
              </button>
              <button
                type="button"
                onClick={() => navigate("/log")}
                className="flex items-center gap-3 text-sm text-muted-foreground hover:text-foreground w-full text-left p-2 rounded-md hover:bg-muted"
              >
                <FileText size={16} />
                {t.log}
              </button>
              <button
                type="button"
                onClick={() => navigate("/doc")}
                className="flex items-center gap-3 text-sm text-muted-foreground hover:text-foreground w-full text-left p-2 rounded-md hover:bg-muted"
              >
                {t.mcp}
              </button>

              {user ? (
                <>
                  <div className="h-px bg-border w-full my-2" />
                  <div className="flex items-center gap-3 p-2">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-muted text-muted-foreground">
                        {user.email?.[0] || <User size={14} />}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      <span className="text-sm text-foreground">User</span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {maskEmail(user.email)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex items-center gap-3 w-full text-left px-2 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                  >
                    <LogOut size={16} />
                    {t.logout}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsLoginOpen(true)}
                  className="w-full mt-4 px-4 py-3 text-sm font-bold bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-center"
                >
                  {t.login}
                </button>
              )}
            </div>
          </div>
        )}
      </nav>

      <AuthDialog
        isOpen={isLoginOpen}
        onOpenChange={setIsLoginOpen}
        onLoginSuccess={handleLoginSuccess}
      />
    </>
  );
};
