export const INTENT_UPDATED = "2026-09-14";
export const INTENT_PUBLISHED = "2026-09-14";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export const INTENT_LANDINGS = [
  {
    id: "free-static-site-hosting",
    title: "Free Static Website Hosting with CLI & MCP | Demox",
    description: "Free static website hosting for HTML, ZIP, and React/Vue/Vite builds. Deploy with drag-and-drop, CLI, or MCP and get a public HTTPS URL.",
    eyebrow: "Free static hosting",
    h1: "Free static website hosting with CLI and MCP",
    answer:
      "Demox is a free static website hosting platform. Upload one HTML file, a ZIP, or a dist folder with index.html at the root. You get a public HTTPS URL on a CDN. You do not set up a server, a certificate, or Git. The web console is for drag-and-drop. The CLI command is demox deploy ./dist. MCP-compatible agents such as Claude Code and Cursor can publish through npx -y @demox-site/mcp-server@latest. Current public pricing lists every plan as free. Demox does not replace a full CI/CD platform. Python, PHP, Java, and Express listen apps are not a direct fit.",
    steps: [
      "Build or export the site so the root folder contains index.html.",
      "Sign in at www.demox.site, or run demox login.",
      "Upload in the console, run demox deploy ./dist, or ask an MCP agent to deploy.",
      "Open the HTTPS URL in a private window.",
    ],
    faqs: [
      { q: "Is Demox free?", a: "The public pricing page lists Basic, Pro, and Enterprise as free. Support the project with a GitHub star if you want to." },
      { q: "Do I need Git?", a: "No. Drag-and-drop, CLI, and MCP all publish files you already have." },
    ],
    zh: {
      eyebrow: "免费静态托管",
      h1: "免费静态网站发布平台，支持 CLI 和 MCP",
      answer: "把 HTML、ZIP 或 React/Vue/Vite 构建产物上传到 Demox，立刻拿到公网 HTTPS 地址。不需要 Git，也不需要自己配服务器。网页端拖拽，终端用 demox deploy，AI 助手走 MCP。",
    },
  },
  {
    id: "ai-website-deployment",
    title: "AI Website Deployment with CLI and MCP | Demox",
    description: "Deploy AI-generated websites from Claude, Cursor, Codex, or v0. Publish HTML, ZIP, or a frontend build through web, CLI, or MCP.",
    eyebrow: "AI website deployment",
    h1: "Deploy AI-generated websites in seconds",
    answer:
      "Demox publishes websites that an AI coding agent just generated. If the output is one HTML file, upload that file. If the output is a React, Vue, or Vite project, run the production build first, then deploy the dist folder. CLI: npm install -g @demox-site/cli@latest, then demox login and demox deploy ./dist. MCP: npx -y @demox-site/mcp-server@latest inside Claude Code, Cursor, or another MCP client. The agent can read https://www.demox.site/doc and deploy from the local files. Chat-only assistants can write steps; they cannot upload until they have tools.",
    steps: [
      "Ask the agent to produce a static page or a production build.",
      "Confirm index.html is at the root of the folder or ZIP.",
      "Deploy with the web console, demox deploy, or the Demox MCP server.",
      "Share the HTTPS URL. Do not put secrets in frontend files.",
    ],
    faqs: [
      { q: "Can the AI deploy for me?", a: "Yes, if it can read local files and run MCP or CLI tools. Paste https://www.demox.site/doc and ask it to deploy." },
      { q: "Can I upload the source repo?", a: "Usually no. Upload the built dist, a ZIP with index.html at the root, or a single HTML file." },
    ],
    zh: {
      eyebrow: "AI 网站发布",
      h1: "AI 生成网页后，怎样发布成网站？",
      answer: "产物是单个 HTML 就直接上传。React/Vue/Vite 先构建再发 dist。网页、CLI、MCP 都可以。把文档地址发给能读本地文件并执行工具的 AI 即可。",
    },
  },
  {
    id: "mcp-website-deployment",
    title: "MCP Website Deployment for Claude Code and Cursor | Demox",
    description: "Deploy static websites from MCP-compatible AI agents. Install @demox-site/mcp-server and publish HTML, ZIP, or dist folders to a public HTTPS URL.",
    eyebrow: "MCP deploy",
    h1: "Deploy a website from MCP",
    answer:
      "Demox has an MCP server so an AI coding agent can publish a static site without opening a cloud console. Add npx -y @demox-site/mcp-server@latest to the MCP config for Claude Code, Cursor, or another MCP client. Restart the agent. The first deploy opens a browser for OAuth. After that, the agent can upload a folder, ZIP, HTML file, or document. The npm package is @demox-site/mcp-server. This is for static output and Node handlers that export handler(request, env). It is not an Express listen host.",
    steps: [
      "Add the Demox MCP server to the agent config with npx -y @demox-site/mcp-server@latest.",
      "Restart the agent and complete the browser login on first use.",
      "Point the agent at a folder that contains index.html, or at a single HTML file.",
      "Ask it to deploy to Demox and return the public URL.",
    ],
    faqs: [
      { q: "Which agents work?", a: "Any MCP client that can run npx. Claude Code and Cursor are the documented examples." },
      { q: "Do I need an API key in the config?", a: "No environment variable is required. Login happens in the browser on first deploy." },
    ],
    zh: {
      eyebrow: "MCP 发布",
      h1: "用 MCP 把网站发布到公网",
      answer: "在 Claude Code 或 Cursor 里加入 npx -y @demox-site/mcp-server@latest。首次部署会打开浏览器登录。之后 AI 可以直接上传 HTML、ZIP 或 dist。",
    },
  },
  {
    id: "cli-static-site-deploy",
    title: "CLI Static Site Deploy: demox deploy ./dist | Demox",
    description: "Deploy a static site from the terminal with demox deploy ./dist. Install @demox-site/cli, log in, and get a public HTTPS URL.",
    eyebrow: "CLI deploy",
    h1: "Deploy a static site from the CLI",
    answer:
      "The Demox CLI publishes a local folder to a public HTTPS URL. Install with npm install -g @demox-site/cli@latest. Run demox login, then demox deploy ./dist. The folder or ZIP must contain index.html at the root. You can also deploy a single HTML file, a PDF, or a Markdown file. Version 1.1.6 and later include functions, env, and alias commands for Node handlers. The npm package is @demox-site/cli. This path is for terminals and CI. MCP is the path for AI agents.",
    steps: [
      "npm install -g @demox-site/cli@latest",
      "demox login",
      "demox deploy ./dist",
      "Copy the HTTPS URL from the command output.",
    ],
    faqs: [
      { q: "What does demox deploy ./dist do?", a: "It uploads the dist folder and returns a public site URL. Use --id WEBSITE_ID to update an existing site." },
      { q: "Can CI use it?", a: "Yes. Non-interactive runs can use a DEMOX_TOKEN environment variable." },
    ],
    zh: {
      eyebrow: "命令行发布",
      h1: "用 CLI 发布静态网站",
      answer: "安装 @demox-site/cli，登录后执行 demox deploy ./dist。目录根必须有 index.html。也可以发单个 HTML、PDF 或 Markdown。",
    },
  },
  {
    id: "deploy-ai-generated-website",
    title: "Deploy an AI-Generated Website | Demox",
    description: "You already have HTML from an AI. Upload the file or ZIP to Demox and get a public HTTPS link. No Git required.",
    eyebrow: "AI-generated HTML",
    h1: "You have an AI-generated page. How do you publish it?",
    answer:
      "If an AI already wrote an HTML file, you do not need a Git repository to share it. Open www.demox.site, sign in, and upload the .html file. If the page needs local CSS, images, or fonts, put those files next to the HTML, use relative paths, zip the folder, and upload the ZIP with index.html at the root. CLI: demox deploy ./page.html or demox deploy ./folder. MCP agents can do the same after you install @demox-site/mcp-server. Absolute paths such as /Users/... will break in the browser.",
    steps: [
      "Save the AI output as a .html file, or as a folder with index.html.",
      "Replace local disk paths with relative paths.",
      "Upload the file or ZIP, or run demox deploy.",
      "Check the live page in a private window.",
    ],
    faqs: [
      { q: "Why are styles missing?", a: "The HTML still points at a local file. Keep assets in the same folder and use relative paths." },
      { q: "Can I keep the same URL after edits?", a: "Yes. Redeploy to the same site ID." },
    ],
    zh: {
      eyebrow: "AI 已经写好了页面",
      h1: "AI 生成的网页怎么发布？",
      answer: "单个 HTML 直接上传。有 CSS 和图片就把它们和 HTML 放在一起，用相对路径打 ZIP。不需要先建 Git 仓库。",
    },
  },
  {
    id: "claude-code-deploy-website",
    title: "Deploy a Website from Claude Code | Demox",
    description: "Publish a static site from Claude Code with the Demox MCP server. No Git host is required. You get a public HTTPS URL.",
    eyebrow: "Claude Code",
    h1: "Deploy a website from Claude Code",
    answer:
      "Claude Code can publish a Demox site through MCP. Add a server named demox with command npx and args [\"-y\", \"@demox-site/mcp-server@latest\"]. Restart Claude Code. The first deploy opens a browser login. Then ask: read https://www.demox.site/doc, build this project if needed, and deploy the static output to Demox. Do not upload secrets. Claude Code can also install the CLI and run demox deploy ./dist if you prefer the terminal. Node backends must export handler(request, env).",
    steps: [
      "Add @demox-site/mcp-server to Claude Code MCP settings.",
      "Restart Claude Code and complete OAuth on first deploy.",
      "Ask it to deploy the current HTML file or dist folder.",
      "Verify the HTTPS URL it returns.",
    ],
    faqs: [
      { q: "Where is the config file?", a: "Use the Claude Code MCP settings. The command is npx -y @demox-site/mcp-server@latest." },
      { q: "Can it deploy Node APIs?", a: "Only after the backend is rewritten as handler(request, env) and pushed with functions." },
    ],
    zh: {
      eyebrow: "Claude Code",
      h1: "用 Claude Code 发布网站",
      answer: "加上 Demox MCP 后，让 Claude Code 读文档并部署当前 HTML 或 dist。第一次会打开浏览器登录。",
    },
  },
  {
    id: "cursor-deploy-website",
    title: "Deploy a Website from Cursor | Demox",
    description: "Publish HTML or a frontend build from Cursor using the Demox MCP server or the Demox CLI.",
    eyebrow: "Cursor",
    h1: "Deploy a website from Cursor",
    answer:
      "Cursor can deploy to Demox with MCP or with the CLI. For MCP, add npx -y @demox-site/mcp-server@latest and restart Cursor. For CLI, run npm install -g @demox-site/cli@latest, then demox login and demox deploy ./dist. Give Cursor this prompt: read https://www.demox.site/doc, use the local files, and publish a static site. Cursor must be able to read the project and run tools. A chat-only session cannot upload. This is for static output, not for an Express listen server.",
    steps: [
      "Enable the Demox MCP server in Cursor, or install the CLI.",
      "Open the project that already has HTML or a dist folder.",
      "Ask Cursor to deploy with Demox and return the URL.",
      "Open the URL in a private window.",
    ],
    faqs: [
      { q: "MCP or CLI?", a: "MCP if you want Cursor to call tools. CLI if you want to type demox deploy yourself." },
      { q: "Does Cursor need GitHub?", a: "No. Demox publishes local files." },
    ],
    zh: {
      eyebrow: "Cursor",
      h1: "用 Cursor 发布网站",
      answer: "在 Cursor 里接 Demox MCP，或让它执行 demox deploy ./dist。把文档地址发给它，要求用本地文件发布。",
    },
  },
  {
    id: "codex-deploy-website",
    title: "Deploy a Website from Codex | Demox",
    description: "Publish a static site from Codex with the Demox CLI or MCP. Upload HTML, ZIP, or a dist folder and get a public HTTPS URL.",
    eyebrow: "Codex",
    h1: "Deploy a website from Codex",
    answer:
      "Codex can publish to Demox when it can run shell commands or MCP tools. CLI path: npm install -g @demox-site/cli@latest, demox login, demox deploy ./dist. MCP path: npx -y @demox-site/mcp-server@latest. Point Codex at https://www.demox.site/doc and at the local build. If the project is React or Vite, build first. Codex should not upload .env files or source trees with node_modules. The result is a public HTTPS URL, not a GitHub Pages repository.",
    steps: [
      "Install the CLI or configure the MCP server.",
      "Build the project if it is not already static HTML.",
      "Ask Codex to run demox deploy or the MCP deploy tool.",
      "Confirm the live URL loads without local paths.",
    ],
    faqs: [
      { q: "Does Codex need a Demox account?", a: "Yes. The first deploy opens a browser login." },
      { q: "Can it keep updating the same site?", a: "Yes. Pass --id WEBSITE_ID on later deploys." },
    ],
    zh: {
      eyebrow: "Codex",
      h1: "用 Codex 发布网站",
      answer: "让 Codex 安装 CLI 或走 MCP，构建后执行 demox deploy。不要上传密钥和 node_modules。",
    },
  },
  {
    id: "free-html-hosting",
    title: "Free HTML Hosting for a Single Page | Demox",
    description: "Host one HTML file for free. Upload a .html page to Demox and get a public HTTPS URL. No Git, no server.",
    eyebrow: "Single HTML file",
    h1: "Free hosting for a single HTML file",
    answer:
      "Demox can host one HTML file. In the web console, choose the .html file. The CLI command is demox deploy ./index.html. If the page links to CSS, images, or fonts on disk, those links will 404. Put the assets in the same folder, switch to relative paths, and upload a ZIP with index.html at the root instead. This is free on the public pricing page. It is meant for prototypes, AI one-pagers, and review links, not for a multi-service app.",
    steps: [
      "Save the page as a .html file.",
      "Inline assets, or zip the folder with relative paths.",
      "Upload the file or run demox deploy ./page.html.",
      "Share the HTTPS URL.",
    ],
    faqs: [
      { q: "Can I upload page.html that imports ./style.css?", a: "Upload a ZIP that contains both files and names the entry index.html." },
      { q: "Is there a custom domain?", a: "Official subdomains such as name.demox.site are documented in the CLI." },
    ],
    zh: {
      eyebrow: "单个 HTML",
      h1: "免费托管一个 HTML 文件",
      answer: "网页端直接选 .html。有本地 CSS 或图片时，改成相对路径后打 ZIP 上传。",
    },
  },
  {
    id: "deploy-dist-folder",
    title: "Deploy a dist Folder | Demox",
    description: "Publish a dist or build folder with index.html at the root. Run demox deploy ./dist and get a public HTTPS URL.",
    eyebrow: "dist folder",
    h1: "How do you deploy a dist folder?",
    answer:
      "A dist folder is a production static build. Demox hosts it if index.html sits at the root of the upload. Command: demox deploy ./dist. You can zip the folder and drag the ZIP into the web console. MCP agents can deploy the same folder. If index.html is nested in dist/public or dist/client, the upload is not a valid static site and you will see MISSING_ENTRYPOINT or INVALID_STATIC_SITE. Set the bundler base path for static hosting before you build.",
    steps: [
      "Run the project's production build.",
      "Confirm dist/index.html exists.",
      "Run demox deploy ./dist, or zip the folder and upload it.",
      "Open the site and check CSS, JS, and client routes.",
    ],
    faqs: [
      { q: "Can I deploy the repo root?", a: "No. Deploy the build output, not package.json and node_modules." },
      { q: "SPA routes 404 on refresh?", a: "Demox keeps SPA fallback for hosted sites. Unknown document routes on www.demox.site stay real 404s." },
    ],
    zh: {
      eyebrow: "dist 目录",
      h1: "怎样发布 dist 目录？",
      answer: "根目录必须有 index.html。执行 demox deploy ./dist，或把目录打成 ZIP 上传。不要上传源码仓库根目录。",
    },
  },
  {
    id: "deploy-vite-app",
    title: "Deploy a Vite App | Demox",
    description: "Build a Vite app and publish the dist folder to Demox. Use demox deploy ./dist or MCP. No Git host required.",
    eyebrow: "Vite",
    h1: "How do you deploy a Vite app?",
    answer:
      "Vite apps deploy to Demox as static files. Run npm run build. Then demox deploy ./dist. The default Vite outDir is dist. If you changed outDir, deploy that folder instead. Set base to ./ or / so assets load on the hosted origin. Do not upload the Vite source tree. MCP agents can run the build and the deploy. Client-side routing works as a static SPA. Server-side Vite plugins that need Node at request time are not included unless you rewrite them as handler(request, env).",
    steps: [
      "npm run build",
      "Check dist/index.html and hashed assets.",
      "demox deploy ./dist",
      "Reload inner routes in a private window.",
    ],
    faqs: [
      { q: "What about Vite SSR?", a: "Export a static build, or host the server elsewhere. Demox does not run the Vite dev server." },
      { q: "Environment variables?", a: "Only VITE_ public variables belong in the frontend build. Secrets stay in function env." },
    ],
    zh: {
      eyebrow: "Vite",
      h1: "Vite 项目怎么发布？",
      answer: "先 npm run build，再 demox deploy ./dist。资源 base path 按静态托管设置。不要上传源码。",
    },
  },
  {
    id: "deploy-react-build",
    title: "Deploy a React Build | Demox",
    description: "Publish a React production build. Run the build, then demox deploy ./dist or ./build. Get a public HTTPS URL.",
    eyebrow: "React",
    h1: "How do you deploy a React build?",
    answer:
      "React source does not run on Demox. Run the production build, then upload the output folder. Vite React apps usually emit dist. Create React App emits build. Next.js only fits if you have a static export. Command examples: demox deploy ./dist or demox deploy ./build. Homepage, assets, and client-side routes should load from relative or root paths. API keys must not be in the bundle. For a Node API, export handler(request, env) and use demox functions push.",
    steps: [
      "Run the production build for your React toolchain.",
      "Find the folder that contains index.html.",
      "demox deploy that folder.",
      "Test a hard refresh on a nested client route.",
    ],
    faqs: [
      { q: "Can I upload src/?", a: "No. Upload the production build." },
      { q: "Create React App or Vite?", a: "Both work after build. Point demox deploy at dist or build." },
    ],
    zh: {
      eyebrow: "React",
      h1: "React 构建产物怎么发布？",
      answer: "先生产构建。Vite 一般是 dist，CRA 一般是 build。对那个目录执行 demox deploy。源码目录不能直接上。",
    },
  },
  {
    id: "netlify-drop-alternative",
    title: "Netlify Drop Alternative for a Quick Link | Demox",
    description: "Need a public link from a folder without a full Netlify project? Demox publishes HTML, ZIP, and dist folders through web, CLI, or MCP.",
    eyebrow: "Netlify Drop alternative",
    h1: "When is Demox an alternative to Netlify Drop?",
    answer:
      "Netlify Drop is a way to drag a folder onto the web and get a URL. Demox covers that job for HTML, ZIP, and dist folders, and it also has CLI and MCP so an AI agent can deploy. Demox is not a full Netlify replacement. It does not claim Netlify's identity, Git integration, or platform-wide CI. Use Demox when you already have static files and need a link now. Keep Netlify when you want that complete product. Python and Express listen apps still need another host.",
    steps: [
      "If you only have a folder of static files, upload it to Demox or run demox deploy.",
      "If an AI agent should deploy, use the MCP server.",
      "If you need Netlify's full CI and identity stack, stay on Netlify.",
      "Read /when-to-use-demox before migrating an existing app.",
    ],
    faqs: [
      { q: "Is this a drop-in Netlify clone?", a: "No. It is a fast public link for static files and small Node handlers." },
      { q: "Can I drag a ZIP?", a: "Yes. The ZIP root must contain index.html." },
    ],
    zh: {
      eyebrow: "Netlify Drop 替代",
      h1: "什么时候用 Demox 代替拖拽发布？",
      answer: "手里已经有静态目录、只想马上发链接时，可以用 Demox。它不是完整 Netlify。Git 集成和整套 CI 请留在原平台。",
    },
  },
  {
    id: "surge-alternative",
    title: "Surge.sh Alternative for Static Deploys | Demox",
    description: "Publish static sites with a CLI the way Surge does, plus a web console and MCP. Demox is not a full Surge replacement.",
    eyebrow: "Surge alternative",
    h1: "When is Demox an alternative to Surge?",
    answer:
      "Surge is a CLI that publishes a folder to a static host. Demox has the same job through demox deploy ./dist, and it also has a web console and MCP. That is useful when an AI coding agent should deploy. Demox is not Surge. Command names, domains, and account systems are different. Use Demox when you want drag-and-drop, CLI, and MCP on one account. Stay on Surge if that CLI already fits your workflow. Neither product is a general backend platform.",
    steps: [
      "Install @demox-site/cli.",
      "demox login",
      "demox deploy ./dist",
      "Compare with /when-to-use-demox if the project is not static.",
    ],
    faqs: [
      { q: "Is the command surge?", a: "No. The command is demox deploy." },
      { q: "Does MCP exist on Surge?", a: "Demox documents MCP for Claude Code and Cursor. That is the difference this page is about." },
    ],
    zh: {
      eyebrow: "Surge 替代",
      h1: "什么时候用 Demox 代替 Surge？",
      answer: "需要 CLI 发静态目录，同时又要网页拖拽和 MCP 时，可以用 Demox。命令不是 surge，而是 demox deploy。",
    },
  },
  {
    id: "vercel-alternative-for-static-sites",
    title: "Vercel Alternative for Static Sites | Demox",
    description: "Need a public URL for a static build without a full Vercel project? Demox publishes dist folders, HTML, and ZIP files through web, CLI, or MCP.",
    eyebrow: "Static-site alternative",
    h1: "When is Demox an alternative to Vercel for static sites?",
    answer:
      "Vercel is a full deployment platform. Demox is not a Vercel replacement. Demox is for a static build, an HTML file, or a ZIP that you want to share now, including from CLI and MCP. There is no claim about matching Vercel serverless, Git previews, or the Vercel marketplace. If the app needs Next.js server rendering without a static export, keep a platform that runs that runtime. If you only have dist/ and need an HTTPS link, demox deploy ./dist is enough.",
    steps: [
      "Static export or Vite/React production build first.",
      "Deploy the folder with Demox.",
      "Keep Vercel or similar if you need that full platform.",
      "Read /when-to-use-demox for the not-a-fit list.",
    ],
    faqs: [
      { q: "Can Demox replace Vercel?", a: "No. The product facts and docs say it is for a link you can open now, plus small Node handlers." },
      { q: "What about Next.js?", a: "Only a static export. App Router server features need another host." },
    ],
    zh: {
      eyebrow: "静态站场景",
      h1: "静态站什么时候用 Demox 而不是完整云平台？",
      answer: "只有 dist 或 HTML、需要马上发链接、并且希望 CLI/MCP 也能发时，用 Demox。它不是 Vercel 替代品。需要 SSR 就留在能跑该运行时的平台。",
    },
  },
];

