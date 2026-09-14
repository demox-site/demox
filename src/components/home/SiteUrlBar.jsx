import React from "react";
import { Check, Copy, ExternalLink, Globe2, Loader2, LockKeyhole } from "lucide-react";
import { useToast } from "@/components/ui";
import { copySiteUrl } from "@/lib/copy-site-url";
import { getPrimaryDomain, isSiteBusy } from "@/lib/website-utils";

export default function SiteUrlBar({
  website,
  t,
  deploying = {},
  size = "md",
  hostInteractive = true,
  className = ""
}) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);
  const primary = getPrimaryDomain(website);
  const isPrivate = website?.visibility === "private";
  const busy = isSiteBusy(website, deploying);

  if (!primary) return null;

  const copy = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const ok = await copySiteUrl(primary.url, toast, t);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const open = (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.open(primary.url, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className={`site-url-bar ${size === "lg" ? "site-url-bar-lg" : ""} ${className}`.trim()}
      data-busy={busy ? "true" : "false"}
      data-private={isPrivate ? "true" : "false"}
    >
      <span className="site-url-bar-lock" data-private={isPrivate ? "true" : "false"} aria-hidden="true">
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isPrivate ? (
          <LockKeyhole className="h-3.5 w-3.5" />
        ) : (
          <Globe2 className="h-3.5 w-3.5" />
        )}
      </span>
      {hostInteractive ? (
        <a
          href={primary.url}
          className="site-url-bar-host"
          onClick={open}
          title={primary.host}
        >
          {primary.host}
        </a>
      ) : (
        <span className="site-url-bar-host" title={primary.host}>
          {primary.host}
        </span>
      )}
      <div className="site-url-bar-actions">
        <button type="button" onClick={copy} title={t.copyLink} aria-label={t.copyLink}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button type="button" onClick={open} title={t.openSite} aria-label={t.openSite}>
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
