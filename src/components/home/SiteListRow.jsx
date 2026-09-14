import React from "react";
import { formatBytes } from "@/lib/utils";
import { formatRelativeTime, getDisplayName } from "@/lib/website-utils";
import SiteUrlBar from "./SiteUrlBar";

export default function SiteListRow({ website, t, lang, deploying, onOpen }) {
  const name = getDisplayName(website);
  const age = formatRelativeTime(website.updatedAt || website.createdAt, lang);
  const bytes = Number(website.deployedSize || website.deployed_size || website.storage_size || 0);
  const tags = Array.isArray(website.tags) ? website.tags.slice(0, 4) : [];

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={name}
      className="site-list-row"
      onClick={() => onOpen(website)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(website);
        }
      }}
    >
      <SiteUrlBar website={website} t={t} deploying={deploying} hostInteractive={false} />
      <div className="site-list-meta">
        <span className="site-list-name">{name}</span>
        {age ? <span>{age}</span> : null}
        {bytes > 0 ? <span>{formatBytes(bytes)}</span> : null}
        {tags.map((tag) => (
          <span key={tag} className="site-tag">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}