export function renderIntentFallback(page) {
  const steps = page.steps.map((step, index) => `<li><strong>Step ${index + 1}.</strong> ${escapeHtml(step)}</li>`).join("");
  const faqs = page.faqs.map((item) => `<h3>${escapeHtml(item.q)}</h3><p>${escapeHtml(item.a)}</p>`).join("");
  const related = INTENT_LANDINGS.filter((item) => item.id !== page.id)
    .slice(0, 6)
    .map((item) => `<li><a href="/${item.id}">${escapeHtml(item.h1)}</a></li>`)
    .join("");
  return `<main data-crawlable-fallback class="fallback-simple" lang="en"><article><p>${escapeHtml(page.eyebrow)} · Updated ${INTENT_UPDATED} · Demox team</p><h1>${escapeHtml(page.h1)}</h1><p><strong>Direct answer:</strong> ${escapeHtml(page.answer)}</p><h2>How to do it</h2><ol>${steps}</ol><h2>FAQ</h2>${faqs}<section lang="zh-CN"><h2>${escapeHtml(page.zh.h1)}</h2><p>${escapeHtml(page.zh.answer)}</p></section><h2>Related Demox pages</h2><ul>${related}<li><a href="/doc">CLI and MCP docs</a></li><li><a href="/when-to-use-demox">When to use Demox</a></li></ul><p><a href="/console/projects">Upload and publish</a> · <a href="/doc">Read the docs</a></p></article></main>`;
}

export function intentPublicPages() {
  return Object.fromEntries(
    INTENT_LANDINGS.map((page) => [
      page.id,
      {
        title: page.title,
        description: page.description,
        article: {
          datePublished: INTENT_PUBLISHED,
          dateModified: INTENT_UPDATED,
          inLanguage: "en",
        },
        howTo: {
          name: page.h1,
          description: page.description,
          steps: page.steps,
        },
        fallback: renderIntentFallback(page),
      },
    ]),
  );
}
