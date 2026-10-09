import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const rootEl = document.getElementById("root")!;

// 预览专用构建（VITE_ADMIN_BI_DEMO=1）：整站只渲染 BI 看板的「示例数据」演示，不挂载 App、不请求任何接口。
// 正式构建里这个条件恒为 false，演示代码会被摇掉。
if (import.meta.env.VITE_ADMIN_BI_DEMO === "1") {
  import("./pages/admin/bi/demo-entry").then(({ mountAdminBiDemo }) => mountAdminBiDemo(rootEl));
} else {
  createRoot(rootEl).render(<App />);
}
