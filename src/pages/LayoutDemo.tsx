import React from "react";
import { MainLayout } from "@/layouts/MainLayout";

const LayoutDemo: React.FC = () => {
  return (
    <MainLayout>
      <div className="space-y-6">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Layout 模式 Demo
        </h1>
        <p className="text-zinc-400 text-sm md:text-base leading-relaxed max-w-2xl">
          这是一个使用公共导航栏和页脚的示例页面。导航和页脚来自统一的
          Layout 组件，中间区域只负责渲染各自页面的内容。
        </p>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-6 space-y-4">
          <h2 className="text-xl font-semibold">当前结构</h2>
          <ul className="text-sm text-zinc-400 space-y-1 list-disc pl-5">
            <li>顶部：共享的 Nav（品牌 + 路由入口）</li>
            <li>中间：当前页面独有的内容区域</li>
            <li>底部：共享的 Footer（版权和说明）</li>
          </ul>
          <p className="text-xs text-zinc-500">
            未来可以让其他页面（如首页、控制台等）逐步迁移到同一个
            Layout 结构上，以减少重复代码并保持整体体验一致。
          </p>
        </div>
      </div>
    </MainLayout>
  );
};

export default LayoutDemo;

