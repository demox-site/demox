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
      title: "免费静态网站托管，支持 CLI 和 MCP | Demox",
      description: "免费托管 HTML、ZIP、React/Vue/Vite 构建产物。网页拖拽、CLI 或 MCP 发布后得到公网 HTTPS 地址。",
      eyebrow: "免费静态托管",
      h1: "免费静态网站发布平台，支持 CLI 和 MCP",
      answer: "把 HTML、ZIP 或 React/Vue/Vite 构建产物上传到 Demox，立刻拿到公网 HTTPS 地址。不需要 Git，也不需要自己配服务器。网页端拖拽，终端用 demox deploy，AI 助手走 MCP。",
      steps: [
        "先把站点导出或构建成根目录含 index.html 的静态产物。",
        "在 www.demox.site 登录，或执行 demox login。",
        "网页端上传，或 demox deploy ./dist，或让 MCP 助手发布。",
        "用无痕窗口打开得到的 HTTPS 地址。",
      ],
      faqs: [
        { q: "Demox 免费吗？", a: "公开价格页里基础版、专业版、尊贵土豪版都是免费。愿意的话可以给 GitHub 仓库点 star。" },
        { q: "必须用 Git 吗？", a: "不用。拖拽、CLI、MCP 都是发布你已经有的文件。" },
      ],
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
      title: "用 CLI 和 MCP 发布 AI 生成的网站 | Demox",
      description: "把 Claude、Cursor、Codex 或 v0 生成的 HTML、ZIP 或前端构建产物发布成公网网站。",
      eyebrow: "AI 网站发布",
      h1: "AI 生成网页后，怎样发布成网站？",
      answer: "产物是单个 HTML 就直接上传。React/Vue/Vite 先构建再发 dist。网页、CLI、MCP 都可以。把文档地址发给能读本地文件并执行工具的 AI 即可。",
      steps: [
        "让 AI 生成静态页面，或先跑生产构建。",
        "确认文件夹或 ZIP 根目录有 index.html。",
        "用网页端、demox deploy 或 Demox MCP 发布。",
        "分享 HTTPS 地址。不要把密钥写进前端文件。",
      ],
      faqs: [
        { q: "AI 能替我发布吗？", a: "可以，前提是它能读本地文件并执行 MCP 或 CLI。把 https://www.demox.site/doc 发给它，要求部署。" },
        { q: "源码仓库能直接上传吗？", a: "通常不行。上传构建后的 dist、根目录含 index.html 的 ZIP，或单个 HTML。" },
      ],
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
      title: "用 MCP 从 Claude Code / Cursor 发布网站 | Demox",
      description: "给 MCP 兼容的 AI 助手安装 @demox-site/mcp-server，把 HTML、ZIP 或 dist 发布成公网 HTTPS 地址。",
      eyebrow: "MCP 发布",
      h1: "用 MCP 把网站发布到公网",
      answer: "在 Claude Code 或 Cursor 里加入 npx -y @demox-site/mcp-server@latest。首次部署会打开浏览器登录。之后 AI 可以直接上传 HTML、ZIP 或 dist。",
      steps: [
        "在助手配置里加入 npx -y @demox-site/mcp-server@latest。",
        "重启助手，第一次发布时完成浏览器登录。",
        "把含 index.html 的目录或单个 HTML 交给它。",
        "让它发布到 Demox 并返回公开地址。",
      ],
      faqs: [
        { q: "哪些助手能用？", a: "能跑 npx 的 MCP 客户端都可以。文档里的例子是 Claude Code 和 Cursor。" },
        { q: "配置里要写 API key 吗？", a: "不用环境变量。第一次发布会在浏览器登录。" },
      ],
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
      title: "用 CLI 发布静态网站：demox deploy ./dist | Demox",
      description: "安装 @demox-site/cli，登录后执行 demox deploy ./dist，把本地目录发布成公网 HTTPS 地址。",
      eyebrow: "命令行发布",
      h1: "用 CLI 发布静态网站",
      answer: "安装 @demox-site/cli，登录后执行 demox deploy ./dist。目录根必须有 index.html。也可以发单个 HTML、PDF 或 Markdown。",
      steps: [
        "npm install -g @demox-site/cli@latest",
        "demox login",
        "demox deploy ./dist",
        "从命令输出复制 HTTPS 地址。",
      ],
      faqs: [
        { q: "demox deploy ./dist 做什么？", a: "上传 dist 目录并返回公开站点地址。更新已有站点时加 --id WEBSITE_ID。" },
        { q: "CI 能用吗？", a: "可以。非交互环境用 DEMOX_TOKEN 环境变量。" },
      ],
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
      title: "发布 AI 已经生成的网页 | Demox",
      description: "手里已经有 AI 写的 HTML。上传文件或 ZIP 到 Demox，拿到公网 HTTPS 链接。不需要 Git。",
      eyebrow: "AI 已经写好了页面",
      h1: "AI 生成的网页怎么发布？",
      answer: "单个 HTML 直接上传。有 CSS 和图片就把它们和 HTML 放在一起，用相对路径打 ZIP。不需要先建 Git 仓库。",
      steps: [
        "把 AI 产物存成 .html，或存成根目录含 index.html 的文件夹。",
        "把本机磁盘路径改成相对路径。",
        "上传文件或 ZIP，或执行 demox deploy。",
        "用无痕窗口检查线上页面。",
      ],
      faqs: [
        { q: "为什么样式丢了？", a: "HTML 还在指向本机文件。资源放在同一目录，使用相对路径。" },
        { q: "改完还能用同一个地址吗？", a: "可以。对同一个站点 ID 重新发布。" },
      ],
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
      title: "用 Claude Code 发布网站 | Demox",
      description: "通过 Demox MCP，从 Claude Code 发布静态网站。不需要 Git 托管，直接拿到公网 HTTPS 地址。",
      eyebrow: "Claude Code",
      h1: "用 Claude Code 发布网站",
      answer: "加上 Demox MCP 后，让 Claude Code 读文档并部署当前 HTML 或 dist。第一次会打开浏览器登录。",
      steps: [
        "在 Claude Code 的 MCP 设置里加入 @demox-site/mcp-server。",
        "重启 Claude Code，第一次发布时完成登录。",
        "让它部署当前 HTML 文件或 dist 目录。",
        "核对它返回的 HTTPS 地址。",
      ],
      faqs: [
        { q: "配置文件在哪？", a: "用 Claude Code 的 MCP 设置。命令是 npx -y @demox-site/mcp-server@latest。" },
        { q: "能发 Node 接口吗？", a: "只有把后端改成 handler(request, env) 并用 functions 推送之后才可以。" },
      ],
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
      title: "用 Cursor 发布网站 | Demox",
      description: "在 Cursor 里用 Demox MCP 或 CLI 发布 HTML 或前端构建产物。",
      eyebrow: "Cursor",
      h1: "用 Cursor 发布网站",
      answer: "在 Cursor 里接 Demox MCP，或让它执行 demox deploy ./dist。把文档地址发给它，要求用本地文件发布。",
      steps: [
        "在 Cursor 启用 Demox MCP，或安装 CLI。",
        "打开已经有 HTML 或 dist 的项目。",
        "让 Cursor 用 Demox 发布并返回地址。",
        "用无痕窗口打开该地址。",
      ],
      faqs: [
        { q: "用 MCP 还是 CLI？", a: "想让 Cursor 调工具就用 MCP。想自己敲命令就用 demox deploy。" },
        { q: "Cursor 需要 GitHub 吗？", a: "不需要。Demox 发布的是本地文件。" },
      ],
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
      title: "用 Codex 发布网站 | Demox",
      description: "用 Demox CLI 或 MCP 从 Codex 发布静态网站。上传 HTML、ZIP 或 dist，拿到公网 HTTPS 地址。",
      eyebrow: "Codex",
      h1: "用 Codex 发布网站",
      answer: "让 Codex 安装 CLI 或走 MCP，构建后执行 demox deploy。不要上传密钥和 node_modules。",
      steps: [
        "安装 CLI，或配置 MCP。",
        "如果还不是静态 HTML，先构建项目。",
        "让 Codex 执行 demox deploy 或 MCP 发布。",
        "确认线上地址不再依赖本机路径。",
      ],
      faqs: [
        { q: "Codex 需要 Demox 账号吗？", a: "需要。第一次发布会打开浏览器登录。" },
        { q: "能反复更新同一个站点吗？", a: "可以。之后发布加上 --id WEBSITE_ID。" },
      ],
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
      title: "免费托管单个 HTML 页面 | Demox",
      description: "免费托管一个 HTML 文件。上传 .html 到 Demox，得到公网 HTTPS 地址。不需要 Git，也不需要服务器。",
      eyebrow: "单个 HTML",
      h1: "免费托管一个 HTML 文件",
      answer: "网页端直接选 .html。有本地 CSS 或图片时，改成相对路径后打 ZIP 上传。",
      steps: [
        "把页面存成 .html 文件。",
        "资源内联，或按相对路径打 ZIP。",
        "上传文件，或执行 demox deploy ./page.html。",
        "分享 HTTPS 地址。",
      ],
      faqs: [
        { q: "page.html 引用了 ./style.css 怎么办？", a: "把两个文件打进同一个 ZIP，入口文件名为 index.html。" },
        { q: "有自定义域名吗？", a: "官方子域名如 name.demox.site，用法见 CLI 文档。" },
      ],
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
      title: "发布 dist 目录 | Demox",
      description: "发布根目录含 index.html 的 dist 或 build。执行 demox deploy ./dist，得到公网 HTTPS 地址。",
      eyebrow: "dist 目录",
      h1: "怎样发布 dist 目录？",
      answer: "根目录必须有 index.html。执行 demox deploy ./dist，或把目录打成 ZIP 上传。不要上传源码仓库根目录。",
      steps: [
        "执行项目的生产构建。",
        "确认存在 dist/index.html。",
        "执行 demox deploy ./dist，或把目录打 ZIP 上传。",
        "打开站点，检查 CSS、JS 和前端路由。",
      ],
      faqs: [
        { q: "能上传仓库根目录吗？", a: "不能。发布构建产物，不要上传 package.json 和 node_modules。" },
        { q: "刷新 SPA 路由会 404 吗？", a: "用户站点保留 SPA 回退。www.demox.site 上未知文档路径仍是真正的 404。" },
      ],
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
      title: "发布 Vite 应用 | Demox",
      description: "构建 Vite 应用后把 dist 发到 Demox。用 demox deploy ./dist 或 MCP。不需要 Git 托管。",
      eyebrow: "Vite",
      h1: "Vite 项目怎么发布？",
      answer: "先 npm run build，再 demox deploy ./dist。资源 base path 按静态托管设置。不要上传源码。",
      steps: [
        "npm run build",
        "检查 dist/index.html 和带 hash 的资源。",
        "demox deploy ./dist",
        "用无痕窗口刷新内部路由。",
      ],
      faqs: [
        { q: "Vite SSR 怎么办？", a: "先静态导出，或把服务放在别的地方。Demox 不跑 Vite 开发服务器。" },
        { q: "环境变量呢？", a: "只有 VITE_ 开头的公开变量能进前端构建。密钥放在函数 env。" },
      ],
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
      title: "发布 React 构建产物 | Demox",
      description: "先生产构建，再 demox deploy ./dist 或 ./build，得到公网 HTTPS 地址。",
      eyebrow: "React",
      h1: "React 构建产物怎么发布？",
      answer: "先生产构建。Vite 一般是 dist，CRA 一般是 build。对那个目录执行 demox deploy。源码目录不能直接上。",
      steps: [
        "按你的 React 工具链执行生产构建。",
        "找到含 index.html 的目录。",
        "对该目录执行 demox deploy。",
        "对嵌套的前端路由做一次硬刷新检查。",
      ],
      faqs: [
        { q: "能上传 src/ 吗？", a: "不能。上传生产构建产物。" },
        { q: "Create React App 还是 Vite？", a: "构建完成后都可以。把 demox deploy 指向 dist 或 build。" },
      ],
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
      title: "Netlify Drop 的快速发链接替代 | Demox",
      description: "没有完整 Netlify 项目、只想把文件夹变成公开链接？Demox 支持 HTML、ZIP、dist，以及网页、CLI、MCP。",
      eyebrow: "Netlify Drop 替代",
      h1: "什么时候用 Demox 代替拖拽发布？",
      answer: "手里已经有静态目录、只想马上发链接时，可以用 Demox。它不是完整 Netlify。Git 集成和整套 CI 请留在原平台。",
      steps: [
        "如果只有静态文件目录，上传到 Demox 或执行 demox deploy。",
        "如果要让 AI 助手发布，用 MCP。",
        "如果需要 Netlify 的完整 CI 和身份体系，留在 Netlify。",
        "迁移已有应用前先看 /when-to-use-demox。",
      ],
      faqs: [
        { q: "这是可以原样替换的 Netlify 吗？", a: "不是。它适合给静态文件和小 Node handler 一个马上能打开的链接。" },
        { q: "能拖 ZIP 吗？", a: "可以。ZIP 根目录必须有 index.html。" },
      ],
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
      title: "Surge.sh 的静态发布替代 | Demox",
      description: "用 CLI 发布静态站，同时还有网页端和 MCP。Demox 不是完整的 Surge 替代品。",
      eyebrow: "Surge 替代",
      h1: "什么时候用 Demox 代替 Surge？",
      answer: "需要 CLI 发静态目录，同时又要网页拖拽和 MCP 时，可以用 Demox。命令不是 surge，而是 demox deploy。",
      steps: [
        "安装 @demox-site/cli。",
        "demox login",
        "demox deploy ./dist",
        "如果项目不是静态站，先对照 /when-to-use-demox。",
      ],
      faqs: [
        { q: "命令是 surge 吗？", a: "不是。命令是 demox deploy。" },
        { q: "Surge 有 MCP 吗？", a: "Demox 为 Claude Code 和 Cursor 提供了 MCP。这就是本页要说的差别。" },
      ],
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
      title: "静态站场景下的 Vercel 替代选择 | Demox",
      description: "没有完整 Vercel 项目、只想给静态构建一个公开地址？Demox 可通过网页、CLI 或 MCP 发布 dist、HTML 和 ZIP。",
      eyebrow: "静态站场景",
      h1: "静态站什么时候用 Demox 而不是完整云平台？",
      answer: "只有 dist 或 HTML、需要马上发链接、并且希望 CLI/MCP 也能发时，用 Demox。它不是 Vercel 替代品。需要 SSR 就留在能跑该运行时的平台。",
      steps: [
        "先做静态导出，或 Vite/React 生产构建。",
        "用 Demox 发布该目录。",
        "如果需要完整云平台，继续用 Vercel 或同类服务。",
        "不适合的情况见 /when-to-use-demox。",
      ],
      faqs: [
        { q: "Demox 能替代 Vercel 吗？", a: "不能。产品和文档写的是：给一个马上能打开的链接，外加小型 Node handler。" },
        { q: "Next.js 呢？", a: "只支持静态导出。App Router 的服务端能力需要别的主机。" },
      ],
    },
  },
];

