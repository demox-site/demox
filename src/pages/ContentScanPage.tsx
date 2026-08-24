import React, { useEffect, useState } from "react";
import { Shield, Copy, CheckCircle } from "lucide-react";
import { MainLayout } from "@/layouts/MainLayout";
import { Seo } from "@/components/Seo";
import { useLanguage } from "@/hooks/use-language";
import { websiteApi } from "@/api";

const API_URL = "https://api.demox.site/website/content-scan/phrases";
const STATIC_JSON = "/content-scan.json";
const SKILL_URL = "https://github.com/demox-site/skill";

type PhraseGroup = {
  category: string;
  label: string;
  labelEn?: string;
  phrases: string[];
};

type PhraseCatalog = {
  success?: boolean;
  docs?: string;
  skill?: string;
  method?: string;
  updatedAt?: string;
  count?: number;
  phrases?: string[];
  groups?: PhraseGroup[];
  imageReview?: { note?: string };
};

const copy = {
  zh: {
    seoTitle: "屏蔽词表 - Demox 内容审核",
    seoDesc: "查看 Demox 部署前本地规则使用的全部屏蔽词，以及公开查询接口。",
    title: "内容审核屏蔽词",
    subtitle:
      "部署前会用短语匹配扫描上传包。这里是完整词表；图片另走腾讯云 IMS，不在本表。",
    apiTitle: "公开接口",
    apiDesc: "无需登录。AI 助手优先读 Agent Skill，再调这个接口拿最新词表。",
    skill: "Agent Skill",
    curl: "curl 示例",
    copy: "复制",
    copied: "已复制",
    listTitle: "当前屏蔽词",
    updated: "词表日期",
    count: "条",
    loadError: "接口暂不可用，以下为站点静态词表。",
    imageNote: "图片审核",
  },
  en: {
    seoTitle: "Blocked phrases - Demox content scan",
    seoDesc: "The complete Demox local blocklist and the public API for listing every phrase.",
    title: "Content scan phrases",
    subtitle:
      "Uploads are scanned with phrase matching before deploy. This is the full list. Images go through Tencent IMS, not this table.",
    apiTitle: "Public API",
    apiDesc: "No login. Agents should read the skill first, then call this endpoint for the live list.",
    skill: "Agent Skill",
    curl: "curl example",
    copy: "Copy",
    copied: "Copied",
    listTitle: "Current phrases",
    updated: "Updated",
    count: "phrases",
    loadError: "Live API unavailable; showing the static site copy.",
    imageNote: "Image review",
  },
} as const;

export const ContentScanPage: React.FC = () => {
  const { language } = useLanguage();
  const t = copy[language === "en" ? "en" : "zh"];
  const [catalog, setCatalog] = useState<PhraseCatalog | null>(null);
  const [fromStatic, setFromStatic] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const live = await websiteApi.listBlockedPhrases();
        if (!cancelled && live?.success && Array.isArray(live.groups)) {
          setCatalog(live);
          setFromStatic(false);
          return;
        }
      } catch {
        // fall through to static copy
      }
      try {
        const res = await fetch(STATIC_JSON);
        const data = (await res.json()) as PhraseCatalog;
        if (!cancelled) {
          setCatalog(data);
          setFromStatic(true);
        }
      } catch {
        if (!cancelled) setCatalog(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const curl = `curl -s ${API_URL}`;
  const groups = catalog?.groups || [];
  const count = catalog?.count ?? groups.reduce((sum, group) => sum + (group.phrases?.length || 0), 0);

  return (
    <MainLayout>
      <Seo title={t.seoTitle} description={t.seoDesc} />
      <div className="relative z-10 max-w-3xl">
        <div className="flex items-center gap-2.5 mb-3">
          <Shield className="text-[var(--stitch-muted)]" size={22} />
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[var(--stitch-ink)]">
            {t.title}
          </h1>
        </div>
        <p className="text-[var(--stitch-muted)] leading-relaxed mb-10">{t.subtitle}</p>

        <section className="mb-12 rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--stitch-ink)] mb-2">{t.apiTitle}</h2>
          <p className="text-sm text-[var(--stitch-muted)] leading-relaxed mb-4">{t.apiDesc}</p>
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] pl-4 pr-2 py-2">
              <code className="flex-1 min-w-0 truncate text-sm font-mono">{API_URL}</code>
            </div>
            <a
              href={SKILL_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-sm text-[var(--stitch-ink)] underline underline-offset-4"
            >
              {t.skill}: {SKILL_URL}
            </a>
            <div className="relative">
              <p className="text-xs uppercase tracking-wider text-zinc-500 mb-2">{t.curl}</p>
              <pre className="bg-[var(--stitch-surface-strong)] border border-[var(--stitch-line)] rounded-xl p-4 text-sm font-mono overflow-x-auto">
                <code>{curl}</code>
              </pre>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(curl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }}
                className="absolute top-7 right-3 flex items-center gap-1 px-2 py-1 rounded text-xs bg-[var(--stitch-ink)] text-[var(--stitch-surface)]"
              >
                {copied ? <CheckCircle size={12} /> : <Copy size={12} />}
                {copied ? t.copied : t.copy}
              </button>
            </div>
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-baseline gap-3 mb-4">
            <h2 className="text-lg font-bold text-[var(--stitch-ink)]">{t.listTitle}</h2>
            <span className="text-sm text-[var(--stitch-muted)]">
              {count} {t.count}
              {catalog?.updatedAt ? ` · ${t.updated} ${catalog.updatedAt}` : ""}
            </span>
          </div>
          {fromStatic && (
            <p className="text-xs text-amber-500/90 mb-4">{t.loadError}</p>
          )}
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.category}>
                <h3 className="font-semibold text-[var(--stitch-ink)] mb-2">
                  {language === "en" ? group.labelEn || group.label : group.label}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {(group.phrases || []).map((phrase) => (
                    <code
                      key={phrase}
                      className="px-2 py-1 rounded-md border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-sm"
                    >
                      {phrase}
                    </code>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {catalog?.imageReview?.note && (
            <p className="text-sm text-[var(--stitch-muted)] mt-8">
              {t.imageNote}：{catalog.imageReview.note}
            </p>
          )}
        </section>
      </div>
    </MainLayout>
  );
};

export default ContentScanPage;
