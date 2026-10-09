import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const rootEl = document.getElementById("root")!;

// 预览专用构建（VITE_ADMIN_BI_DEMO=1）：整站只渲染 BI 看板的「示例数据」演示，不挂载 App、不请求任何接口。
// 正式构建里这个条件恒为 false，演示代码会被摇掉。
if (import.meta.env.VITE_ADMIN_BI_DEMO === "1") {
  import("./pages/admin/bi/demo-entry").then(({ mountAdminBiDemo }) => mountAdminBiDemo(rootEl));
} else if (import.meta.env.VITE_CONSOLE_DEMO === "1") {
  // 预览专用构建（VITE_CONSOLE_DEMO=1）：渲染真实控制台，但接口全部由示例数据应答（src/demo/console-demo.ts），
  // 方便设计审阅颜色。?route=/console/... 指定打开哪一页（静态预览站没有 SPA 回退）。
  import("./demo/console-demo").then(({ installConsoleDemo }) => {
    installConsoleDemo(String(import.meta.env.VITE_DEMOX_API_URL || "").replace(/\/+$/, ""));
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    document.head.appendChild(robots);
    document.querySelectorAll("[data-crawlable-fallback]").forEach((el) => el.remove());
    const params = new URLSearchParams(window.location.search);
    const route = params.get("route") || "/console/admin/dashboard";
    if (params.get("lang")) localStorage.setItem("app_language", params.get("lang") === "en" ? "en" : "zh");
    if (params.get("theme")) localStorage.setItem("app_theme", params.get("theme") === "light" ? "light" : "dark");
    if (route.startsWith("/console")) {
      window.history.replaceState(null, "", route);
      // App 的 history 对象在模块加载时已读过地址，用 popstate 让它同步到新地址
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
    createRoot(rootEl).render(<App />);
  });
} else {
  createRoot(rootEl).render(<App />);
}
