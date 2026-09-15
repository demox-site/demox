import React, { useState } from "react";
import { Check, Copy, Mail } from "lucide-react";
import { ToastAction } from "@/components/ui/toast";
import {
  WEBMASTER_EMAIL,
  openWebmasterMail,
  webmasterMailto
} from "@/lib/webmaster";

type ContactWebmasterProps = {
  language?: string;
  user?: { email?: string; userId?: string; openId?: string; id?: string } | null;
  variant?: "block" | "inline" | "button";
  hint?: string;
  align?: "start" | "center";
  className?: string;
};

const copy = {
  zh: {
    write: "联系我",
    copied: "已复制",
    copyEmail: "复制邮箱",
    defaultHint: "需要更多技术支持，欢迎联系我。"
  },
  en: {
    write: "Contact me",
    copied: "Copied",
    copyEmail: "Copy email",
    defaultHint: "Need more technical support? Feel free to contact me."
  }
} as const;

export function ContactWebmaster({
  language = "zh",
  user = null,
  variant = "block",
  hint,
  align = "start",
  className = ""
}: ContactWebmasterProps) {
  const t = language === "en" ? copy.en : copy.zh;
  const [copied, setCopied] = useState(false);
  const mailOptions = { language, user };
  const href = webmasterMailto(mailOptions);
  const hintText = hint === undefined ? t.defaultHint : hint;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(WEBMASTER_EMAIL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const writeButton = (
    <a
      href={href}
      className={
        variant === "inline"
          ? "inline-flex items-center gap-1.5 text-sm font-medium text-[var(--stitch-ink)] underline-offset-4 hover:underline"
          : "inline-flex items-center justify-center gap-2 rounded-full bg-[var(--stitch-ink)] px-5 py-2.5 text-sm font-semibold text-[var(--stitch-surface)] hover:opacity-90"
      }
    >
      <Mail className="h-4 w-4" />
      {t.write}
    </a>
  );

  const copyButton = (
    <button
      type="button"
      onClick={onCopy}
      className={
        variant === "inline"
          ? "inline-flex items-center gap-1 text-xs text-[var(--stitch-muted)] hover:text-[var(--stitch-ink)]"
          : "inline-flex items-center justify-center gap-2 rounded-full border border-[var(--stitch-line)] px-4 py-2.5 text-sm text-[var(--stitch-muted)] hover:border-[var(--stitch-ink)] hover:text-[var(--stitch-ink)]"
      }
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? t.copied : WEBMASTER_EMAIL}
    </button>
  );

  if (variant === "button") {
    return (
      <a
        href={href}
        className={`stitch-action inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold ${className}`}
      >
        <Mail className="h-4 w-4" />
        {t.write}
      </a>
    );
  }

  if (variant === "inline") {
    return (
      <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
        {writeButton}
        <button type="button" onClick={onCopy} className="font-mono text-xs text-[var(--stitch-muted)] hover:text-[var(--stitch-ink)]">
          {copied ? t.copied : WEBMASTER_EMAIL}
        </button>
      </span>
    );
  }

  return (
    <div className={`rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-6 ${className}`}>
      {hintText ? (
        <p className={`mb-4 text-sm leading-6 text-[var(--stitch-muted)] ${align === "center" ? "text-center" : ""}`}>
          {hintText}
        </p>
      ) : null}
      <div className={`flex flex-col gap-3 sm:flex-row sm:items-center ${align === "center" ? "sm:justify-center" : ""}`}>
        {writeButton}
        {copyButton}
      </div>
    </div>
  );
}

export function WebmasterToastAction({
  language = "zh",
  user = null,
  label
}: {
  language?: string;
  user?: ContactWebmasterProps["user"];
  label?: string;
}) {
  const t = language === "en" ? copy.en : copy.zh;
  return (
    <ToastAction
      altText={label || t.write}
      onClick={() => openWebmasterMail({ language, user })}
    >
      {label || t.write}
    </ToastAction>
  );
}
