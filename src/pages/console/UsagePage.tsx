import React, { useEffect, useState } from "react";
import { userManager, websiteApi } from "@/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
  Button,
  Progress
} from "@/components/ui";
import { formatBytes } from "@/lib/utils";
import { Gauge, HardDrive, FileStack, Rocket, Crown } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useNavigate } from "react-router-dom";

const texts = {
  zh: {
    title: "用量与套餐",
    subtitle: "查看当前套餐配额与使用情况。",
    planTitle: "当前套餐",
    upgrade: "升级套餐",
    quotaTitle: "配额用量",
    storage: "存储空间",
    files: "文件数量",
    deployments: "部署次数",
    unlimited: "无限制",
    of: "/",
    loading: "加载中...",
    todoNote: "用量统计接口待接入，以下为配额上限展示。"
  },
  en: {
    title: "Usage & Plan",
    subtitle: "View your current plan quota and usage.",
    planTitle: "Current plan",
    upgrade: "Upgrade",
    quotaTitle: "Quota usage",
    storage: "Storage",
    files: "Files",
    deployments: "Deployments",
    unlimited: "Unlimited",
    of: "of",
    loading: "Loading...",
    todoNote:
      "Usage metering endpoint pending; showing quota limits below."
  }
} as const;

interface RoleLimits {
  name?: string;
  max_file_size?: number | null;
  max_file_count?: number | null;
  deployment_limit?: number | null;
}

const UsagePage: React.FC = () => {
  const { language } = useLanguage();
  const t = texts[language];
  const navigate = useNavigate();
  const [limits, setLimits] = useState<RoleLimits | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const user = userManager.get();
        const roles = (user?.roles as string[]) || ["user"];
        const res = await websiteApi.getRoleLimits(roles);
        if (res?.code === 0 && res.data?.length > 0) {
          const sorted = (res.data as (RoleLimits & {
            priority?: number;
          })[]).sort((a, b) => (b.priority || 0) - (a.priority || 0));
          setLimits(sorted[0]);
        }
      } catch {
        // ignore — show empty state
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const quotaRow = (
    icon: React.ReactNode,
    label: string,
    limitText: string
  ) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-zinc-300">
          {icon}
          {label}
        </span>
        <span className="text-zinc-500 font-mono text-xs">{limitText}</span>
      </div>
      {/* Usage value pending backend; bar shown at 0 for now */}
      <Progress value={0} className="h-1.5 bg-zinc-900" />
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Gauge className="w-7 h-7 text-zinc-400" />
          {t.title}
        </h1>
        <p className="text-sm text-zinc-500 mt-2">{t.subtitle}</p>
      </div>

      <Card className="bg-zinc-950/50 border-zinc-900 mb-6">
        <CardHeader>
          <CardTitle className="text-zinc-100">{t.planTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <Crown className="w-5 h-5 text-zinc-300" />
            </div>
            <span className="text-lg font-bold text-zinc-100 capitalize">
              {loading ? t.loading : limits?.name || "user"}
            </span>
          </div>
          <Button
            onClick={() => navigate("/pricing")}
            className="bg-zinc-100 text-black hover:bg-white"
          >
            {t.upgrade}
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-zinc-950/50 border-zinc-900">
        <CardHeader>
          <CardTitle className="text-zinc-100">{t.quotaTitle}</CardTitle>
          <CardDescription className="text-zinc-500">
            {t.todoNote}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {quotaRow(
            <HardDrive className="w-4 h-4 text-zinc-500" />,
            t.storage,
            limits?.max_file_size
              ? formatBytes(limits.max_file_size)
              : t.unlimited
          )}
          {quotaRow(
            <FileStack className="w-4 h-4 text-zinc-500" />,
            t.files,
            limits?.max_file_count ? String(limits.max_file_count) : t.unlimited
          )}
          {quotaRow(
            <Rocket className="w-4 h-4 text-zinc-500" />,
            t.deployments,
            limits?.deployment_limit
              ? String(limits.deployment_limit)
              : t.unlimited
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default UsagePage;
