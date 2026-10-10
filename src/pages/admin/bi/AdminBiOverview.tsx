/**
 * 管理后台 BI 概览。
 * - 首屏：时间范围 + 8 张 KPI 卡，加载即完整显示（没有进场动画，数据未到时用固定高度骨架）；
 * - 首屏以下：增长 / 使用 / 流量 / 健康 4 个区块，图表代码单独分包（BiSections），滚动到才淡入；
 * - mock=true 时只用本地示例数据（fixtures），不请求任何接口。
 */
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useInkPalette } from "@/lib/ink-palette";
import { Activity, ArrowDownRight, ArrowUpRight, Crown, Flag, Globe, MousePointerClick, RefreshCw, Rocket, UserPlus } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { adminApi } from "@/api";
import type { AdminBiData, BiRange, BiSeriesPoint } from "./types";
import { biText, fill } from "./bi-i18n";
import { definedValues, delta, fmtNum, fmtPct, fmtSinceDate } from "./format";

const BiSections = React.lazy(() => import("./BiSections"));

const RANGES: BiRange[] = [7, 30, 90];

type Kpi = {
  id: string;
  label: string;
  /** 手机端标题：更短，保证 375px 宽也能完整显示（不截断、不加省略号） */
  short: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  hint: string;
  change: number | null;
  goodWhenUp: boolean;
  warn?: boolean;
  spark?: number[];
};

function Sparkline({ values }: { values: number[] }) {
  const ink = useInkPalette();
  if (!values.length || values.every((v) => v === 0)) return <div className="h-6 md:h-8" />;
  const w = 120;
  const h = 32;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-6 w-full md:h-8" aria-hidden="true">
      <polygon points={`0,${h} ${pts.join(" ")} ${w},${h}`} fill={ink.wash} />
      <polyline points={pts.join(" ")} fill="none" stroke={ink.mid} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function KpiCard({ kpi, loading, vsPrev }: { kpi: Kpi; loading: boolean; vsPrev: string }) {
  const Icon = kpi.icon;
  const up = kpi.change != null && kpi.change > 0;
  const down = kpi.change != null && kpi.change < 0;
  const good = (up && kpi.goodWhenUp) || (down && !kpi.goodWhenUp);
  return (
    <div
      className={`flex min-h-[124px] flex-col rounded-xl border p-3 md:min-h-[156px] md:p-4 ${kpi.warn ? "border-zinc-400 bg-zinc-900" : "border-zinc-800 bg-zinc-900"}`}
      data-kpi={kpi.id}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`flex min-w-0 items-center gap-1.5 text-xs ${kpi.warn ? "font-medium text-zinc-100" : "text-zinc-400"}`}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-300">
            <Icon className="h-3 w-3" />
          </span>
          <span className="min-w-0 break-words leading-tight md:hidden" data-kpi-title>{kpi.short}</span>
          <span className="hidden min-w-0 break-words leading-tight md:inline" data-kpi-title>{kpi.label}</span>
        </span>
        {!loading && kpi.change != null ? (
          <span
            className={`flex shrink-0 items-center text-[11px] font-medium tabular-nums ${good ? "text-success" : "text-zinc-400"}`}
            title={vsPrev}
          >
            {up ? <ArrowUpRight className="h-3 w-3" /> : down ? <ArrowDownRight className="h-3 w-3" /> : null}
            {fmtPct(Math.abs(kpi.change), 0)}
          </span>
        ) : null}
      </div>
      {loading ? (
        <>
          <div className="mt-3 h-7 w-24 animate-pulse rounded bg-zinc-800" />
          <div className="mt-2 h-3 w-36 animate-pulse rounded bg-zinc-800/70" />
          <div className="mt-auto h-6 animate-pulse rounded bg-zinc-800/40 md:h-8" />
        </>
      ) : (
        <>
          <div className="mt-1.5 text-xl font-semibold tabular-nums tracking-tight text-zinc-50 md:mt-2 md:text-2xl">{kpi.value}</div>
          <div className={`mt-1 break-words text-xs leading-snug ${kpi.warn ? "text-zinc-200" : "text-zinc-500"}`} title={kpi.hint}>
            {kpi.hint}
          </div>
          <div className="mt-auto">{kpi.spark ? <Sparkline values={kpi.spark} /> : <div className="h-6 md:h-8" />}</div>
        </>
      )}
    </div>
  );
}

const pick = (series: BiSeriesPoint[], f: (p: BiSeriesPoint) => number | null) => series.map((p) => Number(f(p) || 0));
/** 部署按天合计；没有任何记录的日子是 null（迷你折线里跳过，不画 0） */
const deployTotal = (p: BiSeriesPoint): number | null =>
  p.deploySuccess == null && p.deployFail == null && p.deployDerived == null
    ? null
    : Number(p.deploySuccess || 0) + Number(p.deployFail || 0) + Number(p.deployDerived || 0);

