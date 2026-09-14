import React from "react";
import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";
import { useLanguage } from "@/hooks/use-language";
import { siteConfig } from "@/configs/env";
import { INTENT_LANDINGS } from "@/content/intent-landings.mjs";

interface SeoProps {
  title?: string;
  description?: string;
  image?: string;
}

const SITE_NAME = siteConfig.name;
const DEFAULT_IMAGE = `${siteConfig.url}og-image.png`;
const INDEXABLE_PATHS = new Set([
  "/",
  "/index",
  "/pricing",
  "/doc",
  "/content-scan",
  "/ai-static-site-deployment",
  "/when-to-use-demox",
  "/deploy-troubleshooting",
  "/how-demox-hosts-itself",
  ...INTENT_LANDINGS.map((page) => `/${page.id}`),
  "/terms",
  "/privacy",
  "/log"
]);

export const Seo: React.FC<SeoProps> = ({
  title,
  description,
  image = DEFAULT_IMAGE
}) => {
  const { language } = useLanguage();
  const { pathname } = useLocation();

  const isZh = language === "zh";

  const defaultTitle = isZh
    ? "免费静态网站发布平台，支持 CLI 和 MCP | Demox"
    : "Free Static Website Hosting with CLI & MCP | Demox";

  const defaultDescription = isZh
    ? "将 AI 生成的 HTML、ZIP、React/Vue/Vite 构建产物一键发布为公网网站，无需 Git，无需服务器配置。支持网页、CLI 与 MCP。"
    : "Demox is a free static website hosting platform for AI-generated websites. Deploy HTML, ZIP, React/Vue/Vite builds through drag-and-drop, CLI or MCP and get a public HTTPS URL.";

  const siteTitle = title
    ? title.includes(SITE_NAME)
      ? title
      : `${title} | ${SITE_NAME}`
    : defaultTitle;
  const siteDescription = description || defaultDescription;
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const canonicalPath = normalizedPath === "/index" ? "/" : normalizedPath;
  const siteOrigin = siteConfig.url.replace(/\/+$/, "");
  const canonicalUrl = `${siteOrigin}${canonicalPath === "/" ? "/" : canonicalPath}`;
  const shouldIndex = INDEXABLE_PATHS.has(normalizedPath);
  const robots = shouldIndex
    ? "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
    : "noindex, nofollow";

  return (
    <Helmet>
      <html lang={language} />
      <title>{siteTitle}</title>
      <meta name="description" content={siteDescription} />
      <meta name="robots" content={robots} />
      <link rel="canonical" href={canonicalUrl} />

      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={siteTitle} />
      <meta property="og:description" content={siteDescription} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:image" content={image} />
      <meta property="og:image:alt" content={`${SITE_NAME} static site deployment platform`} />
      <meta property="og:locale" content={isZh ? "zh_CN" : "en_US"} />
      <meta property="og:locale:alternate" content={isZh ? "en_US" : "zh_CN"} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={siteTitle} />
      <meta name="twitter:description" content={siteDescription} />
      <meta name="twitter:image" content={image} />
    </Helmet>
  );
};
