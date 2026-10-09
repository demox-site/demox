import React, { Suspense, useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { userManager, adminApi } from "@/api";
import {
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
  Label,
  RadioGroup,
  RadioGroupItem,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useToast } from "@/components/ui";
import { formatBytes } from "@/lib/utils";
import { FeishuIcon } from "@/components/FeishuIcon";
import { Switch } from "@/components/ui/switch";
import { Tooltip as UiTooltip, TooltipContent as UiTooltipContent, TooltipTrigger as UiTooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Ban, Eye, FolderKanban, Github, Globe, HardDrive, Pencil, RefreshCw, Search, ShieldCheck, Trash2, UserPlus } from "lucide-react";

// BI 概览单独分包：只有打开「数据概览」时才下载图表代码。
const AdminBiOverview = React.lazy(() => import("./admin/bi/AdminBiOverview"));

const DEFAULT_ROLE_META = [
  { id: "admin", name: "管理员", priority: 100, enabled: true },
  { id: "pro", name: "专业用户", priority: 50, enabled: true },
  { id: "user", name: "普通用户", priority: 10, enabled: true }
];

const normalizeRoleIds = (roles: string[]) => {
  const normalized = roles.map((role) => String(role || "").trim().toLowerCase()).filter(Boolean);
  return ["user", ...new Set(normalized.filter((role) => role !== "user"))];
};

const PRO_DURATION_OPTIONS = [
  { id: "keep", label: "保持当前时效" },
  { id: "30", label: "30 天" },
  { id: "90", label: "90 天" },
  { id: "365", label: "365 天" },
  { id: "lifetime", label: "永久" }
] as const;

type ProDuration = (typeof PRO_DURATION_OPTIONS)[number]["id"];

const formatCount = (value?: number | null) =>
  Number(value || 0).toLocaleString("zh-CN");

type OverviewSite = {
  websiteId: string;
  name: string;
  url?: string;
  projectId?: string;
  projectName?: string;
  views30d?: number;
  storage?: number;
};

type OverviewProject = {
  id: string;
  name: string;
  slug: string;
  archived?: boolean;
  websitesCount?: number;
  sites?: OverviewSite[];
};

const groupProjectsWithSites = (
  projects: OverviewProject[] | undefined,
  sites: OverviewSite[] | undefined,
  ungroupedSites?: OverviewSite[]
) => {
  const projectList = projects || [];
  const siteList = sites || [];
  if (projectList.some((project) => Array.isArray(project.sites))) {
    const assigned = new Set(projectList.flatMap((project) => (project.sites || []).map((site) => site.websiteId)));
    return {
      projects: projectList.map((project) => ({ ...project, sites: project.sites || [] })),
      ungrouped: (ungroupedSites && ungroupedSites.length > 0)
        ? ungroupedSites
        : siteList.filter((site) => !assigned.has(site.websiteId))
    };
  }
  const used = new Set<string>();
  const grouped = projectList.map((project) => {
    const nested = siteList.filter((site) => {
      const match = site.projectId === project.id || (!!site.projectName && site.projectName === project.name);
      if (match) used.add(site.websiteId);
      return match;
    });
    return { ...project, sites: nested, websitesCount: project.websitesCount ?? nested.length };
  });
  return {
    projects: grouped,
    ungrouped: siteList.filter((site) => !used.has(site.websiteId))
  };
};

const formatProExpiry = (item: {
  role?: string[];
  proLifetime?: boolean;
  proExpired?: boolean;
  proExpiresAt?: string | null;
  remainingDays?: number | null;
}) => {
  if (!(item.role || []).includes("pro")) return null;
  if (item.proLifetime) return "永久";
  if (item.proExpired) return "已过期";
  const dateText = item.proExpiresAt
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(item.proExpiresAt))
    : "";
  if (item.remainingDays != null) {
    return dateText ? `${dateText} · 剩 ${item.remainingDays} 天` : `剩 ${item.remainingDays} 天`;
  }
  return dateText || "—";
};

const VIEWS_LABEL = "访问";

const roleBadgeClass = (roleId: string) => {
  // 黑白灰：管理员最实（反白），专业用户描边，普通用户最弱
  if (roleId === "admin") return "border-zinc-100 bg-zinc-100 text-zinc-900";
  if (roleId === "pro") return "border-zinc-400 bg-transparent text-zinc-100";
  return "border-zinc-700 bg-zinc-800 text-zinc-300";
};

/**
 * AdminDashboard
 * 仅管理员可见的大盘页面，展示 COS 存储与流量信息
 */
