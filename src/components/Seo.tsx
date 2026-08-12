import React from "react";
import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";
import { useLanguage } from "@/hooks/use-language";
import { siteConfig } from "@/configs/env";

interface SeoProps {
  title?: string;
  description?: string;
  image?: string;
}

const SITE_NAME = siteConfig.name;
const DEFAULT_IMAGE = `${siteConfig.url}og-image.png`;
const INDEXABLE_PATHS = new Set(["/", "/index", "/pricing", "/doc", "/terms", "/privacy", "/log"]);

export const Seo: React.FC<SeoProps> = ({
  title,
  description,
  image = DEFAULT_IMAGE
}) => {
  const { language } = useLanguage();
  const { pathname } = useLocation();

  const isZh = language === "zh";

  const defaultTitle = isZh
    ? "Demox - 前端静态网站托管部署平台"
    : "Demox - Frontend Static Website Hosting & Deployment Platform";

  const defaultDescription = isZh
    ? "Demox 是一个极简的静态网站托管平台。无需配置服务器，只需上传构建产物，即可获得公网访问链接。支持 CDN 加速、HTTPS、自动缓存策略。"
    : "Demox is a minimalist static website hosting platform. No server configuration required. Just upload your build artifacts and get a public link instantly. Supports CDN, HTTPS, and automatic caching strategies.";

  const siteTitle = title ? `${title} | ${SITE_NAME}` : defaultTitle;
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