export default function AdminBiOverview({ mock = false }: { mock?: boolean }) {
  const { language } = useLanguage();
  const t = biText(language);
  const [range, setRange] = useState<BiRange>(30);
  const [data, setData] = useState<AdminBiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (r: BiRange) => {
    setLoading(true);
    setError(null);
    try {
      if (mock) {
        const { buildFixture } = await import("./fixtures");
        setData(buildFixture(r));
      } else {
        const res = await adminApi.getAdminBi(r);
        if (!res.success || !res.data) throw new Error(res.message || "get_admin_bi failed");
        setData(res.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mock]);

  useEffect(() => {
    load(range);
  }, [load, range]);

  const kpis = useMemo<Kpi[]>(() => {
    const k = data?.kpis;
    const s = data?.series || [];
    const n = (v: number | null | undefined) => fmtNum(v, language);
    const deployRate = k?.deploys?.successRate;
    // 本期没被服务端埋点完整覆盖：提示从哪天开始算；上期不完整时后端给 prev=null，涨跌箭头自然不显示
    const deploySince = k?.deploys && k.deploys.complete === false && k.deploys.trackedSince ? fmtSinceDate(k.deploys.trackedSince, language) : "";
    return [
      {
        id: "newUsers", label: t.kNewUsers, short: t.kNewUsersShort, icon: UserPlus, goodWhenUp: true,
        value: n(k?.newUsers?.value), hint: fill(t.kNewUsersHint, { total: n(k?.newUsers?.total) }),
        change: delta(k?.newUsers?.value, k?.newUsers?.prev), spark: pick(s, (p) => p.newUsers)
      },
      {
        id: "activeDeployers", label: t.kActive, short: t.kActiveShort, icon: Activity, goodWhenUp: true,
        value: n(k?.activeDeployers7d?.value), hint: t.kActiveHint,
        change: delta(k?.activeDeployers7d?.value, k?.activeDeployers7d?.prev)
      },
      {
        id: "deploys", label: t.kDeploys, short: t.kDeploysShort, icon: Rocket, goodWhenUp: true,
        value: n(k?.deploys?.value),
        hint: k?.deploys
          ? fill(deploySince ? t.kDeploysSinceHint : t.kDeploysHint, { rate: fmtPct(deployRate), fail: n(k.deploys.fail), d: deploySince })
          : t.unavailable,
        change: delta(k?.deploys?.value, k?.deploys?.prev),
        warn: deployRate != null && deployRate < 0.8,
        spark: definedValues(s.map(deployTotal))
      },
      {
        id: "sites", label: t.kSites, short: t.kSitesShort, icon: Globe, goodWhenUp: true,
        value: n(k?.sites?.value), hint: fill(t.kSitesHint, { total: n(k?.sites?.total) }),
        change: delta(k?.sites?.value, k?.sites?.prev), spark: pick(s, (p) => p.newSites)
      },
      {
        id: "pv", label: t.kPv, short: t.kPvShort, icon: Activity, goodWhenUp: true,
        value: n(k?.pv?.value), hint: fill(t.kPvHint, { uv: n(k?.uv?.value) }),
        change: delta(k?.pv?.value, k?.pv?.prev), spark: pick(s, (p) => p.pv)
      },
      {
        id: "funnel", label: t.kFunnel, short: t.kFunnelShort, icon: MousePointerClick, goodWhenUp: true,
        value: fmtPct(k?.funnel?.successRate),
        hint: k?.funnel
          ? fill(t.kFunnelHint, { landing: n(k.funnel.landing), click: n(k.funnel.deployClick), success: n(k.funnel.deploySuccess) })
          : t.unavailable,
        change: delta(k?.funnel?.deployClick, k?.funnel?.prevDeployClick),
        spark: definedValues(s.map((p) => p.landing))
      },
      {
        id: "pro", label: t.kPro, short: t.kProShort, icon: Crown, goodWhenUp: true,
        value: n(k?.pro?.active),
        hint: k?.pro ? fill(t.kProHint, { n: n(k.pro.expiring30d), m: n(k.pro.lifetime) }) : t.unavailable,
        change: null
      },
      {
        id: "reports", label: t.kReports, short: t.kReportsShort, icon: Flag, goodWhenUp: false,
        value: n(k?.reports?.open),
        hint: k?.reports ? fill(t.kReportsHint, { n: n(k.reports.recent) }) : t.unavailable,
        change: null,
        warn: (k?.reports?.open || 0) > 0
      }
    ];
  }, [data, language, t]);

  const showSkeleton = loading && !data;
  const updated = data ? new Date(data.generatedAt).toLocaleTimeString(language === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }) : "";

  return (
    <div className="space-y-4 md:space-y-6" data-testid="admin-bi">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100 md:text-2xl">{t.title}</h1>
            {mock ? (
              <span className="rounded-full border border-zinc-600 bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-100" data-testid="bi-demo-badge">
                {t.demoBadge}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-zinc-400 md:text-sm">{mock ? t.demoNote : t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5" role="tablist">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={range === r}
                onClick={() => setRange(r)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${range === r ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {fill(t.rangeDays, { n: r })}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => load(range)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {t.refresh}
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex items-center justify-between rounded-lg border border-zinc-500 bg-zinc-900 px-4 py-2 text-sm text-zinc-100">
          <span>{t.loadFailed}: {error}</span>
          <button type="button" className="underline" onClick={() => load(range)}>{t.retry}</button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 md:gap-3 lg:grid-cols-4" data-testid="bi-kpis">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.id} kpi={kpi} loading={showSkeleton} vsPrev={t.vsPrev} />
        ))}
      </div>

      {data ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
          <span>{data.range.start} → {data.range.end} · {data.tz}</span>
          {updated ? <span>{fill(t.updatedAt, { t: updated })}{data.cached ? ` · ${t.cached}` : ""}</span> : null}
          <span>{t.noteDeploys}</span>
        </div>
      ) : null}

      <Suspense fallback={<div className="min-h-[1200px]" />}>
        {data ? <BiSections data={data} /> : <div className="min-h-[1200px]" />}
      </Suspense>
    </div>
  );
}
