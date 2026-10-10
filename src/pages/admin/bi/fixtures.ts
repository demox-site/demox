/**
 * 「示例数据」：只在预览 / 演示模式下使用，不请求任何线上接口。
 * 数字是编造的，量级参考 2026-10 的真实情况，方便看版式。
 */
import { listStatDateKeys } from "@/lib/stat-date";
import type { AdminBiData, BiDeploySource, BiRange } from "./types";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildFixture(range: BiRange, now = Date.now()): AdminBiData {
  const rand = rng(range * 7919);
  const days = listStatDateKeys(range, now);
  // 部署的三种状态都演示出来（和线上一样）：
  // - 最早的日子：没有任何记录（none），图上留空；
  // - 中间：服务端埋点之前，按站点记录补算，只有总数（derived）；
  // - 最近 10 天：服务端埋点，成功 / 失败都有（开始那天是 mixed）。
  const all = listStatDateKeys(90, now);
  const trackedSince = all[all.length - 10];
  const derivedSince = all[all.length - 24];
  const series = days.map((date, i) => {
    const wave = 1 + 0.35 * Math.sin(i / 2.3);
    const spike = i === days.length - 3 ? 3.2 : 1;
    const pv = Math.round((380 + rand() * 160) * wave * spike);
    const landing = Math.round(pv * (0.16 + rand() * 0.05));
    const deployClick = Math.round(landing * (0.18 + rand() * 0.06));
    const success = Math.round(6 + rand() * 9 * wave);
    const fail = Math.round(rand() * 2.4);
    const derivedRaw = Math.round(2 + rand() * 6 * wave);
    const live = date >= trackedSince;
    const isStart = date === trackedSince;
    // 开始那天：埋点只记到半天（9），补算更大（14）→ 只画补算 14，不叠加
    const liveS = isStart ? 8 : success;
    const liveF = isStart ? 1 : fail;
    const derived = date >= derivedSince && date <= trackedSince ? (isStart ? 14 : derivedRaw) : 0;
    const asLive = live && (!derived || liveS + liveF >= derived);
    const fromLogs = date >= all[all.length - 17];
    return {
      date,
      newUsers: Math.round(3 + rand() * 7 * wave),
      newSites: Math.round(4 + rand() * 8 * wave),
      deploySuccess: asLive ? liveS : null,
      deployFail: asLive ? liveF : null,
      deployDerived: derived > 0 && !asLive ? derived : null,
      deploySource: (live ? (derived > 0 ? "mixed" : "events") : derived > 0 ? "derived" : "none") as BiDeploySource,
      deploySplitKnown: live && derived === 0,
      deployDerivedFrom: (derived > 0 && !asLive ? (fromLogs ? "logs" : "sites") : null) as "logs" | "sites" | null,
      deployLiveTotal: live ? liveS + liveF : null,
      pv,
      uv: Math.round(pv * (0.34 + rand() * 0.08)),
      landing,
      deployClick
    };
  });
  const sum = (k: keyof (typeof series)[number]) => series.reduce((a, p) => a + Number(p[k] || 0), 0);
  const deploysComplete = days[0] > trackedSince;
  const pv = sum("pv");
  const uv = Math.round(sum("uv") * 0.82);
  const success = sum("deploySuccess");
  const fail = sum("deployFail");
  const landing = sum("landing");
  const click = sum("deployClick");
  const converted = Math.round(click * 0.31);
  const end = days[days.length - 1];
  return {
    generatedAt: new Date(now).toISOString(),
    tz: "Asia/Shanghai",
    cached: false,
    range: { days: range, start: days[0], end, prevStart: days[0] },
    kpis: {
      newUsers: { value: sum("newUsers"), prev: Math.round(sum("newUsers") * 0.84), total: 1286 },
      activeDeployers7d: { value: 64, prev: 57 },
      deploys: {
        value: success + fail,
        // 上期没被埋点完整覆盖：null，看板不显示涨跌箭头
        prev: null,
        success,
        fail,
        successRate: success / (success + fail),
        prevSuccessRate: null,
        trackedSince,
        complete: deploysComplete,
        derivedTotal: sum("deployDerived")
      },
      sites: { value: sum("newSites"), prev: Math.round(sum("newSites") * 1.08), total: 2143 },
      pv: { value: pv, prev: Math.round(pv * 0.88) },
      uv: { value: uv, prev: Math.round(uv * 0.91), approx: true },
      funnel: {
        landing,
        deployClick: click,
        guideClick: Math.round(landing * 0.07),
        deploySuccess: converted,
        deploySuccessSince: trackedSince,
        prevLanding: Math.round(landing * 0.95),
        prevDeployClick: Math.round(click * 0.86),
        clickRate: landing ? click / landing : null,
        successRate: landing ? converted / landing : null
      },
      pro: { active: 37, lifetime: 9, expiring30d: 6, expired: 11 },
      reports: { open: 2, recent: 5 }
    },
    series,
    deploySources: [
      { source: "cli", success: Math.round(success * 0.46), fail: Math.round(fail * 0.4) },
      { source: "web", success: Math.round(success * 0.27), fail: Math.round(fail * 0.35) },
      { source: "token", success: Math.round(success * 0.17), fail: Math.round(fail * 0.1) },
      { source: "mcp", success: Math.round(success * 0.1), fail: Math.round(fail * 0.15) }
    ],
    deployErrors: [
      { code: "INVALID_STATIC_SITE", count: Math.max(1, Math.round(fail * 0.45)) },
      { code: "CONTENT_BLOCKED", count: Math.max(1, Math.round(fail * 0.25)) },
      { code: "HTTP_403", count: Math.max(1, Math.round(fail * 0.18)) },
      { code: "UPLOAD_HASH_MISMATCH", count: 1 }
    ],
    usage: {
      totalSites: 2143,
      siteOwners: 812,
      storageBytes: 7.4 * 1024 * 1024 * 1024,
      customSubdomainSites: 386,
      hideWatermarkSites: 41
    },
    tops: {
      referrers: [
        { key: "direct", views: Math.round(pv * 0.62) },
        { key: "demox.site", views: Math.round(pv * 0.14) },
        { key: "github.com", views: Math.round(pv * 0.05) },
        { key: "google.com", views: Math.round(pv * 0.04) },
        { key: "cn.bing.com", views: Math.round(pv * 0.03) },
        { key: "example-a.demox.site", views: Math.round(pv * 0.02) },
        { key: "m.baidu.com", views: Math.round(pv * 0.01) }
      ],
      countries: [
        { key: "CN", views: Math.round(pv * 0.64) },
        { key: "US", views: Math.round(pv * 0.13) },
        { key: "SG", views: Math.round(pv * 0.05) },
        { key: "HK", views: Math.round(pv * 0.02) },
        { key: "JP", views: Math.round(pv * 0.02) },
        { key: "DE", views: Math.round(pv * 0.01) }
      ],
      wwwPaths: [
        { key: "/", views: Math.round(pv * 0.26) },
        { key: "/ai-static-site-deployment", views: Math.round(pv * 0.032) },
        { key: "/pricing", views: Math.round(pv * 0.017) },
        { key: "/console/projects", views: Math.round(pv * 0.016) },
        { key: "/when-to-use-demox", views: Math.round(pv * 0.013) },
        { key: "/doc", views: Math.round(pv * 0.01) },
        { key: "/log", views: Math.round(pv * 0.008) }
      ],
      sites: [
        { key: "EXAMPLE01", name: "Example Portfolio", views: Math.round(pv * 0.11) },
        { key: "EPX2UU43", name: "www", views: Math.round(pv * 0.08) },
        { key: "EXAMPLE02", name: "Sample Docs", views: Math.round(pv * 0.03) },
        { key: "EXAMPLE03", name: "Demo Landing", views: Math.round(pv * 0.01) }
      ]
    },
    health: { analyticsLastIngestAt: new Date(now - 6 * 60000).toISOString(), analyticsLagMinutes: 6, deployFailRate: fail / (success + fail) },
    tracking: {
      deploys: trackedSince,
      deploysAt: `${trackedSince}T05:25:00.000Z`,
      deploysDerivedFrom: ["websites.created_at", "deploy_upload_sessions.updated_at"],
      landing: all[0],
      deployClick: all[0]
    },
    warnings: []
  };
}
