import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/hooks/use-language";
import { ThemeProvider } from "@/hooks/use-theme";
import AdminBiDemoPage from "./AdminBiDemoPage";

export function mountAdminBiDemo(rootEl: HTMLElement) {
  document.title = "Demox Admin BI · Sample data";
  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex, nofollow";
  document.head.appendChild(robots);

  const params = new URLSearchParams(window.location.search);
  const theme = params.get("theme");
  if (theme === "light" || theme === "dark") {
    localStorage.setItem("app_theme", theme);
  } else if (!localStorage.getItem("app_theme")) {
    localStorage.setItem("app_theme", "dark");
  }
  if (params.get("lang") === "en" || params.get("lang") === "zh") {
    localStorage.setItem("app_language", params.get("lang")!);
  }

  // index.html 里给爬虫的静态兜底内容，演示页不需要
  document.querySelectorAll("[data-crawlable-fallback]").forEach((el) => el.remove());
  createRoot(rootEl).render(
    <ThemeProvider>
      <LanguageProvider>
        <AdminBiDemoPage />
      </LanguageProvider>
    </ThemeProvider>
  );
}
