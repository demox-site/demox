import React, { useEffect, useRef, useState } from "react";
import { MainLayout } from "@/layouts/MainLayout";
import { Seo } from "@/components/Seo";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/hooks/use-language";
import {
  Terminal,
  Bot,
  Copy,
  CheckCircle,
  KeyRound,
  FileArchive,
  HelpCircle,
  Rocket,
  ChevronRight,
  Sparkles,
} from "lucide-react";

/** 文档章节 id（用于侧边栏锚点与滚动高亮）。 */
type SectionId =
  | "start"
  | "mcp"
  | "cli"
  | "auth"
  | "files"
  | "faq";

const t = {
  zh: {
    seoTitle: "文档 - 接入 Demox（MCP & CLI）",
    pageTitle: "Demox 文档",
    pageSubtitle: "两种方式把网站部署接入你的工作流：AI 助手用 MCP，终端用 CLI。",
    onThisPage: "本页目录",
    copy: "复制",
    copied: "已复制",
    skill: {
      title: "用 Agent Skill 一键接入",
      desc: "把下面的仓库地址甩给你的 AI（Claude Code、Cursor 等），它就学会用 demox CLI 帮你部署网站了。",
      open: "查看仓库",
    },
    nav: {
      start: "快速开始",
      mcp: "通过 MCP 接入",
      cli: "通过 CLI 使用",
      auth: "认证与凭证",
      files: "文件与限制",
      faq: "常见问题",
    },
  },
  en: {
    seoTitle: "Docs - Connect to Demox (MCP & CLI)",
    pageTitle: "Demox Docs",
    pageSubtitle:
      "Two ways to bring deployment into your workflow: MCP for AI assistants, CLI for the terminal.",
    onThisPage: "On this page",
    copy: "Copy",
    copied: "Copied",
    skill: {
      title: "Connect with an Agent Skill",
      desc: "Hand the repo URL below to your AI (Claude Code, Cursor, etc.) and it learns to deploy your sites with the demox CLI.",
      open: "View repo",
    },
    nav: {
      start: "Quick Start",
      mcp: "Via MCP",
      cli: "Via CLI",
      auth: "Auth & Credentials",
      files: "Files & Limits",
      faq: "FAQ",
    },
  },
} as const;

const SECTIONS: { id: SectionId; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: "start", icon: Rocket },
  { id: "mcp", icon: Bot },
  { id: "cli", icon: Terminal },
  { id: "auth", icon: KeyRound },
  { id: "files", icon: FileArchive },
  { id: "faq", icon: HelpCircle },
];

/** 带「复制」按钮的代码块，亮/暗主题自适应。 */
const CodeBlock: React.FC<{ code: string; lang?: string; copyLabel: string; copiedLabel: string }> = ({
  code,
  lang,
  copyLabel,
  copiedLabel,
}) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="relative group">
      {lang && (
        <span className="absolute top-3 left-4 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
          {lang}
        </span>
      )}
      <pre className="bg-zinc-900 text-zinc-200 border border-zinc-800 rounded-lg overflow-x-auto text-sm font-mono p-4 pt-8">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-1 rounded text-xs bg-zinc-100 text-zinc-900 hover:bg-white transition-colors"
      >
        {copied ? <CheckCircle size={12} /> : <Copy size={12} />}
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  );
};

/** 内联 URL 行：等宽显示 + 右侧行内复制按钮，比 CodeBlock 更紧凑。 */
const InlineCopy: React.FC<{ value: string; copyLabel: string; copiedLabel: string }> = ({
  value,
  copyLabel,
  copiedLabel,
}) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 pl-4 pr-2 py-2">
      <code className="flex-1 min-w-0 truncate text-sm font-mono text-zinc-200">{value}</code>
      <button
        type="button"
        onClick={copy}
        className="flex items-center gap-1 shrink-0 px-2.5 py-1.5 rounded-md text-xs bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
      >
        {copied ? <CheckCircle size={13} /> : <Copy size={13} />}
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  );
};

/** 章节容器：统一标题样式 + 滚动锚点。 */
const Section: React.FC<{
  id: SectionId;
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  refCb: (el: HTMLElement | null) => void;
  children: React.ReactNode;
}> = ({ id, title, icon: Icon, refCb, children }) => (
  <section
    id={`doc-${id}`}
    ref={refCb}
    className="scroll-mt-24 border-b border-zinc-900 pb-12 mb-12 last:border-0"
  >
    <h2 className="flex items-center gap-2.5 text-2xl font-bold text-zinc-100 mb-6">
      <Icon className="text-zinc-400" size={22} />
      {title}
    </h2>
    {children}
  </section>
);

