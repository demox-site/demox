/**
 * BI 看板首屏以下的 4 个区块（增长 / 使用 / 流量 / 健康）。
 * 单独分包（recharts 图表都在这里），滚动进入视口时淡入；首屏 KPI 不依赖本文件。
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useInkPalette } from "@/lib/ink-palette";
import { formatBytes } from "@/lib/utils";
import { shortDateLabel } from "@/lib/stat-date";
import type { AdminBiData, BiSeriesPoint, BiTopItem } from "./types";
import { biText, fill, sourceLabel, type BiText } from "./bi-i18n";
import { fmtNum, fmtPct, fmtSinceDate } from "./format";

/**
 * 配色规则（设计）：全站只用黑 / 白 / 灰；绿色只表示变好或成功，其他颜色一律不用。
 * 后台是深色底，所以三档灰阶按「对比度」排：INK 最强（深色底上接近白）、MID 中灰、LOW 浅（弱）灰。
 * 每张图最多 3 条系列；系列名直接标在线尾，次要系列再用虚线区分，不只靠图例。
 */
// 颜色跟着亮 / 暗主题走（src/lib/ink-palette.ts）：亮色下主系列是墨黑、次系列中灰；暗色下反过来接近白。

/** 线尾直接标注系列名：只在最后一个点画文字。 */
function EndLabel(props: { x?: number | string; y?: number | string; index?: number; lastIndex: number; text: string; color: string; dy?: number }) {
  const { x, y, index, lastIndex, text, color, dy = 0 } = props;
  if (index !== lastIndex || x == null || y == null) return null;
  return (
    <text x={Number(x) + 6} y={Number(y) + dy} dy={4} fill={color} fontSize={11} fontWeight={500}>
      {text}
    </text>
  );
}

/** 堆叠柱的线尾标注：标在最后一根柱子对应段的右侧。 */
function BarEndLabel(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; index?: number; lastIndex: number; text: string; color: string; dy?: number }) {
  const { x, y, width, height, index, lastIndex, text, color, dy = 0 } = props;
  if (index !== lastIndex || x == null || y == null) return null;
  return (
    <text x={Number(x) + Number(width || 0) + 6} y={Number(y) + Number(height || 0) / 2 + dy} dy={4} fill={color} fontSize={11} fontWeight={500}>
      {text}
    </text>
  );
}

/**
 * 部署柱状图的悬停提示：按这天的数据来源说清楚，补算的日子只给总数，没有记录的日子写「暂无数据」，不写 0。
 */
function DeployTooltip(props: {
  active?: boolean;
  payload?: Array<{ payload?: BiSeriesPoint & { label: string } }>;
  t: BiText;
  n: (v: number | null | undefined) => string;
  style: React.CSSProperties;
}) {
  const { active, payload, t, n, style } = props;
  const p = active && payload && payload[0] ? payload[0].payload : undefined;
  if (!p) return null;
  const rows: Array<[string, string]> = [];
  if (p.deploySuccess != null) rows.push([t.sSuccess, n(p.deploySuccess)]);
  if (p.deployFail != null) rows.push([t.sFail, n(p.deployFail)]);
  if (p.deployDerived != null) rows.push([t.sDerived, n(p.deployDerived)]);
  // 开始那天画的是补算时，埋点已记到的数也写出来（只是提示，不叠到柱子上）
  if (p.deploySource === "mixed" && p.deployDerived != null && p.deployLiveTotal != null) rows.push([t.sLiveSoFar, n(p.deployLiveTotal)]);
  return (
    <div style={{ ...style, padding: "6px 10px" }} data-deploy-tooltip={p.deploySource || "events"}>
      <div style={{ marginBottom: 2, fontWeight: 500 }}>{p.label}</div>
      {rows.length ? rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>{k}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span>
        </div>
      )) : <div>{t.noData}</div>}
    </div>
  );
}

