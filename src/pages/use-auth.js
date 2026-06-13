import { useState, useEffect } from "react";
import { authApi, websiteApi, tokenManager, userManager } from "../api";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui";
import { isTokenExpiredError } from "@/lib/website-utils";

/**
 * useAuth
 * 负责登录态检查、角色限额加载、登出，以及统一的鉴权错误处理。
 * @param {Record<string,any>} t 翻译表
 * @returns 鉴权相关状态与方法
 */
export function useAuth(t) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [roleLimits, setRoleLimits] = useState(null);

  /**
   * checkAuthStatus
   * 检查登录态；允许重试一次，保持统一的用户对象结构
   */
  const checkAuthStatus = async (retry = true) => {
    console.log("Checking auth status...");
    try {
      const token = tokenManager.get();
      const storedUser = userManager.get();

      if (token && storedUser && storedUser.userId) {
        const u = {
          ...storedUser,
          userId: storedUser.userId,
          openId: storedUser.userId,
          nickName: storedUser.nickName || storedUser.email?.split("@")[0],
          email: storedUser.email
        };

        try {
          // 角色已存于登录态;无则默认普通用户
          if (!Array.isArray(u.roles) || u.roles.length === 0) {
            u.roles = ["user"];
          }

          let candidateRoles = ["user", ...u.roles];
          candidateRoles = [...new Set(candidateRoles)];
          const limitRes = await websiteApi.getRoleLimits(candidateRoles);

          let data = [];
          if (limitRes && limitRes.code === 0) {
            data = limitRes.data || [];
          } else {
            console.warn("getRoleLimits failed:", limitRes);
          }

          if (data && data.length > 0) {
            const sortedRoles = data.sort(
              (a, b) => (b.priority || 0) - (a.priority || 0)
            );
            const effectiveRole = sortedRoles[0];
            setRoleLimits(effectiveRole);
            u.role_name = effectiveRole.name || t.roleStandard;
          } else {
            console.warn("No role limits found in database");
            u.role_name = t.roleStandard;
          }
        } catch (roleError) {
          console.warn("Fetch user roles failed:", roleError);
          u.roles = ["user"];
          u.role_name = t.roleStandard;

          try {
            const userLimitRes = await websiteApi.getRoleLimits(["user"]);
            if (userLimitRes && userLimitRes.code === 0 && userLimitRes.data.length > 0) {
              setRoleLimits(userLimitRes.data[0]);
              u.role_name = userLimitRes.data[0].name || t.roleStandard;
            }
          } catch (limitError) {
            console.warn("Fallback fetch 'user' role limit failed:", limitError);
          }
        }

        setIsLoggedIn(true);
        setUser(u);
        setIsLoading(false);
      } else {
        if (retry) {
          console.log("No user found, retrying in 500ms...");
          setTimeout(() => checkAuthStatus(false), 500);
          return;
        }
        console.warn("No user found in login state");
        setIsLoggedIn(false);
        setUser(null);
        setIsLoading(false);
      }
    } catch (e) {
      console.warn("Auth check failed:", e);
      if (retry) {
        console.log("Auth check error, retrying in 500ms...");
        setTimeout(() => checkAuthStatus(false), 500);
        return;
      }
      setIsLoggedIn(false);
      setUser(null);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkAuthStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * handleLogout
   * 登出并清理本地状态；onAfterLogout 用于让调用方清理自己的状态（如站点列表）
   */
  const handleLogout = async (onAfterLogout) => {
    try {
      try {
        authApi.logout();
      } catch (err) {
        console.warn("SignOut error:", err);
      }

      setIsLoggedIn(false);
      setUser(null);
      if (typeof onAfterLogout === "function") onAfterLogout();
      toast({
        title: t.logoutSuccessTitle,
        description: t.logoutSuccessDesc
      });
      navigate("/", { replace: true });
    } catch (error) {
      toast({
        title: t.logoutFailedTitle,
        description: error.message,
        variant: "destructive"
      });
    }
  };

  /**
   * handleAuthError
   * 统一处理鉴权相关错误；凭证过期时弹框确认刷新页面
   */
  const handleAuthError = (error, fallbackToast = true) => {
    if (isTokenExpiredError(error)) {
      try {
        if (typeof window !== "undefined" && window.showTokenExpiredModal) {
          window.showTokenExpiredModal();
          return;
        }
      } catch {}
    }
    if (fallbackToast) {
      toast({
        title: t.loadFailedTitle,
        description:
          (error && (error.message || error.msg || error.error_description)) ||
          t.loadFailedDesc,
        variant: "destructive"
      });
    }
  };

  return {
    isLoading,
    isLoggedIn,
    user,
    roleLimits,
    setIsLoggedIn,
    setUser,
    checkAuthStatus,
    handleLogout,
    handleAuthError,
    navigate
  };
}
