import React from "react";
// @ts-ignore
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast
} from "@/components/ui";
// @ts-ignore
import { Building2, Check, Loader2, Mail, Search, ShieldCheck, UserMinus, UserPlus, UsersRound, X } from "lucide-react";
import { websiteApi } from "@/api";

const roleLabels = {
  owner: "Owner",
  admin: "Admin",
  member: "Member"
};

const normalizeRole = (role) => (role === "owner" || role === "admin" ? role : "member");

export function ProjectMembersPanel({
  project,
  projectId,
  currentUser,
  t,
  active = true,
  onLeave
}) {
  const { toast } = useToast();
  const [members, setMembers] = React.useState([]);
  const [invitations, setInvitations] = React.useState([]);
  const [feishuGrants, setFeishuGrants] = React.useState([]);
  const [serverProject, setServerProject] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [busyKey, setBusyKey] = React.useState("");
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteTab, setInviteTab] = React.useState("email");
  const [inviteQuery, setInviteQuery] = React.useState("");
  const [inviteResults, setInviteResults] = React.useState([]);
  const [selectedInviteUser, setSelectedInviteUser] = React.useState(null);
  const [inviteSearchOpen, setInviteSearchOpen] = React.useState(false);
  const [inviteSearchLoading, setInviteSearchLoading] = React.useState(false);
  const [inviteSearchError, setInviteSearchError] = React.useState("");
  const [inviteActiveIndex, setInviteActiveIndex] = React.useState(-1);
  const [inviteRole, setInviteRole] = React.useState("member");
  const [feishuPrincipalType, setFeishuPrincipalType] = React.useState("user");
  const [feishuQuery, setFeishuQuery] = React.useState("");
  const [feishuResults, setFeishuResults] = React.useState([]);
  const [selectedFeishuPrincipal, setSelectedFeishuPrincipal] = React.useState(null);
  const [feishuSearchOpen, setFeishuSearchOpen] = React.useState(false);
  const [feishuSearchLoading, setFeishuSearchLoading] = React.useState(false);
  const [feishuSearchError, setFeishuSearchError] = React.useState("");
  const [feishuActiveIndex, setFeishuActiveIndex] = React.useState(-1);
  const [feishuRole, setFeishuRole] = React.useState("member");
  const inviteSearchRequest = React.useRef(0);
  const feishuSearchRequest = React.useRef(0);
  const resolvedProjectId = project?.id || project?._id || projectId;
  const effectiveProject = serverProject ? { ...(project || {}), ...serverProject } : project;
  const myRole = normalizeRole(effectiveProject?.role);
  const canManage = ["owner", "admin"].includes(myRole);
  const canManageAdmins = myRole === "owner";

  const roleText = (role) => {
    if (t?.projectRoleOwner && role === "owner") return t.projectRoleOwner;
    if (t?.projectRoleAdmin && role === "admin") return t.projectRoleAdmin;
    if (t?.projectRoleMember && role === "member") return t.projectRoleMember;
    return roleLabels[role] || role;
  };

  const loadMembers = React.useCallback(async () => {
    if (!resolvedProjectId || !active) return;
    setLoading(true);
    try {
      const res = await websiteApi.listProjectMembers(resolvedProjectId);
      if (!res?.success) throw new Error(res?.message || t.projectMembersLoadFailed);
      setServerProject(res.project ? { ...res.project, role: res.role || res.project.role } : { id: resolvedProjectId, role: res.role });
      setMembers(res.members || []);
      setInvitations(res.invitations || []);
      setFeishuGrants(res.feishuGrants || []);
    } catch (error) {
      toast({
        title: t.projectMembersLoadFailed,
        description: error.message || t.projectMembersLoadFailedDesc,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }, [active, resolvedProjectId, t, toast]);

  const resetFeishuSelection = React.useCallback((nextQuery = "") => {
    setFeishuQuery(nextQuery);
    setFeishuResults([]);
    setSelectedFeishuPrincipal(null);
    setFeishuSearchError("");
    setFeishuActiveIndex(-1);
    setFeishuSearchOpen(Boolean(nextQuery.trim()));
  }, []);

  const resetInviteDialog = React.useCallback(() => {
    setInviteTab("email");
    setInviteQuery("");
    setInviteResults([]);
    setSelectedInviteUser(null);
    setInviteSearchOpen(false);
    setInviteSearchError("");
    setInviteRole("member");
    resetFeishuSelection();
    setFeishuPrincipalType("user");
    setFeishuRole("member");
  }, [resetFeishuSelection]);

  React.useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  React.useEffect(() => {
    const query = inviteQuery.trim();
    const requestId = ++inviteSearchRequest.current;
    if (!inviteOpen || inviteTab !== "email" || !query || !resolvedProjectId) {
      setInviteSearchLoading(false);
      setInviteResults([]);
      return undefined;
    }
    setInviteSearchLoading(true);
    setInviteSearchError("");
    const timer = window.setTimeout(async () => {
      try {
        const res = await websiteApi.searchProjectInviteUsers({ projectId: resolvedProjectId, query });
        if (!res?.success) throw new Error(res?.message || t.projectInviteSearchFailed);
        if (inviteSearchRequest.current === requestId) setInviteResults(res.users || []);
      } catch (error) {
        if (inviteSearchRequest.current === requestId) {
          setInviteResults([]);
          setInviteSearchError(error.message || t.projectInviteSearchFailedDesc);
        }
      } finally {
        if (inviteSearchRequest.current === requestId) setInviteSearchLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [inviteOpen, inviteQuery, inviteTab, resolvedProjectId, t]);

  React.useEffect(() => {
    const query = feishuQuery.trim();
    const requestId = ++feishuSearchRequest.current;
    if (!inviteOpen || inviteTab !== "feishu" || !query || !resolvedProjectId) {
      setFeishuSearchLoading(false);
      setFeishuResults([]);
      return undefined;
    }
    setFeishuSearchLoading(true);
    setFeishuSearchError("");
    const timer = window.setTimeout(async () => {
      try {
        const res = await websiteApi.searchFeishuProjectPrincipals({
          projectId: resolvedProjectId,
          principalType: feishuPrincipalType,
          query
        });
        if (!res?.success) throw new Error(res?.message || t.projectFeishuSearchFailed);
        if (feishuSearchRequest.current === requestId) setFeishuResults(res.principals || []);
      } catch (error) {
        if (feishuSearchRequest.current === requestId) {
          setFeishuResults([]);
          setFeishuSearchError(error.message || t.projectFeishuSearchFailedDesc);
        }
      } finally {
        if (feishuSearchRequest.current === requestId) setFeishuSearchLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [feishuPrincipalType, feishuQuery, inviteOpen, inviteTab, resolvedProjectId, t]);

  const inviteMember = async (event) => {
    event.preventDefault();
    const email = String(selectedInviteUser?.email || "").trim();
    if (!email || !resolvedProjectId) return;
    setBusyKey("invite");
    try {
      const res = await websiteApi.inviteProjectMember({ projectId: resolvedProjectId, email, role: inviteRole });
      if (!res?.success) throw new Error(res?.message || t.projectInviteFailed);
      setInviteOpen(false);
      resetInviteDialog();
      toast({ title: t.projectInviteSent, description: res.message || t.projectInviteSentDesc });
      await loadMembers();
    } catch (error) {
      toast({
        title: t.projectInviteFailed,
        description: error.message || t.projectInviteFailedDesc,
        variant: "destructive"
      });
    } finally {
      setBusyKey("");
    }
  };

  const grantToFeishu = async (event) => {
    event.preventDefault();
    if (!selectedFeishuPrincipal?.principalKey || !resolvedProjectId) return;
    setBusyKey("feishu-grant");
    try {
      const res = await websiteApi.grantProjectToFeishu({
        projectId: resolvedProjectId,
        principalType: feishuPrincipalType,
        principalKey: selectedFeishuPrincipal.principalKey,
        role: feishuRole
      });
      if (!res?.success) throw new Error(res?.message || t.projectFeishuGrantFailed);
      setInviteOpen(false);
      resetInviteDialog();
      toast({ title: t.projectFeishuGrantSaved, description: res.message || t.projectFeishuGrantSavedDesc });
      await loadMembers();
    } catch (error) {
      toast({
        title: t.projectFeishuGrantFailed,
        description: error.message || t.projectFeishuGrantFailedDesc,
        variant: "destructive"
      });
    } finally {
      setBusyKey("");
    }
  };

  const removeFeishuGrant = async (grant) => {
    if (!resolvedProjectId || !grant?.id) return;
    setBusyKey(`feishu:${grant.id}`);
    try {
      const res = await websiteApi.removeProjectFeishuGrant({ projectId: resolvedProjectId, grantId: grant.id });
      if (!res?.success) throw new Error(res?.message || t.projectFeishuGrantRemoveFailed);
      setFeishuGrants((prev) => prev.filter((item) => item.id !== grant.id));
      toast({ title: t.projectFeishuGrantRemoved, description: res.message || t.projectFeishuGrantRemovedDesc });
    } catch (error) {
      toast({
        title: t.projectFeishuGrantRemoveFailed,
        description: error.message || t.projectFeishuGrantRemoveFailedDesc,
        variant: "destructive"
      });
    } finally {
      setBusyKey("");
    }
  };

  const updateRole = async (member, role) => {
    if (!resolvedProjectId || !member?.userId || role === member.role) return;
    const key = `role:${member.userId}`;
    setBusyKey(key);
    try {
      const res = await websiteApi.updateProjectMemberRole({ projectId: resolvedProjectId, userId: member.userId, role });
      if (!res?.success) throw new Error(res?.message || t.projectMemberRoleFailed);
      setMembers((prev) => prev.map((m) => (m.userId === member.userId ? { ...m, role } : m)));
      toast({ title: t.projectMemberRoleSaved, description: t.projectMemberRoleSavedDesc });
    } catch (error) {
      toast({
        title: t.projectMemberRoleFailed,
        description: error.message || t.projectMemberRoleFailedDesc,
        variant: "destructive"
      });
    } finally {
      setBusyKey("");
    }
  };

  const removeMember = async (member) => {
    if (!resolvedProjectId || !member?.userId) return;
    const key = `remove:${member.userId}`;
    setBusyKey(key);
    try {
      const res = await websiteApi.removeProjectMember({ projectId: resolvedProjectId, userId: member.userId });
      if (!res?.success) throw new Error(res?.message || t.projectMemberRemoveFailed);
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
      toast({ title: t.projectMemberRemoved, description: res.message || t.projectMemberRemovedDesc });
      if (member.userId === currentUser?.userId) onLeave?.();
    } catch (error) {
      toast({
        title: t.projectMemberRemoveFailed,
        description: error.message || t.projectMemberRemoveFailedDesc,
        variant: "destructive"
      });
    } finally {
      setBusyKey("");
    }
  };

  const canEditMember = (member) => {
    if (!canManage || member.role === "owner") return false;
    if (myRole === "admin" && member.role !== "member") return false;
    return true;
  };

  return (
    <div className="space-y-5">
      {canManage && (
        <div className="flex justify-end">
          <Button type="button" className="stitch-primary" onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            {t.projectInviteButton}
          </Button>
          <Dialog
            open={inviteOpen}
            onOpenChange={(nextOpen) => {
              setInviteOpen(nextOpen);
              if (!nextOpen) resetInviteDialog();
            }}
          >
            <DialogContent className="max-w-lg border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)]">
              <DialogHeader>
                <DialogTitle>{t.projectInviteDialogTitle}</DialogTitle>
                <DialogDescription className="text-[var(--stitch-muted)]">{t.projectInviteDialogDesc}</DialogDescription>
              </DialogHeader>
              <Tabs
                value={inviteTab}
                onValueChange={(value) => {
                  setInviteTab(value);
                  setInviteSearchOpen(false);
                  setFeishuSearchOpen(false);
                }}
              >
                <TabsList className="grid w-full grid-cols-2 border border-[var(--stitch-line)] bg-[var(--stitch-surface)]">
                  <TabsTrigger value="email" className="gap-2 data-[state=active]:bg-[var(--stitch-surface-strong)] data-[state=active]:text-[var(--stitch-ink)]">
                    <Mail className="h-4 w-4" />
                    {t.projectInviteEmailTab}
                  </TabsTrigger>
                  <TabsTrigger value="feishu" className="gap-2 data-[state=active]:bg-[var(--stitch-surface-strong)] data-[state=active]:text-[var(--stitch-ink)]">
                    <Building2 className="h-4 w-4" />
                    {t.projectInviteFeishuTab}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="email" className="mt-5">
                  <form onSubmit={inviteMember} className="space-y-4" autoComplete="off">
                    <div>
                      <label htmlFor="project-member-query" className="mb-2 block text-sm font-semibold text-[var(--stitch-ink)]">
                        {t.projectInviteEmailLabel}
                      </label>
                      <div
                        className="relative"
                        onBlur={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget)) setInviteSearchOpen(false);
                        }}
                      >
                        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--stitch-muted)]" />
                        <Input
                          id="project-member-query"
                          name="project-member-query"
                          type="search"
                          value={inviteQuery}
                          onChange={(event) => {
                            setInviteQuery(event.target.value);
                            setSelectedInviteUser(null);
                            setInviteActiveIndex(-1);
                            setInviteSearchOpen(Boolean(event.target.value.trim()));
                          }}
                          onFocus={() => setInviteSearchOpen(Boolean(inviteQuery.trim()))}
                          onKeyDown={(event) => {
                            if (event.key === "Escape" && inviteSearchOpen) {
                              event.preventDefault();
                              event.stopPropagation();
                              setInviteSearchOpen(false);
                            } else if (event.key === "ArrowDown" && inviteResults.length) {
                              event.preventDefault();
                              setInviteSearchOpen(true);
                              setInviteActiveIndex((index) => (index + 1) % inviteResults.length);
                            } else if (event.key === "ArrowUp" && inviteResults.length) {
                              event.preventDefault();
                              setInviteSearchOpen(true);
                              setInviteActiveIndex((index) => (index <= 0 ? inviteResults.length - 1 : index - 1));
                            } else if (event.key === "Enter" && inviteSearchOpen && inviteActiveIndex >= 0) {
                              event.preventDefault();
                              setSelectedInviteUser(inviteResults[inviteActiveIndex]);
                              setInviteSearchOpen(false);
                            }
                          }}
                          placeholder={t.projectInviteEmailPlaceholder}
                          autoComplete="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          data-1p-ignore="true"
                          data-lpignore="true"
                          data-form-type="other"
                          role="combobox"
                          aria-autocomplete="list"
                          aria-expanded={Boolean(inviteQuery.trim() && inviteSearchOpen)}
                          aria-controls="project-member-results"
                          aria-activedescendant={inviteActiveIndex >= 0 ? `project-member-result-${inviteActiveIndex}` : undefined}
                          className="pl-9 border-[var(--stitch-line)] bg-[var(--stitch-surface)] text-[var(--stitch-ink)] placeholder:text-[var(--stitch-muted)]"
                        />
                        {inviteQuery.trim() && inviteSearchOpen && (
                          <div id="project-member-results" role="listbox" className="absolute z-50 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] p-1 shadow-2xl">
                            {inviteSearchLoading && <div className="flex items-center px-3 py-3 text-sm text-[var(--stitch-muted)]"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t.projectSearchLoading}</div>}
                            {!inviteSearchLoading && inviteSearchError && <div className="px-3 py-3 text-sm text-red-400">{inviteSearchError}</div>}
                            {!inviteSearchLoading && !inviteSearchError && inviteResults.length === 0 && <div className="px-3 py-3 text-sm text-[var(--stitch-muted)]">{t.projectInviteNoUsers}</div>}
                            {!inviteSearchLoading && inviteResults.map((user, index) => (
                              <button
                                id={`project-member-result-${index}`}
                                key={user.userId}
                                type="button"
                                role="option"
                                aria-selected={selectedInviteUser?.userId === user.userId}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  setSelectedInviteUser(user);
                                  setInviteSearchOpen(false);
                                }}
                                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left ${inviteActiveIndex === index ? "bg-[var(--stitch-blue-soft)]" : "hover:bg-[var(--stitch-blue-soft)]"}`}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold">{user.nickname || user.email}</span>
                                  <span className="block truncate text-xs text-[var(--stitch-muted)]">{user.email}</span>
                                </span>
                                {selectedInviteUser?.userId === user.userId && <Check className="h-4 w-4 shrink-0 text-[var(--stitch-blue)]" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {selectedInviteUser && (
                      <div className="flex items-center justify-between rounded-xl border border-[var(--stitch-blue)]/40 bg-[var(--stitch-blue-soft)] px-3 py-2">
                        <div className="min-w-0"><div className="truncate text-sm font-semibold">{selectedInviteUser.nickname || selectedInviteUser.email}</div><div className="truncate text-xs text-[var(--stitch-muted)]">{selectedInviteUser.email}</div></div>
                        <Check className="h-4 w-4 shrink-0 text-[var(--stitch-blue)]" />
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-2">
                      <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} disabled={busyKey === "invite"} className="h-10 rounded-md border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-3 text-sm text-[var(--stitch-ink)] outline-none">
                        {canManageAdmins && <option value="admin">{roleText("admin")}</option>}
                        <option value="member">{roleText("member")}</option>
                      </select>
                      <Button type="submit" className="stitch-primary" disabled={busyKey === "invite" || !selectedInviteUser}>
                        {busyKey === "invite" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                        {t.projectInviteButton}
                      </Button>
                    </div>
                  </form>
                </TabsContent>

                <TabsContent value="feishu" className="mt-5">
                  <form onSubmit={grantToFeishu} className="space-y-4" autoComplete="off">
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--stitch-surface)] p-1">
                      {[{ value: "user", label: t.projectFeishuUser }, { value: "department", label: t.projectFeishuDepartment }].map((option) => (
                        <button key={option.value} type="button" onClick={() => { setFeishuPrincipalType(option.value); resetFeishuSelection(); }} className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${feishuPrincipalType === option.value ? "bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)] shadow-sm" : "text-[var(--stitch-muted)] hover:text-[var(--stitch-ink)]"}`}>{option.label}</button>
                      ))}
                    </div>
                    <div
                      className="relative"
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) setFeishuSearchOpen(false);
                      }}
                    >
                      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--stitch-muted)]" />
                      <Input
                        name="project-directory-query"
                        type="search"
                        value={feishuQuery}
                        onChange={(event) => resetFeishuSelection(event.target.value)}
                        onFocus={() => setFeishuSearchOpen(Boolean(feishuQuery.trim()))}
                        onKeyDown={(event) => {
                          if (event.key === "Escape" && feishuSearchOpen) {
                            event.preventDefault();
                            event.stopPropagation();
                            setFeishuSearchOpen(false);
                          } else if (event.key === "ArrowDown" && feishuResults.length) {
                            event.preventDefault();
                            setFeishuSearchOpen(true);
                            setFeishuActiveIndex((index) => (index + 1) % feishuResults.length);
                          } else if (event.key === "ArrowUp" && feishuResults.length) {
                            event.preventDefault();
                            setFeishuSearchOpen(true);
                            setFeishuActiveIndex((index) => (index <= 0 ? feishuResults.length - 1 : index - 1));
                          } else if (event.key === "Enter" && feishuSearchOpen && feishuActiveIndex >= 0) {
                            event.preventDefault();
                            setSelectedFeishuPrincipal(feishuResults[feishuActiveIndex]);
                            setFeishuSearchOpen(false);
                          }
                        }}
                        placeholder={feishuPrincipalType === "department" ? t.projectFeishuDepartmentPlaceholder : t.projectFeishuUserPlaceholder}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        data-1p-ignore="true"
                        data-lpignore="true"
                        data-form-type="other"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={Boolean(feishuQuery.trim() && feishuSearchOpen)}
                        aria-controls="project-feishu-results"
                        aria-activedescendant={feishuActiveIndex >= 0 ? `project-feishu-result-${feishuActiveIndex}` : undefined}
                        className="pl-9 border-[var(--stitch-line)] bg-[var(--stitch-surface)] text-[var(--stitch-ink)] placeholder:text-[var(--stitch-muted)]"
                      />
                      {feishuQuery.trim() && feishuSearchOpen && (
                        <div id="project-feishu-results" role="listbox" className="absolute z-50 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] p-1 shadow-2xl">
                          {feishuSearchLoading && <div className="flex items-center px-3 py-3 text-sm text-[var(--stitch-muted)]"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t.projectSearchLoading}</div>}
                          {!feishuSearchLoading && feishuSearchError && <div className="px-3 py-3 text-sm text-red-400">{feishuSearchError}</div>}
                          {!feishuSearchLoading && !feishuSearchError && feishuResults.length === 0 && <div className="px-3 py-3 text-sm text-[var(--stitch-muted)]">{t.projectFeishuNoResults}</div>}
                          {!feishuSearchLoading && feishuResults.map((principal, index) => (
                            <button
                              id={`project-feishu-result-${index}`}
                              key={principal.principalKey}
                              type="button"
                              role="option"
                              aria-selected={selectedFeishuPrincipal?.principalKey === principal.principalKey}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => { setSelectedFeishuPrincipal(principal); setFeishuSearchOpen(false); }}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left ${feishuActiveIndex === index ? "bg-[var(--stitch-blue-soft)]" : "hover:bg-[var(--stitch-blue-soft)]"}`}
                            >
                              <span className="min-w-0"><span className="block truncate text-sm font-semibold">{principal.name}</span>{principal.secondaryText && <span className="block truncate text-xs text-[var(--stitch-muted)]">{principal.secondaryText}</span>}</span>
                              {selectedFeishuPrincipal?.principalKey === principal.principalKey && <Check className="h-4 w-4 shrink-0 text-[var(--stitch-blue)]" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {selectedFeishuPrincipal && (
                      <div className="flex items-center justify-between rounded-xl border border-[var(--stitch-blue)]/40 bg-[var(--stitch-blue-soft)] px-3 py-2">
                        <div className="min-w-0"><div className="truncate text-sm font-semibold">{selectedFeishuPrincipal.name}</div>{selectedFeishuPrincipal.secondaryText && <div className="truncate text-xs text-[var(--stitch-muted)]">{selectedFeishuPrincipal.secondaryText}</div>}</div>
                        <Badge variant="outline" className="ml-3 border-[var(--stitch-line)]">{t.projectFeishuSource}</Badge>
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-2">
                      <select value={feishuRole} onChange={(event) => setFeishuRole(event.target.value)} disabled={busyKey === "feishu-grant"} className="h-10 rounded-md border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-3 text-sm text-[var(--stitch-ink)] outline-none">
                        {canManageAdmins && <option value="admin">{roleText("admin")}</option>}
                        <option value="member">{roleText("member")}</option>
                      </select>
                      <Button type="submit" className="stitch-primary" disabled={busyKey === "feishu-grant" || !selectedFeishuPrincipal}>
                        {busyKey === "feishu-grant" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                        {t.projectFeishuGrantButton}
                      </Button>
                    </div>
                  </form>
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {feishuGrants.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-mono uppercase tracking-[0.18em] text-[var(--stitch-muted)]">
            {t.projectFeishuGrantsSection}
          </div>
          <div className="overflow-hidden rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)]">
            {feishuGrants.map((grant) => (
              <div key={grant.id} className="flex items-center justify-between gap-3 border-b border-[var(--stitch-line)] p-3 text-sm last:border-b-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-[var(--stitch-ink)]">{grant.name || grant.displayName || grant.principalKey}</span>
                    <Badge variant="outline" className="border-[var(--stitch-line)] text-[var(--stitch-muted)]">
                      {t.projectFeishuSource}
                    </Badge>
                    <Badge className="border-[var(--stitch-line)] bg-[var(--stitch-blue-soft)] text-[var(--stitch-ink)]">
                      {roleText(grant.role)}
                    </Badge>
                  </div>
                </div>
                {canManage && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busyKey === `feishu:${grant.id}`}
                    onClick={() => removeFeishuGrant(grant)}
                    className="h-8 w-8 shrink-0 text-[var(--stitch-muted)] hover:bg-red-950/30 hover:text-red-400"
                    aria-label={t.projectFeishuGrantRemove}
                  >
                    {busyKey === `feishu:${grant.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-4 w-4" />}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-xs font-mono uppercase tracking-[0.18em] text-[var(--stitch-muted)]">
          {t.projectMembersSection}
        </div>
        {loading ? (
          <div className="flex items-center justify-center rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] py-10 text-[var(--stitch-muted)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t.loading}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)]">
            {members.map((member) => {
              const busy = busyKey.endsWith(member.userId);
              return (
                <div key={member.userId} className="flex flex-col gap-3 border-b border-[var(--stitch-line)] p-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--stitch-ink)]">
                        {member.nickname || member.email || member.userId}
                      </span>
                      <Badge className="border-[var(--stitch-line)] bg-[var(--stitch-blue-soft)] text-[var(--stitch-ink)]">
                        <ShieldCheck className="mr-1 h-3 w-3" />
                        {roleText(member.role)}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-[var(--stitch-muted)]">
                      {member.email || member.userId}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canEditMember(member) && (
                      <select
                        value={member.role}
                        onChange={(event) => updateRole(member, event.target.value)}
                        disabled={!!busy}
                        className="h-8 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] px-2 text-xs text-[var(--stitch-muted)] outline-none"
                      >
                        {canManageAdmins && <option value="admin">{roleText("admin")}</option>}
                        <option value="member">{roleText("member")}</option>
                      </select>
                    )}
                    {member.role !== "owner" && (canEditMember(member) || member.userId === currentUser?.userId) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => removeMember(member)}
                        className="h-8 text-[var(--stitch-muted)] hover:bg-red-950/30 hover:text-red-400"
                      >
                        {busyKey === `remove:${member.userId}` ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <UserMinus className="mr-2 h-3.5 w-3.5" />}
                        {member.userId === currentUser?.userId ? t.projectLeaveButton : t.projectRemoveButton}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {members.length === 0 && (
              <div className="p-6 text-center text-sm text-[var(--stitch-muted)]">{t.projectMembersEmpty}</div>
            )}
          </div>
        )}
      </div>

      {invitations.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-mono uppercase tracking-[0.18em] text-[var(--stitch-muted)]">
            {t.projectPendingInvites}
          </div>
          <div className="rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)]">
            {invitations.map((invite) => (
              <div key={invite.id || invite.email} className="flex items-center justify-between border-b border-[var(--stitch-line)] p-3 text-sm last:border-b-0">
                <span className="truncate font-mono text-[var(--stitch-muted)]">{invite.email}</span>
                <Badge variant="outline" className="border-[var(--stitch-line)] text-[var(--stitch-muted)]">
                  {roleText(invite.role)}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectMembersDialog({ open, onOpenChange, project, currentUser, t }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UsersRound className="h-5 w-5 text-[var(--stitch-blue)]" />
            {t.projectMembersTitle}
          </DialogTitle>
          <DialogDescription className="text-[var(--stitch-muted)]">
            {project?.name ? `${project.name} · ${t.projectMembersDesc}` : t.projectMembersDesc}
          </DialogDescription>
        </DialogHeader>
        <ProjectMembersPanel
          active={open}
          project={project}
          currentUser={currentUser}
          t={t}
          onLeave={() => onOpenChange(false)}
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="text-[var(--stitch-muted)] hover:bg-[var(--stitch-blue-soft)] hover:text-[var(--stitch-ink)]">
            {t.cancel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
