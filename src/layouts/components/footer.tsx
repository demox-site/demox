import React from "react";
import { useLanguage } from "@/hooks/use-language";

const footerCopy = {
  zh: {
    whenToUse: "适用场景",
    freeHosting: "免费托管",
    mcp: "MCP 发布",
    troubleshooting: "发布排错",
    blocklist: "屏蔽词表",
    privacy: "隐私政策",
    terms: "服务条款",
    contact: "联系邮箱：phosa@qq.com",
  },
  en: {
    whenToUse: "When to use",
    freeHosting: "Free hosting",
    mcp: "MCP deploy",
    troubleshooting: "Troubleshooting",
    blocklist: "Blocklist",
    privacy: "Privacy",
    terms: "Terms",
    contact: "Contact: phosa@qq.com",
  },
} as const;

const linkClass = "hover:text-[var(--stitch-ink)] transition-colors";

export const MainFooter: React.FC = () => {
  const { language } = useLanguage();
  const t = footerCopy[language === "en" ? "en" : "zh"];

  return (
    <footer className="border-t border-[var(--stitch-line)] bg-[var(--stitch-surface)]/60 rounded-t-xl py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-[var(--stitch-blue-soft)] border border-[var(--stitch-line)] rounded-lg flex items-center justify-center">
              <span className="text-[var(--stitch-muted)] text-[10px] font-bold">D</span>
            </div>
            <span className="text-[var(--stitch-muted)] text-sm">
              Demox © {new Date().getFullYear()}
            </span>
          </div>

          <div className="flex flex-col md:flex-row items-center gap-4 md:gap-8 text-sm text-[var(--stitch-muted)]">
            <a href="/when-to-use-demox" className={linkClass}>{t.whenToUse}</a>
            <a href="/free-static-site-hosting" className={linkClass}>{t.freeHosting}</a>
            <a href="/mcp-website-deployment" className={linkClass}>{t.mcp}</a>
            <a href="/deploy-troubleshooting" className={linkClass}>{t.troubleshooting}</a>
            <a href="/content-scan" className={linkClass}>{t.blocklist}</a>
            <a href="/privacy" className={linkClass}>{t.privacy}</a>
            <a href="/terms" className={linkClass}>{t.terms}</a>
            <a href="mailto:phosa@qq.com" className={`${linkClass} flex items-center gap-2`}>
              <span>{t.contact}</span>
            </a>
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noreferrer"
              className={`${linkClass} flex items-center gap-2`}
            >
              <span>陕ICP备2024025600号-2</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
