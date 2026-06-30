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
    todoNote: "Usage metering endpoint pending; showing quota limits below."
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
          const sorted = (res.data as (RoleLimits & { priority?: number })[]).sort(
            (a, b) => (b.priority || 0) - (a.priority || 0)
          );
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
        <span className="flex items-center gap-2 text-[var(--stitch-ink)]">
          {icon}
          {label}
        </span>
        <span className="text-[var(--stitch-muted)] font-mono text-xs">{limitText}</span>
      </div>
      <Progress value={0} className="h-1.5" />
    </div>
  );

  return (
    <div className="stitch-page max-w-3xl">
      <div className="stitch-page-hero mb-8">
        <div className="stitch-eyebrow"><Gauge className="w-4 h-4" /> {t.title}</div>
        <h1 className="stitch-title">{t.title}</h1>
        <p className="stitch-subtitle">{t.subtitle}</p>
      </div>

      <Card className="stitch-panel mb-6">
        <CardHeader>
          <CardTitle>{t.planTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--stitch-blue-soft)] border border-[var(--stitch-line)] flex items-center justify-center">
              <Crown className="w-5 h-5 text-[var(--stitch-muted)]" />
            </div>
            <span className="text-lg font-bold capitalize">
              {loading ? t.loading : limits?.name || "user"}
            </span>
          </div>
          <Button onClick={() => navigate("/pricing")} className="stitch-action rounded-full">{t.upgrade}</Button>
        </CardContent>
      </Card>

      <Card className="stitch-panel">
        <CardHeader>
          <CardTitle>{t.quotaTitle}</CardTitle>
          <CardDescription className="text-[var(--stitch-muted)]">{t.todoNote}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {quotaRow(
            <HardDrive className="w-4 h-4 text-[var(--stitch-muted)]" />,
            t.storage,
            limits?.max_file_size ? formatBytes(limits.max_file_size) : t.unlimited
          )}
          {quotaRow(
            <FileStack className="w-4 h-4 text-[var(--stitch-muted)]" />,
            t.files,
            limits?.max_file_count ? String(limits.max_file_count) : t.unlimited
          )}
          {quotaRow(
            <Rocket className="w-4 h-4 text-[var(--stitch-muted)]" />,
            t.deployments,
            limits?.deployment_limit ? String(limits.deployment_limit) : t.unlimited
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default UsagePage;
