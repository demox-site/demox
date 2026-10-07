import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Bot, Layers, Scale, Terminal } from "lucide-react";
import { INTENT_LANDINGS } from "@/content/intent-landings.mjs";
import { track } from "@/lib/track";

type Lang = "zh" | "en";

const GROUPS: {
  key: string;
  icon: React.ElementType;
  zh: { t: string; d: string };
  en: { t: string; d: string };
  cmd: string;
  ids: string[];
}[] = [
  {
    key: "static",
    icon: Terminal,
    zh: { t: "发布静态文件", d: "单个 HTML、ZIP 或 dist 文件夹，上传或一行命令。" },
    en: { t: "Ship static files", d: "One HTML file, a ZIP, or a dist folder — upload or one command." },
    cmd: "demox deploy ./dist",
    ids: ["free-static-site-hosting", "free-html-hosting", "cli-static-site-deploy", "deploy-dist-folder"],
  },
  {
    key: "ai",
    icon: Bot,
    zh: { t: "让 AI 助手发布", d: "Claude Code、Cursor、Codex 通过 MCP 或 CLI 直接发布。" },
    en: { t: "Let an AI agent deploy", d: "Claude Code, Cursor, and Codex publish via MCP or the CLI." },
    cmd: "npx -y @demox-site/mcp-server@latest",
    ids: ["ai-website-deployment", "mcp-website-deployment", "deploy-ai-generated-website", "claude-code-deploy-website", "cursor-deploy-website", "codex-deploy-website"],
  },
  {
    key: "fw",
    icon: Layers,
    zh: { t: "前端框架构建产物", d: "Vite、React 构建后，把输出目录发出去。" },
    en: { t: "Framework builds", d: "Build with Vite or React, then publish the output folder." },
    cmd: "npm run build && demox deploy ./dist",
    ids: ["deploy-vite-app", "deploy-react-build"],
  },
  {
    key: "cmp",
    icon: Scale,
    zh: { t: "和其他平台对比", d: "什么时候选 Demox，什么时候不适合，如实写清。" },
    en: { t: "Compare platforms", d: "When Demox fits and when it doesn't, stated honestly." },
    cmd: "Netlify Drop · Surge · Vercel",
    ids: ["netlify-drop-alternative", "surge-alternative", "vercel-alternative-for-static-sites"],
  },
];

const byId = new Map(INTENT_LANDINGS.map((p: any) => [p.id, p]));

export const TaskGuides: React.FC<{ lang: Lang }> = ({ lang }) => {
  const reduce = useReducedMotion();
  const zh = lang === "zh";
  const grouped = new Set(GROUPS.flatMap((g) => g.ids));
  const rest = INTENT_LANDINGS.filter((p: any) => !grouped.has(p.id));
  const groups = GROUPS.map((g, i) =>
    i === 0 ? { ...g, ids: [...g.ids, ...rest.map((p: any) => p.id)] } : g,
  );

  return (
    <section id="intent-guides" className="relative py-20 md:py-28 px-4 border-t border-[var(--stitch-line)] overflow-x-clip">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-[1fr_auto] md:items-end gap-6 mb-10 md:mb-14">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-surface)] mb-5 text-xs font-mono text-[var(--stitch-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--stitch-ink)]" />
              {zh ? "发布指南" : "Deploy guides"}
            </div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-[var(--stitch-ink)] mb-3">
              {zh ? "按具体发布任务查" : "Guides for a specific deploy job"}
            </h2>
            <p className="text-[var(--stitch-muted)] max-w-2xl leading-relaxed">
              {zh
                ? "从你手上的东西出发：一个文件、一个 AI 助手、一个框架项目，或者正在比较平台。每篇都给出可以直接复制的步骤。"
                : "Start from what you have: a file, an AI agent, a framework project, or a platform you're comparing. Each guide gives steps you can copy."}
            </p>
          </div>
          <span className="hidden md:inline text-xs font-mono text-[var(--stitch-muted)]">
            {INTENT_LANDINGS.length} {zh ? "篇指南" : "guides"}
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-4 md:gap-5">
          {groups.map((g, gi) => {
            const Icon = g.icon;
            const copy = zh ? g.zh : g.en;
            return (
              <motion.div
                key={g.key}
                initial={reduce ? false : { opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: gi * 0.07, ease: [0.22, 1, 0.36, 1] }}
                className="group/card relative min-w-0 rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-5 md:p-6 transition-[border-color,box-shadow,transform] duration-300 hover:border-[var(--stitch-muted)] hover:shadow-[var(--stitch-shadow)] md:hover:-translate-y-0.5"
              >
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 shrink-0 rounded-xl border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] flex items-center justify-center text-[var(--stitch-ink)] transition-transform duration-300 group-hover/card:rotate-[-6deg]">
                    <Icon className="w-[18px] h-[18px]" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-[var(--stitch-ink)] leading-tight">{copy.t}</h3>
                    <p className="text-sm text-[var(--stitch-muted)] mt-1 leading-relaxed">{copy.d}</p>
                  </div>
                </div>
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--stitch-line)] bg-[var(--stitch-blue-soft)] px-3 py-2 font-mono text-xs text-[var(--stitch-muted)] min-w-0">
                  <span className="text-[var(--stitch-ink)] select-none">$</span>
                  <code className="truncate">{g.cmd}</code>
                </div>
                <ul className="divide-y divide-[var(--stitch-line)]">
                  {g.ids.map((id) => {
                    const page: any = byId.get(id);
                    if (!page) return null;
                    return (
                      <li key={id}>
                        <a
                          href={`/${id}`}
                          onClick={() => track("intent_guide_click", { id, group: g.key })}
                          className="group/link flex items-center justify-between gap-3 py-2.5 text-sm text-[var(--stitch-ink)] rounded-md -mx-2 px-2 transition-colors hover:bg-[var(--stitch-blue-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--stitch-ink)]"
                        >
                          <span className="min-w-0 truncate">{zh ? page.zh.h1 : page.h1}</span>
                          <ArrowUpRight className="w-4 h-4 shrink-0 text-[var(--stitch-muted)] transition-transform duration-200 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 group-hover/link:text-[var(--stitch-ink)]" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default TaskGuides;
