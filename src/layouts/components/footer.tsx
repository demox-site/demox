import React from "react";

export const MainFooter: React.FC = () => {
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
            <a
              href="/when-to-use-demox"
              className="hover:text-[var(--stitch-ink)] transition-colors"
            >
              适用场景
            </a>
            <a
              href="/deploy-troubleshooting"
              className="hover:text-[var(--stitch-ink)] transition-colors"
            >
              发布排错
            </a>
            <a
              href="/content-scan"
              className="hover:text-[var(--stitch-ink)] transition-colors"
            >
              屏蔽词表
            </a>
            <a
              href="/privacy"
              className="hover:text-[var(--stitch-ink)] transition-colors"
            >
              Privacy
            </a>
            <a
              href="/terms"
              className="hover:text-[var(--stitch-ink)] transition-colors"
            >
              Terms
            </a>
            <a
              href="mailto:phosa@qq.com"
              className="hover:text-[var(--stitch-ink)] transition-colors flex items-center gap-2"
            >
              <span>联系邮箱：phosa@qq.com</span>
            </a>
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noreferrer"
              className="hover:text-[var(--stitch-ink)] transition-colors flex items-center gap-2"
            >
              <span>陕ICP备2024025600号-2</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
