import React from "react";
import { MainLayout } from "@/layouts/MainLayout";
import { Card, CardHeader, CardTitle, CardContent, Button } from "@/components/ui";
import { Plus, RefreshCw } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";

const translations = {
  zh: {
    pageTitle: "示例页面",
    pageSubtitle: "这是一个遵循设计规范的示例页面",
    cardTitle: "内容卡片",
    addButton: "添加",
    refreshButton: "刷新",
    cardContent: "卡片内容区域"
  },
  en: {
    pageTitle: "Example Page",
    pageSubtitle: "This is an example page following design guidelines",
    cardTitle: "Content Card",
    addButton: "Add",
    refreshButton: "Refresh",
    cardContent: "Card content area"
  }
};

export default function ExamplePage() {
  const { language: lang } = useLanguage();
  const t = translations[lang];

  return (
    <MainLayout>
      <div className="relative z-10">
        {/* Page Title */}
        <div className="mb-10">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            {t.pageTitle}
          </h1>
          <p className="text-sm text-zinc-500 mt-2">{t.pageSubtitle}</p>
        </div>

        {/* Main Content Card */}
        <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm">
          <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
            <CardTitle className="text-zinc-100 flex items-center justify-between">
              <span>{t.cardTitle}</span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="bg-zinc-100 text-black hover:bg-zinc-200"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  {t.addButton}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {t.refreshButton}
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8">
            <p className="text-zinc-400">{t.cardContent}</p>
          </CardContent>
        </Card>

        {/* Grid Background Decoration */}
        <div className="fixed inset-0 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] -z-10 pointer-events-none" />
      </div>
    </MainLayout>
  );
}
