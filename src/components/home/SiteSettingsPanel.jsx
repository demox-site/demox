import React from "react";
import { Button, Input, Switch } from "@/components/ui";
import {
  Eye,
  EyeOff,
  FolderKanban,
  Globe2,
  Link2,
  Lock,
  LockKeyhole,
  Search,
  Trash2
} from "lucide-react";
import {
  getDisplayName,
  getSiteDomains,
  hasProOrAboveRole,
  joinTags
} from "@/lib/website-utils";

function PremiumMark({ t }) {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-blue-soft)] px-1.5 py-px text-[10px] font-semibold text-[var(--stitch-muted)]">
      <Lock className="h-3 w-3" />
      {t.proFeatureBadge || "专业"}
    </span>
  );
}

function Group({ title, hint, children }) {
  return (
    <section className="site-settings-group">
      <div>
        <h3>{title}</h3>
        {hint ? <p className="site-settings-hint">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default function SiteSettingsPanel({
  website,
  t,
  user,
  deploying,
  watermarkSaving = {},
  projects = [],
  nameDraft,
  setNameDraft,
  tagsDraft,
  setTagsDraft,
  saveName,
  saveTags,
  moveWebsiteToProject,
  setWebsiteVisibility,
  setWebsiteWatermark,
  openDomainDialog,
  openSeoDialog,
  confirmDeleteWebsite
}) {
  const isProcessing = website.status === "processing" || deploying[website._id];
  const isPlatformAdmin = Array.isArray(user?.roles) && user.roles.includes("admin");
  const isSiteOwner = !website.userId || website.userId === user?.userId;
  const canManageByProject = ["owner", "admin"].includes(website.projectRole || "");
  const canManageSite = isSiteOwner || isPlatformAdmin || canManageByProject;
  const canUseProFeatures = hasProOrAboveRole(user?.roles);
  const proHint = t.proFeatureUnavailable || "仅专业用户及以上可用";
  const canMoveProject = canManageSite && Array.isArray(projects) && projects.length > 0;
  const isPrivate = website.visibility === "private";
  const isPublic = !isPrivate;
  const domains = getSiteDomains(website);
  const officialHost = website.subdomain
    ? domains.find((item) => item.host.startsWith(`${String(website.subdomain).toLowerCase()}.`))
    : null;
  const defaultHost = domains.find((item) => item.isDefault);
  const nameDirty = String(nameDraft || "").trim() !== getDisplayName(website);
  const tagsDirty = joinTags(website.tags || []) !== String(tagsDraft || "").trim();

  if (!canManageSite) {
    return <p className="text-sm text-[var(--stitch-muted)]">{t.readOnlySite || t.siteSettingsHint}</p>;
  }

  return (
    <div className="site-settings-grid">
      <Group title={t.settingsAccess} hint={t.settingsAccessHint}>
        <div className="site-setting-row">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--stitch-ink)]">
              {isPublic ? <Globe2 className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
              {isPublic ? t.visibilityPublic : t.visibilityPrivate}
            </div>
            <p className="mt-1 text-xs text-[var(--stitch-muted)]">
              {isPublic ? t.visibilityPublicHint : t.visibilityPrivateHint}
            </p>
          </div>
          <Switch
            checked={isPublic}
            disabled={isProcessing}
            onCheckedChange={(checked) => {
              if (setWebsiteVisibility) setWebsiteVisibility(website, checked ? "public" : "private");
            }}
          />
        </div>
        <div
          className={`site-setting-row ${canUseProFeatures ? "" : "opacity-60"}`}
          title={canUseProFeatures ? t.watermarkToggleTitle : proHint}
        >
          <div className="min-w-0">
            <div className="flex items-center text-sm font-medium text-[var(--stitch-ink)]">
              {website.hideWatermark === true ? (
                <EyeOff className="mr-2 h-4 w-4 shrink-0" />
              ) : (
                <Eye className="mr-2 h-4 w-4 shrink-0" />
              )}
              <span className="truncate">{t.watermarkLabel}</span>
              {!canUseProFeatures ? <PremiumMark t={t} /> : null}
            </div>
            <p className="mt-1 text-xs text-[var(--stitch-muted)]">{t.watermarkHint}</p>
          </div>
          <Switch
            checked={website.hideWatermark !== true}
            disabled={!canUseProFeatures || isProcessing || watermarkSaving[website._id]}
            onCheckedChange={(checked) => {
              if (canUseProFeatures && setWebsiteWatermark) setWebsiteWatermark(website, !checked);
            }}
          />
        </div>
      </Group>

      <Group title={t.settingsAddress} hint={t.settingsAddressHint}>
        <div className="site-setting-row">
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--stitch-ink)]">{t.officialPrefix}</div>
            <p className="mt-1 truncate font-mono text-xs text-[var(--stitch-muted)]">
              {officialHost?.host || t.noOfficialPrefix}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="stitch-action shrink-0 rounded-full"
            onClick={() => openDomainDialog(website)}
          >
            <Link2 className="mr-2 h-4 w-4" />
            {officialHost ? t.changePrefix : t.setPrefix}
          </Button>
        </div>
        {defaultHost ? (
          <div className="site-alt-host pt-1">
            <span className="truncate">
              {t.defaultAddress} · {defaultHost.host}
            </span>
          </div>
        ) : null}
      </Group>

      <Group title={t.settingsAppearance} hint={t.settingsAppearanceHint}>
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-[var(--stitch-muted)]">{t.siteNameLabel}</span>
          <div className="flex gap-2">
            <Input
              value={nameDraft}
              disabled={isProcessing}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveName();
              }}
              className="h-10 rounded-xl border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)]"
            />
            <Button
              size="sm"
              disabled={!nameDirty || isProcessing}
              onClick={saveName}
              className="stitch-primary h-10 rounded-full px-4"
            >
              {t.save}
            </Button>
          </div>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-[var(--stitch-muted)]">{t.siteTagsLabel}</span>
          <div className="flex gap-2">
            <Input
              value={tagsDraft}
              disabled={isProcessing}
              placeholder={t.siteTagsPlaceholder}
              onChange={(event) => setTagsDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveTags();
              }}
              className="h-10 rounded-xl border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)]"
            />
            <Button
              size="sm"
              disabled={!tagsDirty || isProcessing}
              onClick={saveTags}
              className="stitch-action h-10 rounded-full px-4"
            >
              {t.save}
            </Button>
          </div>
        </label>
        <button
          type="button"
          disabled={!canUseProFeatures}
          title={canUseProFeatures ? t.seoSettings : proHint}
          onClick={() => openSeoDialog && openSeoDialog(website)}
          className={`site-setting-row mt-1 w-full border-t border-[var(--stitch-line)] text-left ${canUseProFeatures ? "" : "cursor-not-allowed opacity-60"}`}
        >
          <div className="min-w-0">
            <div className="flex items-center text-sm font-medium text-[var(--stitch-ink)]">
              <Search className="mr-2 h-4 w-4" />
              {t.seoSettings}
              {!canUseProFeatures ? <PremiumMark t={t} /> : null}
            </div>
            <p className="mt-1 text-xs text-[var(--stitch-muted)]">{t.seoRowHint}</p>
          </div>
        </button>
      </Group>

      <Group title={t.settingsOrg} hint={t.settingsOrgHint}>
        {canMoveProject ? (
          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 text-xs font-bold text-[var(--stitch-muted)]">
              <FolderKanban className="h-3.5 w-3.5" />
              {t.moveToProject}
            </span>
            <select
              value={website.projectId || ""}
              disabled={isProcessing}
              onChange={(event) => {
                const nextProjectId = String(event.target.value || "");
                if (!nextProjectId || nextProjectId === String(website.projectId || "")) return;
                const project = projects.find((item) => String(item.id) === nextProjectId);
                if (project && moveWebsiteToProject) moveWebsiteToProject(website, project);
              }}
              className="stitch-select h-10 w-full"
            >
              {!website.projectId && <option value="">{t.noProject}</option>}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button
          variant="ghost"
          onClick={() => confirmDeleteWebsite(website._id)}
          className="h-11 w-full justify-start rounded-2xl text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t.deleteSite}
        </Button>
      </Group>
    </div>
  );
}