export function renderIntentFallback(page) {
  const steps = page.steps.map((step, index) => `<li><strong>Step ${index + 1}.</strong> ${escapeHtml(step)}</li>`).join("");
  const faqs = page.faqs.map((item) => `<h3>${escapeHtml(item.q)}</h3><p>${escapeHtml(item.a)}</p>`).join("");
  const zhSteps = page.zh.steps.map((step, index) => `<li><strong>${String(index + 1).padStart(2, "0")}</strong> ${escapeHtml(step)}</li>`).join("");
  const zhFaqs = page.zh.faqs.map((item) => `<h3>${escapeHtml(item.q)}</h3><p>${escapeHtml(item.a)}</p>`).join("");
  const related = INTENT_LANDINGS.filter((item) => item.id !== page.id)
    .slice(0, 6)
    .map((item) => `<li><a href="/${item.id}">${escapeHtml(item.h1)}</a></li>`)
    .join("");
  return `<main data-crawlable-fallback class="fallback-simple" lang="en"><article><p>${escapeHtml(page.eyebrow)} · Updated ${INTENT_UPDATED} · Demox team</p><h1>${escapeHtml(page.h1)}</h1><p><strong>Direct answer:</strong> ${escapeHtml(page.answer)}</p><h2>How to do it</h2><ol>${steps}</ol><h2>FAQ</h2>${faqs}<section lang="zh-CN"><h2>${escapeHtml(page.zh.h1)}</h2><p>${escapeHtml(page.zh.answer)}</p><h3>按这个顺序做</h3><ol>${zhSteps}</ol><h3>常见问题</h3>${zhFaqs}</section><h2>Related Demox pages</h2><ul>${related}<li><a href="/doc">CLI and MCP docs</a></li><li><a href="/when-to-use-demox">When to use Demox</a></li></ul><p><a href="/console/projects">Upload and publish</a> · <a href="/doc">Read the docs</a></p></article></main>`;
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