/** 分界线上的小字：标在线的左侧（指向补算的日子），不压到柱子上方 */
function DividerLabel(props: { viewBox?: { x?: number; y?: number }; text: string; color: string }) {
  const { viewBox, text, color } = props;
  if (!viewBox || viewBox.x == null || viewBox.y == null) return null;
  return (
    <text x={viewBox.x - 6} y={viewBox.y + 10} textAnchor="end" fill={color} fontSize={10}>
      {text}
    </text>
  );
}

function Reveal({ children, id }: { children: React.ReactNode; id: string }) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return true;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  });
  useEffect(() => {
    if (visible || !ref.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 }
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible]);
  return (
    <section
      ref={ref}
      id={id}
      data-bi-section={id}
      className={`transition-all duration-700 ease-out ${visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
    >
      {children}
    </section>
  );
}

function SectionHead({ title, desc, index }: { title: string; desc: string; index: number }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <span className="font-mono text-xs text-zinc-500">0{index}</span>
      <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
      <span className="text-xs text-zinc-500">{desc}</span>
    </div>
  );
}

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-800 bg-zinc-900 p-4 ${className}`}>
      <div className="mb-3 text-sm font-medium text-zinc-300">{title}</div>
      {children}
    </div>
  );
}

function Empty({ t }: { t: BiText }) {
  return <div className="flex h-40 items-center justify-center text-sm text-zinc-500">{t.noData}</div>;
}

