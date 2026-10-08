/**
 * Gallery (screen 3) card list — single source of truth.
 * Shape is intentionally flat/serialisable so it can later be served by an admin-config API.
 *   preview: "image" → `image` is a URL; "coffee" | "www" | "preview" → built-in live mini renders.
 */
import shotVite from "@/assets/gallery/example-vite.webp";
import shotMd from "@/assets/gallery/example-md.webp";
import shotAi from "@/assets/gallery/example-ai.webp";
import shotTool from "@/assets/gallery/example-tool.webp";
import shotPortfolio from "@/assets/gallery/example-portfolio.webp";
import shotDocs from "@/assets/gallery/example-docs.webp";
import shotEssay from "@/assets/gallery/example-essay.webp";
import shotChangelog from "@/assets/gallery/example-changelog.webp";

export type GalleryCard = {
  id: string;
  title: string;
  url: string;          // public site URL (shown in the card bar)
  href?: string;        // optional click target if different from url
  preview: "image" | "coffee" | "www" | "preview";
  image?: string;
  caption: string;      // may contain <code>…</code> (zh / original wording)
  titleEn?: string;     // English title; omit when the title is the site's own name (shown as-is)
  captionEn?: string;   // English caption; may contain <code>…</code>
  row: 1 | 2;
  order: number;
  enabled: boolean;
};

export const GALLERY_CARDS: GalleryCard[] = [
  { id: "coffee", title: "好咖啡 · Coffee.", url: "https://coffee.demox.site/", preview: "coffee", caption: "用 Demox 搭建并发布的咖啡馆网站", captionEn: "A café website built and published with Demox", row: 1, order: 1, enabled: true },
  { id: "www", title: "Demox 主站", url: "https://www.demox.site/", href: "/how-demox-hosts-itself", preview: "www", caption: "第一方案例 · <code>demox deploy ./dist</code>", titleEn: "Demox website", captionEn: "Our own site · <code>demox deploy ./dist</code>", row: 1, order: 2, enabled: true },
  { id: "tool", title: "晚风番茄钟", url: "https://wanfeng-pomodoro.demox.site/", preview: "image", image: shotTool, caption: "AI 写的单页小工具 · <code>demox deploy ./tool</code>", captionEn: "Single-page tool written by AI · <code>demox deploy ./tool</code>", row: 1, order: 3, enabled: true },
  { id: "vite", title: "北线灯具 · 客户预览", url: "https://beixian-lighting.demox.site/", preview: "image", image: shotVite, caption: "Vite + React 构建产物 · <code>demox deploy ./dist</code>", captionEn: "Vite + React build output · <code>demox deploy ./dist</code>", row: 1, order: 4, enabled: true },
  { id: "ai", title: "夜班车 · 江岸 3 号泊位", url: "https://night-bus-riverside.demox.site/", preview: "image", image: shotAi, caption: "AI 生成的活动页 · <code>demox deploy index.html</code>", captionEn: "AI-generated event page · <code>demox deploy index.html</code>", row: 1, order: 5, enabled: true },
  { id: "portfolio", title: "远山设计 · 作品集", url: "https://yuanshan-design.demox.site/", preview: "image", image: shotPortfolio, caption: "发链接给客户在线评审", captionEn: "Send clients a link to review online", row: 1, order: 6, enabled: true },
  { id: "preview", title: "本页预览站", url: "https://preview.demox.site/", preview: "preview", caption: "验收预览站 preview.demox.site · <code>demox deploy</code>", titleEn: "Preview site for this page", captionEn: "Sign-off preview site preview.demox.site · <code>demox deploy</code>", row: 2, order: 1, enabled: true },
  { id: "md", title: "田间气象站 · 安装与校准手册", url: "https://field-weather-manual.demox.site/", preview: "image", image: shotMd, caption: "Markdown 转网页 · <code>demox deploy README.md</code>", captionEn: "Markdown to web page · <code>demox deploy README.md</code>", row: 2, order: 2, enabled: true },
  { id: "docs", title: "纸鹤 CLI · 快速开始", url: "https://zhihe-cli-docs.demox.site/", preview: "image", image: shotDocs, caption: "使用文档 · insight 模板", captionEn: "User docs · insight template", row: 2, order: 3, enabled: true },
  { id: "essay", title: "山间来信 · 第 12 封", url: "https://letters-from-the-hill.demox.site/", preview: "image", image: shotEssay, caption: "随笔博客 · warm 模板", captionEn: "Essay blog · warm template", row: 2, order: 4, enabled: true },
  { id: "changelog", title: "栖木笔记 · 更新日志", url: "https://qimu-notes-changelog.demox.site/", preview: "image", image: shotChangelog, caption: "CHANGELOG.md · dark 模板", captionEn: "CHANGELOG.md · dark template", row: 2, order: 5, enabled: true },
];

/** Card text in the UI language; falls back to the original fields when no English is set. */
export const cardTitle = (c: GalleryCard, lang: "zh" | "en") => (lang === "en" && c.titleEn) || c.title;
export const cardCaption = (c: GalleryCard, lang: "zh" | "en") => (lang === "en" && c.captionEn) || c.caption;

export const cardsForRow = (row: 1 | 2, list: GalleryCard[] = GALLERY_CARDS) =>
  list.filter((c) => c.enabled && c.row === row).sort((a, b) => a.order - b.order);
