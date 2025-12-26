import React from "react";
import { Helmet } from "react-helmet-async";
import { useLanguage } from "@/hooks/use-language";
import { siteConfig } from "@/configs/env";

interface SeoProps {
  title?: string;
  description?: string;
  keywords?: string[];
  image?: string;
}

const SITE_NAME = siteConfig.name;
const DEFAULT_IMAGE = `${siteConfig.url}og-image.png`;

export const Seo: React.FC<SeoProps> = ({
  title,
  description,
  keywords = [],
  image = DEFAULT_IMAGE
}) => {
  const { language } = useLanguage();

  const isZh = language === "zh";

  const defaultTitle = isZh
    ? "Demox - 前端静态网站托管部署平台"
    : "Demox - Frontend Static Website Hosting & Deployment Platform";

  const defaultDescription = isZh
    ? "Demox 是一个极简的静态网站托管平台。无需配置服务器，只需上传构建产物，即可获得公网访问链接。支持 CDN 加速、HTTPS、自动缓存策略。"
    : "Demox is a minimalist static website hosting platform. No server configuration required. Just upload your build artifacts and get a public link instantly. Supports CDN, HTTPS, and automatic caching strategies.";

  const defaultKeywords = isZh
    ? [
        "静态网站托管",
        "前端部署",
        "CDN加速",
        "HTTPS",
        "React部署",
        "Vue部署",
        "Demox"
      ]
    : [
        "Static Website Hosting",
        "Frontend Deployment",
        "CDN",
        "HTTPS",
        "React Deployment",
        "Vue Deployment",
        "Demox"
      ];

  const siteTitle = title ? `${title} | ${SITE_NAME}` : defaultTitle;
  const siteDescription = description || defaultDescription;
  const siteKeywords = [...defaultKeywords, ...keywords].join(", ");

  return (
    <Helmet>
      <html lang={language} />
      <title>{siteTitle}</title>
      <meta name="description" content={siteDescription} />
      <meta name="keywords" content={siteKeywords} />

      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={siteTitle} />
      <meta property="og:description" content={siteDescription} />
      <meta property="og:image" content={image} />
      <meta property="og:locale" content={isZh ? "zh_CN" : "en_US"} />
      <meta property="og:locale:alternate" content={isZh ? "en_US" : "zh_CN"} />

      <meta property="twitter:card" content="summary_large_image" />
      <meta property="twitter:title" content={siteTitle} />
      <meta property="twitter:description" content={siteDescription} />
      <meta property="twitter:image" content={image} />
    </Helmet>
  );
};
