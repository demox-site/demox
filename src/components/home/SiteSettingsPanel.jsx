import React from "react";
import { Button, Switch } from "@/components/ui";
import {
  Eye,
  EyeOff,
  FolderKanban,
  Globe2,
  Link2,
  Lock,
  LockKeyhole,
  Search,
  Trash2,
  Upload
} from "lucide-react";
import { hasProOrAboveRole } from "@/lib/website-utils";

function PremiumMark({ t }) {
  return (
    <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
      <Lock className="h-3 w-3" />
      {t.proFeatureBadge || "专业"}
    </span>
  );
}

export default function SiteSettingsPanel({
  website,
  t,
  user,
  deploying,
  watermarkSaving = {},
  projects = [],
  moveWebsiteToProject,
  setWebsiteVisibility,
  setWebsiteWatermark,
  openRedeployDialog,
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

  if (!canManageSite) {
    return (
      <p className="text-sm text-muted-foreground">
        {t.siteSettingsHint || "No permission to change this site."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {canMoveProject && (
        <section className="rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-4">
          <label className="mb-2 flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <FolderKanban className="h-3.5 w-3.5" />
            {t.moveToProject}
          </label>
          <select
            value={website.projectId || ""}
            disabled={isProcessing}
            onChange={(e) => {
              const nextProjectId = String(e.target.value || "");
              if (!nextProjectId || nextProjectId === String(website.projectId || "")) return;
              const project = projects.find((p) => String(p.id) === nextProjectId);
              if (project && moveWebsiteToProject) moveWebsiteToProject(website, project);
            }}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-ring disabled:cursor-not-allowed disabled:opacity-50"
            title={t.moveToProject}
          >
            {!website.projectId && <option value="">{t.noProject}</option>}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </section>
      )}

      <section className="flex items-center justify-between rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            {isPublic ? <Globe2 className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
            {isPublic ? t.visibilityPublic : t.visibilityPrivate}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t.visibilityToggleTitle}</p>
        </div>
        <Switch
          checked={isPublic}
          disabled={isProcessing}
          onCheckedChange={(checked) => {
            if (setWebsiteVisibility) setWebsiteVisibility(website, checked ? "public" : "private");
          }}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Button
          variant="outline"
          disabled={isProcessing}
          onClick={() => openRedeployDialog(website)}
          className="h-11 justify-start rounded-2xl"
          title={isProcessing ? t.redeployDisabledTooltip : t.redeployButton}
        >
          <Upload className="mr-2 h-4 w-4" />
          {t.redeployButton}
        </Button>
        <Button
          variant="outline"
          onClick={() => openDomainDialog(website)}
          className="h-11 justify-start rounded-2xl"
          title={t.customDomain}
        >
          <Link2 className="mr-2 h-4 w-4" />
          {website.subdomain ? t.domainBound : t.customDomain}
        </Button>
      </section>

      <section
        className={`flex items-center justify-between rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-4 py-3 ${canUseProFeatures ? "" : "opacity-60"}`}
        title={canUseProFeatures ? t.watermarkToggleTitle : proHint}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            {website.hideWatermark === true ? <EyeOff className="h-4 w-4 shrink-0" /> : <Eye className="h-4 w-4 shrink-0" />}
            <span className="truncate">{t.watermarkLabel || t.watermarkHidden}</span>
            {!canUseProFeatures && <PremiumMark t={t} />}
          </div>
        </div>
        <Switch
          checked={website.hideWatermark !== true}
          disabled={!canUseProFeatures || isProcessing || watermarkSaving[website._id]}
          onCheckedChange={(checked) => {
            if (canUseProFeatures && setWebsiteWatermark) setWebsiteWatermark(website, !checked);
          }}
        />
      </section>

      <div title={canUseProFeatures ? (t.seoSettings || "SEO") : proHint}>
        <Button
          variant="outline"
          disabled={!canUseProFeatures}
          onClick={() => openSeoDialog && openSeoDialog(website)}
          className="h-11 w-full justify-start rounded-2xl"
        >
          <Search className="mr-2 h-4 w-4" />
          {t.seoSettings || "SEO"}
          {!canUseProFeatures && <PremiumMark t={t} />}
        </Button>
      </div>

      <Button
        variant="ghost"
        onClick={() => confirmDeleteWebsite(website._id)}
        className="h-11 w-full justify-start rounded-2xl text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        {t.deleteSite || "删除站点"}
      </Button>
    </div>
  );
}
