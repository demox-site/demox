/** get_admin_bi 响应（与 scf-code/website-api/index.js 里的 adminBiLib.computeAdminBi 对应） */
export type BiRange = 7 | 30 | 90;

export interface BiDelta {
  value: number;
  prev: number;
}

export interface BiSeriesPoint {
  date: string;
  newUsers: number;
  newSites: number;
  deploySuccess: number;
  deployFail: number;
  pv: number;
  uv: number | null;
  landing: number;
  deployClick: number;
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
    deploys: (BiDelta & { success: number; fail: number; successRate: number | null; prevSuccessRate: number | null }) | null;
    sites: (BiDelta & { total: number | null }) | null;
    pv: BiDelta | null;
    uv: (BiDelta & { approx: boolean }) | null;
    funnel: {
      landing: number;
      deployClick: number;
      guideClick: number;
      deploySuccess: number;
      prevLanding: number;
      prevDeployClick: number;
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
  warnings: string[];
}