function BarList({ items, t, format }: { items: BiTopItem[]; t: BiText; format: (it: BiTopItem) => string }) {
  const { language } = useLanguage();
  if (!items.length) return <Empty t={t} />;
  const max = Math.max(...items.map((i) => i.views), 1);
  return (
    <ul className="space-y-1.5">
      {items.map((it) => (
        <li key={it.key} className="relative overflow-hidden rounded-md bg-zinc-950/60 px-2.5 py-1.5 text-xs">
          <div className="absolute inset-y-0 left-0 bg-zinc-700/40" style={{ width: `${(it.views / max) * 100}%` }} />
          <div className="relative flex items-center justify-between gap-3">
            <span className="truncate text-zinc-200">{format(it)}</span>
            <span className="shrink-0 tabular-nums text-zinc-400">{fmtNum(it.views, language)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warn" }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${tone === "warn" ? "text-white underline decoration-zinc-500 underline-offset-4" : "text-zinc-100"}`}>{value}</div>
    </div>
  );
}

export default function BiSections({ data }: { data: AdminBiData }) {
  const { language } = useLanguage();
  const t = biText(language);
  const n = (v: number | null | undefined) => fmtNum(v, language);
  const series = data.series.map((p) => ({ ...p, label: shortDateLabel(p.date) }));
  const k = data.kpis;
  const funnelSteps = k.funnel
    ? [
        { label: t.fLanding, value: k.funnel.landing },
        { label: t.fClick, value: k.funnel.deployClick },
        { label: t.fSuccess, value: k.funnel.deploySuccess }
      ]
    : [];
  const funnelMax = Math.max(...funnelSteps.map((s) => s.value), 1);
  const sources = data.deploySources.map((s) => ({ ...s, label: sourceLabel(t, s.source) }));
  const failRate = data.health.deployFailRate;
  const lag = data.health.analyticsLagMinutes;
  // 部署：埋点开始日期在窗口内时，图上方写「部署从 X 开始统计」，渠道 / 失败率也注明起始日
  const trackedSince = k.deploys?.trackedSince ?? data.tracking?.deploys ?? null;
  const sinceInWindow = !!trackedSince && series.length > 0 && trackedSince > series[0].date;
  const sinceText = trackedSince ? fmtSinceDate(trackedSince, language) : "";
  const hasDerived = series.some((p) => p.deployDerived != null);
  // 分界线画在第一根「按埋点画」的柱子左边（之前有补算时才画）。
  // 开始那天如果画的是补算（补算 > 埋点），它算在线的左边，线挪到下一天。
  const boundary = hasDerived ? series.find((p) => p.deploySuccess != null) : undefined;
  const deployLast = (() => {
    for (let i = series.length - 1; i >= 0; i -= 1) if (series[i].deploySuccess != null) return i;
    return -1;
  })();
  const last = series.length - 1;
  const lp = series[last];
  // 两条线尾标注互相避让：末值大的标在上方，小的标在下方
  const above = (a: number | null | undefined, b: number | null | undefined) => Number(a || 0) >= Number(b || 0);
  const dyUsers = lp && above(lp.newUsers, lp.newSites) ? -7 : 9;
  const dyPv = lp && above(lp.pv, lp.uv) ? -7 : 9;
  const ink = useInkPalette();
  const { ink: INK, mid: MID, low: LOW, soft: SOFT, grid: GRID, axis: AXIS } = ink;
  const tooltipStyle = { background: ink.tooltipBg, border: `1px solid ${ink.tooltipBorder}`, borderRadius: 8, fontSize: 12, color: ink.tooltipText };
  const tooltipItemStyle = { color: ink.tooltipText };
  const axisProps = { stroke: AXIS, tick: { fontSize: 11 }, tickLine: false, axisLine: false } as const;

  return (
    <div className="space-y-10 pt-4">
      <Reveal id="growth">
        <SectionHead index={1} title={t.secGrowth} desc={t.secGrowthDesc} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel title={t.cNewUsersSites}>
            <div className="h-64">
              <ResponsiveContainer>
                <AreaChart data={series} margin={{ left: -18, right: 64, top: 8 }}>
                  <defs>
                    <linearGradient id="biUsers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={INK} stopOpacity={0.14} />
                      <stop offset="100%" stopColor={INK} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" {...axisProps} minTickGap={16} />
                  <YAxis {...axisProps} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} cursor={{ stroke: LOW }} />
                  <Area type="monotone" dataKey="newUsers" name={t.sNewUsers} stroke={INK} fill="url(#biUsers)" strokeWidth={2} isAnimationActive={false}
                    label={<EndLabel lastIndex={last} text={t.sNewUsers} color={INK} dy={dyUsers} />} />
                  <Area type="monotone" dataKey="newSites" name={t.sNewSites} stroke={MID} fill="transparent" strokeDasharray="5 4" strokeWidth={1.5} isAnimationActive={false}
                    label={<EndLabel lastIndex={last} text={t.sNewSites} color={MID} dy={-dyUsers + 2} />} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title={t.cFunnel}>
            {funnelSteps.length ? (
              <div className="space-y-3">
                {funnelSteps.map((s, i) => (
                  <div key={s.label}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-zinc-300">{s.label}</span>
                      <span className="tabular-nums text-zinc-400">
                        {n(s.value)}
                        {i > 0 && funnelSteps[i - 1].value ? ` · ${fmtPct(s.value / funnelSteps[i - 1].value)}` : ""}
                      </span>
                    </div>
                    <div className="h-6 rounded-md bg-zinc-950/70">
                      <div
                        className="h-6 rounded-md"
                        style={{ width: `${Math.max(2, (s.value / funnelMax) * 100)}%`, background: [INK, MID, LOW][i] ?? LOW }}
                      />
                    </div>
                  </div>
                ))}
                <div className="pt-1 text-xs text-zinc-500">
                  {t.fGuide}: {n(k.funnel?.guideClick)}
                </div>
              </div>
            ) : <Empty t={t} />}
          </Panel>
        </div>
      </Reveal>

      <Reveal id="usage">
        <SectionHead index={2} title={t.secUsage} desc={t.secUsageDesc} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel title={t.cDeploysDaily}>
            {sinceInWindow ? (
              <div className="-mt-2 mb-2 text-[11px] text-zinc-500" data-testid="bi-deploys-since">{fill(t.deploysSince, { d: sinceText })}</div>
            ) : null}
            <div className="h-64" data-testid="bi-deploys-chart">
              <ResponsiveContainer>
                <BarChart data={series} margin={{ left: -18, right: 76, top: hasDerived ? 18 : 8 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" {...axisProps} minTickGap={16} />
                  <YAxis {...axisProps} allowDecimals={false} />
                  <Tooltip content={<DeployTooltip t={t} n={n} style={tooltipStyle} />} cursor={{ fill: ink.wash }} />
                  {/* 补算（站点记录 / 日志回填）= 只有虚线描边的空心柱，只有总数，不拆成功 / 失败。没有记录的日子值是 null，不画柱，也不画 0。
                      开始那天后端只给一种（埋点或补算），所以这里的堆叠不会出现「补算上再叠埋点」 */}
                  <Bar dataKey="deployDerived" name={t.sDerived} stackId="d" fill="transparent" stroke={LOW} strokeWidth={1} strokeDasharray="3 2" isAnimationActive={false} />
                  {/* 成功 = 浅灰实心（主体），失败 = 深灰 + 细描边：失败不能比成功更抢眼 */}
                  <Bar dataKey="deploySuccess" name={t.sSuccess} stackId="d" fill={SOFT} radius={[0, 0, 0, 0]} isAnimationActive={false}
                    label={<BarEndLabel lastIndex={deployLast} text={t.sSuccess} color={SOFT} />} />
                  <Bar dataKey="deployFail" name={t.sFail} stackId="d" fill={LOW} stroke={MID} strokeWidth={0.75} radius={[3, 3, 0, 0]} isAnimationActive={false}
                    label={<BarEndLabel lastIndex={deployLast} text={t.sFail} color={MID} dy={-8} />} />
                  {boundary ? (
                    <ReferenceLine x={boundary.label} position="start" stroke={MID} strokeWidth={1} ifOverflow="extendDomain"
                      label={<DividerLabel text={t.derivedDivider} color={AXIS} />} />
                  ) : null}
                </BarChart>
              </ResponsiveContainer>
            </div>
            {hasDerived ? <div className="mt-2 text-[11px] text-zinc-500">{t.derivedNote}</div> : null}
          </Panel>
          <div className="grid gap-4">
            <Panel title={t.cSources}>
              {sinceInWindow ? <div className="-mt-2 mb-2 text-[11px] text-zinc-500">{fill(t.since, { d: sinceText })}</div> : null}
              {sources.length ? (
                <ul className="space-y-2">
                  {sources.map((s) => {
                    const total = s.success + s.fail;
                    const all = sources.reduce((a, b) => a + b.success + b.fail, 0) || 1;
                    return (
                      <li key={s.source} className="text-xs">
                        <div className="mb-1 flex justify-between">
                          <span className="text-zinc-300">{s.label}</span>
                          <span className="tabular-nums text-zinc-400">
                            {n(total)} · {fmtPct(total ? s.success / total : null, 0)}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-zinc-800">
                          <div className="h-1.5 rounded-full bg-zinc-300" style={{ width: `${(total / all) * 100}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : <Empty t={t} />}
            </Panel>
            <Panel title={t.cSiteUsage}>
              <div className="grid grid-cols-2 gap-2">
                <Stat label={t.uTotalSites} value={n(data.usage.totalSites)} />
                <Stat label={t.uOwners} value={n(data.usage.siteOwners)} />
                <Stat label={t.uStorage} value={data.usage.storageBytes == null ? "—" : formatBytes(data.usage.storageBytes)} />
                <Stat label={t.uSubdomain} value={n(data.usage.customSubdomainSites)} />
              </div>
            </Panel>
          </div>
        </div>
      </Reveal>

      <Reveal id="traffic">
        <SectionHead index={3} title={t.secTraffic} desc={t.secTrafficDesc} />
        <Panel title={t.cTrafficDaily}>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ left: -10, right: 64, top: 8 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" {...axisProps} minTickGap={16} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} cursor={{ stroke: LOW }} />
                <Line type="monotone" dataKey="pv" name={t.sPv} stroke={INK} strokeWidth={2} dot={false} isAnimationActive={false}
                  label={<EndLabel lastIndex={last} text={t.sPv} color={INK} dy={dyPv} />} />
                <Line type="monotone" dataKey="uv" name={t.sUv} stroke={MID} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false}
                  label={<EndLabel lastIndex={last} text="UV" color={MID} dy={-dyPv + 2} />} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 text-[11px] text-zinc-500">{t.noteUv}</div>
        </Panel>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Panel title={t.cReferrers}>
            <BarList items={data.tops.referrers} t={t} format={(it) => (it.key === "direct" ? t.direct : it.key)} />
          </Panel>
          <Panel title={t.cCountries}>
            <BarList items={data.tops.countries} t={t} format={(it) => it.key} />
          </Panel>
          <Panel title={t.cPaths}>
            <BarList items={data.tops.wwwPaths} t={t} format={(it) => it.key} />
          </Panel>
          <Panel title={t.cSites}>
            <BarList items={data.tops.sites} t={t} format={(it) => (it.name ? `${it.name} · ${it.key}` : it.key)} />
          </Panel>
        </div>
      </Reveal>

      <Reveal id="health">
        <SectionHead index={4} title={t.secHealth} desc={t.secHealthDesc} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Panel title={t.cFailRate}>
            <div className={`text-3xl font-semibold tabular-nums ${failRate != null && failRate > 0.2 ? "text-white underline decoration-zinc-500 underline-offset-4" : "text-zinc-100"}`}>
              {fmtPct(failRate)}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {k.deploys ? `${t.sSuccess} ${n(k.deploys.success)} · ${t.sFail} ${n(k.deploys.fail)}${sinceInWindow ? ` · ${fill(t.since, { d: sinceText })}` : ""}` : t.unavailable}
            </div>
          </Panel>
          <Panel title={t.cErrors}>
            {data.deployErrors.length ? (
              <ul className="space-y-1.5 text-xs">
                {data.deployErrors.map((e) => (
                  <li key={e.code} className="flex justify-between gap-2">
                    <span className="truncate font-mono text-zinc-300">{e.code}</span>
                    <span className="tabular-nums text-zinc-400">{n(e.count)}</span>
                  </li>
                ))}
              </ul>
            ) : <div className="text-sm text-zinc-500">{t.noData}</div>}
          </Panel>
          <Panel title={t.cIngest}>
            <div className={`text-3xl font-semibold tabular-nums ${lag != null && lag > 60 ? "text-white underline decoration-zinc-500 underline-offset-4" : "text-zinc-100"}`}>
              {lag == null ? "—" : fill(t.ingestMinutes, { n: lag })}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {lag == null || !data.health.analyticsLastIngestAt
                ? t.ingestNever
                : `${new Date(data.health.analyticsLastIngestAt).toLocaleString(language === "en" ? "en-US" : "zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} UTC+8`}
            </div>
          </Panel>
          <Panel title={t.cReports}>
            <div className="grid grid-cols-2 gap-2">
              <Stat label={t.reportsOpen} value={n(k.reports?.open)} tone={(k.reports?.open || 0) > 0 ? "warn" : "default"} />
              <Stat label={t.reportsRecent} value={n(k.reports?.recent)} />
            </div>
          </Panel>
        </div>
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs text-zinc-400">
          <div className="mb-2 flex items-center gap-1.5 font-medium text-zinc-300">
            {data.warnings.length ? <AlertTriangle className="h-3.5 w-3.5 text-zinc-100" /> : <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
            {t.cWarnings}
          </div>
          {data.warnings.length ? (
            <ul className="mb-2 list-inside list-disc font-mono text-zinc-200">
              {data.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          ) : (
            <div className="mb-2">{t.warningsNone}</div>
          )}
          <div className="space-y-0.5 text-zinc-500">
            <div>{t.noteDeploys}</div>
            <div>{t.noteUv}</div>
            <div>{t.noteTz}</div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
