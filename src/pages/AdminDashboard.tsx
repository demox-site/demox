import React, { useEffect, useState, useCallback } from "react";
import { app, auth, db } from "@/cloudbase";
import { Card, CardHeader, CardTitle, CardContent, Button } from "@/components/ui";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useToast } from "@/components/ui";
import { formatBytes } from "@/lib/utils";

interface BucketStats {
  success: boolean;
  sitesBytes?: number;
  sitesCount?: number;
  usersCount?: number;
  projectsCount?: number;
  traffic?: {
    timestamps: string[];
    inbound: number[] | null;
    outbound: number[] | null;
  };
  message?: string;
}

/**
 * AdminDashboard
 * 仅管理员可见的大盘页面，展示 COS 存储与流量信息
 */
const AdminDashboard: React.FC = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [statsDay, setStatsDay] = useState<BucketStats | null>(null);
  const [statsHour, setStatsHour] = useState<BucketStats | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [rangeDay, setRangeDay] = useState<{ start: string; end: string }>(() => {
    const now = new Date();
    const end = new Date(now.getTime());
    const start = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return { start: fmt(start), end: fmt(end) };
  });
  const [rangeHour, setRangeHour] = useState<{ start: string; end: string }>(() => {
    const now = new Date();
    const end = new Date(now.getTime());
    const start = new Date(now.getTime() - 24 * 3600 * 1000);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return { start: fmt(start), end: fmt(end) };
  });

  /**
   * 检查当前用户是否为管理员
   */
  const checkAdmin = async () => {
    const loginState = await auth.getLoginState();
    if (!loginState || !loginState.user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    const uid = loginState.user.uid;
    setUserName(loginState.user.nickName || loginState.user.email || uid);
    try {
      const res = await db.collection("ai_builder_user_roles").doc(uid).get();
      const roles = res.data && res.data[0]?.role ? res.data[0].role : ["user"];
      const isAdminRole = Array.isArray(roles) && roles.includes("admin");
      setIsAdmin(isAdminRole);
    } catch {
      setIsAdmin(false);
    }
  };

  /**
   * 拉取天级别统计（含 Sites 用量与在用用户/项目数量）
   */
  const fetchStatsDay = useCallback(async () => {
    try {
      const fnRes = await app.callFunction({
        name: "deploy-website",
        data: {
          action: "bucket_stats",
          granularity: "day",
          startTime: rangeDay.start,
          endTime: rangeDay.end
        }
      });
      const result: BucketStats = fnRes.result || {};
      if (!result.success) {
        throw new Error(result.message || "获取统计失败");
      }
      setStatsDay(result);
    } catch (e: unknown) {
      toast({
        title: "获取统计失败",
        description: e instanceof Error ? e.message : "请稍后重试",
        variant: "destructive"
      });
    }
  }, [toast, rangeDay.start, rangeDay.end]);

  /**
   * 拉取小时级别统计（仅流量时间序列）
   */
  const fetchStatsHour = useCallback(async () => {
    try {
      const fnRes = await app.callFunction({
        name: "deploy-website",
        data: {
          action: "bucket_stats",
          granularity: "hour",
          startTime: rangeHour.start,
          endTime: rangeHour.end
        }
      });
      const result: BucketStats = fnRes.result || {};
      if (!result.success) {
        throw new Error(result.message || "获取统计失败");
      }
      setStatsHour(result);
    } catch (e: unknown) {
      toast({
        title: "获取统计失败",
        description: e instanceof Error ? e.message : "请稍后重试",
        variant: "destructive"
      });
    }
  }, [toast, rangeHour.start, rangeHour.end]);

  useEffect(() => {
    (async () => {
      await checkAdmin();
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (isAdmin) {
      fetchStatsDay();
      fetchStatsHour();
    }
  }, [isAdmin, fetchStatsDay, fetchStatsHour]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-zinc-800 border-t-zinc-100 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex items-center justify-center">
        <Card className="bg-zinc-900 border-zinc-800 w-[520px]">
          <CardHeader>
            <CardTitle className="text-zinc-100">无权限</CardTitle>
          </CardHeader>
          <CardContent className="text-zinc-400">
            该页面仅管理员可见，请联系管理员开通权限
          </CardContent>
        </Card>
      </div>
    );
  }

  const sitesBytes = statsDay?.sitesBytes ?? 0;
  const sitesCount = statsDay?.sitesCount ?? 0;
  const usersCount = statsDay?.usersCount ?? 0;
  const projectsCount = statsDay?.projectsCount ?? 0;
  const trafficDay = statsDay?.traffic;
  const trafficHour = statsHour?.traffic;
  const chartDataDay = (() => {
    if (trafficDay && trafficDay.timestamps.length > 0) {
      return trafficDay.timestamps.map((ts, i) => ({
        ts,
        inbound: trafficDay.inbound ? trafficDay.inbound[i] || 0 : 0,
        outbound: trafficDay.outbound ? trafficDay.outbound[i] || 0 : 0
      }));
    }
    return [];
  })();
  const chartDataHour = (() => {
    if (trafficHour && trafficHour.timestamps.length > 0) {
      return trafficHour.timestamps.map((ts, i) => ({
        ts,
        inbound: trafficHour.inbound ? trafficHour.inbound[i] || 0 : 0,
        outbound: trafficHour.outbound ? trafficHour.outbound[i] || 0 : 0
      }));
    }
    return [];
  })();
  /**
   * formatTsLabel
   * 格式化时间坐标标签
   */
  const formatTsLabel = (ts: string | number, mode: "day" | "hour") => {
    try {
      let ms: number;
      if (typeof ts === "number") {
        ms = ts < 1000000000000 ? ts * 1000 : ts;
      } else {
        ms = new Date(ts).getTime();
      }
      const d = new Date(ms);
      if (mode === "day") {
        return `${d.getMonth() + 1}/${d.getDate()}`;
      }
      return `${String(d.getHours()).padStart(2, "0")}:00`;
    } catch {
      return ts;
    }
  };
  /**
   * bytesToGB
   * 将字节转换为 GB（保留两位小数）
   */
  const bytesToGB = (bytes: number): number => {
    const GB = 1024 * 1024 * 1024;
    return Math.max(0, bytes) / GB;
  };
  /**
   * calcDailyCost
   * 计算日消费：存储(GB)*0.099 + 外网下行(GB)*0.5
   * 使用当前 Sites 存储用量与天级流量的最新一天作为估算
   */
  const calcDailyCost = (): {
    storageGB: number;
    outboundGB: number;
    storageCost: number;
    outboundCost: number;
    total: number;
  } => {
    const storageGB = bytesToGB(sitesBytes);
    const lastOutboundBytes =
      chartDataDay.length > 0 ? chartDataDay[chartDataDay.length - 1].outbound : 0;
    const outboundGB = bytesToGB(lastOutboundBytes);
    const storageCost = storageGB * 0.099;
    const outboundCost = outboundGB * 0.5;
    const total = storageCost + outboundCost;
    return { storageGB, outboundGB, storageCost, outboundCost, total };
  };
  const dailyCost = calcDailyCost();

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-zinc-100 rounded-sm flex items-center justify-center">
              <span className="text-black text-sm font-bold">A</span>
            </div>
            <span className="text-xl font-bold tracking-tight">
              Admin Dashboard
            </span>
          </div>
          <div className="text-sm text-zinc-400">欢迎，{userName}</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-zinc-100">存储用量</CardTitle>
            </CardHeader>
            <CardContent className="text-zinc-400">
              <div className="text-2xl text-zinc-100 mb-2">{formatBytes(sitesBytes)}</div>
              <div>对象数量：{sitesCount}</div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-zinc-100">用户数量</CardTitle>
            </CardHeader>
            <CardContent className="text-zinc-400">
              <div className="text-2xl text-zinc-100 mb-2">{usersCount}</div>
              <div>统计范围：正在使用本平台的用户数量</div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-zinc-100">项目数量</CardTitle>
            </CardHeader>
            <CardContent className="text-zinc-400">
              <div className="text-2xl text-zinc-100 mb-2">{projectsCount}</div>
              <div>统计范围：正在运行的项目数量</div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-zinc-100">日消费（估算）</CardTitle>
            </CardHeader>
            <CardContent className="text-zinc-400">
              <div className="text-2xl text-zinc-100 mb-2">
                ￥{dailyCost.total.toFixed(2)}
              </div>
              <div className="space-y-1 text-sm">
                <div>
                  存储：{dailyCost.storageGB.toFixed(2)} GB × 0.099 = ￥
                  {dailyCost.storageCost.toFixed(2)}
                </div>
                <div>
                  下行：{dailyCost.outboundGB.toFixed(2)} GB × 0.5 = ￥
                  {dailyCost.outboundCost.toFixed(2)}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-zinc-100">桶流量（天级，近7天）</CardTitle>
            </CardHeader>
            <CardContent className="text-zinc-400">
              <div className="flex items-center gap-2 mb-4">
                <input
                  type="datetime-local"
                  value={rangeDay.start}
                  onChange={(e) => setRangeDay((r) => ({ ...r, start: e.target.value }))}
                  className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                />
                <span>至</span>
                <input
                  type="datetime-local"
                  value={rangeDay.end}
                  onChange={(e) => setRangeDay((r) => ({ ...r, end: e.target.value }))}
                  className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                />
                <Button
                  variant="outline"
                  className="bg-zinc-900 border-zinc-700 text-zinc-300"
                  onClick={fetchStatsDay}
                >
                  应用
                </Button>
              </div>
              {chartDataDay.length === 0 ? (
                <div>暂无数据</div>
              ) : (
                <div style={{ width: "100%", height: 240 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartDataDay}>
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                      <XAxis dataKey="ts" tickFormatter={(v) => formatTsLabel(v, "day")} stroke="#71717a" />
                      <YAxis
                        tickFormatter={(v) => formatBytes(Number(v))}
                        stroke="#71717a"
                        domain={[0, (max: number) => max * 1.2]}
                        allowDataOverflow
                      />
                      <Tooltip
                        formatter={(value: number | string, name: string, item: { dataKey?: string }) => [
                          formatBytes(typeof value === "number" ? value : Number(value)),
                          item?.dataKey === "inbound" ? "入站" : "出站"
                        ]}
                        labelFormatter={(label: string | number) => formatTsLabel(label, "day")}
                        contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a" }}
                      />
                      <Line type="monotone" dataKey="inbound" stroke="#22c55e" dot={false} name="入站" />
                      <Line type="monotone" dataKey="outbound" stroke="#3b82f6" dot={false} name="出站" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-zinc-100">桶流量（小时级，近24小时）</CardTitle>
            </CardHeader>
            <CardContent className="text-zinc-400">
              <div className="flex items-center gap-2 mb-4">
                <input
                  type="datetime-local"
                  value={rangeHour.start}
                  onChange={(e) => setRangeHour((r) => ({ ...r, start: e.target.value }))}
                  className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                />
                <span>至</span>
                <input
                  type="datetime-local"
                  value={rangeHour.end}
                  onChange={(e) => setRangeHour((r) => ({ ...r, end: e.target.value }))}
                  className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                />
                <Button
                  variant="outline"
                  className="bg-zinc-900 border-zinc-700 text-zinc-300"
                  onClick={fetchStatsHour}
                >
                  应用
                </Button>
              </div>
              {chartDataHour.length === 0 ? (
                <div>暂无数据</div>
              ) : (
                <div style={{ width: "100%", height: 240 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartDataHour}>
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                      <XAxis dataKey="ts" tickFormatter={(v) => formatTsLabel(v, "hour")} stroke="#71717a" />
                      <YAxis
                        tickFormatter={(v) => formatBytes(Number(v))}
                        stroke="#71717a"
                        domain={[0, (max: number) => max * 1.2]}
                        allowDataOverflow
                      />
                      <Tooltip
                        formatter={(value: number | string, name: string, item: { dataKey?: string }) => [
                          formatBytes(typeof value === "number" ? value : Number(value)),
                          item?.dataKey === "inbound" ? "入站" : "出站"
                        ]}
                        labelFormatter={(label: string | number) => formatTsLabel(label, "hour")}
                        contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a" }}
                      />
                      <Line type="monotone" dataKey="inbound" stroke="#22c55e" dot={false} name="入站" />
                      <Line type="monotone" dataKey="outbound" stroke="#3b82f6" dot={false} name="出站" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