const AdminDashboard: React.FC = () => {
  const { toast } = useToast();
  const { section } = useParams<{ section?: string }>();
  const activeTab: "dashboard" | "roles" | "roleLimits" | "buckets" | "reports" =
    section === "roles" ? "roles"
      : section === "roleLimits" ? "roleLimits"
        : section === "buckets" ? "buckets"
          : section === "reports" ? "reports"
          : "dashboard";
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userName, setUserName] = useState<string>("");
  const [currentUserId, setCurrentUserId] = useState<string>("");
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

  useEffect(() => {
    (async () => {
      await checkAdmin();
      setLoading(false);
    })();
  }, []);

  // ===== 角色配置状态与方法 =====
  interface UserRoleDoc {
    _id: string;
    email?: string;
    nickname?: string;
    authProviders?: Array<"github" | "feishu">;
    role?: string[];
    effectiveRole?: string[];
    proExpiresAt?: string | null;
    proLifetime?: boolean;
    proExpired?: boolean;
    remainingDays?: number | null;
    siteCount?: number;
    storageBytes?: number;
    updatedAt?: number;
  }
  type RoleSortKey = "sites" | "storage" | "updatedAt" | "role";
  type RawRoleDoc = {
    _id: string;
    email?: string;
    nickname?: string;
    authProviders?: string[];
    role?: string[];
    effectiveRole?: string[];
    proExpiresAt?: string | null;
    proLifetime?: boolean;
    proExpired?: boolean;
    remainingDays?: number | null;
    siteCount?: number;
    sites_count?: number;
    storageBytes?: number;
    updatedAt?: number;
    updateTime?: number;
  };
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesList, setRolesList] = useState<UserRoleDoc[]>([]);
  const [roleSearch, setRoleSearch] = useState("");
  const [roleSort, setRoleSort] = useState<{ key: RoleSortKey; dir: "asc" | "desc" }>({
    key: "updatedAt",
    dir: "desc"
  });
  const [isUserRoleDialogOpen, setIsUserRoleDialogOpen] = useState(false);
  const [userRoleDialogMode, setUserRoleDialogMode] = useState<"create" | "edit">("create");
  const [userRoleDialogUid, setUserRoleDialogUid] = useState("");
  const [userRoleDialogEmail, setUserRoleDialogEmail] = useState("");
  const [userRoleDialogRoles, setUserRoleDialogRoles] = useState<string[]>(["user"]);
  const [userRoleDialogProDuration, setUserRoleDialogProDuration] = useState<ProDuration>("30");
  const [roleSavingUid, setRoleSavingUid] = useState("");
  const [detailUser, setDetailUser] = useState<UserRoleDoc | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [userOverview, setUserOverview] = useState<{
    user?: {
      id?: string;
      email?: string;
      nickname?: string;
      createdAt?: number;
      authProviders?: string[];
      remainingDays?: number | null;
      proLifetime?: boolean;
      proExpired?: boolean;
      proExpiresAt?: string | null;
    };
    counts?: { projects?: number; archivedProjects?: number; sites?: number };
    usage?: { storage?: number; files?: number; deployments?: number; role?: { name?: string } };
    traffic?: { views7d?: number; views30d?: number; viewsAll?: number; daily?: Array<{ date: string; views: number }> };
    projects?: OverviewProject[];
    sites?: OverviewSite[];
    ungroupedSites?: OverviewSite[];
  } | null>(null);
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
        nickname: d.nickname || "",
        authProviders: (Array.isArray(d.authProviders) ? d.authProviders : []).filter(
          (provider): provider is "github" | "feishu" => provider === "github" || provider === "feishu"
        ),
        role: Array.isArray(d.role) ? d.role : [],
        effectiveRole: Array.isArray(d.effectiveRole) ? d.effectiveRole : undefined,
        proExpiresAt: d.proExpiresAt ?? null,
        proLifetime: Boolean(d.proLifetime),
        proExpired: Boolean(d.proExpired),
        remainingDays: d.remainingDays ?? null,
        siteCount: Number(d.siteCount ?? d.sites_count ?? 0),
        storageBytes: Number(d.storageBytes ?? 0),
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

  const openUserDetail = async (item: UserRoleDoc) => {
    setDetailUser(item);
    setDetailLoading(true);
    setDetailError("");
    setUserOverview(null);
    try {
      const res = await adminApi.getUserOverview(item._id);
      if (!res.success) throw new Error(res.message || "用户详情加载失败");
      setUserOverview(res);
    } catch (e: unknown) {
      setDetailError(e instanceof Error ? e.message : "请稍后重试");
    } finally {
      setDetailLoading(false);
    }
  };
  /**
   * saveRoleDoc
   * 保存或更新指定用户的角色配置（docId 为 uid）
   */
  const saveRoleDoc = async (uid: string, selectedRoles: string[], duration: ProDuration = "30") => {
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
    const grantOptions: { proDays?: number; proLifetime?: boolean } = {};
    if (roles.includes("pro")) {
      if (duration === "lifetime") grantOptions.proLifetime = true;
      else if (duration !== "keep") grantOptions.proDays = Number(duration);
    }
    setRoleSavingUid(targetUid);
    try {
      const result = await adminApi.setUserRole(targetUid, roles, grantOptions);
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

  const openCreateRoleDialog = () => {
    setUserRoleDialogMode("create");
    setUserRoleDialogUid("");
    setUserRoleDialogEmail("");
    setUserRoleDialogRoles(["user"]);
    setUserRoleDialogProDuration("30");
    setIsUserRoleDialogOpen(true);
  };

  const openEditRoleDialog = (item: UserRoleDoc) => {
    setUserRoleDialogMode("edit");
    setUserRoleDialogUid(item._id);
    setUserRoleDialogEmail(item.email || "");
    setUserRoleDialogRoles(normalizeRoleIds(item.role || []));
    const hasActivePro = (item.role || []).includes("pro") && !item.proExpired;
    setUserRoleDialogProDuration(hasActivePro ? (item.proLifetime ? "lifetime" : "keep") : "30");
    setIsUserRoleDialogOpen(true);
  };

  const toggleDialogRole = (roleId: string, checked: boolean) => {
    if (roleId === "user") return;
    setUserRoleDialogRoles((current) => normalizeRoleIds(
      checked ? [...current, roleId] : current.filter((role) => role !== roleId)
    ));
  };

  const submitUserRoleDialog = async () => {
    const saved = await saveRoleDoc(userRoleDialogUid, userRoleDialogRoles, userRoleDialogProDuration);
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

  const REPORT_REASON_LABEL: Record<string, string> = {
    porn: "色情低俗",
    illegal: "违法违规",
    violence: "暴力恐怖",
    spam: "欺诈广告",
    ip: "侵权盗用",
    other: "其他"
  };
  type ReportRow = {
    id: number;
    website_id: string;
    reason: string;
    note: string;
    page_url: string;
    host: string;
    status: string;
    created_at: string;
    site_name?: string;
    site_url?: string;
    subdomain?: string;
    visibility?: string;
  };
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsList, setReportsList] = useState<ReportRow[]>([]);
  const [reportsFilter, setReportsFilter] = useState<"open" | "reviewed" | "all">("open");
  const [inspectReport, setInspectReport] = useState<ReportRow | null>(null);
  const [disableTarget, setDisableTarget] = useState<ReportRow | null>(null);
  const [disableReason, setDisableReason] = useState("");
  const [disableSaving, setDisableSaving] = useState(false);
  const fetchReports = useCallback(async (status: "open" | "reviewed" | "all" = reportsFilter) => {
    setReportsLoading(true);
    try {
      const res = await adminApi.listSiteReports(status);
      if (!res.success) throw new Error(res.message || "加载失败");
      setReportsList(Array.isArray(res.data) ? res.data : []);
    } catch (e: unknown) {
      toast({ title: "加载举报失败", description: e instanceof Error ? e.message : "", variant: "destructive" });
      setReportsList([]);
    } finally {
      setReportsLoading(false);
    }
  }, [reportsFilter, toast]);
  const markReportReviewed = async (id: number) => {
    try {
      const res = await adminApi.updateSiteReport(id, "reviewed");
      if (!res.success) throw new Error(res.message || "操作失败");
      fetchReports();
    } catch (e: unknown) {
      toast({ title: "操作失败", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };
  const reportSiteUrl = (row: ReportRow) =>
    row.page_url || row.site_url || (row.host ? `https://${row.host}/` : `https://${String(row.website_id || "").toLowerCase()}.demox.site/`);
  const canDisableReportedSite = (row: ReportRow) =>
    String(row.website_id || "").toUpperCase() !== "EPX2UU43" && String(row.subdomain || "").toLowerCase() !== "www";
  const openDisableDialog = (row: ReportRow) => {
    if (!canDisableReportedSite(row)) {
      toast({ title: "不能禁用主站", variant: "destructive" });
      return;
    }
    setDisableReason("");
    setDisableTarget(row);
  };
  const disableReportedSite = async () => {
    const row = disableTarget;
    if (!row) return;
    const reason = disableReason.trim();
    if (reason.length < 8) {
      toast({ title: "请填写停用理由", description: "至少 8 个字，将用邮件发给站点所有者。", variant: "destructive" });
      return;
    }
    setDisableSaving(true);
    try {
      const res = await adminApi.updateVisibility({
        websiteId: row.website_id,
        visibility: "disabled",
        disableReason: reason,
        reportId: row.id
      });
      if (!res.success) throw new Error(res.message || "禁用失败");
      toast({
        title: res.emailed === false ? "站点已禁用，邮件发送失败" : "站点已禁用",
        description: res.message
      });
      setDisableTarget(null);
      setInspectReport(null);
      fetchReports();
    } catch (e: unknown) {
      toast({ title: "禁用失败", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setDisableSaving(false);
    }
  };
  const restoreReportedSite = async (row: ReportRow) => {
    try {
      const res = await adminApi.updateVisibility({ websiteId: row.website_id, visibility: "public" });
      if (!res.success) throw new Error(res.message || "恢复失败");
      toast({ title: "已恢复公开" });
      setInspectReport(null);
      fetchReports();
    } catch (e: unknown) {
      toast({ title: "恢复失败", description: e instanceof Error ? e.message : "", variant: "destructive" });
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
    else if (activeTab === "reports") fetchReports();
  }, [isAdmin, activeTab, fetchRoles, fetchRoleLimits, fetchBuckets, fetchReports]);

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
  const filteredRoleMatches = rolesList.filter((item) => {
    if (!normalizedRoleSearch) return true;
    const providers = (item.authProviders || []).flatMap((provider) =>
      provider === "github" ? ["github"] : ["feishu", "飞书"]
    );
    return [item.nickname || "", item.email || "", item._id, ...providers, ...(item.role || []).flatMap((roleId) => [roleId, getRoleMeta(roleId).name])]
      .some((value) => value.toLowerCase().includes(normalizedRoleSearch));
  });
  const toggleRoleSort = (key: RoleSortKey) => {
    setRoleSort((current) => (
      current.key === key
        ? { key, dir: current.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" }
    ));
  };
  const filteredRolesList = [...filteredRoleMatches].sort((a, b) => {
    const dir = roleSort.dir === "asc" ? 1 : -1;
    if (roleSort.key === "sites") return ((a.siteCount || 0) - (b.siteCount || 0)) * dir;
    if (roleSort.key === "storage") return ((a.storageBytes || 0) - (b.storageBytes || 0)) * dir;
    if (roleSort.key === "role") {
      const pa = getEffectiveRole(a.effectiveRole || a.role || []).priority;
      const pb = getEffectiveRole(b.effectiveRole || b.role || []).priority;
      return (pa - pb) * dir;
    }
    return ((a.updatedAt || 0) - (b.updatedAt || 0)) * dir;
  });
  const roleSortIcon = (key: RoleSortKey) => {
    if (roleSort.key !== key) return <ArrowUpDown className="h-3.5 w-3.5 text-zinc-600" />;
    return roleSort.dir === "asc"
      ? <ArrowUp className="h-3.5 w-3.5 text-zinc-200" />
      : <ArrowDown className="h-3.5 w-3.5 text-zinc-200" />;
  };
  const roleCounts = roleOptions.reduce<Record<string, number>>((counts, option) => {
    counts[option.id] = rolesList.filter((item) => getEffectiveRole(item.effectiveRole || item.role || []).id === option.id).length;
    return counts;
  }, {});
  const dialogEffectiveRole = getEffectiveRole(userRoleDialogRoles);
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
              <Suspense fallback={<div className="min-h-[640px]" />}>
                <AdminBiOverview />
              </Suspense>
            ) : activeTab === "roles" ? (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
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
                      <div className="absolute inset-y-0 left-0 w-1 bg-zinc-600" />
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
                      <p className="mt-1 text-sm text-zinc-500">仅展示有显式角色配置的账户，共 {rolesList.length} 个。点击一行可查看项目、站点与访问看板。</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <div className="relative min-w-0 sm:w-72">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                        <Input
                          value={roleSearch}
                          onChange={(event) => setRoleSearch(event.target.value)}
                          placeholder="搜索昵称、邮箱、UID、登录方式或角色"
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
                            <th className="py-3 pr-6 font-medium">第三方登录</th>
                            <th className="py-3 pr-6 font-medium">
                              <button type="button" className="inline-flex items-center gap-1 hover:text-zinc-200" onClick={() => toggleRoleSort("role")}>
                                生效角色 {roleSortIcon("role")}
                              </button>
                            </th>
                            <th className="py-3 pr-6 font-medium">会员时效</th>
                            <th className="py-3 pr-6 font-medium">
                              <button type="button" className="inline-flex items-center gap-1 hover:text-zinc-200" onClick={() => toggleRoleSort("sites")}>
                                站点数量 {roleSortIcon("sites")}
                              </button>
                            </th>
                            <th className="py-3 pr-6 font-medium">
                              <button type="button" className="inline-flex items-center gap-1 hover:text-zinc-200" onClick={() => toggleRoleSort("storage")}>
                                存储 {roleSortIcon("storage")}
                              </button>
                            </th>
                            <th className="py-3 pr-6 font-medium">
                              <button type="button" className="inline-flex items-center gap-1 hover:text-zinc-200" onClick={() => toggleRoleSort("updatedAt")}>
                                更新时间 {roleSortIcon("updatedAt")}
                              </button>
                            </th>
                            <th className="py-3 text-right font-medium">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRolesList.length === 0 ? (
                            <tr>
                              <td className="py-10 text-center text-zinc-500" colSpan={8}>
                                {rolesLoading ? "正在加载角色配置..." : roleSearch ? "没有匹配的用户" : "暂无显式角色配置"}
                              </td>
                            </tr>
                          ) : (
                            filteredRolesList.map((item) => {
                              const effectiveRole = getEffectiveRole(item.effectiveRole || item.role || []);
                              const isCurrentUser = item._id === currentUserId;
                              const proExpiryText = formatProExpiry(item);
                              return (
                                <tr
                                  key={item._id}
                                  className="border-t border-zinc-800 align-middle cursor-pointer hover:bg-zinc-900/80"
                                  onClick={() => openUserDetail(item)}
                                >
                                  <td className="py-4 pr-6">
                                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                                      {item.nickname || item.email || "未关联账户"}
                                      {isCurrentUser ? <Badge variant="outline" className="border-zinc-700 text-zinc-400">当前账户</Badge> : null}
                                    </div>
                                    {item.nickname && item.email ? (
                                      <div className="mt-1 max-w-[280px] truncate text-xs text-zinc-500" title={item.email}>{item.email}</div>
                                    ) : null}
                                    <div className="mt-1 max-w-[280px] truncate font-mono text-xs text-zinc-600" title={item._id}>{item._id}</div>
                                  </td>
                                  <td className="py-4 pr-6">
                                    {(item.authProviders || []).length > 0 ? (
                                      <div className="flex flex-wrap gap-1.5">
                                        {(item.authProviders || []).map((provider) => (
                                          <Badge key={provider} variant="outline" className="gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300">
                                            {provider === "github" ? (
                                              <Github className="h-3.5 w-3.5" aria-hidden="true" />
                                            ) : (
                                              <FeishuIcon className="h-3.5 w-3.5" />
                                            )}
                                            {provider === "github" ? "GitHub" : "飞书"}
                                          </Badge>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-sm text-zinc-500">未绑定</span>
                                    )}
                                  </td>
                                  <td className="py-4 pr-6">
                                    <Badge variant="outline" className={roleBadgeClass(effectiveRole.id)}>{effectiveRole.name}</Badge>
                                  </td>
                                  <td className="whitespace-nowrap py-4 pr-6 text-sm">
                                    {proExpiryText ? (
                                      <span className={item.proExpired ? "inline-flex items-center gap-1 text-zinc-500" : "text-zinc-300"}>
                                        {item.proExpired ? <AlertCircle className="h-3.5 w-3.5" aria-hidden /> : null}
                                        {proExpiryText}
                                      </span>
                                    ) : (
                                      <span className="text-zinc-600">—</span>
                                    )}
                                  </td>
                                  <td className="whitespace-nowrap py-4 pr-6 font-mono text-sm text-zinc-200">
                                    {formatCount(item.siteCount)}
                                  </td>
                                  <td className="whitespace-nowrap py-4 pr-6 font-mono text-sm text-zinc-200">
                                    {formatBytes(item.storageBytes || 0)}
                                  </td>
                                  <td className="whitespace-nowrap py-4 pr-6 text-sm text-zinc-500">
                                    {item.updatedAt
                                      ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.updatedAt))
                                      : "—"}
                                  </td>
                                  <td className="py-4 text-right">
                                    <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                                        onClick={() => openUserDetail(item)}
                                      >
                                        <Eye className="mr-1.5 h-3.5 w-3.5" />
                                        详情
                                      </Button>
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

                <Sheet open={Boolean(detailUser)} onOpenChange={(open) => !open && setDetailUser(null)}>
                  <SheetContent className="overflow-y-auto border-zinc-800 bg-zinc-950 sm:max-w-3xl">
                    <SheetHeader>
                      <SheetTitle className="text-zinc-100">
                        {detailUser?.nickname || detailUser?.email || "用户详情"}
                      </SheetTitle>
                      <SheetDescription className="font-mono text-xs text-zinc-500">
                        {detailUser?._id}
                      </SheetDescription>
                    </SheetHeader>
                    <div className="mt-6 space-y-6">
                      {detailLoading ? (
                        <p className="text-sm text-zinc-500">正在加载看板...</p>
                      ) : detailError ? (
                        <p role="alert" className="flex items-center gap-2 text-sm text-zinc-200"><AlertCircle className="h-4 w-4 shrink-0" aria-hidden />{detailError}</p>
                      ) : userOverview ? (
                        <>
                          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
                            {userOverview.user?.email ? <span>{userOverview.user.email}</span> : null}
                            {userOverview.usage?.role?.name ? (
                              <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                                {userOverview.usage.role.name}
                              </Badge>
                            ) : null}
                            {userOverview.user?.proLifetime ? (
                              <span>永久会员</span>
                            ) : userOverview.user?.proExpired ? (
                              <span className="inline-flex items-center gap-1 text-zinc-300"><AlertCircle className="h-3.5 w-3.5" aria-hidden />会员已过期</span>
                            ) : userOverview.user?.remainingDays != null ? (
                              <span>会员剩 {userOverview.user.remainingDays} 天</span>
                            ) : null}
                          </div>

                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {[
                              { label: "项目", value: formatCount(userOverview.counts?.projects), icon: FolderKanban },
                              { label: "站点", value: formatCount(userOverview.counts?.sites), icon: Globe },
                              { label: "近 30 天访问", value: formatCount(userOverview.traffic?.views30d), icon: Eye },
                              { label: "占用存储", value: formatBytes(userOverview.usage?.storage || 0), icon: HardDrive }
                            ].map((card) => (
                              <div key={card.label} className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-3">
                                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                                  <card.icon className="h-3.5 w-3.5" />
                                  {card.label}
                                </div>
                                <div className="mt-2 text-xl font-semibold text-zinc-100">{card.value}</div>
                              </div>
                            ))}
                          </div>

                          <div className="grid grid-cols-3 gap-3 text-sm text-zinc-400">
                            <div>近 7 天访问 <span className="text-zinc-200">{formatCount(userOverview.traffic?.views7d)}</span></div>
                            <div>累计访问 <span className="text-zinc-200">{formatCount(userOverview.traffic?.viewsAll)}</span></div>
                            <div>部署文件 <span className="text-zinc-200">{formatCount(userOverview.usage?.files)}</span></div>
                          </div>

                          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                            <div className="mb-3 text-sm font-medium text-zinc-200">近 30 天访问量</div>
                            {(userOverview.traffic?.daily || []).length === 0 ? (
                              <p className="text-sm text-zinc-500">暂无访问数据</p>
                            ) : (
                              <div style={{ width: "100%", height: 220 }}>
                                <ResponsiveContainer>
                                  <LineChart data={userOverview.traffic?.daily || []} margin={{ top: 12, right: 44, left: 0, bottom: 0 }}>
                                    <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="date" stroke="#71717a" tick={{ fontSize: 11 }} />
                                    <YAxis stroke="#71717a" allowDecimals={false} />
                                    <Tooltip
                                      formatter={(value: number | string) => [formatCount(Number(value)), VIEWS_LABEL]}
                                      contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a" }}
                                    />
                                    <Line type="monotone" dataKey="views" name={VIEWS_LABEL} stroke="#f4f4f5" strokeWidth={2} dot={false} isAnimationActive={false}
                                      label={(props: { x?: number; y?: number; index?: number }) =>
                                        props.index === (userOverview.traffic?.daily || []).length - 1 && props.x != null && props.y != null ? (
                                          <text key="end" x={props.x + 6} y={props.y + 4} textAnchor="start" fill="#f4f4f5" fontSize={11} fontWeight={600}>{VIEWS_LABEL}</text>
                                        ) : <g key={props.index} />
                                      } />
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                            )}
                          </div>

                          {(() => {
                            const grouped = groupProjectsWithSites(
                              userOverview.projects,
                              userOverview.sites,
                              userOverview.ungroupedSites
                            );
                            const hasAnything = grouped.projects.length > 0 || grouped.ungrouped.length > 0;
                            const renderSite = (site: OverviewSite) => (
                              <div key={site.websiteId} className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-sm text-zinc-100">{site.name}</span>
                                  <span className="shrink-0 font-mono text-xs text-zinc-400">
                                    {formatBytes(site.storage || 0)} · {formatCount(site.views30d)} 次
                                  </span>
                                </div>
                                <div className="mt-1 truncate text-xs text-zinc-500">{site.url || site.websiteId}</div>
                              </div>
                            );
                            return (
                              <div>
                                <div className="mb-2 text-sm font-medium text-zinc-200">项目与站点</div>
                                {!hasAnything ? (
                                  <p className="text-sm text-zinc-500">还没有项目或站点</p>
                                ) : (
                                  <div className="space-y-3">
                                    {grouped.projects.map((project) => {
                                      const projectViews = (project.sites || []).reduce((sum, site) => sum + Number(site.views30d || 0), 0);
                                      const projectStorage = (project.sites || []).reduce((sum, site) => sum + Number(site.storage || 0), 0);
                                      return (
                                        <div key={project.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                                          <div className="flex items-start justify-between gap-3">
                                            <div>
                                              <div className="flex items-center gap-2">
                                                <FolderKanban className="h-3.5 w-3.5 text-zinc-500" />
                                                <span className="text-sm text-zinc-100">{project.name}</span>
                                                {project.archived ? <Badge variant="outline" className="border-zinc-700 text-zinc-500">已归档</Badge> : null}
                                              </div>
                                              <div className="mt-1 text-xs text-zinc-500">
                                                {project.slug} · {formatCount(project.sites?.length ?? project.websitesCount)} 个站点
                                                {projectStorage ? ` · ${formatBytes(projectStorage)}` : ""}
                                                {projectViews ? ` · 近 30 天 ${formatCount(projectViews)} 次` : ""}
                                              </div>
                                            </div>
                                          </div>
                                          <div className="mt-3 space-y-2">
                                            {(project.sites || []).length === 0 ? (
                                              <p className="text-xs text-zinc-500">该项目还没有站点</p>
                                            ) : (
                                              (project.sites || []).map(renderSite)
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                    {grouped.ungrouped.length > 0 ? (
                                      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-3">
                                        <div className="text-sm text-zinc-200">未关联项目</div>
                                        <div className="mt-1 text-xs text-zinc-500">{formatCount(grouped.ungrouped.length)} 个站点没有项目</div>
                                        <div className="mt-3 space-y-2">
                                          {grouped.ungrouped.map(renderSite)}
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </>
                      ) : null}
                    </div>
                  </SheetContent>
                </Sheet>

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

                      {userRoleDialogRoles.includes("pro") ? (
                        <fieldset className="space-y-2">
                          <legend className="mb-2 text-sm font-medium text-zinc-300">专业会员时效</legend>
                          <RadioGroup
                            value={userRoleDialogProDuration}
                            onValueChange={(value) => setUserRoleDialogProDuration(value as ProDuration)}
                            className="grid grid-cols-2 gap-2"
                          >
                            {PRO_DURATION_OPTIONS.filter((option) => {
                              if (option.id !== "keep") return true;
                              const editingUser = rolesList.find((item) => item._id === userRoleDialogUid);
                              return userRoleDialogMode === "edit"
                                && Boolean(editingUser)
                                && (editingUser?.role || []).includes("pro")
                                && !editingUser?.proExpired;
                            }).map((option) => (
                              <label
                                key={option.id}
                                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                                  userRoleDialogProDuration === option.id
                                    ? "border-zinc-300 bg-zinc-100/10 text-zinc-100"
                                    : "border-zinc-800 bg-zinc-950/40 text-zinc-300"
                                }`}
                              >
                                <RadioGroupItem value={option.id} className="border-zinc-500" />
                                {option.label}
                              </label>
                            ))}
                          </RadioGroup>
                          <p className="text-xs text-zinc-500">
                            新开通默认 30 天；未过期会员选「保持当前时效」不会改到期日。来信开通：按登录邮箱找到人，勾选专业用户，选 30/90/365/永久后保存。
                          </p>
                        </fieldset>
                      ) : null}

                      <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-3">
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
            ) : activeTab === "reports" ? (
              <div className="space-y-6">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">站点举报</h1>
                    <p className="mt-2 text-sm text-zinc-400">查看被举报页面，确认后可禁用该站点。主站不能禁用。</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {(["open", "reviewed", "all"] as const).map((key) => (
                      <Button
                        key={key}
                        variant="outline"
                        className={`border-zinc-700 ${reportsFilter === key ? "bg-zinc-800 text-zinc-100" : "bg-zinc-900 text-zinc-400"}`}
                        onClick={() => { setReportsFilter(key); fetchReports(key); }}
                      >
                        {key === "open" ? "待处理" : key === "reviewed" ? "已审" : "全部"}
                      </Button>
                    ))}
                    <Button
                      variant="outline"
                      className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                      onClick={() => fetchReports()}
                      disabled={reportsLoading}
                    >
                      <RefreshCw className={`mr-2 h-4 w-4 ${reportsLoading ? "animate-spin" : ""}`} />
                      刷新
                    </Button>
                  </div>
                </div>
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardContent className="pt-6">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-zinc-300">
                        <thead className="text-zinc-500 border-b border-zinc-800">
                          <tr>
                            <th className="text-left py-2 pr-4">时间</th>
                            <th className="text-left py-2 pr-4">站点</th>
                            <th className="text-left py-2 pr-4">类别</th>
                            <th className="text-left py-2 pr-4">说明</th>
                            <th className="text-right py-2">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportsList.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-8 text-center text-zinc-500">
                                {reportsLoading ? "加载中..." : "暂无举报"}
                              </td>
                            </tr>
                          ) : (
                            reportsList.map((row) => (
                              <tr key={row.id} className="border-b border-zinc-800/60 align-top">
                                <td className="py-3 pr-4 whitespace-nowrap text-zinc-400">
                                  {row.created_at ? new Date(row.created_at).toLocaleString("zh-CN") : "—"}
                                </td>
                                <td className="py-3 pr-4">
                                  <div>{row.site_name || row.website_id}</div>
                                  <a
                                    className="text-xs text-zinc-300 underline-offset-2 hover:underline"
                                    href={row.page_url || row.site_url || (row.host ? `https://${row.host}/` : "#")}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {row.host || row.page_url || row.website_id}
                                  </a>
                                </td>
                                <td className="py-3 pr-4">{REPORT_REASON_LABEL[row.reason] || row.reason}</td>
                                <td className="py-3 pr-4 text-zinc-400 max-w-xs break-words">{row.note || "—"}</td>
                                <td className="py-3 text-right whitespace-nowrap">
                                  <button className="text-zinc-200 hover:underline mr-3" onClick={() => setInspectReport(row)}>查看</button>
                                  {row.visibility === "disabled" ? (
                                    <button className="text-zinc-400 hover:underline mr-3" onClick={() => restoreReportedSite(row)}>恢复</button>
                                  ) : canDisableReportedSite(row) ? (
                                    <button className="mr-3 inline-flex items-center gap-1 text-zinc-100 hover:underline" onClick={() => openDisableDialog(row)}><Ban className="h-3.5 w-3.5" aria-hidden />禁用</button>
                                  ) : null}
                                  {row.status === "open" ? (
                                    <button className="text-zinc-300 hover:underline" onClick={() => markReportReviewed(row.id)}>标为已审</button>
                                  ) : (
                                    <span className="text-zinc-500">已审</span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
                <Dialog open={!!disableTarget} onOpenChange={(open) => { if (!open && !disableSaving) setDisableTarget(null); }}>
                  <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 max-w-lg">
                    <DialogHeader>
                      <DialogTitle>禁用站点</DialogTitle>
                      <DialogDescription className="text-zinc-400">
                        必须填写理由。提交后会按标准格式邮件发给站点所有者，访客将无法打开该站。
                      </DialogDescription>
                    </DialogHeader>
                    {disableTarget ? (
                      <div className="space-y-3">
                        <div className="text-sm text-zinc-300">
                          {disableTarget.site_name || disableTarget.website_id}
                          <div className="text-xs text-zinc-500 break-all">{reportSiteUrl(disableTarget)}</div>
                        </div>
                        <div>
                          <Label className="text-zinc-300">停用理由</Label>
                          <textarea
                            value={disableReason}
                            onChange={(e) => setDisableReason(e.target.value)}
                            maxLength={500}
                            rows={5}
                            placeholder="写给所有者的停用说明，至少 8 个字"
                            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
                          />
                          <div className="mt-1 text-xs text-zinc-500">{disableReason.trim().length}/500</div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" className="border-zinc-700 bg-zinc-900" disabled={disableSaving} onClick={() => setDisableTarget(null)}>取消</Button>
                          <Button className="gap-1.5 bg-zinc-100 text-zinc-900 hover:bg-zinc-300" disabled={disableSaving} onClick={disableReportedSite}>
                            <Ban className="h-4 w-4" aria-hidden />
                            {disableSaving ? "提交中..." : "确认禁用并发送邮件"}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </DialogContent>
                </Dialog>
                <Dialog open={!!inspectReport} onOpenChange={(open) => { if (!open) setInspectReport(null); }}>
                  <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 max-w-lg">
                    <DialogHeader>
                      <DialogTitle>举报详情</DialogTitle>
                      <DialogDescription className="text-zinc-400">
                        {inspectReport ? (REPORT_REASON_LABEL[inspectReport.reason] || inspectReport.reason) : ""}
                      </DialogDescription>
                    </DialogHeader>
                    {inspectReport ? (
                      <div className="space-y-3 text-sm">
                        <div>
                          <div className="text-zinc-500">站点</div>
                          <div>{inspectReport.site_name || inspectReport.website_id}</div>
                        </div>
                        <div>
                          <div className="text-zinc-500">页面</div>
                          <a className="text-zinc-200 underline-offset-2 hover:underline break-all" href={reportSiteUrl(inspectReport)} target="_blank" rel="noreferrer">
                            {reportSiteUrl(inspectReport)}
                          </a>
                        </div>
                        <div>
                          <div className="text-zinc-500">说明</div>
                          <div className="text-zinc-300 whitespace-pre-wrap">{inspectReport.note || "无"}</div>
                        </div>
                        <div className="text-zinc-500">
                          {inspectReport.created_at ? new Date(inspectReport.created_at).toLocaleString("zh-CN") : ""}
                          {inspectReport.visibility === "disabled" ? " · 已禁用" : ""}
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                          <Button variant="outline" className="border-zinc-700 bg-zinc-900" asChild>
                            <a href={reportSiteUrl(inspectReport)} target="_blank" rel="noreferrer">打开站点</a>
                          </Button>
                          {inspectReport.visibility === "disabled" ? (
                            <Button variant="outline" className="border-zinc-700 bg-zinc-900" onClick={() => restoreReportedSite(inspectReport)}>恢复公开</Button>
                          ) : canDisableReportedSite(inspectReport) ? (
                            <Button variant="outline" className="gap-1.5 border-zinc-500 bg-zinc-900 text-zinc-100" onClick={() => openDisableDialog(inspectReport)}><Ban className="h-4 w-4" aria-hidden />禁用站点</Button>
                          ) : null}
                          {inspectReport.status === "open" ? (
                            <Button className="bg-zinc-100 text-zinc-900 hover:bg-zinc-300" onClick={() => { markReportReviewed(inspectReport.id); setInspectReport(null); }}>标为已审</Button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
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
                      <div role="alert" className="mb-3 flex items-center gap-2 text-sm text-zinc-200"><AlertCircle className="h-4 w-4 shrink-0" aria-hidden />{bucketsErr}</div>
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
                                    <span className="ml-2 rounded border border-zinc-600 px-1.5 py-0.5 text-xs text-zinc-200">默认</span>
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
                                    <button className="text-zinc-200 hover:underline mr-3" onClick={() => setDefaultBucket(b.id)}>设为默认</button>
                                  ) : null}
                                  <button className="text-zinc-400 hover:underline mr-3" onClick={() => toggleBucketEnabled(b)}>
                                    {b.enabled ? "停用" : "启用"}
                                  </button>
                                  {!b.isDefault ? (
                                    <button className="inline-flex items-center gap-1 text-zinc-100 hover:underline" onClick={() => removeBucket(b)}><Trash2 className="h-3.5 w-3.5" aria-hidden />删除</button>
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
