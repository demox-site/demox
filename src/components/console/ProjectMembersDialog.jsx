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
  useToast
} from "@/components/ui";
// @ts-ignore
import { Loader2, MailPlus, ShieldCheck, UserMinus, UsersRound } from "lucide-react";
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
  const [serverProject, setServerProject] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [busyKey, setBusyKey] = React.useState("");
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState("member");
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

  React.useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const inviteMember = async (event) => {
    event.preventDefault();
    const email = String(inviteEmail || "").trim();
    if (!email || !resolvedProjectId) return;
    setBusyKey("invite");
    try {
      const res = await websiteApi.inviteProjectMember({ projectId: resolvedProjectId, email, role: inviteRole });
      if (!res?.success) throw new Error(res?.message || t.projectInviteFailed);
      setInviteEmail("");
      setInviteRole("member");
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
        <form onSubmit={inviteMember} className="rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder={t.projectInviteEmailPlaceholder}
              className="border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)] placeholder:text-[var(--stitch-muted)]"
              type="email"
              disabled={busyKey === "invite"}
            />
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value)}
              disabled={busyKey === "invite"}
              className="h-10 rounded-md border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] px-3 text-sm text-[var(--stitch-ink)] outline-none"
            >
              {canManageAdmins && <option value="admin">{roleText("admin")}</option>}
              <option value="member">{roleText("member")}</option>
            </select>
            <Button type="submit" className="stitch-primary shrink-0" disabled={busyKey === "invite" || !inviteEmail.trim()}>
              {busyKey === "invite" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailPlus className="mr-2 h-4 w-4" />}
              {t.projectInviteButton}
            </Button>
          </div>
        </form>
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
