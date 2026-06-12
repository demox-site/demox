import React, { useEffect, useState, useCallback } from "react";
import { app, auth, db } from "@/cloudbase";
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Label, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useToast } from "@/components/ui";
import { formatBytes } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Tooltip as UiTooltip, TooltipContent as UiTooltipContent, TooltipTrigger as UiTooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

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
  const [activeTab, setActiveTab] = useState<"dashboard" | "roles">("dashboard");
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
  // ===== 角色配置状态与方法 =====
  interface UserRoleDoc {
    _id: string;
    role?: string[];
    updatedAt?: number;
  }
  type RawRoleDoc = {
    _id: string;
    role?: string[];
    updatedAt?: number;
    updateTime?: number;
  };
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesList, setRolesList] = useState<UserRoleDoc[]>([]);
  const [newUid, setNewUid] = useState("");
  const [newRoles, setNewRoles] = useState("user");
  const [editMap, setEditMap] = useState<Record<string, string>>({});
  /**
   * parseRoles
   * 将逗号分隔的字符串解析为角色数组
   */
  const parseRoles = (text: string): string[] => {
    return text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };
  /**
   * fetchRoles
   * 获取 ai_builder_user_roles 集合的全部文档
   */
  const fetchRoles = useCallback(async () => {
    setRolesLoading(true);
    try {
      const res = await db.collection("ai_builder_user_roles").get();
      const raw: RawRoleDoc[] = (res.data || []) as RawRoleDoc[];
      const list: UserRoleDoc[] = raw.map((d) => ({
        _id: d._id || "",
        role: Array.isArray(d.role) ? d.role : [],
        updatedAt: d.updatedAt || d.updateTime
      }));
      setRolesList(list);
    } catch (e: unknown) {
      toast({
        title: "获取角色失败",
        description: e instanceof Error ? e.message : "请稍后重试",
        variant: "destructive"
      });
    } finally {
      setRolesLoading(false);
    }
  }, [toast]);
  /**
   * saveRoleDoc
   * 保存或更新指定用户的角色配置（docId 为 uid）
   */
  const saveRoleDoc = async (uid: string, rolesText: string) => {
    const roles = parseRoles(rolesText);
    if (!uid) {
      toast({ title: "保存失败", description: "请填写用户 UID", variant: "destructive" });
      return;
    }
    try {
      await db.collection("ai_builder_user_roles").doc(uid).set({ role: roles });
      toast({ title: "保存成功", description: `用户 ${uid} 角色已更新` });
      setEditMap((m) => {
        const cp = { ...m };
        delete cp[uid];
        return cp;
      });
      await fetchRoles();
    } catch (e: unknown) {
      toast({
        title: "保存失败",
        description: e instanceof Error ? e.message : "请稍后重试",
        variant: "destructive"
      });
    }
  };
  /**
   * deleteRoleDoc
   * 删除指定用户的角色文档
   */
  const deleteRoleDoc = async (uid: string) => {
    if (!uid) return;
    try {
      await db.collection("ai_builder_user_roles").doc(uid).remove();
      toast({ title: "删除成功", description: `用户 ${uid} 角色已删除` });
      await fetchRoles();
    } catch (e: unknown) {
      toast({
        title: "删除失败",
        description: e instanceof Error ? e.message : "请稍后重试",
        variant: "destructive"
      });
    }
  };
  /**
   * createRoleDoc
   * 新增一个用户角色文档
   */
  const createRoleDoc = async () => {
    await saveRoleDoc(newUid.trim(), newRoles.trim());
    setNewUid("");
    setNewRoles("user");
  };
  /**
   * 角色限额定义
   * 管理 admin/vip/user 等角色的限额配置
   */
  interface RoleLimitDoc {
    _id: string;
    name: string;
    priority?: number | null;
    max_file_size?: number | null;
    deployment_limit?: number | null;
    max_file_count?: number | null;
    allowed_extensions?: string[] | null;
    enabled?: boolean | null;
  }
  type RawRoleLimitDoc = {
    _id?: string;
    name?: string;
    priority?: number | null;
    max_file_size?: number | null;
    deployment_limit?: number | null;
    max_file_count?: number | null;
    allowed_extensions?: string[] | null;
    enabled?: boolean | null;
  };
  const [roleLimitsLoading, setRoleLimitsLoading] = useState(false);
  const [roleLimitsList, setRoleLimitsList] = useState<RoleLimitDoc[]>([]);
  const [newRoleName, setNewRoleName] = useState("user");
  const [newRolePriority, setNewRolePriority] = useState<string>("");
  const [newRoleMaxFileMB, setNewRoleMaxFileMB] = useState<string>("");
  const [newRoleDeployLimit, setNewRoleDeployLimit] = useState<string>("");
  const [editRoleLimitMap, setEditRoleLimitMap] = useState<Record<string, RoleLimitDoc>>({});
  const [isAddUserRoleOpen, setIsAddUserRoleOpen] = useState(false);
  const [isAddRoleLimitOpen, setIsAddRoleLimitOpen] = useState(false);
  const [isRoleLimitEditOpen, setIsRoleLimitEditOpen] = useState(false);
  const [roleLimitDialogRole, setRoleLimitDialogRole] = useState<string>("");
  const [roleLimitDialogPriority, setRoleLimitDialogPriority] = useState<string>("");
  const [roleLimitDialogMaxMB, setRoleLimitDialogMaxMB] = useState<string>("");
  const [roleLimitDialogDeployLimit, setRoleLimitDialogDeployLimit] = useState<string>("");
  const [roleLimitDialogMaxCount, setRoleLimitDialogMaxCount] = useState<string>("");
  const [roleLimitDialogAllowedExt, setRoleLimitDialogAllowedExt] = useState<string>("");
  const [roleLimitDialogEnabled, setRoleLimitDialogEnabled] = useState<boolean>(true);
  /**
   * mbToBytes
   * 将 MB 转换为字节
   */
  const mbToBytes = (mbStr: string): number | null => {
    const s = String(mbStr ?? "").trim();
    if (s === "") return null;
    const n = Number(s);
    if (!isFinite(n)) return null;
    if (n < 0) return null;
    return Math.round(n * 1024 * 1024);
  };
  /**
   * fetchRoleLimits
   * 读取 ai_builder_roles 集合的全部文档（包含角色与限额）
   */
  const fetchRoleLimits = useCallback(async () => {
    setRoleLimitsLoading(true);
    try {
      const res = await db.collection("ai_builder_roles").get();
      const raw: RawRoleLimitDoc[] = (res.data || []) as RawRoleLimitDoc[];
      const list: RoleLimitDoc[] = raw
        .map((d) => ({
          // 兼容 name 与 _id 字段
          _id: (d._id || d.name || "") as string,
          name: (d.name || d._id || "") as string,
          priority: d.priority ?? null,
          max_file_size: d.max_file_size ?? null,
          deployment_limit: d.deployment_limit ?? null,
          max_file_count: d.max_file_count ?? null,
          allowed_extensions: Array.isArray(d.allowed_extensions) ? d.allowed_extensions : null,
          enabled: typeof d.enabled === "boolean" ? d.enabled : null
        }))
        .filter((d) => !!d.name);
      setRoleLimitsList(list);
    } catch (e: unknown) {
      toast({
        title: "获取角色限额失败",
        description: e instanceof Error ? e.message : "请稍后重试",
        variant: "destructive"
      });
    } finally {
      setRoleLimitsLoading(false);
    }
  }, [toast]);
  /**
   * saveRoleLimitDoc
   * 保存或更新角色限额定义（集合：ai_builder_roles；docId 使用角色名称）
   */
  const saveRoleLimitDoc = async (doc: RoleLimitDoc) => {
    const payload: RawRoleLimitDoc = {
      // 同时写入 name 字段，保持兼容
      name: doc.name,
      priority: doc.priority ?? null,
      max_file_size: doc.max_file_size ?? null,
      deployment_limit: doc.deployment_limit ?? null,
      max_file_count: doc.max_file_count ?? null,
      allowed_extensions: doc.allowed_extensions ?? null,
      enabled: typeof doc.enabled === "boolean" ? doc.enabled : null
    };
    // 删除为 null 的键，遵循“没有就是无限”的约定
    Object.keys(payload).forEach((k) => {
      const key = k as keyof RawRoleLimitDoc;
      if (payload[key] == null) {
        // @ts-expect-error 动态删除可选键
        delete payload[key];
      }
    });
    try {
      await db.collection("ai_builder_roles").doc((doc._id || doc.name) as string).set(payload);
      toast({ title: "保存成功", description: `角色 ${doc.name} 限额已更新` });
      setEditRoleLimitMap((m) => {
        const cp = { ...m };
        delete cp[doc.name];
        return cp;
      });
      await fetchRoleLimits();
    } catch (e: unknown) {
      toast({
        title: "保存失败",
        description: e instanceof Error ? e.message : "请稍后重试",
        variant: "destructive"
      });
    }
  };
  /**
   * deleteRoleLimitDoc
   * 删除角色限额定义（集合：ai_builder_roles）
   */
  const deleteRoleLimitDoc = async (name: string) => {
    try {
      await db.collection("ai_builder_roles").doc(name).remove();
      toast({ title: "删除成功", description: `角色 ${name} 限额已删除` });
      await fetchRoleLimits();
    } catch (e: unknown) {
      toast({
        title: "删除失败",
        description: e instanceof Error ? e.message : "请稍后重试",
        variant: "destructive"
      });
    }
  };
  /**
   * createRoleLimitDoc
   * 新增角色限额定义
   */
  const createRoleLimitDoc = async () => {
    const priority = newRolePriority.trim() === "" ? null : Number(newRolePriority);
    const maxFile = mbToBytes(newRoleMaxFileMB.trim());
    const deployLimit =
      newRoleDeployLimit.trim() === "" ? null : Number(newRoleDeployLimit.trim());
    const doc: RoleLimitDoc = {
      _id: newRoleName,
      name: newRoleName,
      priority: priority ?? null,
      max_file_size: maxFile,
      deployment_limit: isFinite(deployLimit as number) ? (deployLimit as number) : null
    };
    await saveRoleLimitDoc(doc);
    setNewRoleName("user");
    setNewRolePriority("");
    setNewRoleMaxFileMB("");
    setNewRoleDeployLimit("");
  };
  /**
   * openRoleLimitEditDialog
   * 打开角色限额编辑弹框，默认选中第一个角色
   */
  const openRoleLimitEditDialog = () => {
    const first = roleLimitsList[0];
    if (first) {
      setRoleLimitDialogRole(first._id || first.name);
      setRoleLimitDialogPriority(
        first.priority == null ? "" : String(first.priority)
      );
      setRoleLimitDialogMaxMB(
        first.max_file_size == null
          ? ""
          : String(Math.round((first.max_file_size as number) / 1024 / 1024))
      );
      setRoleLimitDialogDeployLimit(
        first.deployment_limit == null ? "" : String(first.deployment_limit)
      );
      setRoleLimitDialogMaxCount(
        first.max_file_count == null ? "" : String(first.max_file_count)
      );
      setRoleLimitDialogAllowedExt(
        Array.isArray(first.allowed_extensions) && first.allowed_extensions.length > 0
          ? first.allowed_extensions.join(",")
          : ""
      );
      setRoleLimitDialogEnabled(first.enabled === false ? false : true);
    } else {
      setRoleLimitDialogRole("");
      setRoleLimitDialogPriority("");
      setRoleLimitDialogMaxMB("");
      setRoleLimitDialogDeployLimit("");
      setRoleLimitDialogMaxCount("");
      setRoleLimitDialogAllowedExt("");
      setRoleLimitDialogEnabled(true);
    }
    setIsRoleLimitEditOpen(true);
  };
  /**
   * applyRoleLimitDialogSelection
   * 根据选择的角色名称填充弹框表单
   */
  const applyRoleLimitDialogSelection = (name: string) => {
    setRoleLimitDialogRole(name);
    const found = roleLimitsList.find((i) => (i._id || i.name) === name);
    if (found) {
      setRoleLimitDialogPriority(
        found.priority == null ? "" : String(found.priority)
      );
      setRoleLimitDialogMaxMB(
        found.max_file_size == null
          ? ""
          : String(Math.round((found.max_file_size as number) / 1024 / 1024))
      );
      setRoleLimitDialogDeployLimit(
        found.deployment_limit == null ? "" : String(found.deployment_limit)
      );
      setRoleLimitDialogMaxCount(
        found.max_file_count == null ? "" : String(found.max_file_count)
      );
      setRoleLimitDialogAllowedExt(
        Array.isArray(found.allowed_extensions) && found.allowed_extensions.length > 0
          ? found.allowed_extensions.join(",")
          : ""
      );
      setRoleLimitDialogEnabled(found.enabled === false ? false : true);
    } else {
      setRoleLimitDialogPriority("");
      setRoleLimitDialogMaxMB("");
      setRoleLimitDialogDeployLimit("");
      setRoleLimitDialogMaxCount("");
      setRoleLimitDialogAllowedExt("");
      setRoleLimitDialogEnabled(true);
    }
  };
  /**
   * saveRoleLimitDialog
   * 保存弹框中的角色限额配置
   */
  const saveRoleLimitDialog = async () => {
    if (!roleLimitDialogRole) {
      toast({
        title: "保存失败",
        description: "请先选择角色",
        variant: "destructive"
      });
      return;
    }
    const priority =
      roleLimitDialogPriority.trim() === "" ? null : Number(roleLimitDialogPriority);
    const maxFile = mbToBytes(roleLimitDialogMaxMB.trim());
    const deployLimit =
      roleLimitDialogDeployLimit.trim() === ""
        ? null
        : Number(roleLimitDialogDeployLimit.trim());
    const allowedExt =
      roleLimitDialogAllowedExt.trim() === ""
        ? null
        : roleLimitDialogAllowedExt
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    const maxFileCount =
      roleLimitDialogMaxCount.trim() === ""
        ? null
        : Number(roleLimitDialogMaxCount.trim());
    const displayName =
      roleLimitsList.find((i) => (i._id || i.name) === roleLimitDialogRole)?.name ||
      roleLimitDialogRole;
    const doc: RoleLimitDoc = {
      _id: roleLimitDialogRole,
      name: displayName,
      priority: priority ?? null,
      max_file_size: maxFile,
      deployment_limit: isFinite(deployLimit as number) ? (deployLimit as number) : null,
      max_file_count: isFinite(maxFileCount as number) ? (maxFileCount as number) : null,
      allowed_extensions: allowedExt,
      enabled: roleLimitDialogEnabled
    };
    await saveRoleLimitDoc(doc);
    setIsRoleLimitEditOpen(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-zinc-800 border-t-zinc-100 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
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
    <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-zinc-100 rounded-sm flex items-center justify-center">
              <span className="text-black text-sm font-bold">A</span>
            </div>
            <span className="text-xl font-bold tracking-tight">Admin</span>
          </div>
          <div className="text-sm text-zinc-400">欢迎，{userName}</div>
        </div>

        <div className="flex gap-6">
          {/* Sidebar */}
          <div className="w-56 shrink-0">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-zinc-100">导航</CardTitle>
              </CardHeader>
              <CardContent className="text-zinc-300 space-y-2">
                <Button
                  variant="outline"
                  className={`w-full border-zinc-700 ${
                    activeTab === "dashboard"
                      ? "bg-zinc-800 text-zinc-100"
                      : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                  }`}
                  onClick={() => setActiveTab("dashboard")}
                >
                  Dashboard
                </Button>
                <Button
                  variant="outline"
                  className={`w-full border-zinc-700 ${
                    activeTab === "roles"
                      ? "bg-zinc-800 text-zinc-100"
                      : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                  }`}
                  onClick={async () => {
                    setActiveTab("roles");
                    await fetchRoles();
                  }}
                >
                  用户角色配置
                </Button>
                <Button
                  variant="outline"
                  className={`w-full border-zinc-700 ${
                    activeTab === "roleLimits"
                      ? "bg-zinc-800 text-zinc-100"
                      : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                  }`}
                  onClick={async () => {
                    setActiveTab("roleLimits");
                    await fetchRoleLimits();
                  }}
                >
                  角色列表
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Content */}
          <div className="flex-1">
            {activeTab === "dashboard" ? (
              <>
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
                      <div className="text-2xl text-zinc-100 mb-2">￥{dailyCost.total.toFixed(2)}</div>
                      <div className="space-y-1 text-sm">
                        <div>
                          存储：{dailyCost.storageGB.toFixed(2)} GB × 0.099 = ￥{dailyCost.storageCost.toFixed(2)}
                        </div>
                        <div>
                          下行：{dailyCost.outboundGB.toFixed(2)} GB × 0.5 = ￥{dailyCost.outboundCost.toFixed(2)}
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
                        <Button variant="outline" className="bg-zinc-900 border-zinc-700 text-zinc-300" onClick={fetchStatsDay}>
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
                        <Button variant="outline" className="bg-zinc-900 border-zinc-700 text-zinc-300" onClick={fetchStatsHour}>
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
              </>
            ) : activeTab === "roles" ? (
              <div className="space-y-6">
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader>
                    <CardTitle className="text-zinc-100">新增角色</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                      <div>
                        <Label className="text-zinc-300">用户 UID</Label>
                        <Input value={newUid} onChange={(e) => setNewUid(e.target.value)} placeholder="输入用户 UID" />
                      </div>
                      <div>
                        <Label className="text-zinc-300">角色（逗号分隔）</Label>
                        <Input value={newRoles} onChange={(e) => setNewRoles(e.target.value)} placeholder="例如：admin,vip" />
                      </div>
                      <div className="flex items-end">
                        <Button onClick={createRoleDoc} className="w-full">新增</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-zinc-100">角色列表</CardTitle>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={fetchRoles} disabled={rolesLoading}>
                        刷新
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-left text-zinc-400">
                            <th className="py-2 pr-4">UID</th>
                            <th className="py-2 pr-4">角色</th>
                            <th className="py-2 pr-4">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rolesList.length === 0 ? (
                            <tr>
                              <td className="py-3 pr-4 text-zinc-400" colSpan={3}>
                                {rolesLoading ? "加载中..." : "暂无数据"}
                              </td>
                            </tr>
                          ) : (
                            rolesList.map((item) => {
                              const currentText = editMap[item._id] ?? (item.role || []).join(",");
                              return (
                                <tr key={item._id} className="border-t border-zinc-800">
                                  <td className="py-2 pr-4 text-zinc-200">{item._id}</td>
                                  <td className="py-2 pr-4">
                                    <Input
                                      value={currentText}
                                      onChange={(e) =>
                                        setEditMap((m) => ({ ...m, [item._id]: e.target.value }))
                                      }
                                      placeholder="角色，逗号分隔"
                                    />
                                  </td>
                                  <td className="py-2 pr-4">
                                    <div className="flex gap-2">
                                      <Button
                                        size="sm"
                                        onClick={() => saveRoleDoc(item._id, currentText)}
                                      >
                                        保存
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                          setEditMap((m) => {
                                            const cp = { ...m };
                                            delete cp[item._id];
                                            return cp;
                                          })
                                        }
                                      >
                                        取消
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        onClick={() => deleteRoleDoc(item._id)}
                                      >
                                        删除
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="space-y-6">
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-zinc-100">角色限额列表</CardTitle>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                        onClick={fetchRoleLimits}
                        disabled={roleLimitsLoading}
                      >
                        刷新
                      </Button>
                      <Button
                        variant="outline"
                        className="bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                        onClick={openRoleLimitEditDialog}
                      >
                        编辑角色限额
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-left text-zinc-400">
                            <th className="py-2 pr-4">角色</th>
                            <th className="py-2 pr-4">优先级</th>
                            <th className="py-2 pr-4">启用</th>
                            <th className="py-2 pr-4">最大文件（MB）</th>
                            <th className="py-2 pr-4">最大文件数（个）</th>
                            <th className="py-2 pr-4">允许扩展名</th>
                            <th className="py-2 pr-4">部署上限（个）</th>
                            <th className="py-2 pr-4">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {roleLimitsList.length === 0 ? (
                            <tr>
                              <td className="py-3 pr-4 text-zinc-400" colSpan={8}>
                                {roleLimitsLoading ? "加载中..." : "暂无数据"}
                              </td>
                            </tr>
                          ) : (
                            roleLimitsList.map((item) => {
                              const priorityText =
                                item.priority == null ? "-" : String(item.priority);
                              const enabledText = item.enabled === false ? "否" : "是";
                              const maxMBText =
                                item.max_file_size == null
                                  ? "不限"
                                  : `${Math.round((item.max_file_size as number) / 1024 / 1024)} MB`;
                              const maxCountText =
                                item.max_file_count == null ? "不限" : String(item.max_file_count);
                              const allowedExtText =
                                !item.allowed_extensions || item.allowed_extensions.length === 0
                                  ? "不限"
                                  : item.allowed_extensions.join(",");
                              const deployLimitText =
                                item.deployment_limit == null
                                  ? "不限"
                                  : String(item.deployment_limit);
                              return (
                                <tr key={(item._id || item.name)} className="border-t border-zinc-800">
                                  <td className="py-2 pr-4 text-zinc-200">{item.name}</td>
                                  <td className="py-2 pr-4 text-zinc-200">{priorityText}</td>
                                  <td className="py-2 pr-4 text-zinc-200">{enabledText}</td>
                                  <td className="py-2 pr-4 text-zinc-200">{maxMBText}</td>
                                  <td className="py-2 pr-4 text-zinc-200">{maxCountText}</td>
                                  <td className="py-2 pr-4 text-zinc-200">
                                    <TooltipProvider>
                                      <UiTooltip>
                                        <UiTooltipTrigger asChild>
                                          <span className="inline-block max-w-[240px] truncate text-zinc-200">
                                            {allowedExtText}
                                          </span>
                                        </UiTooltipTrigger>
                                        <UiTooltipContent className="max-w-[420px] break-words bg-zinc-900 border-zinc-800 text-zinc-200">
                                          {allowedExtText}
                                        </UiTooltipContent>
                                      </UiTooltip>
                                    </TooltipProvider>
                                  </td>
                                  <td className="py-2 pr-4 text-zinc-200">{deployLimitText}</td>
                                  <td className="py-2 pr-4 text-zinc-400">只读</td>
                                </tr>
                              );
                            })
                          )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <Dialog open={isRoleLimitEditOpen} onOpenChange={setIsRoleLimitEditOpen}>
                <DialogContent className="bg-zinc-900 border-zinc-800">
                  <DialogHeader>
                    <DialogTitle className="text-zinc-100">编辑角色限额</DialogTitle>
                    <DialogDescription>选择角色并更新其限额配置，留空表示不限制</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-zinc-300">选择角色</Label>
                      <select
                        className="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-2 text-zinc-200"
                        value={roleLimitDialogRole}
                        onChange={(e) => applyRoleLimitDialogSelection(e.target.value)}
                      >
                        <option value="" disabled>
                          请选择角色
                        </option>
                        {roleLimitsList.map((r) => (
                          <option key={(r._id || r.name)} value={(r._id || r.name)}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <Label className="text-zinc-300">优先级</Label>
                        <Input
                          value={roleLimitDialogPriority}
                          onChange={(e) => setRoleLimitDialogPriority(e.target.value)}
                          placeholder="数字，越大优先级越高"
                          className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
                        />
                      </div>
                      <div>
                        <Label className="text-zinc-300">最大文件大小（MB）</Label>
                        <Input
                          value={roleLimitDialogMaxMB}
                          onChange={(e) => setRoleLimitDialogMaxMB(e.target.value)}
                          placeholder="例如：100（留空表示不限制）"
                          className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
                        />
                      </div>
                      <div>
                        <Label className="text-zinc-300">部署上限（个）</Label>
                        <Input
                          value={roleLimitDialogDeployLimit}
                          onChange={(e) => setRoleLimitDialogDeployLimit(e.target.value)}
                          placeholder="例如：3（留空表示不限制）"
                          className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-zinc-300">最大文件数（个）</Label>
                        <Input
                          value={roleLimitDialogMaxCount}
                          onChange={(e) => setRoleLimitDialogMaxCount(e.target.value)}
                          placeholder="例如：1000（留空表示不限制）"
                          className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
                        />
                      </div>
                      <div>
                        <Label className="text-zinc-300">允许扩展名（逗号分隔）</Label>
                        <Input
                          value={roleLimitDialogAllowedExt}
                          onChange={(e) => setRoleLimitDialogAllowedExt(e.target.value)}
                          placeholder=".html,.css,.js（留空表示不限制）"
                          className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="text-zinc-300">启用</Label>
                      <Switch checked={roleLimitDialogEnabled} onCheckedChange={setRoleLimitDialogEnabled} />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        className="bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                        onClick={() => setIsRoleLimitEditOpen(false)}
                      >
                        取消
                      </Button>
                      <Button
                        variant="outline"
                        className="bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                        onClick={saveRoleLimitDialog}
                      >
                        保存
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              </div>
            )}
          </div>
        </div>
      </div>
  );
};

export default AdminDashboard;