export const Docs: React.FC = () => {
  const { language: lang } = useLanguage();
  const tr = t[lang];
  const isZh = lang === "zh";
  const [active, setActive] = useState<SectionId>("start");
  const sectionEls = useRef<Map<SectionId, HTMLElement>>(new Map());

  // 滚动高亮：当前视口顶部所在章节高亮侧边栏。
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          const id = (visible[0].target as HTMLElement).id.replace("doc-", "") as SectionId;
          setActive(id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );
    sectionEls.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [lang]);

  const goTo = (id: SectionId) => {
    sectionEls.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const copyProps = { copyLabel: tr.copy, copiedLabel: tr.copied };

  return (
    <MainLayout>
      <Seo title={tr.seoTitle} />
      <div className="relative z-10">
        {/* 标题 */}
        <div className="mb-10">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-zinc-100 mb-3">
            {tr.pageTitle}
          </h1>
          <p className="text-zinc-400 max-w-2xl leading-relaxed">{tr.pageSubtitle}</p>
        </div>

        {/* Agent Skill 高亮块 */}
        <div className="mb-12 rounded-xl border border-zinc-700/80 bg-gradient-to-br from-zinc-900 to-zinc-900/30 p-6 sm:p-7">
          <div className="flex items-center gap-2.5 mb-2">
            <Sparkles className="text-zinc-200 shrink-0" size={20} />
            <h2 className="text-lg font-bold text-zinc-100">{tr.skill.title}</h2>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed mb-5 max-w-2xl">{tr.skill.desc}</p>
          <div className="flex flex-col sm:flex-row sm:items-stretch gap-3">
            <div className="flex-1 min-w-0">
              <InlineCopy
                value="https://github.com/demox-site/skill"
                {...copyProps}
              />
            </div>
            <a
              href="https://github.com/demox-site/skill"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 px-5 rounded-lg text-sm font-medium bg-zinc-100 text-zinc-900 hover:bg-white transition-colors whitespace-nowrap shrink-0 py-2.5 sm:py-0"
            >
              {tr.skill.open}
              <ChevronRight size={15} />
            </a>
          </div>
        </div>

        <div className="flex gap-10">
          {/* 侧边栏（桌面端固定） */}
          <aside className="hidden lg:block w-56 shrink-0">
            <nav className="sticky top-24 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 px-3">
                {tr.onThisPage}
              </p>
              {SECTIONS.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => goTo(id)}
                  className={`flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    active === id
                      ? "bg-zinc-100 text-zinc-900 font-medium"
                      : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
                  }`}
                >
                  <Icon size={16} />
                  {tr.nav[id]}
                </button>
              ))}
            </nav>
          </aside>

          {/* 移动端横向章节条 */}
          <div className="lg:hidden -mx-4 px-4 mb-6 overflow-x-auto sticky top-16 z-20 bg-black/80 backdrop-blur-md py-3 border-b border-zinc-900">
            <div className="flex gap-2 w-max">
              {SECTIONS.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => goTo(id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors ${
                    active === id
                      ? "bg-zinc-100 text-zinc-900 font-medium"
                      : "text-zinc-400 bg-zinc-900 hover:text-zinc-100"
                  }`}
                >
                  <Icon size={13} />
                  {tr.nav[id]}
                </button>
              ))}
            </div>
          </div>

          {/* 文档主体 */}
          <div className="flex-1 min-w-0 max-w-3xl">
            {(() => {
              const reg = (id: SectionId) => (el: HTMLElement | null) => {
                if (el) sectionEls.current.set(id, el);
                else sectionEls.current.delete(id);
              };
              return (
                <>
                  {/* 快速开始 */}
                  <Section id="start" title={tr.nav.start} icon={Rocket} refCb={reg("start")}>
                    <p className="text-zinc-400 leading-relaxed mb-6">
                      {isZh
                        ? "Demox 提供两种接入方式，共用同一套账号与部署能力，选择最适合你的："
                        : "Demox offers two ways to connect, sharing the same account and deployment capabilities. Pick what fits you:"}
                    </p>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <button
                        type="button"
                        onClick={() => goTo("mcp")}
                        className="text-left p-5 rounded-lg border border-zinc-800 bg-zinc-900/50 hover:border-zinc-600 transition-colors group"
                      >
                        <Bot className="text-zinc-300 mb-3" size={24} />
                        <h3 className="font-semibold text-zinc-100 mb-1 flex items-center gap-1">
                          {tr.nav.mcp}
                          <ChevronRight size={15} className="text-zinc-500 group-hover:translate-x-0.5 transition-transform" />
                        </h3>
                        <p className="text-sm text-zinc-400">
                          {isZh
                            ? "在 Claude、Cursor 等 AI 工具里用自然语言部署。"
                            : "Deploy from AI tools like Claude or Cursor with natural language."}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => goTo("cli")}
                        className="text-left p-5 rounded-lg border border-zinc-800 bg-zinc-900/50 hover:border-zinc-600 transition-colors group"
                      >
                        <Terminal className="text-zinc-300 mb-3" size={24} />
                        <h3 className="font-semibold text-zinc-100 mb-1 flex items-center gap-1">
                          {tr.nav.cli}
                          <ChevronRight size={15} className="text-zinc-500 group-hover:translate-x-0.5 transition-transform" />
                        </h3>
                        <p className="text-sm text-zinc-400">
                          {isZh
                            ? "一条命令把目录或 ZIP 部署到全球 CDN。"
                            : "One command to ship a folder or ZIP to the global CDN."}
                        </p>
                      </button>
                    </div>
                  </Section>

                  {/* 通过 MCP 接入 */}
                  <Section id="mcp" title={tr.nav.mcp} icon={Bot} refCb={reg("mcp")}>
                    <p className="text-zinc-400 leading-relaxed mb-6">
                      {isZh
                        ? "把下面的配置加入你的 AI 工具配置文件，重启工具即可。首次调用部署工具时会自动打开浏览器登录。"
                        : "Add the config below to your AI tool's config file and restart it. The first deploy call opens a browser login automatically."}
                    </p>
                    <CodeBlock
                      lang="json"
                      code={`{
  "mcpServers": {
    "demox": {
      "command": "npx",
      "args": ["-y", "github:demox-site/mcp-server#main"]
    }
  }
}`}
                      {...copyProps}
                    />
                    <h3 className="font-semibold text-zinc-200 mt-8 mb-3">
                      {isZh ? "配置文件位置" : "Config file location"}
                    </h3>
                    <div className="space-y-2">
                      {[
                        ["Claude Desktop / Code", "~/Library/Application Support/Claude/claude_desktop_config.json"],
                        ["Cursor", "~/.cursor/mcp.json"],
                        ["Cline (VS Code)", "~/.cline/mcp.json"],
                        ["Continue (VS Code)", "~/.continue/mcp.json"],
                      ].map(([name, path]) => (
                        <div
                          key={name}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 p-3 rounded border border-zinc-800 bg-zinc-900/50"
                        >
                          <span className="text-sm font-medium text-zinc-300">{name}</span>
                          <code className="text-xs font-mono text-zinc-500 break-all">{path}</code>
                        </div>
                      ))}
                    </div>
                    <h3 className="font-semibold text-zinc-200 mt-8 mb-3">
                      {isZh ? "示例对话" : "Example prompt"}
                    </h3>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
                      <p className="text-zinc-200 font-mono text-sm">
                        {isZh
                          ? "“把我的 ./dist 目录部署到 Demox”"
                          : '"Deploy my ./dist folder to Demox"'}
                      </p>
                      <div className="text-sm text-zinc-400 space-y-1 border-t border-zinc-800 pt-3">
                        <p className="text-zinc-500">{isZh ? "AI 助手：" : "Assistant:"}</p>
                        <p>{isZh ? "[正在打包 ./dist…] ✅ 部署成功！" : "[Packing ./dist…] ✅ Deployed!"}</p>
                        <p className="text-zinc-300">https://xyz67890.demox.site</p>
                      </div>
                    </div>
                  </Section>

                  {/* 通过 CLI 使用 */}
                  <Section id="cli" title={tr.nav.cli} icon={Terminal} refCb={reg("cli")}>
                    <h3 className="font-semibold text-zinc-200 mb-3">
                      {isZh ? "1. 安装" : "1. Install"}
                    </h3>
                    <CodeBlock
                      lang="bash"
                      code={`# 全局安装\nnpm install -g github:demox-site/cli#main\n\n# 或免安装直接用\nnpx github:demox-site/cli#main --help`}
                      {...copyProps}
                    />
                    <h3 className="font-semibold text-zinc-200 mt-8 mb-3">
                      {isZh ? "2. 登录" : "2. Log in"}
                    </h3>
                    <p className="text-zinc-400 text-sm mb-3">
                      {isZh ? "打开浏览器完成 OAuth 授权。" : "Opens a browser for OAuth authorization."}
                    </p>
                    <CodeBlock lang="bash" code="demox login" {...copyProps} />
                    <h3 className="font-semibold text-zinc-200 mt-8 mb-3">
                      {isZh ? "3. 部署" : "3. Deploy"}
                    </h3>
                    <CodeBlock
                      lang="bash"
                      code={`# 部署目录、ZIP、PDF 或文档\ndemox deploy ./dist\ndemox deploy ./website.zip\ndemox deploy ./document.pdf\ndemox deploy ./notes.md --template warm\n\n# 指定名称 / 更新现有网站\ndemox deploy ./dist --name my-site\ndemox deploy ./dist --id WEBSITE_ID\n\n# 自定义子域名\ndemox domain set WEBSITE_ID my-demo\ndemox domain clear WEBSITE_ID`}
                      {...copyProps}
                    />
                    <h3 className="font-semibold text-zinc-200 mt-8 mb-3">
                      {isZh ? "命令参考" : "Command reference"}
                    </h3>
                    <div className="rounded-lg border border-zinc-800 overflow-hidden">
                      {[
                        ["demox login", isZh ? "登录到 Demox" : "Log in to Demox"],
                        ["demox logout", isZh ? "登出并删除本地 Token" : "Log out and remove local token"],
                        ["demox status", isZh ? "查看登录状态" : "Show login status"],
                        ["demox deploy <path>", isZh ? "部署目录、ZIP、PDF 或文档" : "Deploy folder, ZIP, PDF, or docs"],
                        ["demox domain set <id> <subdomain>", isZh ? "设置自定义子域名" : "Set custom subdomain"],
                        ["demox domain clear <id>", isZh ? "清除自定义子域名" : "Clear custom subdomain"],
                        ["demox list / ls", isZh ? "列出所有网站" : "List all sites"],
                        ["demox info <id>", isZh ? "查看网站详情" : "Show site details"],
                        ["demox delete <id> / rm", isZh ? "删除网站" : "Delete a site"],
                      ].map(([cmd, desc], i) => (
                        <div
                          key={cmd}
                          className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-4 py-2.5 ${
                            i % 2 ? "bg-zinc-900/30" : "bg-zinc-900/60"
                          }`}
                        >
                          <code className="text-xs font-mono text-zinc-200">{cmd}</code>
                          <span className="text-xs text-zinc-500">{desc}</span>
                        </div>
                      ))}
                    </div>
                  </Section>

                  {/* 认证与凭证（MCP / CLI 共享） */}
                  <Section id="auth" title={tr.nav.auth} icon={KeyRound} refCb={reg("auth")}>
                    <p className="text-zinc-400 leading-relaxed mb-6">
                      {isZh
                        ? "MCP 与 CLI 共用同一套 OAuth 登录，登录后凭证保存在本地。"
                        : "MCP and CLI share the same OAuth login. Credentials are stored locally after login."}
                    </p>
                    <div className="grid sm:grid-cols-2 gap-4 mb-6">
                      <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/50">
                        <h4 className="font-semibold text-zinc-200 mb-2 text-sm">
                          {isZh ? "Token 有效期" : "Token lifetime"}
                        </h4>
                        <ul className="text-sm text-zinc-400 space-y-1">
                          <li>• Access Token: {isZh ? "5 分钟" : "5 minutes"}</li>
                          <li>• Refresh Token: {isZh ? "30 天" : "30 days"}</li>
                        </ul>
                      </div>
                      <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/50">
                        <h4 className="font-semibold text-zinc-200 mb-2 text-sm">
                          {isZh ? "自动续期" : "Auto refresh"}
                        </h4>
                        <p className="text-sm text-zinc-400">
                          {isZh
                            ? "Token 过期时自动打开浏览器重新登录，无需手动操作。"
                            : "On expiry, a browser login opens automatically — no manual steps."}
                        </p>
                      </div>
                    </div>
                    <h3 className="font-semibold text-zinc-200 mb-3">
                      {isZh ? "凭证位置 / 撤销授权" : "Credential location / revoke"}
                    </h3>
                    <p className="text-zinc-400 text-sm mb-3">
                      {isZh ? "凭证保存在 " : "Credentials are stored at "}
                      <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-300 text-xs">
                        ~/.demox/token.json
                      </code>
                      {isZh ? "。删除该文件即可撤销授权：" : ". Delete it to revoke access:"}
                    </p>
                    <CodeBlock lang="bash" code="rm ~/.demox/token.json" {...copyProps} />
                  </Section>

                  {/* 文件与限制（共享） */}
                  <Section id="files" title={tr.nav.files} icon={FileArchive} refCb={reg("files")}>
                    <h3 className="font-semibold text-zinc-200 mb-3">
                      {isZh ? "支持的输入" : "Supported input"}
                    </h3>
                    <ul className="space-y-2 mb-6">
                      {[
                        isZh ? "本地目录（自动打包为 ZIP）" : "Local folder (auto-zipped)",
                        isZh ? "本地 ZIP 文件" : "Local ZIP file",
                        isZh ? "PDF（自动生成预览页）" : "PDF (viewer page generated)",
                        isZh ? "Markdown / TXT / DOCX 文档（自动套模板）" : "Markdown / TXT / DOCX docs (templated)",
                        isZh ? "HTTPS URL（指向 .zip）" : "HTTPS URL (to a .zip)",
                      ].map((item) => (
                        <li key={item} className="flex items-center gap-2.5 text-sm text-zinc-400">
                          <CheckCircle size={15} className="text-zinc-300 shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-3">
                      <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                        MCP {isZh ? "上限" : "max"}: 8MB
                      </Badge>
                      <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                        CLI {isZh ? "上限" : "max"}: 8MB
                      </Badge>
                    </div>
                    <p className="text-xs text-zinc-500 mt-3">
                      {isZh
                        ? "当前 CLI 与 MCP 通过 SCF 请求体上传，超过 8MB 请先压缩或拆分。"
                        : "CLI and MCP currently upload through SCF request bodies; compress or split files over 8MB."}
                    </p>
                  </Section>

                  {/* 常见问题（共享） */}
                  <Section id="faq" title={tr.nav.faq} icon={HelpCircle} refCb={reg("faq")}>
                    <div className="space-y-6">
                      {[
                        [
                          isZh ? "MCP 和 CLI 有什么区别？" : "MCP vs CLI?",
                          isZh
                            ? "两者用同一套账号和部署能力。MCP 让 AI 助手用自然语言部署；CLI 在终端里用命令操作，适合脚本与 CI。"
                            : "Same account and capabilities. MCP lets AI assistants deploy via natural language; CLI runs in the terminal, good for scripts and CI.",
                        ],
                        [
                          isZh ? "Token 过期怎么办？" : "What if my token expires?",
                          isZh
                            ? "系统会自动打开浏览器重新登录，并自动重试失败的调用，无需手动操作。"
                            : "A browser login opens automatically and the failed call is retried — no manual steps.",
                        ],
                        [
                          isZh ? "支持哪些 AI 工具？" : "Which AI tools are supported?",
                          isZh
                            ? "Claude Desktop / Claude Code、Cursor、Cline、Continue 等主流支持 MCP 的工具。"
                            : "Claude Desktop / Code, Cursor, Cline, Continue, and other MCP-capable tools.",
                        ],
                        [
                          isZh ? "如何撤销授权？" : "How do I revoke access?",
                          isZh
                            ? "删除 ~/.demox/token.json，下次使用时会重新登录。"
                            : "Delete ~/.demox/token.json; you'll be prompted to log in again next time.",
                        ],
                      ].map(([q, a]) => (
                        <div key={q}>
                          <h3 className="font-semibold text-zinc-200 mb-2 flex items-center gap-2">
                            <HelpCircle size={16} className="text-zinc-400 shrink-0" />
                            {q}
                          </h3>
                          <p className="text-sm text-zinc-400 leading-relaxed pl-6">{a}</p>
                        </div>
                      ))}
                    </div>
                  </Section>
                </>
              );
            })()}
          </div>
        </div>

        {/* 网格背景装饰 */}
        <div className="fixed inset-0 bg-[linear-gradient(to_right,var(--grid-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--grid-line)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] -z-10 pointer-events-none" />
      </div>
    </MainLayout>
  );
};
