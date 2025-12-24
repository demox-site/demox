import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
// 在线编辑器插件，本地开发时可删除
import cloudStudio from './vite-plugin-cloudstudio'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), cloudStudio()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    "process.env.isApp": false,
  },
}));
