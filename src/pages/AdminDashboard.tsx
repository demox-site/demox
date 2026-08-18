import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { userManager, websiteApi, adminApi } from "@/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label
} from "@/components/ui";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useToast } from "@/components/ui";
import { formatBytes } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Tooltip as UiTooltip, TooltipContent as UiTooltipContent, TooltipTrigger as UiTooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Pencil, RefreshCw, RotateCcw, Search, ShieldCheck, UserPlus } from "lucide-react";

const DEFAULT_ROLE_META = [
  { id: "admin", name: "管理员", priority: 100, enabled: true },
  { id: "pro", name: "专业用户", priority: 50, enabled: true },
  { id: "user", name: "普通用户", priority: 10, enabled: true }
];

const normalizeRoleIds = (roles: string[]) => {
  const normalized = roles.map((role) => String(role || "").trim().toLowerCase()).filter(Boolean);
  return ["user", ...new Set(normalized.filter((role) => role !== "user"))];
};

const roleBadgeClass = (roleId: string) => {
  if (roleId === "admin") return "border-amber-400/30 bg-amber-400/10 text-amber-200";
  if (roleId === "pro") return "border-sky-400/30 bg-sky-400/10 text-sky-200";
  return "border-zinc-700 bg-zinc-800 text-zinc-300";
};

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
  const { section } = useParams<{ section?: string }>();
  const activeTab: "dashboard" | "roles" | "roleLimits" | "buckets" =
    section === "roles" ? "roles"
      : section === "roleLimits" ? "roleLimits"
        : section === "buckets" ? "buckets"
          : "dashboard";
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [statsDay, setStatsDay] = useState<BucketStats | null>(null);
  const [statsHour, setStatsHour] = useState<BucketStats | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [currentUserId, setCurrentUserId] = useState<string>("");
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
    const user = userManager.get();
    if (!user || !user.userId) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setUserName(user.email || user.userId);
    setCurrentUserId(user.userId);
    const roles = Array.isArray(user.roles) ? user.roles : [];
    setIsAdmin(roles.includes("admin"));
  };

  /**
   * 拉取天级别统计（含 Sites 用量与在用用户/项目数量）
   */
  const fetchStatsDay = useCallback(async () => {
    try {
      const result: BucketStats = await websiteApi.bucketStats({
        granularity: "day",
        startTime: rangeDay.start,
        endTime: rangeDay.end
      });
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
      const result: BucketStats = await websiteApi.bucketStats({
        granularity: "hour",
        startTime: rangeHour.start,
        endTime: rangeHour.end
      });
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
    email?: string;
    role?: string[];
    updatedAt?: number;
  }
  type RawRoleDoc = {
    _id: string;
    email?: string;
    role?: string[];
    updatedAt?: number;
    updateTime?: number;
  };
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesList, setRolesList] = useState<UserRoleDoc[]>([]);
  const [roleSearch, setRoleSearch] = useState("");
  const [isUserRoleDialogOpen, setIsUserRoleDialogOpen] = useState(false);
  const [userRoleDialogMode, setUserRoleDialogMode] = useState<"create" | "edit">("create");
  const [userRoleDialogUid, setUserRoleDialogUid] = useState("");
  const [userRoleDialogEmail, setUserRoleDialogEmail] = useState("");
  const [userRoleDialogRoles, setUserRoleDialogRoles] = useState<string[]>(["user"]);
  const [roleSavingUid, setRoleSavingUid] = useState("");
  const [resetRoleTarget, setResetRoleTarget] = useState<UserRoleDoc | null>(null);
  /**
   * fetchRoles
   * 获取 ai_builder_user_roles 集合的全部文档
   */
  const fetchRoles = useCallback(async () => {
    setRolesLoading(true);
    try {
      const res = await adminApi.listUserRoles();
      if (!res.success) throw new Error("角色列表加载失败");
      const raw: RawRoleDoc[] = (res.data || []) as RawRoleDoc[];
      const list: UserRoleDoc[] = raw.map((d) => ({
        _id: d._id || "",
        email: d.email || "",
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
  const saveRoleDoc = async (uid: string, selectedRoles: string[]) => {
    const targetUid = uid.trim();
    const roles = normalizeRoleIds(selectedRoles);
    if (!targetUid) {
      toast({ title: "保存失败", description: "请填写用户 UID", variant: "destructive" });
      return false;
    }
    if (targetUid === currentUserId && !roles.includes("admin")) {
      toast({
        title: "无法修改当前账户",
        description: "不能移除自己的管理员角色，请使用其他管理员账户操作",
        variant: "destructive"
      });
      return false;
    }
    setRoleSavingUid(targetUid);
    try {
      const result = await adminApi.setUserRole(targetUid, roles);
      if (!result.success) throw new Error(result.message || "角色更新失败");
      toast({ title: "角色已更新", description: `用户 ${targetUid} 的角色将在下次刷新账户信息时生效` });
      await fetchRoles();
      return true;
    } catch (e: unknown) {
      toast({
        title: "保存失败",
        description: e instanceof Error ? e.message : "请稍后重试",
        variant: "destructive"
      });
      return false;
    } finally {
      setRoleSavingUid("");
    }
  };
  /**
   * deleteRoleDoc
   * 删除指定用户的角色文档
   */
  const deleteRoleDoc = async (uid: string) => {
    if (!uid) return;
    setRoleSavingUid(uid);
    try {
      const result = await adminApi.deleteUserRole(uid);
      if (!result.success) throw new Error(result.message || "角色重置失败");
      toast({ title: "已恢复普通用户", description: `用户 ${uid} 的自定义角色配置已移除` });
      await fetchRoles();
    } catch (e: unknown) {
      toast({
        title: "删除失败",
        description: e instanceof Error ? e.message : "请稍后重试",
        variant: "destructive"
      });
    } finally {
      setRoleSavingUid("");
      setResetRoleTarget(null);
    }
  };

  const openCreateRoleDialog = () => {
    setUserRoleDialogMode("create");
    setUserRoleDialogUid("");
    setUserRoleDialogEmail("");
    setUserRoleDialogRoles(["user"]);
    setIsUserRoleDialogOpen(true);
  };

  const openEditRoleDialog = (item: UserRoleDoc) => {
    setUserRoleDialogMode("edit");
    setUserRoleDialogUid(item._id);
    setUserRoleDialogEmail(item.email || "");
    setUserRoleDialogRoles(normalizeRoleIds(item.role || []));
    setIsUserRoleDialogOpen(true);
  };

  const toggleDialogRole = (roleId: string, checked: boolean) => {
    if (roleId === "user") return;
    setUserRoleDialogRoles((current) => normalizeRoleIds(
      checked ? [...current, roleId] : current.filter((role) => role !== roleId)
    ));
  };

  const submitUserRoleDialog = async () => {
    const saved = await saveRoleDoc(userRoleDialogUid, userRoleDialogRoles);
    if (saved) setIsUserRoleDialogOpen(false);
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
      const res = await adminApi.listRoleLimits();
      if (!res.success) throw new Error("角色定义加载失败");
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
      await adminApi.setRoleLimit({ id: (doc._id || doc.name), ...payload });
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
      await adminApi.deleteRoleLimit(name);
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

  // ====== 存储桶注册制 ======
  interface BucketRow {
    id: number;
    name: string;
    provider: string;
    bucket: string;
    region?: string | null;
    endpoint?: string | null;
    originHost?: string | null;
    forcePathStyle?: boolean;
    hasOwnCreds: boolean;
    isDefault: boolean;
    enabled: boolean;
  }
  const [bucketsLoading, setBucketsLoading] = useState(false);
  const [bucketsList, setBucketsList] = useState<BucketRow[]>([]);
  const [bucketsErr, setBucketsErr] = useState<string>("");
  const [isAddBucketOpen, setIsAddBucketOpen] = useState(false);
  // 新增存储桶表单
  const [bkName, setBkName] = useState("");
  const [bkProvider, setBkProvider] = useState<"cos" | "s3">("cos");
  const [bkBucket, setBkBucket] = useState("");
  const [bkRegion, setBkRegion] = useState("");
  const [bkEndpoint, setBkEndpoint] = useState("");
  const [bkOriginHost, setBkOriginHost] = useState("");
  const [bkSecretId, setBkSecretId] = useState("");
  const [bkSecretKey, setBkSecretKey] = useState("");
  const [bkIsDefault, setBkIsDefault] = useState(false);
  const [bkSaving, setBkSaving] = useState(false);

  const fetchBuckets = useCallback(async () => {
    setBucketsLoading(true);
    setBucketsErr("");
    try {
      const res = await adminApi.listBuckets();
      if (!res.success) {
        setBucketsErr(res.message || "加载失败");
        setBucketsList([]);
      } else {
        setBucketsList(Array.isArray(res.data) ? res.data : []);
      }
    } catch (e: unknown) {
      setBucketsErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setBucketsLoading(false);
    }
  }, []);

  const resetBucketForm = () => {
    setBkName(""); setBkProvider("cos"); setBkBucket(""); setBkRegion("");
    setBkEndpoint(""); setBkOriginHost(""); setBkSecretId(""); setBkSecretKey("");
    setBkIsDefault(false);
  };

  const submitBucket = async () => {
    if (!bkName.trim() || !bkBucket.trim()) {
      toast({ title: "请填写桶名称与 bucket", variant: "destructive" });
      return;
    }
    if ((bkSecretId && !bkSecretKey) || (!bkSecretId && bkSecretKey)) {
      toast({ title: "SecretId 与 SecretKey 需同时填写", variant: "destructive" });
      return;
    }
    setBkSaving(true);
    try {
      const res = await adminApi.registerBucket({
        name: bkName.trim(),
        provider: bkProvider,
        bucket: bkBucket.trim(),
        region: bkRegion.trim() || undefined,
        endpoint: bkEndpoint.trim() || undefined,
        originHost: bkOriginHost.trim() || undefined,
        secretId: bkSecretId || undefined,
        secretKey: bkSecretKey || undefined,
        isDefault: bkIsDefault
      });
      if (!res.success) throw new Error(res.message || "注册失败");
      toast({ title: "存储桶已注册" });
      setIsAddBucketOpen(false);
      resetBucketForm();
      fetchBuckets();
    } catch (e: unknown) {
      toast({ title: "注册失败", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBkSaving(false);
    }
  };

  const setDefaultBucket = async (id: number) => {
    try {
      const res = await adminApi.setDefaultBucket(id);
      if (!res.success) throw new Error(res.message || "操作失败");
      toast({ title: "已设为默认桶" });
      fetchBuckets();
    } catch (e: unknown) {
      toast({ title: "操作失败", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const toggleBucketEnabled = async (b: BucketRow) => {
    try {
      const res = await adminApi.updateBucket({ id: b.id, enabled: !b.enabled });
      if (!res.success) throw new Error(res.message || "操作失败");
      fetchBuckets();
    } catch (e: unknown) {
      toast({ title: "操作失败", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const removeBucket = async (b: BucketRow) => {
    if (!window.confirm(`确定删除存储桶「${b.name}」？仅删除注册记录，不影响桶内文件。`)) return;
    try {
      const res = await adminApi.deleteBucket(b.id);
      if (!res.success) throw new Error(res.message || "删除失败");
      toast({ title: "已删除" });
      fetchBuckets();
    } catch (e: unknown) {
      toast({ title: "删除失败", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  // 注册存储桶弹窗。S3 兼容(R2/OSS/B2/MinIO)需填 endpoint；COS 用 region。
  const BUCKET_DIALOG = (
    <Dialog open={isAddBucketOpen} onOpenChange={setIsAddBucketOpen}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">注册存储桶</DialogTitle>
          <DialogDescription className="text-zinc-500">
            密钥将加密后存入数据库；留空则该桶使用服务端环境变量凭证（仅适合默认桶）。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-zinc-300">名称</Label>
              <Input value={bkName} onChange={(e) => setBkName(e.target.value)} placeholder="如：Cloudflare R2（备用）"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500" />
            </div>
            <div>
              <Label className="text-zinc-300">类型</Label>
              <select value={bkProvider} onChange={(e) => setBkProvider(e.target.value as "cos" | "s3")}
                className="w-full h-10 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 px-3">
                <option value="cos">腾讯云 COS</option>
                <option value="s3">S3 兼容（R2/OSS/B2/MinIO）</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-zinc-300">Bucket 名</Label>
              <Input value={bkBucket} onChange={(e) => setBkBucket(e.target.value)} placeholder="bucket 名称"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500" />
            </div>
            <div>
              <Label className="text-zinc-300">{bkProvider === "cos" ? "区域 Region" : "区域（可填 auto）"}</Label>
              <Input value={bkRegion} onChange={(e) => setBkRegion(e.target.value)} placeholder={bkProvider === "cos" ? "如：ap-chengdu" : "auto"}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500" />
            </div>
          </div>
          {bkProvider === "s3" ? (
            <div>
              <Label className="text-zinc-300">Endpoint</Label>
              <Input value={bkEndpoint} onChange={(e) => setBkEndpoint(e.target.value)} placeholder="如：https://<acct>.r2.cloudflarestorage.com"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500" />
            </div>
          ) : null}
          <div>
            <Label className="text-zinc-300">回源域 origin_host</Label>
            <Input value={bkOriginHost} onChange={(e) => setBkOriginHost(e.target.value)} placeholder="边缘函数回源域，如 sites.demox.site"
              className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-zinc-300">SecretId / AccessKeyId</Label>
              <Input value={bkSecretId} onChange={(e) => setBkSecretId(e.target.value)} placeholder="留空=用环境变量"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500" />
            </div>
            <div>
              <Label className="text-zinc-300">SecretKey / SecretAccessKey</Label>
              <Input type="password" value={bkSecretKey} onChange={(e) => setBkSecretKey(e.target.value)} placeholder="留空=用环境变量"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label className="text-zinc-300">设为默认桶</Label>
            <Switch checked={bkIsDefault} onCheckedChange={setBkIsDefault} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              onClick={() => setIsAddBucketOpen(false)} disabled={bkSaving}>取消</Button>
            <Button variant="outline" className="bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              onClick={submitBucket} disabled={bkSaving}>{bkSaving ? "注册中..." : "注册"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  // 根据二级路由 section 切换时加载对应数据(侧边栏二级菜单驱动)
  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === "roles") {
      fetchRoles();
      fetchRoleLimits();
    }
    else if (activeTab === "roleLimits") fetchRoleLimits();
    else if (activeTab === "buckets") fetchBuckets();
  }, [isAdmin, activeTab, fetchRoles, fetchRoleLimits, fetchBuckets]);

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
  const roleOptions = (() => {
    const configured = roleLimitsList.map((role) => ({
      id: role._id || role.name,
      name: role.name || role._id,
      priority: role.priority ?? 0,
      enabled: role.enabled !== false
    }));
    const merged = new Map(DEFAULT_ROLE_META.map((role) => [role.id, role]));
    configured.forEach((role) => merged.set(role.id, role));
    rolesList.flatMap((item) => item.role || []).forEach((roleId) => {
      if (!merged.has(roleId)) merged.set(roleId, { id: roleId, name: roleId, priority: 0, enabled: false });
    });
    return [...merged.values()].sort((a, b) => b.priority - a.priority);
  })();
  const getRoleMeta = (roleId: string) =>
    roleOptions.find((role) => role.id === roleId) || { id: roleId, name: roleId, priority: 0, enabled: false };
  const getEffectiveRole = (roleIds: string[] = []) => {
    const selected = normalizeRoleIds(roleIds).map(getRoleMeta);
    return selected.sort((a, b) => b.priority - a.priority)[0] || getRoleMeta("user");
  };
  const normalizedRoleSearch = roleSearch.trim().toLowerCase();
  const filteredRolesList = rolesList.filter((item) => {
    if (!normalizedRoleSearch) return true;
    return [item.email || "", item._id, ...(item.role || []).flatMap((roleId) => [roleId, getRoleMeta(roleId).name])]
      .some((value) => value.toLowerCase().includes(normalizedRoleSearch));
  });
  const roleCounts = roleOptions.reduce<Record<string, number>>((counts, option) => {
    counts[option.id] = rolesList.filter((item) => getEffectiveRole(item.role || []).id === option.id).length;
    return counts;
  }, {});
  const dialogEffectiveRole = getEffectiveRole(userRoleDialogRoles);
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

        <div>
          {/* Content（导航已上移到控制台侧边栏二级菜单，由二级路由 section 驱动） */}
          <div>
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
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-200">
                    <ShieldCheck className="h-4 w-4" />
                    平台权限层级
                  </div>
                  <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">用户角色配置</h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                    为指定用户分配平台角色。普通用户是基础角色，多个角色并存时按优先级最高的角色生效。
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {roleOptions.filter((role) => role.enabled).map((role) => (
                    <div
                      key={role.id}
                      className="relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-4"
                    >
                      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-amber-300/80 to-sky-400/30" />
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-zinc-100">{role.name}</span>
                            <Badge variant="outline" className={roleBadgeClass(role.id)}>{role.id}</Badge>
                          </div>
                          <p className="mt-2 text-xs text-zinc-500">优先级 {role.priority}</p>
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-semibold tabular-nums text-zinc-100">{roleCounts[role.id] || 0}</div>
                          <div className="text-xs text-zinc-500">已配置用户</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader className="gap-4 md:flex md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-zinc-100">已配置用户</CardTitle>
                      <p className="mt-1 text-sm text-zinc-500">仅展示有显式角色配置的账户，共 {rolesList.length} 个</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <div className="relative min-w-0 sm:w-72">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                        <Input
                          value={roleSearch}
                          onChange={(event) => setRoleSearch(event.target.value)}
                          placeholder="搜索邮箱、UID 或角色"
                          aria-label="搜索用户角色"
                          className="border-zinc-700 bg-zinc-950 pl-9 text-zinc-100 placeholder:text-zinc-600"
                        />
                      </div>
                      <Button
                        variant="outline"
                        className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                        onClick={() => {
                          fetchRoles();
                          fetchRoleLimits();
                        }}
                        disabled={rolesLoading || roleLimitsLoading}
                      >
                        <RefreshCw className={`mr-2 h-4 w-4 ${rolesLoading ? "animate-spin" : ""}`} />
                        刷新
                      </Button>
                      <Button onClick={openCreateRoleDialog}>
                        <UserPlus className="mr-2 h-4 w-4" />
                        配置用户
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-left text-zinc-400">
                            <th className="py-3 pr-6 font-medium">账户</th>
                            <th className="py-3 pr-6 font-medium">生效角色</th>
                            <th className="py-3 pr-6 font-medium">拥有角色</th>
                            <th className="py-3 pr-6 font-medium">更新时间</th>
                            <th className="py-3 text-right font-medium">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRolesList.length === 0 ? (
                            <tr>
                              <td className="py-10 text-center text-zinc-500" colSpan={5}>
                                {rolesLoading ? "正在加载角色配置..." : roleSearch ? "没有匹配的用户" : "暂无显式角色配置"}
                              </td>
                            </tr>
                          ) : (
                            filteredRolesList.map((item) => {
                              const effectiveRole = getEffectiveRole(item.role || []);
                              const isCurrentUser = item._id === currentUserId;
                              return (
                                <tr key={item._id} className="border-t border-zinc-800 align-middle">
                                  <td className="py-4 pr-6">
                                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                                      {item.email || "未关联邮箱"}
                                      {isCurrentUser ? <Badge variant="outline" className="border-zinc-700 text-zinc-400">当前账户</Badge> : null}
                                    </div>
                                    <div className="mt-1 max-w-[280px] truncate font-mono text-xs text-zinc-600" title={item._id}>{item._id}</div>
                                  </td>
                                  <td className="py-4 pr-6">
                                    <Badge variant="outline" className={roleBadgeClass(effectiveRole.id)}>{effectiveRole.name}</Badge>
                                  </td>
                                  <td className="py-4 pr-6">
                                    <div className="flex max-w-[300px] flex-wrap gap-1.5">
                                      {normalizeRoleIds(item.role || []).map((roleId) => {
                                        const meta = getRoleMeta(roleId);
                                        return <Badge key={roleId} variant="outline" className={roleBadgeClass(roleId)}>{meta.name}</Badge>;
                                      })}
                                    </div>
                                  </td>
                                  <td className="whitespace-nowrap py-4 pr-6 text-sm text-zinc-500">
                                    {item.updatedAt
                                      ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.updatedAt))
                                      : "—"}
                                  </td>
                                  <td className="py-4 text-right">
                                    <div className="flex justify-end gap-2">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                                        onClick={() => openEditRoleDialog(item)}
                                        disabled={roleSavingUid === item._id}
                                      >
                                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                        编辑
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-zinc-500 hover:bg-red-950/40 hover:text-red-300"
                                        onClick={() => setResetRoleTarget(item)}
                                        disabled={isCurrentUser || roleSavingUid === item._id}
                                        title={isCurrentUser ? "不能重置当前管理员账户" : "恢复为普通用户"}
                                      >
                                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                                        重置
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

                <Dialog open={isUserRoleDialogOpen} onOpenChange={setIsUserRoleDialogOpen}>
                  <DialogContent className="border-zinc-800 bg-zinc-900 sm:max-w-xl">
                    <DialogHeader>
                      <DialogTitle className="text-zinc-100">
                        {userRoleDialogMode === "create" ? "配置用户角色" : "编辑用户角色"}
                      </DialogTitle>
                      <DialogDescription>
                        {userRoleDialogMode === "create"
                          ? "输入用户 UID，并从当前启用的角色中选择。"
                          : `正在修改 ${userRoleDialogEmail || userRoleDialogUid}。`}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <Label htmlFor="role-user-uid" className="text-zinc-300">用户 UID</Label>
                        <Input
                          id="role-user-uid"
                          value={userRoleDialogUid}
                          onChange={(event) => setUserRoleDialogUid(event.target.value)}
                          placeholder="例如：user_xxx"
                          disabled={userRoleDialogMode === "edit"}
                          className="border-zinc-700 bg-zinc-950 font-mono text-zinc-100 placeholder:text-zinc-600"
                        />
                        {userRoleDialogMode === "create" ? (
                          <p className="text-xs text-zinc-500">UID 必须对应已注册用户；重复配置同一 UID 会更新原配置。</p>
                        ) : null}
                      </div>

                      <fieldset className="space-y-2">
                        <legend className="mb-2 text-sm font-medium text-zinc-300">分配角色</legend>
                        {roleOptions.map((role) => {
                          const checked = userRoleDialogRoles.includes(role.id);
                          const protectsCurrentAdmin = userRoleDialogUid === currentUserId && role.id === "admin" && checked;
                          const disabled = role.id === "user" || protectsCurrentAdmin || (!role.enabled && !checked);
                          return (
                            <label
                              key={role.id}
                              className={`flex items-center justify-between gap-4 rounded-lg border px-3 py-3 ${
                                checked ? "border-zinc-600 bg-zinc-800/80" : "border-zinc-800 bg-zinc-950/40"
                              } ${disabled && !checked ? "opacity-50" : "cursor-pointer"}`}
                            >
                              <div className="flex items-center gap-3">
                                <Checkbox
                                  checked={checked}
                                  disabled={disabled}
                                  onCheckedChange={(value) => toggleDialogRole(role.id, value === true)}
                                  aria-label={`分配${role.name}角色`}
                                />
                                <div>
                                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                                    {role.name}
                                    <span className="font-mono text-xs text-zinc-600">{role.id}</span>
                                    {!role.enabled ? <Badge variant="outline" className="border-zinc-700 text-zinc-500">已停用</Badge> : null}
                                  </div>
                                  <div className="mt-1 text-xs text-zinc-500">优先级 {role.priority}</div>
                                </div>
                              </div>
                              {role.id === "user" ? <span className="text-xs text-zinc-500">基础角色</span> : null}
                            </label>
                          );
                        })}
                      </fieldset>

                      <div className="rounded-lg border border-sky-400/20 bg-sky-400/5 px-3 py-3">
                        <div className="text-xs text-zinc-500">保存后生效角色</div>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant="outline" className={roleBadgeClass(dialogEffectiveRole.id)}>{dialogEffectiveRole.name}</Badge>
                          <span className="text-xs text-zinc-500">按最高优先级计算</span>
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                          onClick={() => setIsUserRoleDialogOpen(false)}
                          disabled={Boolean(roleSavingUid)}
                        >
                          取消
                        </Button>
                        <Button onClick={submitUserRoleDialog} disabled={!userRoleDialogUid.trim() || Boolean(roleSavingUid)}>
                          {roleSavingUid ? "保存中..." : "保存角色"}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                <AlertDialog open={Boolean(resetRoleTarget)} onOpenChange={(open) => !open && setResetRoleTarget(null)}>
                  <AlertDialogContent className="border-zinc-800 bg-zinc-900">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-zinc-100">恢复为普通用户？</AlertDialogTitle>
                      <AlertDialogDescription className="text-zinc-400">
                        将移除 {resetRoleTarget?.email || resetRoleTarget?._id} 的显式角色配置。该用户会回到普通用户权限，不会删除用户账户或站点数据。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800">取消</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-red-600 text-white hover:bg-red-500"
                        onClick={() => resetRoleTarget && deleteRoleDoc(resetRoleTarget._id)}
                      >
                        确认重置
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ) : activeTab === "roleLimits" ? (
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
            ) : (
              <div className="space-y-6">
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-zinc-100">存储桶</CardTitle>
                      <p className="text-zinc-500 text-sm mt-1">
                        注册多个存储桶（腾讯云 COS / S3 兼容）。新部署落「默认桶」，已有站点保持各自所属桶不变。
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                      onClick={() => { resetBucketForm(); setIsAddBucketOpen(true); }}
                    >
                      注册存储桶
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {bucketsErr ? (
                      <div className="text-amber-400 text-sm mb-3">{bucketsErr}</div>
                    ) : null}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-zinc-300">
                        <thead className="text-zinc-500 border-b border-zinc-800">
                          <tr>
                            <th className="text-left py-2 pr-4">名称</th>
                            <th className="text-left py-2 pr-4">类型</th>
                            <th className="text-left py-2 pr-4">Bucket / 区域</th>
                            <th className="text-left py-2 pr-4">回源域</th>
                            <th className="text-left py-2 pr-4">凭证</th>
                            <th className="text-left py-2 pr-4">状态</th>
                            <th className="text-right py-2">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bucketsList.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-6 text-center text-zinc-500">
                                {bucketsLoading ? "加载中..." : "暂无存储桶，点击右上角注册"}
                              </td>
                            </tr>
                          ) : (
                            bucketsList.map((b) => (
                              <tr key={b.id} className="border-b border-zinc-800/60">
                                <td className="py-2 pr-4">
                                  {b.name}
                                  {b.isDefault ? (
                                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300">默认</span>
                                  ) : null}
                                </td>
                                <td className="py-2 pr-4 uppercase text-zinc-400">{b.provider}</td>
                                <td className="py-2 pr-4">
                                  <div>{b.bucket}</div>
                                  <div className="text-zinc-500 text-xs">{b.region || (b.endpoint || "—")}</div>
                                </td>
                                <td className="py-2 pr-4 text-zinc-400">{b.originHost || "—"}</td>
                                <td className="py-2 pr-4 text-zinc-400">{b.hasOwnCreds ? "独立密钥" : "环境变量"}</td>
                                <td className="py-2 pr-4">{b.enabled ? "启用" : "停用"}</td>
                                <td className="py-2 text-right whitespace-nowrap">
                                  {!b.isDefault && b.enabled ? (
                                    <button className="text-emerald-400 hover:underline mr-3" onClick={() => setDefaultBucket(b.id)}>设为默认</button>
                                  ) : null}
                                  <button className="text-zinc-400 hover:underline mr-3" onClick={() => toggleBucketEnabled(b)}>
                                    {b.enabled ? "停用" : "启用"}
                                  </button>
                                  {!b.isDefault ? (
                                    <button className="text-red-400 hover:underline" onClick={() => removeBucket(b)}>删除</button>
                                  ) : null}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
                {BUCKET_DIALOG}
              </div>
            )}
          </div>
        </div>
      </div>
  );
};

export default AdminDashboard;
