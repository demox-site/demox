import React, { useEffect, useState } from "react";
import { websiteApi } from "@/api";
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
    perUpload: "单次上限",
    loading: "加载中...",
    cumulativeHint: "文件数与体积为各站点单次部署的累计；对应上限为单次上传上限，进度按最大单站计算。",
    loadFailed: "用量加载失败，请稍后重试。"
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
    perUpload: "per-upload",
    loading: "Loading...",
    cumulativeHint: "File count and size are cumulative single-deploy figures across sites; their limits are per-upload caps, with progress based on the largest single site.",
    loadFailed: "Failed to load usage. Please retry later."
  }
} as const;

interface UsageData {
  role: { name: string; priority: number };
  usage: { deployments: number; files: number; storage: number };
  maxSite: { fileCount: number; storageSize: number };
  limits: {
    deployment_limit: number | null;
    max_file_count: number | null;
    max_file_size: number | null;
  };
}

const pct = (used: number, limit: number | null): number => {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
};

const UsagePage: React.FC = () => {
  const { language } = useLanguage();
  const t = texts[language];
  const navigate = useNavigate();
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await websiteApi.getUsage();
        if (res?.code === 0 && res.data) {
          setData(res.data);
        } else {
          setFailed(true);
        }
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const limits = data?.limits;
  const usage = data?.usage;
  const maxSite = data?.maxSite;

  // 部署次数：累计用量 vs 累计上限，进度有意义。
  const deploymentsUsed = usage?.deployments ?? 0;
  const deploymentsLimit = limits?.deployment_limit ?? null;
  const deploymentsText = deploymentsLimit
    ? `${deploymentsUsed} ${t.of} ${deploymentsLimit}`
    : `${deploymentsUsed} / ${t.unlimited}`;

  // 文件数量 / 存储空间：上限是单次上传上限，进度按最大单站计算（真正受约束的比例）。
  const filesUsed = usage?.files ?? 0;
  const filesLimit = limits?.max_file_count ?? null;
  const filesText = `${filesUsed} · ${t.perUpload} ${filesLimit ?? t.unlimited}`;
  const filesProgress = pct(maxSite?.fileCount ?? 0, filesLimit);

  const storageUsed = usage?.storage ?? 0;
  const storageLimit = limits?.max_file_size ?? null;
  const storageText = `${formatBytes(storageUsed)} · ${t.perUpload} ${storageLimit ? formatBytes(storageLimit) : t.unlimited}`;
  const storageProgress = pct(maxSite?.storageSize ?? 0, storageLimit);

  const quotaRow = (
    icon: React.ReactNode,
    label: string,
    usedText: string,
    progress: number
  ) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-[var(--stitch-ink)]">
          {icon}
          {label}
        </span>
        <span className="text-[var(--stitch-muted)] font-mono text-xs">{usedText}</span>
      </div>
      <Progress value={progress} className="h-1.5" />
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
              {loading ? t.loading : data?.role?.name || "user"}
            </span>
          </div>
          <Button onClick={() => navigate("/pricing")} className="stitch-action rounded-full">{t.upgrade}</Button>
        </CardContent>
      </Card>

      <Card className="stitch-panel">
        <CardHeader>
          <CardTitle>{t.quotaTitle}</CardTitle>
          <CardDescription className="text-[var(--stitch-muted)]">
            {failed ? t.loadFailed : t.cumulativeHint}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {quotaRow(
            <Rocket className="w-4 h-4 text-[var(--stitch-muted)]" />,
            t.deployments,
            deploymentsText,
            pct(deploymentsUsed, deploymentsLimit)
          )}
          {quotaRow(
            <FileStack className="w-4 h-4 text-[var(--stitch-muted)]" />,
            t.files,
            filesText,
            filesProgress
          )}
          {quotaRow(
            <HardDrive className="w-4 h-4 text-[var(--stitch-muted)]" />,
            t.storage,
            storageText,
            storageProgress
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default UsagePage;
