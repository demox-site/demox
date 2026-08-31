import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge, Button, Input } from "@/components/ui";
import {
  CheckCircle,
  ExternalLink,
  Globe2,
  LockKeyhole,
  Pencil,
  Tag,
  XCircle
} from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { translations } from "../home-translations";
import { getDisplayName, getSiteDomains, hasProOrAboveRole, parseTags, joinTags } from "@/lib/website-utils";
import DeleteConfirmDialog from "@/components/home/DeleteConfirmDialog";
import RedeployDialog from "@/components/home/RedeployDialog";
import DomainDialog from "@/components/home/DomainDialog";
import SiteSettingsDialog from "@/components/home/SiteSettingsDialog";
import SiteSettingsPanel from "@/components/home/SiteSettingsPanel";
import StatusBadge from "@/components/home/StatusBadge";
import { useAuth } from "../use-auth";
import { useWebsites } from "../use-websites";
import { useProjects } from "../use-projects";
import { useRedeploy } from "../use-redeploy";
import { useDomainDialog } from "../use-domain-dialog";

export default function SiteSettingsPage() {
  const { projectId = "", websiteId = "" } = useParams();
  const navigate = useNavigate();
  const { language: lang } = useLanguage();
  const t = translations[lang];
  const auth = useAuth(t);
  const { isLoggedIn, user, roleLimits, handleAuthError } = auth;
  const sites = useWebsites({ user, t, handleAuthError, projectId });
  const projects = useProjects({ user, t, handleAuthError });
  const redeploy = useRedeploy({
    roleLimits,
    t,
    lang,
    navigate,
    loadWebsites: sites.loadWebsites,
    setWebsites: sites.setWebsites,
    setDeploying: sites.setDeploying
  });
  const domain = useDomainDialog({ t, setWebsites: sites.setWebsites });
  const [seoDialogOpen, setSeoDialogOpen] = React.useState(false);
  const [seoWebsite, setSeoWebsite] = React.useState(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!isLoggedIn) return;
    let alive = true;
    Promise.all([sites.loadWebsites(), projects.loadProjects()]).finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, projectId]);

  const website = sites.websites.find(
    (item) => item.websiteId === websiteId || item._id === websiteId
  );
  const isPrivate = website?.visibility === "private";

  React.useEffect(() => {
    if (!ready) return;
    if (!website) navigate(`/console/projects/${projectId}/sites`, { replace: true });
  }, [navigate, projectId, ready, website]);

  const openSeoDialog = React.useCallback((nextWebsite) => {
    if (!hasProOrAboveRole(user?.roles)) return;
    setSeoWebsite(nextWebsite);
    setSeoDialogOpen(true);
  }, [user]);

  const handleSeoSaved = React.useCallback((seo) => {
    if (seoWebsite && seo) {
      sites.setWebsites((prev) => prev.map((item) => (
        item._id === seoWebsite._id
          ? { ...item, seoTitle: seo.title, seoDescription: seo.description, ogImage: seo.ogImage }
          : item
      )));
    }
  }, [seoWebsite, sites]);

  const handleDelete = async () => {
    await sites.executeDeleteWebsite();
    navigate(`/console/projects/${projectId}/sites`, { replace: true });
  };

  if (!ready || !website) {
    return (
      <div className="min-h-full p-4 sm:p-6 lg:p-8">
        <p className="text-sm text-muted-foreground">{t.loading || "Loading..."}</p>
      </div>
    );
  }

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.siteSettingsTitle || "站点设置"}</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">ID: {website.websiteId || website._id}</p>
        </div>

        <section className="rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-5">
          <div className="flex flex-wrap items-center gap-3">
            {sites.editingId === website._id ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={sites.editingName}
                  onChange={(e) => sites.setEditingName(e.target.value)}
                  className="w-56 rounded-lg border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] px-2 py-1 text-sm"
                />
                <button type="button" onClick={() => sites.saveEditName(website)} title={t.save}>
                  <CheckCircle className="h-4 w-4" />
                </button>
                <button type="button" onClick={sites.cancelEditName} title={t.cancel}>
                  <XCircle className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">{getDisplayName(website)}</h2>
                <button
                  type="button"
                  onClick={() => sites.startEditName(website)}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--stitch-line)] px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  <Pencil className="h-3 w-3" />
                  {t.editName || "编辑名称"}
                </button>
              </div>
            )}
            <StatusBadge status={website.status} t={t} />
            <Badge className={isPrivate ? "stitch-status-private" : "stitch-status-public"}>
              {isPrivate ? <LockKeyhole className="mr-1 h-3 w-3" /> : <Globe2 className="mr-1 h-3 w-3" />}
              {isPrivate ? t.visibilityPrivate : t.visibilityPublic}
            </Badge>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {sites.editingTagsId === website._id ? (
              <div className="flex w-full max-w-md items-center gap-2">
                <Input
                  value={sites.editingTagsValue}
                  onChange={(e) => sites.setEditingTagsValue(e.target.value)}
                  className="h-8 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sites.saveEditTags(website);
                    if (e.key === "Escape") sites.cancelEditTags();
                  }}
                />
                <Button size="sm" variant="ghost" onClick={() => sites.saveEditTags(website)}>{t.save}</Button>
                <Button size="sm" variant="ghost" onClick={sites.cancelEditTags}>{t.cancel}</Button>
              </div>
            ) : (
              <>
                {(website.tags || []).map((tag) => (
                  <span key={tag} className="rounded-full border border-[var(--stitch-line)] px-2 py-0.5 text-[11px]">
                    {tag}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => sites.startEditTags(website)}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--stitch-line)] px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  <Tag className="h-3 w-3" />
                  {t.editTags || "编辑标签"}
                </button>
              </>
            )}
          </div>

          {getSiteDomains(website).length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              {getSiteDomains(website).map((d) => (
                <a
                  key={d.host}
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 font-mono text-sm text-[var(--stitch-ink)] hover:underline"
                >
                  {d.host}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ))}
            </div>
          )}
        </section>

        <SiteSettingsPanel
          website={website}
          t={t}
          user={user}
          deploying={sites.deploying}
          watermarkSaving={sites.watermarkSaving}
          projects={projects.activeProjects}
          moveWebsiteToProject={sites.moveWebsiteToProject}
          setWebsiteVisibility={sites.setWebsiteVisibility}
          setWebsiteWatermark={sites.setWebsiteWatermark}
          openRedeployDialog={redeploy.openRedeployDialog}
          openDomainDialog={domain.openDomainDialog}
          openSeoDialog={openSeoDialog}
          confirmDeleteWebsite={sites.confirmDeleteWebsite}
        />
      </div>

      <DomainDialog
        open={domain.domainOpen}
        onOpenChange={domain.setDomainOpen}
        domainInfo={domain.domainInfo}
        setDomainInfo={domain.setDomainInfo}
        domainInput={domain.domainInput}
        setDomainInput={domain.setDomainInput}
        domainSuffix={domain.domainSuffix}
        setDomainSuffix={domain.setDomainSuffix}
        domainCheck={domain.domainCheck}
        domainBusy={domain.domainBusy}
        onBind={domain.bindDomain}
        onUnbind={domain.unbindDomain}
        onCopy={domain.copyCname}
        t={t}
      />
      <RedeployDialog
        open={redeploy.redeployOpen}
        onOpenChange={redeploy.setRedeployOpen}
        redeployFile={redeploy.redeployFile}
        isDragActive={redeploy.isRedeployDragActive}
        onDragEnter={redeploy.onRedeployDragEnter}
        onDragOver={redeploy.onRedeployDragOver}
        onDragLeave={redeploy.onRedeployDragLeave}
        onDrop={redeploy.onRedeployDrop}
        onFileChange={redeploy.handleRedeployFileChange}
        onCancel={redeploy.closeRedeployDialog}
        onConfirm={redeploy.submitRedeploy}
        t={t}
      />
      <DeleteConfirmDialog
        open={sites.deleteConfirmOpen}
        onOpenChange={sites.setDeleteConfirmOpen}
        onConfirm={handleDelete}
        t={t}
      />
      <SiteSettingsDialog
        open={seoDialogOpen}
        onOpenChange={setSeoDialogOpen}
        website={seoWebsite}
        t={t}
        lang={lang}
        onSaved={handleSeoSaved}
      />
    </div>
  );
}
