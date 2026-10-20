import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, useToast } from "@/components/ui";
import { ExternalLink, Globe2, LockKeyhole, Upload } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { translations } from "../home-translations";
import {
  getDisplayName,
  getPrimaryDomain,
  getSiteDomains,
  hasProOrAboveRole,
  isSiteBusy,
  joinTags
} from "@/lib/website-utils";
import DeleteConfirmDialog from "@/components/home/DeleteConfirmDialog";
import RedeployDialog from "@/components/home/RedeployDialog";
import DomainDialog from "@/components/home/DomainDialog";
import SiteSettingsDialog from "@/components/home/SiteSettingsDialog";
import SiteSettingsPanel from "@/components/home/SiteSettingsPanel";
import SiteUrlBar from "@/components/home/SiteUrlBar";
import SiteCustomDomains from "./SiteCustomDomains";
import { copySiteUrl } from "@/lib/copy-site-url";
import { useAuth } from "../use-auth";
import { useWebsites } from "../use-websites";
import { useProjects } from "../use-projects";
import { useRedeploy } from "../use-redeploy";
import { useDomainDialog } from "../use-domain-dialog";

export default function SiteSettingsPage() {
  const { projectId = "", websiteId = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
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
  const [nameDraft, setNameDraft] = React.useState("");
  const [tagsDraft, setTagsDraft] = React.useState("");

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
  const primary = getPrimaryDomain(website);
  const extraDomains = getSiteDomains(website).filter((item) => item.host !== primary?.host);
  const busy = isSiteBusy(website, sites.deploying);

  const websiteKey = website?._id || "";
  const websiteName = getDisplayName(website);
  const websiteTagKey = joinTags(website?.tags || []);

  React.useEffect(() => {
    if (!websiteKey) return;
    setNameDraft(websiteName);
    setTagsDraft(websiteTagKey);
  }, [websiteKey, websiteName, websiteTagKey]);

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
      <div className="stitch-page">
        <div className="site-list-row h-36 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="stitch-page max-w-5xl">
      <div className="mb-8 flex flex-col gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="site-page-kicker">{t.siteSettingsTitle}</div>
            <h1 className="site-page-title">{getDisplayName(website)}</h1>
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-[var(--stitch-muted)]">
              {isPrivate ? <LockKeyhole className="h-3.5 w-3.5" /> : <Globe2 className="h-3.5 w-3.5" />}
              {isPrivate ? t.visibilityPrivate : t.visibilityPublic}
              {busy ? <span>· {t.processingUrl}</span> : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="stitch-primary rounded-full px-5"
              onClick={() => primary && window.open(primary.url, "_blank", "noopener,noreferrer")}
              disabled={!primary}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {t.openSite}
            </Button>
            <Button
              variant="outline"
              className="stitch-action rounded-full px-5"
              onClick={() => primary && copySiteUrl(primary.url, toast, t)}
              disabled={!primary}
            >
              {t.copyLink}
            </Button>
            <Button
              variant="outline"
              className="stitch-action rounded-full px-5"
              disabled={busy}
              title={busy ? t.redeployDisabledTooltip : t.redeployButton}
              onClick={() => redeploy.openRedeployDialog(website)}
            >
              <Upload className="mr-2 h-4 w-4" />
              {t.redeployButton}
            </Button>
          </div>
        </div>

        <SiteUrlBar website={website} t={t} deploying={sites.deploying} size="lg" />

        {extraDomains.length > 0 ? (
          <div className="flex flex-col gap-1.5 px-1">
            {extraDomains.map((item) => (
              <a
                key={item.host}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="site-alt-host hover:text-[var(--stitch-ink)]"
              >
                <span className="truncate">
                  {item.isDefault
                    ? t.defaultAddress
                    : website.subdomain &&
                        item.host.startsWith(`${String(website.subdomain).toLowerCase()}.`)
                      ? t.officialPrefix
                      : t.projectAddresses}{" "}
                  · {item.host}
                </span>
              </a>
            ))}
          </div>
        ) : null}
      </div>

      <SiteCustomDomains
        projectId={projectId}
        websiteId={website.websiteId || websiteId}
        onChanged={() => {
          void sites.loadWebsites();
        }}
      />

      <SiteSettingsPanel
        website={website}
        t={t}
        user={user}
        deploying={sites.deploying}
        watermarkSaving={sites.watermarkSaving}
        projects={projects.activeProjects}
        nameDraft={nameDraft}
        setNameDraft={setNameDraft}
        tagsDraft={tagsDraft}
        setTagsDraft={setTagsDraft}
        saveName={() => sites.saveEditName(website, nameDraft)}
        saveTags={() => sites.saveEditTags(website, tagsDraft)}
        moveWebsiteToProject={sites.moveWebsiteToProject}
        setWebsiteVisibility={sites.setWebsiteVisibility}
        setWebsiteWatermark={sites.setWebsiteWatermark}
        openDomainDialog={domain.openDomainDialog}
        openSeoDialog={openSeoDialog}
        confirmDeleteWebsite={sites.confirmDeleteWebsite}
      />

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
