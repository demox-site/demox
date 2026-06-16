import React from "react";
// @ts-ignore;
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input
} from "@/components/ui";
// @ts-ignore;
import { Link2, Pencil, X, Loader2, Copy, Check, XCircle } from "lucide-react";

export default function DomainDialog({
  open,
  onOpenChange,
  domainInfo,
  setDomainInfo,
  domainInput,
  setDomainInput,
  domainCheck,
  domainBusy,
  onBind,
  onUnbind,
  onCopy,
  t
}) {
  const inputBorderClass =
    domainCheck.status === "taken" || domainCheck.status === "invalid"
      ? "border-destructive"
      : domainCheck.status === "ok"
      ? "border-success"
      : "border-border";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-muted-foreground" />
            {t.domainDialogTitle}
          </DialogTitle>
          <DialogDescription>{t.domainDialogDesc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {domainInfo && domainInfo.subdomain ? (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">{t.domainCnameTip}</p>
              <div className="flex items-center gap-2 px-3 py-2 rounded bg-muted border border-border">
                <span className="w-2 h-2 rounded-full bg-success"></span>
                <a
                  href={`https://${domainInfo.subdomain}.demox.site`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground text-sm font-mono truncate hover:underline flex-1"
                >
                  {domainInfo.subdomain}.demox.site
                </a>
                <button
                  onClick={() => onCopy(`https://${domainInfo.subdomain}.demox.site`)}
                  className="text-muted-foreground hover:text-foreground"
                  title={t.domainCopy}
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDomainInfo(null);
                    setDomainInput(domainInfo.subdomain);
                  }}
                >
                  <Pencil className="w-4 h-4 mr-2" />
                  {t.editName}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onUnbind}
                  disabled={domainBusy}
                  className="text-destructive hover:text-destructive"
                >
                  {domainBusy ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <X className="w-4 h-4 mr-2" />
                  )}
                  {t.domainUnbindButton}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="text-sm text-muted-foreground">{t.domainInputLabel}</label>
              <div className="flex items-center gap-2">
                <div
                  className={`flex items-center flex-1 rounded bg-muted border overflow-hidden focus-within:ring-1 focus-within:ring-ring ${inputBorderClass}`}
                >
                  <Input
                    value={domainInput}
                    onChange={(e) =>
                      setDomainInput(
                        e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")
                      )
                    }
                    placeholder={t.domainInputPlaceholder}
                    className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && domainCheck.status === "ok" && !domainBusy)
                        onBind();
                    }}
                  />
                  <span className="px-3 text-sm text-muted-foreground font-mono whitespace-nowrap select-none">
                    .demox.site
                  </span>
                </div>
                <Button
                  onClick={onBind}
                  disabled={domainBusy || !domainInput.trim() || domainCheck.status !== "ok"}
                  className="shrink-0"
                >
                  {domainBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    t.domainBindButton
                  )}
                </Button>
              </div>
              {domainCheck.status === "checking" && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t.domainChecking}
                </p>
              )}
              {domainCheck.status === "ok" && domainInput.trim() && (
                <p className="text-xs text-success flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  {t.domainAvailable}
                </p>
              )}
              {(domainCheck.status === "taken" || domainCheck.status === "invalid") && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <XCircle className="w-3 h-3" />
                  {domainCheck.message ||
                    (domainCheck.status === "taken" ? t.domainTaken : t.domainHint)}
                </p>
              )}
              {domainCheck.status === "idle" && (
                <p className="text-xs text-muted-foreground">{t.domainHint}</p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
