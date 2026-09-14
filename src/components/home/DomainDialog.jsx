import React from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input
} from "@/components/ui";
import { DEFAULT_OFFICIAL_DOMAIN, normalizeOfficialDomain } from "@/lib/official-domains";
import { Link2, Pencil, X, Loader2, Copy, Check, XCircle } from "lucide-react";

export default function DomainDialog({
  open,
  onOpenChange,
  domainInfo,
  setDomainInfo,
  domainInput,
  setDomainInput,
  domainSuffix,
  setDomainSuffix,
  domainCheck,
  domainBusy,
  onBind,
  onUnbind,
  onCopy,
  t
}) {
  const activeDomain = normalizeOfficialDomain(domainInfo?.domain || domainSuffix);
  const activeHost = domainInfo?.subdomain ? `${domainInfo.subdomain}.${activeDomain}` : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)] sm:rounded-[1.5rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[var(--stitch-ink)]">
            <Link2 className="h-5 w-5 text-[var(--stitch-muted)]" />
            {t.domainDialogTitle}
          </DialogTitle>
          <DialogDescription className="text-[var(--stitch-muted)]">
            {t.domainDialogDesc}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {domainInfo && domainInfo.subdomain ? (
            <div className="space-y-4">
              <p className="text-xs text-[var(--stitch-muted)]">{t.domainCnameTip}</p>
              <div className="flex items-center gap-2 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-3 py-2">
                <span className="h-2 w-2 rounded-full bg-[var(--stitch-ink)]" />
                <a
                  href={`https://${activeHost}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 truncate font-mono text-sm text-[var(--stitch-ink)] hover:underline"
                >
                  {activeHost}
                </a>
                <button
                  type="button"
                  onClick={() => onCopy(`https://${activeHost}`)}
                  className="text-[var(--stitch-muted)] hover:text-[var(--stitch-ink)]"
                  title={t.domainCopy}
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDomainInfo(null);
                    setDomainInput(domainInfo.subdomain);
                    setDomainSuffix(activeDomain);
                  }}
                  className="stitch-action rounded-full"
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  {t.editName}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onUnbind}
                  disabled={domainBusy}
                  className="rounded-full border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  {domainBusy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <X className="mr-2 h-4 w-4" />
                  )}
                  {t.domainUnbindButton}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="text-sm text-[var(--stitch-muted)]">{t.domainInputLabel}</label>
              <div className="flex items-center gap-2">
                <div
                  className={`flex flex-1 items-center overflow-hidden rounded-full border ${
                    domainCheck.status === "taken" || domainCheck.status === "invalid"
                      ? "border-red-400"
                      : domainCheck.status === "ok"
                      ? "border-[var(--stitch-ink)]"
                      : "border-[var(--stitch-line)]"
                  }`}
                >
                  <Input
                    value={domainInput}
                    onChange={(event) =>
                      setDomainInput(
                        event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")
                      )
                    }
                    placeholder={t.domainInputPlaceholder}
                    className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && domainCheck.status === "ok" && !domainBusy) onBind();
                    }}
                  />
                  <span className="flex h-10 items-center border-l border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-3 font-mono text-sm text-[var(--stitch-muted)]">
                    .{DEFAULT_OFFICIAL_DOMAIN}
                  </span>
                </div>
                <Button
                  onClick={onBind}
                  disabled={domainBusy || !domainInput.trim() || domainCheck.status !== "ok"}
                  className="stitch-primary shrink-0 rounded-full"
                >
                  {domainBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.domainBindButton}
                </Button>
              </div>
              {domainCheck.status === "checking" && (
                <p className="flex items-center gap-1 text-xs text-[var(--stitch-muted)]">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t.domainChecking}
                </p>
              )}
              {domainCheck.status === "ok" && domainInput.trim() && (
                <p className="flex items-center gap-1 text-xs text-emerald-600">
                  <Check className="h-3 w-3" />
                  {t.domainAvailable}
                </p>
              )}
              {(domainCheck.status === "taken" || domainCheck.status === "invalid") && (
                <p className="flex items-center gap-1 text-xs text-red-500">
                  <XCircle className="h-3 w-3" />
                  {domainCheck.message || (domainCheck.status === "taken" ? t.domainTaken : t.domainHint)}
                </p>
              )}
              {domainCheck.status === "idle" && (
                <p className="text-xs text-[var(--stitch-muted)]">{t.domainHint}</p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
