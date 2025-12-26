import React from "react";

export const MainFooter: React.FC = () => {
  return (
    <footer className="border-t border-zinc-900 bg-zinc-950 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-zinc-800 rounded-sm flex items-center justify-center">
              <span className="text-zinc-500 text-[10px] font-bold">D</span>
            </div>
            <span className="text-zinc-500 text-sm">
              Demox © {new Date().getFullYear()}
            </span>
          </div>

          <div className="flex flex-col md:flex-row items-center gap-4 md:gap-8 text-sm text-zinc-500">
            <a
              href="mailto:phosa@qq.com"
              className="hover:text-zinc-300 transition-colors flex items-center gap-2"
            >
              <span>联系邮箱：phosa@qq.com</span>
            </a>
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-300 transition-colors flex items-center gap-2"
            >
              <span>陕ICP备2024025600号-1</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
