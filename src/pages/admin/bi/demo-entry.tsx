import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/hooks/use-language";
import AdminBiDemoPage from "./AdminBiDemoPage";

export function mountAdminBiDemo(rootEl: HTMLElement) {
  document.title = "Demox Admin BI · Sample data";
  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex, nofollow";
  document.head.appendChild(robots);
  document.documentElement.classList.add("dark");
  // index.html 里给爬虫的静态兜底内容，演示页不需要
  document.querySelectorAll("[data-crawlable-fallback]").forEach((el) => el.remove());
  createRoot(rootEl).render(
    <LanguageProvider>
      <AdminBiDemoPage />
    </LanguageProvider>
  );
}
