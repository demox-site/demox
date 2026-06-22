import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { ArrowLeft, BarChart3, Clock3, Globe2, MapPin, MousePointer2, Radio, Route, ShieldCheck, TrendingUp } from "lucide-react";
import { websiteApi, mapWebsiteRow } from "@/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { formatTimestamp, getDisplayName, getSiteDomains } from "@/lib/website-utils";

type StatsResponse = {
  success: boolean;
  websiteId?: string;
  rangeDays?: number;
  totals?: { views: number; badgeClicks: number };
  daily?: { date: string; views: number; badgeClicks: number }[];
  referrers?: { host: string; views: number }[];
  paths?: { path: string; views: number }[];
  countries?: { country: string; views: number }[];
  provinces?: { country: string; province: string; views: number }[];
  message?: string;
};

type AccessLog = {
  ts: number | null;
  type: string;
  host: string;
  path: string;
  referrer: string;
  referrerHost: string;
  country: string;
  province: string;
  ip: string;
  ipArchived?: boolean;
  userAgent: string;
};

const COLORS = ["#38bdf8", "#22c55e", "#f59e0b", "#f43f5e", "#a78bfa", "#14b8a6", "#eab308", "#fb7185"];

const countryNames: Record<string, string> = {
  CN: "中国",
  US: "美国",
  JP: "日本",
  SG: "新加坡",
  HK: "中国香港",
  TW: "中国台湾",
  KR: "韩国",
  GB: "英国",
  DE: "德国",
  FR: "法国",
  UNKNOWN: "未知地区"
};

const provinceAliases: Record<string, string> = {
  Beijing: "北京", Tianjin: "天津", Shanghai: "上海", Chongqing: "重庆",
  Hebei: "河北", Shanxi: "山西", Liaoning: "辽宁", Jilin: "吉林", Heilongjiang: "黑龙江",
  Jiangsu: "江苏", Zhejiang: "浙江", Anhui: "安徽", Fujian: "福建", Jiangxi: "江西", Shandong: "山东",
  Henan: "河南", Hubei: "湖北", Hunan: "湖南", Guangdong: "广东", Hainan: "海南", Sichuan: "四川",
  Guizhou: "贵州", Yunnan: "云南", Shaanxi: "陕西", Gansu: "甘肃", Qinghai: "青海", Taiwan: "台湾",
  Neimenggu: "内蒙古", InnerMongolia: "内蒙古", Guangxi: "广西", Xizang: "西藏", Tibet: "西藏",
  Ningxia: "宁夏", Xinjiang: "新疆", HongKong: "香港", Macau: "澳门", Macao: "澳门"
};

const provinceTiles = [
  { name: "新疆", x: 0, y: 1 }, { name: "甘肃", x: 2, y: 2 }, { name: "内蒙古", x: 3, y: 1 }, { name: "黑龙江", x: 6, y: 0 },
  { name: "青海", x: 1, y: 3 }, { name: "宁夏", x: 3, y: 3 }, { name: "陕西", x: 4, y: 3 }, { name: "山西", x: 5, y: 2 }, { name: "河北", x: 6, y: 2 }, { name: "北京", x: 7, y: 1 }, { name: "天津", x: 7, y: 2 }, { name: "吉林", x: 7, y: 0 }, { name: "辽宁", x: 8, y: 1 },
  { name: "西藏", x: 0, y: 4 }, { name: "四川", x: 3, y: 4 }, { name: "重庆", x: 4, y: 4 }, { name: "河南", x: 5, y: 3 }, { name: "山东", x: 7, y: 3 },
  { name: "云南", x: 2, y: 5 }, { name: "贵州", x: 4, y: 5 }, { name: "湖北", x: 5, y: 4 }, { name: "安徽", x: 6, y: 4 }, { name: "江苏", x: 7, y: 4 }, { name: "上海", x: 8, y: 4 },
  { name: "广西", x: 4, y: 6 }, { name: "湖南", x: 5, y: 5 }, { name: "江西", x: 6, y: 5 }, { name: "浙江", x: 7, y: 5 },
  { name: "广东", x: 5, y: 6 }, { name: "福建", x: 6, y: 6 }, { name: "台湾", x: 8, y: 6 }, { name: "香港", x: 6, y: 7 }, { name: "澳门", x: 5, y: 7 }, { name: "海南", x: 4, y: 7 }
];

function normalizeProvinceName(input: string) {
  const raw = String(input || "UNKNOWN").trim();
  if (!raw || raw === "UNKNOWN") return "未知";
  const compact = raw.replace(/省|市|自治区|特别行政区|壮族|回族|维吾尔/g, "");
  return provinceAliases[raw] || provinceAliases[compact] || compact;
}

