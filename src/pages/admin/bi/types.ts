/** get_admin_bi 响应（与 scf-code/website-api/index.js 里的 adminBiLib.computeAdminBi 对应） */
export type BiRange = 7 | 30 | 90;

export interface BiDelta {
  value: number;
  prev: number;
}

/**
 * 部署按天的数据来源：
 * - events：服务端埋点，success / fail 是真实值（0 就是 0）；
 * - derived：埋点前按站点记录补算，只有 deployDerived 总数（不拆成功 / 失败，不按比例分）；
 * - mixed：埋点开始那天，只画一种：埋点总数 ≥ 补算时画埋点，否则画补算总数（取较大值，不相加）；
 * - none：没有任何记录，图上留空，不画 0。
 */
export type BiDeploySource = "events" | "derived" | "mixed" | "none";

export interface BiSeriesPoint {
  date: string;
  newUsers: number;
  newSites: number;
  /** null = 这天还没有服务端部署埋点 */
  deploySuccess: number | null;
  deployFail: number | null;
  /** 补算的部署数（每站每天最多 1 次，下限）；null = 没有补算 */
  deployDerived?: number | null;
  deploySource?: BiDeploySource;
  /** 这天的成功 / 失败拆分是否完整可知 */
  deploySplitKnown?: boolean;
  /** 补算取的是哪一种（站点记录 / 日志回填，两者取较大值） */
  deployDerivedFrom?: "sites" | "logs" | null;
  /** 埋点记到的总数（开始那天画补算时，提示里仍给出埋点数） */
  deployLiveTotal?: number | null;
  pv: number;
  uv: number | null;
  /** null = 埋点开始之前 */
  landing: number | null;
  deployClick: number | null;
}

export interface BiTopItem {
  key: string;
  views: number;
  name?: string;
}

export interface AdminBiData {
  generatedAt: string;
  tz: string;
  cached?: boolean;
  range: { days: number; start: string; end: string; prevStart: string };
  kpis: {
    newUsers: (BiDelta & { total: number | null }) | null;
    activeDeployers7d: BiDelta;
    deploys: {
      value: number;
      /** null = 上期没被服务端埋点完整覆盖，不显示涨跌 */
      prev: number | null;
      success: number;
      fail: number;
      successRate: number | null;
      prevSuccessRate: number | null;
      /** 服务端部署埋点开始的日期（UTC+8） */
      trackedSince?: string | null;
      /** 本期是否完整被埋点覆盖 */
      complete?: boolean;
      /** 本期埋点之前补算的部署数（只有总数） */
      derivedTotal?: number;
    } | null;
    sites: (BiDelta & { total: number | null }) | null;
    pv: BiDelta | null;
    uv: (BiDelta & { approx: boolean }) | null;
    funnel: {
      landing: number;
      deployClick: number;
      guideClick: number;
      deploySuccess: number;
      prevLanding: number | null;
      prevDeployClick: number | null;
      deploySuccessSince?: string | null;
      clickRate: number | null;
      successRate: number | null;
    } | null;
    pro: { active: number; lifetime: number; expiring30d: number; expired: number } | null;
    reports: { open: number; recent: number } | null;
  };
  series: BiSeriesPoint[];
  deploySources: Array<{ source: string; success: number; fail: number }>;
  deployErrors: Array<{ code: string; count: number }>;
  usage: {
    totalSites: number | null;
    siteOwners: number | null;
    storageBytes: number | null;
    customSubdomainSites: number | null;
    hideWatermarkSites: number | null;
  };
  tops: { referrers: BiTopItem[]; countries: BiTopItem[]; wwwPaths: BiTopItem[]; sites: BiTopItem[] };
  health: { analyticsLastIngestAt: string | null; analyticsLagMinutes: number | null; deployFailRate: number | null };
  /** 各埋点开始日期（UTC+8）；早于这天的序列值是 null */
  tracking?: {
    deploys: string | null;
    deploysAt: string | null;
    deploysDerivedFrom?: string[];
    landing: string | null;
    deployClick: string | null;
  };
  warnings: string[];
}
