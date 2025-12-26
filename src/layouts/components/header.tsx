import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth } from "@/cloudbase";
import { AuthDialog } from "@/components/AuthDialog";
import { useLanguage } from "@/hooks/use-language";
import logo from "@/assets/logo.png";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
  Settings,
  CreditCard,
  FileText
} from "lucide-react";

const navbarTexts = {
  zh: {
    pricing: "价格",
    log: "日志",
    login: "登录",
    console: "控制台",
    logout: "退出登录",
    settings: "账号设置"
  },
  en: {
    pricing: "Pricing",
    log: "Log",
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
    const checkLoginState = async () => {
      const loginState = await auth.getLoginState();
      if (loginState) {
        setUser(loginState.user);
      }
    };
    checkLoginState();
  }, []);

  const handleLoginSuccess = async () => {
    const loginState = await auth.getLoginState();
    if (loginState) {
      setUser(loginState.user);
    }
    navigate("/home");
  };

  const handleLogout = async () => {
    await auth.signOut();
    setUser(null);
    navigate("/index");
  };

  return (
    <>
      <nav className="border-b border-zinc-800 bg-black/50 backdrop-blur-md sticky top-0 z-50">
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
                className="h-8 w-auto object-contain group-hover:scale-105 transition-transform duration-300"
              />
            </button>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-6">
              {/* Language Switcher - Always visible */}
              <button
                type="button"
                onClick={toggleLang}
                className="text-zinc-400 hover:text-zinc-100 transition-colors flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-zinc-900/50"
              >
                <Languages size={16} />
                <span className="text-xs font-mono uppercase">{lang}</span>
              </button>

              {/* Global navigation: Pricing & Log */}
              <button
                type="button"
                onClick={() => navigate("/pricing")}
                className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                {t.pricing}
              </button>
              <button
                type="button"
                onClick={() => navigate("/log")}
                className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                {t.log}
              </button>

              {user ? (
                <>
                  <div className="w-px h-4 bg-zinc-800 mx-2" />

                  {/* Console CTA - Primary Action */}
                  <button
                    type="button"
                    onClick={() => navigate("/home")}
                    className="flex items-center gap-2 px-5 py-2 bg-zinc-100 text-black text-sm font-bold rounded-md hover:-translate-y-0.5 hover:shadow-[0_0_15px_rgba(255,255,255,0.15)] transition-all duration-300"
                  >
                    <LayoutDashboard size={16} />
                    {t.console}
                  </button>

                  {/* User Dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="ml-2 outline-none rounded-full ring-offset-2 ring-offset-black focus:ring-2 focus:ring-zinc-700 transition-all">
                        <Avatar className="h-9 w-9 border border-zinc-800 hover:border-zinc-600 transition-colors">
                          <AvatarImage
                            src={user.avatarUrl}
                            alt={user.nickName}
                          />
                          <AvatarFallback className="bg-zinc-900 text-zinc-400 text-xs font-mono">
                            {user.nickName?.[0]?.toUpperCase() || (
                              <User size={16} />
                            )}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      className="w-64 bg-zinc-950/95 backdrop-blur-xl border-zinc-800 text-zinc-400 p-1.5 shadow-2xl"
                      align="end"
                      sideOffset={8}
                    >
                      {/* User Info Header */}
                      <div className="flex items-center gap-3 p-2 mb-1 border-b border-zinc-900 pb-3">
                        <Avatar className="h-8 w-8 border border-zinc-800">
                          <AvatarImage src={user.avatarUrl} />
                          <AvatarFallback className="bg-zinc-900 text-zinc-500 text-xs">
                            <User size={14} />
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col overflow-hidden">
                          <span className="text-sm font-medium text-zinc-100 truncate">
                            {user.nickName || "User"}
                          </span>
                          <span className="text-xs text-zinc-500 truncate font-mono">
                            {maskEmail(user.email)}
                          </span>
                        </div>
                      </div>

                      <DropdownMenuSeparator className="bg-zinc-900 my-1" />

                      <DropdownMenuItem
                        onClick={handleLogout}
                        className="cursor-pointer text-red-400 focus:bg-red-950/20 focus:text-red-300 my-0.5"
                      >
                        <LogOut className="mr-2 h-4 w-4" />
                        <span>{t.logout}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <>
                  <div className="w-px h-4 bg-zinc-800 mx-2" />
                  <button
                    type="button"
                    onClick={() => setIsLoginOpen(true)}
                    className="px-4 py-2 text-sm font-medium border border-zinc-800 text-zinc-100 rounded-md hover:bg-zinc-100 hover:text-black hover:border-zinc-100 transition-all duration-300"
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
                  onClick={() => navigate("/home")}
                  className="p-2 text-zinc-400 hover:text-zinc-100"
                >
                  <LayoutDashboard size={20} />
                </button>
              )}
              <button
                type="button"
                onClick={toggleLang}
                className="text-zinc-400 hover:text-zinc-100 flex items-center gap-1"
              >
                <Languages size={20} />
                <span className="text-xs font-mono uppercase">{lang}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="text-zinc-400 hover:text-zinc-100"
              >
                {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Dropdown */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-b border-zinc-800 bg-black animate-in slide-in-from-top-2 duration-200">
            <div className="px-4 py-4 space-y-4">
              <button
                type="button"
                onClick={() => navigate("/pricing")}
                className="flex items-center gap-3 text-sm text-zinc-400 hover:text-zinc-100 w-full text-left p-2 rounded-md hover:bg-zinc-900"
              >
                <CreditCard size={16} />
                {t.pricing}
              </button>
              <button
                type="button"
                onClick={() => navigate("/log")}
                className="flex items-center gap-3 text-sm text-zinc-400 hover:text-zinc-100 w-full text-left p-2 rounded-md hover:bg-zinc-900"
              >
                <FileText size={16} />
                {t.log}
              </button>

              {user ? (
                <>
                  <div className="h-px bg-zinc-900 w-full my-2" />
                  <div className="flex items-center gap-3 p-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user.avatarUrl} />
                      <AvatarFallback className="bg-zinc-800 text-zinc-400">
                        {user.nickName?.[0] || <User size={14} />}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      <span className="text-sm text-zinc-200">
                        {user.nickName || "User"}
                      </span>
                      <span className="text-xs text-zinc-500 font-mono">
                        {maskEmail(user.email)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex items-center gap-3 w-full text-left px-2 py-2 text-sm font-medium text-red-400 hover:bg-red-950/20 rounded-md transition-colors"
                  >
                    <LogOut size={16} />
                    {t.logout}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsLoginOpen(true)}
                  className="w-full mt-4 px-4 py-3 text-sm font-bold bg-zinc-100 text-black rounded-md hover:bg-white transition-colors text-center"
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