const fmt = new Intl.NumberFormat("zh-CN");

function fillDaily(daily: StatsResponse["daily"] = [], days: number) {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const out: { date: string; label: string; views: number }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({
      date: key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      views: byDate.get(key)?.views || 0
    });
  }
  return out;
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[1.4rem] border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-5 shadow-[0_18px_45px_rgba(0,0,0,.08)]">
      <div className="mb-4 flex items-center justify-between text-[var(--stitch-muted)]">
        <span className="text-xs font-bold uppercase tracking-[0.18em]">{label}</span>
        {icon}
      </div>
      <div className="text-3xl font-black tracking-[-0.04em] text-[var(--stitch-ink)]">{value}</div>
      <div className="mt-2 text-xs text-[var(--stitch-muted)]">{hint}</div>
    </div>
  );
}

function EmptyChart({ text }: { text: string }) {
  return <div className="grid h-[260px] place-items-center text-sm text-[var(--stitch-muted)]">{text}</div>;
}

export default function SiteAnalyticsPage() {
  const { projectId = "", websiteId = "" } = useParams();
  const navigate = useNavigate();
  const [days, setDays] = React.useState(30);
  const [website, setWebsite] = React.useState<any>(null);
  const [stats, setStats] = React.useState<StatsResponse | null>(null);
  const [logs, setLogs] = React.useState<AccessLog[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    Promise.all([
      websiteApi.list(),
      websiteApi.getSiteStats({ websiteId, days }),
      websiteApi.getSiteAccessLogs({ websiteId, days: Math.min(days, 30), limit: 100 })
    ])
      .then(([listRes, statsRes, logsRes]) => {
        if (!alive) return;
        const site = (listRes.websites || [])
          .map((row: any) => ({ ...mapWebsiteRow(row), status: "deployed" }))
          .find((item: any) => item.websiteId === websiteId || item._id === websiteId);
        setWebsite(site || null);
        setStats(statsRes);
        setLogs(logsRes?.success ? (logsRes.logs || []) : []);
        if (!site) setError("未找到这个站点，或你没有权限查看它。");
        if (!statsRes?.success) setError(statsRes?.message || "统计数据加载失败");
        if (statsRes?.success && logsRes && !logsRes.success) setError(logsRes.message || "访问日志加载失败");
      })
      .catch((err) => {
        if (!alive) return;
        setError(err?.message || "统计数据加载失败");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [websiteId, days]);

  const daily = fillDaily(stats?.daily, days);
  const totalViews = stats?.totals?.views || 0;
  const provinceData = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const item of stats?.provinces || []) {
      const name = normalizeProvinceName(item.province);
      map.set(name, (map.get(name) || 0) + item.views);
    }
    return Array.from(map.entries())
      .map(([province, views]) => ({ province, views }))
      .sort((a, b) => b.views - a.views);
  }, [stats?.provinces]);
  const topCountry = stats?.countries?.[0];
  const topProvince = provinceData.find((item) => item.province !== "未知") || provinceData[0];
  const topReferrer = stats?.referrers?.find((r) => r.host !== "direct") || stats?.referrers?.[0];
  const avgViews = days > 0 ? totalViews / days : 0;
  const domains = website ? getSiteDomains(website) : [];

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 rounded-[2rem] border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-5 shadow-[0_24px_70px_rgba(0,0,0,.10)] sm:p-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate(`/console/projects/${projectId}/sites`)}
              className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-[var(--stitch-muted)] transition-colors hover:text-[var(--stitch-ink)]"
            >
              <ArrowLeft className="h-4 w-4" />
              返回站点列表
            </button>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-blue-soft)] px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-[var(--stitch-muted)]">
              <BarChart3 className="h-3.5 w-3.5" />
              Site analytics
            </div>
            <h1 className="truncate text-3xl font-black tracking-[-0.05em] text-[var(--stitch-ink)] sm:text-5xl">
              {website ? getDisplayName(website) : "站点分析"}
            </h1>
            <div className="mt-3 flex flex-wrap gap-3 text-sm text-[var(--stitch-muted)]">
              <span className="font-mono">ID: {websiteId}</span>
              <span>统计约 5 分钟内更新</span>
              {website?.updatedAt && <span>最近部署：{formatTimestamp(website.updatedAt)}</span>}
              {domains[0] && (
                <a className="inline-flex items-center gap-1 hover:text-[var(--stitch-blue)]" href={domains[0].url} target="_blank" rel="noreferrer">
                  <Globe2 className="h-4 w-4" /> {domains[0].host}
                </a>
              )}
            </div>
          </div>
          <div className="flex rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] p-1">
            {[7, 30, 90].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDays(value)}
                className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${days === value ? "bg-[var(--stitch-ink)] text-[var(--stitch-bg)]" : "text-[var(--stitch-muted)] hover:text-[var(--stitch-ink)]"}`}
              >
                {value} 天
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={<TrendingUp className="h-5 w-5" />} label="访问量" value={fmt.format(totalViews)} hint={`最近 ${days} 天总访问`} />
          <StatCard icon={<MousePointer2 className="h-5 w-5" />} label="日均访问" value={avgViews.toFixed(1)} hint="用于判断链接是否持续被打开" />
          <StatCard icon={<MapPin className="h-5 w-5" />} label="主要地区" value={topProvince?.province || (topCountry ? (countryNames[topCountry.country] || topCountry.country) : "--")} hint={topProvince ? `${fmt.format(topProvince.views)} 次访问` : (topCountry ? `${fmt.format(topCountry.views)} 次访问` : "暂无地区数据")} />
          <StatCard icon={<Radio className="h-5 w-5" />} label="主要来源" value={topReferrer?.host || "--"} hint={topReferrer ? `${fmt.format(topReferrer.views)} 次访问` : "暂无来源数据"} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.45fr_.9fr]">
          <Card className="border-[var(--stitch-line)] bg-[var(--stitch-surface)] text-[var(--stitch-ink)] shadow-[0_18px_50px_rgba(0,0,0,.08)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <TrendingUp className="h-5 w-5 text-[var(--stitch-blue)]" />
                访问趋势
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? <EmptyChart text="加载统计数据中..." /> : daily.every((d) => d.views === 0) ? <EmptyChart text="暂无访问数据" /> : (
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={daily} margin={{ left: 0, right: 18, top: 12, bottom: 0 }}>
                      <defs>
                        <linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.42} />
                          <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(148,163,184,.18)" vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                      <Tooltip contentStyle={{ border: "1px solid rgba(148,163,184,.28)", borderRadius: 16, background: "rgba(15,23,42,.94)", color: "#e5e7eb" }} />
                      <Area type="monotone" dataKey="views" name="访问" stroke="#38bdf8" strokeWidth={3} fill="url(#viewsGradient)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-[var(--stitch-line)] bg-[var(--stitch-surface)] text-[var(--stitch-ink)] shadow-[0_18px_50px_rgba(0,0,0,.08)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MapPin className="h-5 w-5 text-[var(--stitch-blue)]" />
                省级访问热力格
              </CardTitle>
            </CardHeader>
            <CardContent>
              {provinceData.length === 0 ? <EmptyChart text="暂无省级地区数据" /> : (
                <div className="space-y-5">
                  <div className="rounded-[1.4rem] border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] p-4">
                    <div className="grid auto-rows-[34px] grid-cols-9 gap-1.5">
                      {provinceTiles.map((tile) => {
                        const views = provinceData.find((item) => item.province === tile.name)?.views || 0;
                        const max = Math.max(1, ...provinceData.map((item) => item.views));
                        const intensity = views ? 0.18 + (views / max) * 0.82 : 0;
                        return (
                          <div
                            key={tile.name}
                            title={`${tile.name}: ${fmt.format(views)} 次访问`}
                            className="flex items-center justify-center rounded-lg border text-[10px] font-bold transition-transform hover:scale-110"
                            style={{
                              gridColumnStart: tile.x + 1,
                              gridRowStart: tile.y + 1,
                              borderColor: views ? "rgba(56,189,248,.58)" : "rgba(148,163,184,.18)",
                              background: views ? `rgba(56,189,248,${intensity})` : "rgba(148,163,184,.06)",
                              color: views && intensity > 0.55 ? "#020617" : "var(--stitch-muted)"
                            }}
                          >
                            {tile.name}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-[var(--stitch-muted)]">
                      <span>颜色越亮，访问越多</span>
                      <span>这是示意热力格，未知地区进入排行</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {provinceData.slice(0, 8).map((item, index) => {
                      const pct = totalViews ? Math.round((item.views / totalViews) * 100) : 0;
                      return (
                        <div key={item.province}>
                          <div className="mb-1 flex justify-between text-sm">
                            <span>{item.province}</span>
                            <span className="font-mono text-[var(--stitch-muted)]">{pct}% · {fmt.format(item.views)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-[var(--stitch-surface-strong)]">
                            <div className="h-2 rounded-full" style={{ width: `${Math.max(4, pct)}%`, background: COLORS[index % COLORS.length] }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="border-[var(--stitch-line)] bg-[var(--stitch-surface)] text-[var(--stitch-ink)] shadow-[0_18px_50px_rgba(0,0,0,.08)]">
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Radio className="h-5 w-5 text-[var(--stitch-blue)]" />来源排行</CardTitle></CardHeader>
            <CardContent>
              {!stats?.referrers?.length ? <EmptyChart text="暂无来源数据" /> : (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.referrers} layout="vertical" margin={{ left: 8, right: 20, top: 8, bottom: 8 }}>
                      <CartesianGrid stroke="rgba(148,163,184,.16)" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis dataKey="host" type="category" width={120} tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ border: "1px solid rgba(148,163,184,.28)", borderRadius: 16, background: "rgba(15,23,42,.94)", color: "#e5e7eb" }} />
                      <Bar dataKey="views" name="访问" radius={[0, 10, 10, 0]} fill="#38bdf8" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-[var(--stitch-line)] bg-[var(--stitch-surface)] text-[var(--stitch-ink)] shadow-[0_18px_50px_rgba(0,0,0,.08)]">
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Route className="h-5 w-5 text-[var(--stitch-blue)]" />访问路径</CardTitle></CardHeader>
            <CardContent>
              {!stats?.paths?.length ? <EmptyChart text="暂无路径数据" /> : (
                <div className="space-y-3">
                  {stats.paths.map((item) => {
                    const pct = totalViews ? Math.round((item.views / totalViews) * 100) : 0;
                    return (
                      <div key={item.path} className="rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] p-3">
                        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                          <span className="truncate font-mono text-[var(--stitch-ink)]">{item.path}</span>
                          <span className="shrink-0 font-mono text-[var(--stitch-muted)]">{fmt.format(item.views)} 次</span>
                        </div>
                        <div className="h-2 rounded-full bg-[var(--stitch-surface)]">
                          <div className="h-2 rounded-full bg-[var(--stitch-blue)]" style={{ width: `${Math.max(4, pct)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-[var(--stitch-line)] bg-[var(--stitch-surface)] text-[var(--stitch-ink)] shadow-[0_18px_50px_rgba(0,0,0,.08)]">
          <CardHeader>
            <CardTitle className="flex flex-col gap-2 text-lg sm:flex-row sm:items-center sm:justify-between">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[var(--stitch-blue)]" />
                访问日志
              </span>
              <span className="text-xs font-medium text-[var(--stitch-muted)]">
                真实 IP 只加密留档，不在管理端明文展示
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <EmptyChart text="加载访问日志中..." /> : logs.length === 0 ? <EmptyChart text="暂无访问日志" /> : (
              <div className="overflow-hidden rounded-[1.4rem] border border-[var(--stitch-line)]">
                <div className="max-h-[520px] overflow-auto">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-[var(--stitch-surface-strong)] text-xs uppercase tracking-[0.14em] text-[var(--stitch-muted)]">
                      <tr>
                        <th className="whitespace-nowrap px-4 py-3 font-bold">时间</th>
                        <th className="whitespace-nowrap px-4 py-3 font-bold">IP 留档</th>
                        <th className="whitespace-nowrap px-4 py-3 font-bold">地区</th>
                        <th className="whitespace-nowrap px-4 py-3 font-bold">路径</th>
                        <th className="whitespace-nowrap px-4 py-3 font-bold">来源</th>
                        <th className="whitespace-nowrap px-4 py-3 font-bold">设备</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log, index) => {
                        const province = normalizeProvinceName(log.province);
                        const country = countryNames[log.country] || log.country || "未知地区";
                        return (
                          <tr key={`${log.ts || "na"}-${index}`} className="border-t border-[var(--stitch-line)] align-top">
                            <td className="whitespace-nowrap px-4 py-3 text-[var(--stitch-muted)]">
                              <span className="inline-flex items-center gap-2">
                                <Clock3 className="h-4 w-4" />
                                {log.ts ? formatTimestamp(log.ts) : "--"}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 font-mono text-[var(--stitch-muted)]">{log.ipArchived ? "已加密留档" : "--"}</td>
                            <td className="whitespace-nowrap px-4 py-3">{province !== "未知" ? `${country} / ${province}` : country}</td>
                            <td className="max-w-[220px] truncate px-4 py-3 font-mono" title={log.path}>{log.path || "/"}</td>
                            <td className="max-w-[220px] truncate px-4 py-3" title={log.referrer || log.referrerHost}>
                              {log.referrerHost === "direct" ? "直接访问" : (log.referrerHost || "--")}
                            </td>
                            <td className="max-w-[340px] truncate px-4 py-3 text-[var(--stitch-muted)]" title={log.userAgent}>{log.userAgent || "--"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
