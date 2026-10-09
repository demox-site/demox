/**
 * 预览专用：只在 VITE_ADMIN_BI_DEMO=1 的构建里由 main.tsx 挂载到站点根路径（正式 www 构建会把这段整个摇掉）。
 * 只渲染示例数据，不需要登录，不请求任何接口。?lang=en 切英文。
 */
import { useEffect } from "react";
import { useLanguage } from "@/hooks/use-language";
import AdminBiOverview from "./AdminBiOverview";

export default function AdminBiDemoPage() {
  const { language, setLanguage } = useLanguage();
  useEffect(() => {
    const lang = new URLSearchParams(window.location.search).get("lang");
    if (lang === "en" || lang === "zh") setLanguage(lang);
  }, [setLanguage]);
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-4 md:py-8">
        <div className="mb-4 flex items-center justify-between md:mb-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-zinc-100">
              <span className="text-sm font-bold text-black">A</span>
            </div>
            <span className="text-xl font-bold tracking-tight">Admin</span>
          </div>
          <button
            type="button"
            onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
            className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            {language === "zh" ? "EN" : "\u4e2d"}
          </button>
        </div>
        <AdminBiOverview mock />
      </div>
    </div>
  );
}
